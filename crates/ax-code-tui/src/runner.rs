//! TUI Runner for ax-code-tui.
//!
//! Provides the main event loop that connects the headless client to the
//! Ratatui application state and renders the UI.

use clap::Parser;
use crossterm::event::EventStream;
use futures_util::StreamExt;
use tokio::sync::mpsc;

use crate::client::{
    ClientConfig, DEFAULT_SERVER_URL, HeadlessClient, PromptOptions, parse_model_selection,
};
use crate::diagnostics::{self, DiagnosticEvent};
use crate::events::RuntimeEvent;
use crate::launch_policy::{self, LaunchInput, LaunchRoute};
use crate::terminal::NativeTerminal;
use crate::tui::app::{App, SessionSummary};
use crate::tui::input::{InputAction, handle_input};
use crate::tui::render::render;

/// Command-line arguments for the TUI binary.
#[derive(Parser, Debug, Clone)]
#[command(
    name = "ax-code-tui",
    about = "AX Code native TUI client (experimental)"
)]
pub struct CliArgs {
    /// URL of the headless ax-code server.
    /// Format: http://host:port
    #[arg(long, default_value = DEFAULT_SERVER_URL)]
    pub server_url: String,

    /// Auth token for the server.
    /// If not provided, will attempt to use environment variable AX_CODE_AUTH_TOKEN.
    #[arg(long, env = "AX_CODE_AUTH_TOKEN")]
    pub auth_token: Option<String>,

    /// Directory to use as the workspace.
    #[arg(long, default_value = ".")]
    pub directory: String,

    /// Initial prompt to send (optional).
    #[arg(long)]
    pub prompt: Option<String>,

    /// Session ID to connect to (optional, will use most recent if not specified).
    #[arg(long)]
    pub session: Option<String>,

    /// Continue the most recent session.
    #[arg(long = "continue")]
    pub continue_session: bool,

    /// Fork the selected session before attaching.
    #[arg(long)]
    pub fork: bool,

    /// Model to use in provider/model format.
    #[arg(long)]
    pub model: Option<String>,

    /// Agent to use for submitted prompts.
    #[arg(long)]
    pub agent: Option<String>,
}

impl CliArgs {
    /// Convert CLI arguments to a ClientConfig.
    pub fn into_config(self) -> ClientConfig {
        ClientConfig {
            base_url: self.server_url,
            auth_token: self.auth_token,
            directory: Some(self.directory),
            session: self.session,
            prompt: self.prompt,
        }
    }

