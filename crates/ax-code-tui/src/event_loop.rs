//! Terminal event loop: keys → Action → dispatch → Effect execution.

use crate::action::Action;
use crate::auth::AuthConfig;
use crate::client::RuntimeClient;
use crate::dispatch::dispatch;
use crate::effect::Effect;
use crate::state::{AppState, PermissionDecision, SessionPhase};
use crate::terminal_ui;
use anyhow::{Context, Result};
use crossterm::event::{self, Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use crossterm::execute;
use crossterm::terminal::{
    EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode,
};
use ratatui::Terminal;
use ratatui::backend::CrosstermBackend;
use std::io::{self, Write};
use std::time::Duration;
use tokio::sync::mpsc;

pub struct LaunchConfig {
    pub base_url: String,
    pub directory: String,
    pub session_id: Option<String>,
    pub initial_prompt: Option<String>,
    pub auth: AuthConfig,
    /// When true, draw one smoke frame and exit (no TTY raw mode required if headless_smoke).
    pub smoke: bool,
    /// Force headless string render instead of crossterm (CI).
    pub headless: bool,
}

/// Shared runtime for effect execution (HTTP + optional SSE fan-in).
struct Runtime<'a> {
    client: &'a RuntimeClient,
    action_tx: mpsc::UnboundedSender<Action>,
    sse_handle: Option<tokio::task::JoinHandle<()>>,
}

impl Drop for Runtime<'_> {
    fn drop(&mut self) {
        if let Some(handle) = self.sse_handle.take() {
            handle.abort();
        }
    }
}

pub async fn run(config: LaunchConfig) -> Result<i32> {
    let mut state = AppState::new(config.directory.clone());
    state.session_id = config.session_id.clone();
    if let Some(p) = &config.initial_prompt {
        state.prompt = p.clone();
    }

    let client = RuntimeClient::new(&config.base_url, config.auth.clone(), &config.directory)?;

    if config.smoke || config.headless {
        return run_headless(&mut state, &client, &config).await;
    }

    run_interactive(&mut state, &client, &config).await
}

async fn run_headless(
    state: &mut AppState,
    client: &RuntimeClient,
    config: &LaunchConfig,
) -> Result<i32> {
    let (action_tx, mut action_rx) = mpsc::unbounded_channel::<Action>();
    let mut runtime = Runtime {
        client,
        action_tx,
        sse_handle: None,
    };

    apply_boot(state, &mut runtime).await?;

    // Fail closed: boot must leave us with a ready session.
    if state.session_id.is_none() || state.phase == SessionPhase::Failed {
        let frame = terminal_ui::render_smoke_frame(state);
        println!("{frame}");
        eprintln!(
            "-- ax-code-tui smoke failed: session not ready ({}) --",
            state.error.as_deref().unwrap_or(state.status.as_str())
        );
        return Ok(1);
    }

    // Drain any SSE already armed by SubscribeEvents (stream deltas / permissions).
    let stream_wait = std::env::var("AX_CODE_TUI_SMOKE_STREAM_MS")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(400);
    let deadline = tokio::time::Instant::now() + Duration::from_millis(stream_wait);
    while tokio::time::Instant::now() < deadline {
        match tokio::time::timeout(Duration::from_millis(50), action_rx.recv()).await {
            Ok(Some(action)) => {
                for effect in dispatch(state, action) {
                    execute_effect(state, &mut runtime, effect).await?;
                }
            }
            Ok(None) => break,
            Err(_) => {}
        }
    }

    // Optional synthetic permission (only when session is healthy).
    if std::env::var_os("AX_CODE_TUI_SMOKE_PERMISSION").is_some() {
        for effect in dispatch(
            state,
            Action::PermissionAsked {
                request_id: "smoke_req".into(),
                summary: "smoke permission".into(),
            },
        ) {
            execute_effect(state, &mut runtime, effect).await?;
        }
        for effect in dispatch(
            state,
            Action::PermissionReply {
                decision: PermissionDecision::Allow,
            },
        ) {
            let _ = execute_effect(state, &mut runtime, effect).await;
        }
        dispatch(state, Action::PermissionReplyAck);
    }

    if let Some(prompt) = &config.initial_prompt {
        for effect in dispatch(
            state,
            Action::PromptSet {
                text: prompt.clone(),
            },
        ) {
            execute_effect(state, &mut runtime, effect).await?;
        }
        for effect in dispatch(state, Action::PromptSubmit) {
            if let Err(err) = execute_effect(state, &mut runtime, effect).await {
                state.error = Some(err.to_string());
                state.turn_active = false;
            }
        }
        // Allow more SSE after submit.
        let post = tokio::time::Instant::now() + Duration::from_millis(stream_wait);
        while tokio::time::Instant::now() < post {
            match tokio::time::timeout(Duration::from_millis(50), action_rx.recv()).await {
                Ok(Some(action)) => {
                    for effect in dispatch(state, action) {
                        let _ = execute_effect(state, &mut runtime, effect).await;
                    }
                }
                Ok(None) => break,
                Err(_) => {}
            }
        }
    }

    let frame = terminal_ui::render_smoke_frame(state);
    println!("{frame}");

    let ok = state.session_id.is_some()
        && state.phase != SessionPhase::Failed
        && state.error.is_none();
    if !ok {
        eprintln!(
            "-- ax-code-tui smoke failed ({}) --",
            state.error.as_deref().unwrap_or(state.status.as_str())
        );
        for effect in dispatch(state, Action::Quit) {
            let _ = execute_effect(state, &mut runtime, effect).await;
        }
        return Ok(1);
    }

    println!("-- ax-code-tui smoke ok --");
    for effect in dispatch(state, Action::Quit) {
        execute_effect(state, &mut runtime, effect).await?;
    }
    Ok(0)
}

