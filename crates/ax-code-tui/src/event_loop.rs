//! Terminal event loop: keys → Action → dispatch → Effect execution.

use crate::action::Action;
use crate::auth::AuthConfig;
use crate::client::RuntimeClient;
use crate::dispatch::dispatch;
use crate::effect::Effect;
use crate::state::{AppState, PermissionDecision};
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
    apply_boot(state, client).await?;
    // Optional one-shot demo permission for smoke coverage without a live agent.
    if std::env::var_os("AX_CODE_TUI_SMOKE_PERMISSION").is_some() {
        for effect in dispatch(
            state,
            Action::PermissionAsked {
                request_id: "smoke_req".into(),
                summary: "smoke permission".into(),
            },
        ) {
            execute_effect(state, client, effect).await?;
        }
        for effect in dispatch(
            state,
            Action::PermissionReply {
                decision: PermissionDecision::Allow,
            },
        ) {
            // Smoke may not have a real request — ignore HTTP errors.
            let _ = execute_effect(state, client, effect).await;
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
            execute_effect(state, client, effect).await?;
        }
        for effect in dispatch(state, Action::PromptSubmit) {
            let _ = execute_effect(state, client, effect).await;
        }
    }
    let frame = terminal_ui::render_smoke_frame(state);
    println!("{frame}");
    println!("-- ax-code-tui smoke ok --");
    // Clean quit path.
    for effect in dispatch(state, Action::Quit) {
        execute_effect(state, client, effect).await?;
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

    let boot_result = apply_boot(state, client).await;
    if let Err(err) = boot_result {
        state.error = Some(err.to_string());
        state.status = "boot error".into();
    }

    let mut exit_code = 0;
    loop {
        terminal.draw(|f| terminal_ui::draw(f, state))?;

        if state.should_quit {
            break;
        }

        // Poll events with a short timeout so status can refresh.
        if event::poll(Duration::from_millis(200)).context("poll")? {
            match event::read().context("read event")? {
                Event::Key(key) if key.kind == KeyEventKind::Press || key.kind == KeyEventKind::Repeat => {
                    handle_key(state, client, key).await?;
                }
                Event::Resize(cols, rows) => {
                    dispatch(state, Action::Resize { cols, rows });
                }
                _ => {}
            }
        } else {
            // Opportunistic event poll from backend.
            if let Ok(actions) = client.poll_events_once().await {
                for action in actions {
                    for effect in dispatch(state, action) {
                        if let Err(err) = execute_effect(state, client, effect).await {
                            state.error = Some(err.to_string());
                        }
                    }
                }
            }
        }

        if state.phase == crate::state::SessionPhase::Failed {
            exit_code = 1;
        }
        if state.phase == crate::state::SessionPhase::AwaitingAuth {
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

async fn apply_boot(state: &mut AppState, client: &RuntimeClient) -> Result<()> {
    for effect in dispatch(state, Action::Boot) {
        execute_effect(state, client, effect).await?;
    }
    Ok(())
}

async fn handle_key(state: &mut AppState, client: &RuntimeClient, key: KeyEvent) -> Result<()> {
    if state.permission.is_some() {
        match key.code {
            KeyCode::Char('y') | KeyCode::Char('Y') => {
                run_action(
                    state,
                    client,
                    Action::PermissionReply {
                        decision: PermissionDecision::Allow,
                    },
                )
                .await?;
            }
            KeyCode::Char('n') | KeyCode::Char('N') | KeyCode::Esc => {
                run_action(
                    state,
                    client,
                    Action::PermissionReply {
                        decision: PermissionDecision::Deny,
                    },
                )
                .await?;
            }
            KeyCode::Char('q') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                run_action(state, client, Action::Quit).await?;
            }
            _ => {}
        }
        return Ok(());
    }

    match key.code {
        KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            if state.turn_active {
                run_action(state, client, Action::AbortTurn).await?;
            } else if state.prompt.is_empty() {
                run_action(state, client, Action::Quit).await?;
            } else {
                run_action(
                    state,
                    client,
                    Action::PromptSet {
                        text: String::new(),
                    },
                )
                .await?;
            }
        }
        KeyCode::Char('q') if key.modifiers.is_empty() && state.prompt.is_empty() => {
            run_action(state, client, Action::Quit).await?;
        }
        KeyCode::Enter => {
            run_action(state, client, Action::PromptSubmit).await?;
        }
        KeyCode::Backspace => {
            let mut t = state.prompt.clone();
            t.pop();
            run_action(state, client, Action::PromptSet { text: t }).await?;
        }
        KeyCode::Char(c) if !key.modifiers.contains(KeyModifiers::CONTROL) => {
            let mut t = state.prompt.clone();
            t.push(c);
            run_action(state, client, Action::PromptSet { text: t }).await?;
        }
        KeyCode::Esc => {
            run_action(state, client, Action::Quit).await?;
        }
        _ => {}
    }
    Ok(())
}

async fn run_action(state: &mut AppState, client: &RuntimeClient, action: Action) -> Result<()> {
    for effect in dispatch(state, action) {
        execute_effect(state, client, effect).await?;
    }
    Ok(())
}

async fn execute_effect(
    state: &mut AppState,
    client: &RuntimeClient,
    effect: Effect,
) -> Result<()> {
    match effect {
        Effect::None => {}
        Effect::EnsureSession { session_id } => {
            match ensure_session(client, session_id.as_deref()).await {
                Ok(id) => {
                    for e in dispatch(state, Action::SessionReady { session_id: id }) {
                        Box::pin(execute_effect(state, client, e)).await?;
                    }
                }
                Err(err) => {
                    for e in dispatch(
                        state,
                        Action::SessionFailed {
                            message: err.to_string(),
                        },
                    ) {
                        Box::pin(execute_effect(state, client, e)).await?;
                    }
                }
            }
        }
        Effect::SubscribeEvents => {
            // Phase 2: opportunistic polling from the main loop; nothing to arm.
        }
        Effect::SubmitPrompt { session_id, text } => match client.submit_prompt(&session_id, &text).await
        {
            Ok(()) => {
                for e in dispatch(state, Action::PromptAccepted) {
                    Box::pin(execute_effect(state, client, e)).await?;
                }
            }
            Err(err) => {
                state.error = Some(err.to_string());
                state.turn_active = false;
            }
        },
        Effect::AbortTurn { session_id } => match client.abort(&session_id).await {
            Ok(()) => {
                for e in dispatch(state, Action::AbortAck) {
                    Box::pin(execute_effect(state, client, e)).await?;
                }
            }
            Err(err) => {
                state.error = Some(err.to_string());
            }
        },
        Effect::ReplyPermission {
            request_id,
            decision,
        } => match client.reply_permission(&request_id, decision).await {
            Ok(()) => {
                for e in dispatch(state, Action::PermissionReplyAck) {
                    Box::pin(execute_effect(state, client, e)).await?;
                }
            }
            Err(err) => {
                state.error = Some(err.to_string());
            }
        },
        Effect::Shutdown => {
            // Interactive path restores terminal in run_interactive finally.
            state.should_quit = true;
            dispatch(state, Action::QuitComplete);
        }
    }
    Ok(())
}

async fn ensure_session(client: &RuntimeClient, session_id: Option<&str>) -> Result<String> {
    // Probe first so auth failures surface clearly.
    client.probe().await.context("runtime probe")?;
    if let Some(id) = session_id {
        client.get_session(id).await.context("attach session")?;
        return Ok(id.to_string());
    }
    client.create_session().await.context("create session")
}