    pub fn into_runner(self) -> Runner {
        let launch = LaunchOptions {
            continue_session: self.continue_session,
            fork: self.fork,
            model: self.model.clone(),
            agent: self.agent.clone(),
        };
        Runner::new(self.into_config()).with_launch_options(launch)
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LaunchOptions {
    pub continue_session: bool,
    pub fork: bool,
    pub model: Option<String>,
    pub agent: Option<String>,
}

/// The main TUI runner that manages the event loop.
pub struct Runner {
    config: ClientConfig,
    launch: LaunchOptions,
}

impl Runner {
    /// Create a new runner with the given configuration.
    pub fn new(config: ClientConfig) -> Self {
        Self {
            config,
            launch: LaunchOptions::default(),
        }
    }

    pub fn with_launch_options(mut self, launch: LaunchOptions) -> Self {
        self.launch = launch;
        self
    }

    /// Run the TUI event loop.
    pub async fn run(
        &self,
        mut terminal: NativeTerminal,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // Create the app state
        let mut app = App::new();

        // Check for legacy home rollback (ADR-035 Phase 5)
        let legacy_home_requested = diagnostics::check_legacy_rollback();
        if legacy_home_requested {
            app.set_status("Legacy home route active (AX_CODE_TUI_LEGACY_HOME=1)".to_string());
        }

        // Emit renderer startup diagnostic
        DiagnosticEvent::RendererStartup {
            renderer: "ratatui".to_string(),
            success: true,
            error: None,
        }
        .emit();

        let prompt_options = PromptOptions {
            model: self
                .launch
                .model
                .as_deref()
                .map(parse_model_selection)
                .transpose()?,
            agent: self.launch.agent.clone(),
        };

        // Bridge the server stream into the event-driven UI loop.
        let (event_tx, mut event_rx) = mpsc::channel::<RuntimeEvent>(256);

        // Try to create the client
        let client = match HeadlessClient::new(self.config.clone()) {
            Ok(c) => Some(c),
            Err(e) => {
                // Log error but continue - TUI can run in offline mode
                app.set_status(format!("Connection failed: {}", e));
                None
            }
        };

        // Subscribe to the headless server's event stream via HeadlessClient.
        // This applies the configured auth token (HeadlessClient::new sets the
        // Authorization header in default_headers) and parses SSE with a
        // cross-chunk buffer. The runner must not build its own reqwest client
        // here — that previously bypassed auth entirely on /global/event.
        let mut event_join_handle: Option<tokio::task::JoinHandle<()>> = None;
        if let Some(ref client) = client {
            match client.subscribe().await {
                Ok(server_rx) => {
                    // Bridge the server receiver into our local channel.
                    let event_tx = event_tx.clone();
                    event_join_handle = Some(tokio::spawn(async move {
                        let mut server_rx = server_rx;
                        while let Some(event) = server_rx.recv().await {
                            if event_tx.send(event).await.is_err() {
                                return;
                            }
                        }
                    }));
                }
                Err(e) => {
                    app.set_status(format!("Event stream failed: {}", e));
                }
            }
        }
        drop(event_tx);

        let recent_session_ids = if legacy_home_requested {
            Vec::new()
        } else if let Some(ref client) = client {
            match client.list_recent_session_ids().await {
                Ok(ids) => ids,
                Err(e) => {
                    app.set_status(format!("Session list failed: {}", e));
                    Vec::new()
                }
            }
        } else {
            Vec::new()
        };

        app.load_sessions(
            recent_session_ids
                .iter()
                .map(|id| SessionSummary {
                    id: id.clone(),
                    title: None,
                    message_count: 0,
                })
                .collect(),
        );

        // `--continue --prompt` attaches to the most recent session and sends
        // there. Without --continue, a standalone prompt starts a new session.
        let explicit_session_id = self.config.session.clone().or_else(|| {
            self.launch
                .continue_session
                .then(|| recent_session_ids.first().cloned())
                .flatten()
        });
        let launch_input = LaunchInput {
            explicit_prompt: if explicit_session_id.is_some() {
                None
            } else {
                self.config.prompt.clone()
            },
            explicit_session_id,
            recent_session_ids: recent_session_ids.clone(),
            has_project_context: false,
        };
        let route = resolve_runner_launch_route(&launch_input, legacy_home_requested);

        // Apply the resolved launch route: attach to an existing session
        // or create a new one (optionally sending an initial prompt).
        // This runs after SSE subscription so SessionCreated events are
        // captured by the event stream.
        if let (Some(client), Some(route)) = (&client, &route) {
            match route {
                LaunchRoute::Session { session_id } => {
                    let attached_session_id = if self.launch.fork {
                        client.fork_session(session_id).await?
                    } else {
                        session_id.clone()
                    };
                    app.session_id = Some(attached_session_id.clone());
                    let mut transcript_loaded = true;
                    match client.session_transcript_events(&attached_session_id).await {
                        Ok(events) => {
                            for event in events {
                                app.handle_event(event);
                            }
                        }
                        Err(e) => {
                            transcript_loaded = false;
                            app.set_status(format!("Attached, but transcript load failed: {}", e));
                        }
                    }
                    if transcript_loaded {
                        app.set_status(format!("Attached to session: {attached_session_id}"));
                    }
                    if let Some(initial_prompt) = self
                        .config
                        .prompt
                        .as_deref()
                        .filter(|prompt| !prompt.is_empty())
                    {
                        if let Err(e) = client
                            .send_prompt_with_options(
                                &attached_session_id,
                                initial_prompt,
                                &prompt_options,
                            )
                            .await
                        {
                            app.set_status(format!("Failed to send initial prompt: {e}"));
                        }
                    }
                }
                LaunchRoute::NewSession { prompt } => match client.create_session().await {
                    Ok(session_id) => {
                        app.session_id = Some(session_id.clone());
                        if let Some(initial_prompt) = prompt {
                            if let Err(e) = client
                                .send_prompt_with_options(
                                    &session_id,
                                    initial_prompt,
                                    &prompt_options,
                                )
                                .await
                            {
                                app.set_status(format!("Failed to send initial prompt: {e}"));
                            }
                        } else {
                            app.set_status(format!("Created session: {session_id}"));
                        }
                    }
                    Err(e) => {
                        app.set_status(format!("Failed to create session: {}", e));
                    }
                },
            }
        }

        // Event-driven main loop. The old implementation woke and redrew every
        // 50ms even when idle; native mode now repaints only for terminal or
        // runtime events.
        let mut terminal_events = EventStream::new();
        let mut runtime_events_open = true;
        let shutdown = shutdown_signal();
        tokio::pin!(shutdown);
        terminal.draw(|frame| render(frame, &app))?;
        loop {
            tokio::select! {
                () = &mut shutdown => {
                    app.quit();
                }
                maybe_terminal_event = terminal_events.next() => {
                    match maybe_terminal_event {
                        Some(Ok(event)) => {
                            let action = handle_input(&mut app, event);
                            apply_input_action(
                                &mut app,
                                client.as_ref(),
                                action,
                                &prompt_options,
                            ).await;
                        }
                        Some(Err(error)) => return Err(Box::new(error)),
                        None => break,
                    }
                }
                maybe_runtime_event = event_rx.recv(), if runtime_events_open => {
                    match maybe_runtime_event {
                        Some(event) => {
                            app.handle_event(event);
                            // Coalesce event bursts into one paint while preserving order.
                            while let Ok(event) = event_rx.try_recv() {
                                app.handle_event(event);
                            }
                        }
                        None => {
                            runtime_events_open = false;
                            app.set_status("Runtime event stream closed".to_string());
                        }
                    }
                }
            }

            if app.should_quit {
                break;
            }
            terminal.draw(|frame| render(frame, &app))?;
        }

        // Clean up the event bridge task. subscribe()'s own SSE task exits
        // when the server closes the stream or when our bridge drops the
        // receiver (event_tx goes out of scope on return).
        if let Some(handle) = event_join_handle {
            handle.abort();
        }

        Ok(())
    }
}

#[cfg(unix)]
async fn shutdown_signal() {
    use tokio::signal::unix::{SignalKind, signal};

    let mut interrupt = signal(SignalKind::interrupt()).expect("install SIGINT handler");
    let mut terminate = signal(SignalKind::terminate()).expect("install SIGTERM handler");
    let mut hangup = signal(SignalKind::hangup()).expect("install SIGHUP handler");
    tokio::select! {
        _ = interrupt.recv() => {}
        _ = terminate.recv() => {}
        _ = hangup.recv() => {}
    }
}

#[cfg(not(unix))]
async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
}

async fn apply_input_action(
    app: &mut App,
    client: Option<&HeadlessClient>,
    action: InputAction,
    prompt_options: &PromptOptions,
) {
    let Some(client) = client else {
        match action {
            InputAction::None => {}
            InputAction::SubmitPrompt(prompt) => {
                app.insert_text(&prompt);
                app.set_status("Native runtime is unavailable; prompt restored".to_string());
            }
            _ => {
                app.set_status("Native runtime is unavailable".to_string());
            }
        }
        return;
    };

    match action {
        InputAction::None => {}
        InputAction::SubmitPrompt(prompt) => {
            let session_id = match app.current_session_id().map(str::to_string) {
                Some(session_id) => session_id,
                None => match client.create_session().await {
                    Ok(session_id) => {
                        app.session_id = Some(session_id.clone());
                        session_id
                    }
                    Err(error) => {
                        app.insert_text(&prompt);
                        app.set_status(format!("Failed to create session: {error}"));
                        return;
                    }
                },
            };
            app.scroll_offset = 0;
            if let Err(error) = client
                .send_prompt_with_options(&session_id, &prompt, prompt_options)
                .await
            {
                app.insert_text(&prompt);
                app.set_status(format!("Failed to send prompt: {error}"));
            }
        }
        InputAction::AcceptPermission {
            session_id,
            request_id,
        } => {
            match client
                .reply_permission(&session_id, &request_id, true)
                .await
            {
                Ok(()) => app.resolve_permission(&request_id),
                Err(error) => app.set_status(format!("Permission reply failed: {error}")),
            }
        }
        InputAction::RejectPermission {
            session_id,
            request_id,
        } => {
            match client
                .reply_permission(&session_id, &request_id, false)
                .await
            {
                Ok(()) => app.resolve_permission(&request_id),
                Err(error) => app.set_status(format!("Permission reply failed: {error}")),
            }
        }
        InputAction::AnswerQuestion {
            session_id,
            request_id,
            answers,
        } => {
            match client
                .reply_question(&session_id, &request_id, answers)
                .await
            {
                Ok(()) => app.resolve_question(&request_id),
                Err(error) => app.set_status(format!("Question reply failed: {error}")),
            }
        }
        InputAction::RejectQuestion {
            session_id,
            request_id,
        } => match client.reject_question(&session_id, &request_id).await {
            Ok(()) => app.resolve_question(&request_id),
            Err(error) => app.set_status(format!("Question reject failed: {error}")),
        },
        InputAction::AbortSession { session_id } => {
            if let Err(error) = client.abort_session(&session_id).await {
                app.set_status(format!("Abort failed: {error}"));
            }
        }
        InputAction::SwitchSession { session_id } => {
            match client.session_transcript_events(&session_id).await {
                Ok(events) => {
                    app.activate_session(&session_id);
                    for event in events {
                        app.handle_event(event);
                    }
                    app.scroll_offset = 0;
                    app.set_status(format!("Switched to session: {session_id}"));
                }
                Err(error) => {
                    app.set_status(format!("Session switch failed: {error}"));
                }
            }
        }
    }
}

/// Resolve the runner's startup route, honoring the temporary legacy-home rollback.
///
/// `None` means the runner should skip session-first attach/create behavior and
/// leave the app in its initial legacy home state.
pub fn resolve_runner_launch_route(
    input: &LaunchInput,
    legacy_home_requested: bool,
) -> Option<LaunchRoute> {
    if legacy_home_requested {
        return None;
    }
    Some(launch_policy::resolve_launch_route(input))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cli_args_default() {
        let args = CliArgs::parse_from(["ax-code-tui"]);
        assert_eq!(args.server_url, DEFAULT_SERVER_URL);
        assert_eq!(args.directory, ".");
        assert!(args.auth_token.is_none());
        assert!(args.prompt.is_none());
        assert!(args.session.is_none());
        assert!(!args.continue_session);
        assert!(!args.fork);
        assert!(args.model.is_none());
        assert!(args.agent.is_none());
    }

    #[test]
    fn test_cli_args_custom() {
        let args = CliArgs::parse_from([
            "ax-code-tui",
            "--server-url",
            "http://example.com:8080",
            "--auth-token",
            "secret123",
            "--directory",
            "/home/user/project",
            "--prompt",
            "Hello world",
            "--session",
            "abc123",
            "--continue",
            "--fork",
            "--model",
            "xai/grok-code-fast-1",
            "--agent",
            "build",
        ]);
        assert_eq!(args.server_url, "http://example.com:8080");
        assert_eq!(args.auth_token, Some("secret123".to_string()));
        assert_eq!(args.directory, "/home/user/project");
        assert_eq!(args.prompt, Some("Hello world".to_string()));
        assert_eq!(args.session, Some("abc123".to_string()));
        assert!(args.continue_session);
        assert!(args.fork);
        assert_eq!(args.model.as_deref(), Some("xai/grok-code-fast-1"));
        assert_eq!(args.agent.as_deref(), Some("build"));
    }

    #[test]
    fn test_cli_args_into_config() {
        let args = CliArgs::parse_from([
            "ax-code-tui",
            "--server-url",
            "http://test:3000",
            "--auth-token",
            "token",
            "--directory",
            "/test",
            "--session",
            "sess-123",
            "--prompt",
            "Hello world",
        ]);

        let config = args.into_config();
        assert_eq!(config.base_url, "http://test:3000");
        assert_eq!(config.auth_token, Some("token".to_string()));
        assert_eq!(config.directory, Some("/test".to_string()));
        assert_eq!(config.session, Some("sess-123".to_string()));
        assert_eq!(config.prompt, Some("Hello world".to_string()));
    }

    #[test]
    fn test_cli_args_env_token() {
        // Note: env var is only picked up if --auth-token is not provided
        // and clap's env attribute is configured correctly.
        // Testing env vars is platform-specific, so we just verify the
        // default behavior when no token is provided.
        let args = CliArgs::parse_from(["ax-code-tui"]);
        // auth_token should be None when not provided via CLI
        assert!(args.auth_token.is_none());
    }

    #[tokio::test]
    async fn unavailable_runtime_restores_submitted_prompt() {
        let mut app = App::new();
        let options = PromptOptions::default();

        apply_input_action(
            &mut app,
            None,
            InputAction::SubmitPrompt("keep this task".to_string()),
            &options,
        )
        .await;

        assert_eq!(app.prompt, "keep this task");
        assert_eq!(app.cursor_position, app.prompt_grapheme_count());
        assert_eq!(
            app.status_message.as_deref(),
            Some("Native runtime is unavailable; prompt restored")
        );
    }
}