async fn run_interactive(
    state: &mut AppState,
    client: &RuntimeClient,
    _config: &LaunchConfig,
) -> Result<i32> {
    enable_raw_mode().context("enable raw mode")?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen).context("enter alt screen")?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend).context("create terminal")?;

    let (action_tx, mut action_rx) = mpsc::unbounded_channel::<Action>();
    let mut runtime = Runtime {
        client,
        action_tx,
        sse_handle: None,
    };

    let boot_result = apply_boot(state, &mut runtime).await;
    if let Err(err) = boot_result {
        state.error = Some(err.to_string());
        state.status = "boot error".into();
    }

    let mut exit_code = 0;
    loop {
        // Drain runtime actions (SSE) before paint.
        while let Ok(action) = action_rx.try_recv() {
            for effect in dispatch(state, action) {
                if let Err(err) = execute_effect(state, &mut runtime, effect).await {
                    state.error = Some(err.to_string());
                }
            }
        }

        terminal.draw(|f| terminal_ui::draw(f, state))?;

        if state.should_quit {
            break;
        }

        if event::poll(Duration::from_millis(100)).context("poll")? {
            match event::read().context("read event")? {
                Event::Key(key)
                    if key.kind == KeyEventKind::Press || key.kind == KeyEventKind::Repeat =>
                {
                    handle_key(state, &mut runtime, key).await?;
                }
                Event::Resize(cols, rows) => {
                    dispatch(state, Action::Resize { cols, rows });
                }
                _ => {}
            }
        }

        if state.phase == SessionPhase::Failed {
            exit_code = 1;
        }
        if state.phase == SessionPhase::AwaitingAuth {
            exit_code = 2;
        }
    }

    disable_raw_mode().ok();
    execute!(terminal.backend_mut(), LeaveAlternateScreen).ok();
    terminal.show_cursor().ok();
    let _ = io::stdout().flush();
    println!("ax-code-tui: terminal restored");
    Ok(exit_code)
}

async fn apply_boot(state: &mut AppState, runtime: &mut Runtime<'_>) -> Result<()> {
    for effect in dispatch(state, Action::Boot) {
        execute_effect(state, runtime, effect).await?;
    }
    Ok(())
}

async fn handle_key(state: &mut AppState, runtime: &mut Runtime<'_>, key: KeyEvent) -> Result<()> {
    if state.permission.is_some() {
        match key.code {
            KeyCode::Char('y') | KeyCode::Char('Y') => {
                run_action(
                    state,
                    runtime,
                    Action::PermissionReply {
                        decision: PermissionDecision::Allow,
                    },
                )
                .await?;
            }
            KeyCode::Char('n') | KeyCode::Char('N') | KeyCode::Esc => {
                run_action(
                    state,
                    runtime,
                    Action::PermissionReply {
                        decision: PermissionDecision::Deny,
                    },
                )
                .await?;
            }
            KeyCode::Char('q') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                run_action(state, runtime, Action::Quit).await?;
            }
            _ => {}
        }
        return Ok(());
    }

    match key.code {
        KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            if state.turn_active {
                run_action(state, runtime, Action::AbortTurn).await?;
            } else if state.prompt.is_empty() {
                run_action(state, runtime, Action::Quit).await?;
            } else {
                run_action(
                    state,
                    runtime,
                    Action::PromptSet {
                        text: String::new(),
                    },
                )
                .await?;
            }
        }
        KeyCode::Char('q') if key.modifiers.is_empty() && state.prompt.is_empty() => {
            run_action(state, runtime, Action::Quit).await?;
        }
        KeyCode::Enter => {
            run_action(state, runtime, Action::PromptSubmit).await?;
        }
        KeyCode::Backspace => {
            let mut t = state.prompt.clone();
            t.pop();
            run_action(state, runtime, Action::PromptSet { text: t }).await?;
        }
        KeyCode::Char(c) if !key.modifiers.contains(KeyModifiers::CONTROL) => {
            let mut t = state.prompt.clone();
            t.push(c);
            run_action(state, runtime, Action::PromptSet { text: t }).await?;
        }
        KeyCode::Esc => {
            run_action(state, runtime, Action::Quit).await?;
        }
        _ => {}
    }
    Ok(())
}

async fn run_action(state: &mut AppState, runtime: &mut Runtime<'_>, action: Action) -> Result<()> {
    for effect in dispatch(state, action) {
        execute_effect(state, runtime, effect).await?;
    }
    Ok(())
}

async fn execute_effect(
    state: &mut AppState,
    runtime: &mut Runtime<'_>,
    effect: Effect,
) -> Result<()> {
    match effect {
        Effect::None => {}
        Effect::EnsureSession { session_id } => {
            match ensure_session(runtime.client, session_id.as_deref()).await {
                Ok(id) => {
                    for e in dispatch(state, Action::SessionReady { session_id: id }) {
                        Box::pin(execute_effect(state, runtime, e)).await?;
                    }
                }
                Err(err) => {
                    for e in dispatch(
                        state,
                        Action::SessionFailed {
                            message: err.to_string(),
                        },
                    ) {
                        Box::pin(execute_effect(state, runtime, e)).await?;
                    }
                }
            }
        }
        Effect::SubscribeEvents => {
            // Abort prior stream if re-subscribing.
            if let Some(handle) = runtime.sse_handle.take() {
                handle.abort();
            }
            let handle = runtime.client.spawn_event_stream(runtime.action_tx.clone());
            runtime.sse_handle = Some(handle);
            state.status = "subscribed events".into();
        }
        Effect::SubmitPrompt { session_id, text } => {
            match runtime.client.submit_prompt(&session_id, &text).await {
                Ok(()) => {
                    for e in dispatch(state, Action::PromptAccepted) {
                        Box::pin(execute_effect(state, runtime, e)).await?;
                    }
                }
                Err(err) => {
                    state.error = Some(err.to_string());
                    state.turn_active = false;
                }
            }
        }
        Effect::AbortTurn { session_id } => match runtime.client.abort(&session_id).await {
            Ok(()) => {
                for e in dispatch(state, Action::AbortAck) {
                    Box::pin(execute_effect(state, runtime, e)).await?;
                }
            }
            Err(err) => {
                state.error = Some(err.to_string());
            }
        },
        Effect::ReplyPermission {
            request_id,
            decision,
        } => match runtime.client.reply_permission(&request_id, decision).await {
            Ok(()) => {
                for e in dispatch(state, Action::PermissionReplyAck) {
                    Box::pin(execute_effect(state, runtime, e)).await?;
                }
            }
            Err(err) => {
                state.error = Some(err.to_string());
            }
        },
        Effect::Shutdown => {
            if let Some(handle) = runtime.sse_handle.take() {
                handle.abort();
            }
            state.should_quit = true;
            dispatch(state, Action::QuitComplete);
        }
    }
    Ok(())
}

async fn ensure_session(client: &RuntimeClient, session_id: Option<&str>) -> Result<String> {
    client.probe().await.context("runtime probe")?;
    if let Some(id) = session_id {
        client.get_session(id).await.context("attach session")?;
        return Ok(id.to_string());
    }
    client.create_session().await.context("create session")
}
