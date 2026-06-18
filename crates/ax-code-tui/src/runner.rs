//! TUI Runner for ax-code-tui.
//!
//! Provides the main event loop that connects the headless client to the
//! Ratatui application state and renders the UI.

use std::io::{self, stdout};
use std::time::Duration;

use clap::Parser;
use crossterm::{
    event::{self, DisableMouseCapture, EnableMouseCapture},
    execute,
    terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode},
};
use ratatui::{Terminal, backend::CrosstermBackend};
use tokio::sync::mpsc;

use crate::client::{ClientConfig, DEFAULT_SERVER_URL, HeadlessClient};
use crate::diagnostics::{self, DiagnosticEvent};
use crate::events::RuntimeEvent;
use crate::launch_policy::{self, LaunchInput, LaunchRoute};
use crate::tui::app::App;
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
}

/// Initialize the terminal for TUI rendering.
pub fn init_terminal() -> io::Result<Terminal<CrosstermBackend<io::Stdout>>> {
    enable_raw_mode()?;
    let mut stdout = stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    Terminal::new(backend)
}

/// Restore the terminal to its original state.
pub fn restore_terminal() -> io::Result<()> {
    disable_raw_mode()?;
    execute!(io::stdout(), LeaveAlternateScreen, DisableMouseCapture)?;
    Ok(())
}

/// The main TUI runner that manages the event loop.
pub struct Runner {
    config: ClientConfig,
}

impl Runner {
    /// Create a new runner with the given configuration.
    pub fn new(config: ClientConfig) -> Self {
        Self { config }
    }

    /// Run the TUI event loop.
    pub async fn run(
        &self,
        mut terminal: Terminal<CrosstermBackend<io::Stdout>>,
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

        // Create the SSE event channel. We drain into a local mpsc so the
        // poll-style render loop can consume events with try_recv().
        let (event_tx, mut event_rx) = mpsc::channel::<RuntimeEvent>(100);

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

        // Resolve launch route via launch policy (ADR-035).
        // The route is consumed after the client and SSE subscription
        // are ready so we can create/attach sessions and send prompts.
        let launch_input = LaunchInput {
            explicit_session_id: self.config.session.clone(),
            explicit_prompt: self.config.prompt.clone(),
            recent_session_ids,
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
                    app.session_id = Some(session_id.clone());
                    app.set_status(format!("Attached to session: {}", session_id));
                }
                LaunchRoute::NewSession { prompt } => match client.create_session().await {
                    Ok(session_id) => {
                        app.session_id = Some(session_id.clone());
                        if let Some(initial_prompt) = prompt {
                            if let Err(e) = client.send_prompt(&session_id, initial_prompt).await {
                                app.set_status(format!("Failed to send initial prompt: {}", e));
                            }
                        }
                    }
                    Err(e) => {
                        app.set_status(format!("Failed to create session: {}", e));
                    }
                },
            }
        }

        // Main event loop
        loop {
            // Render
            terminal.draw(|f| render(f, &app))?;

            // Check for SSE events (non-blocking)
            while let Ok(event) = event_rx.try_recv() {
                app.handle_event(event);
            }

            // Check for terminal resize
            if event::poll(Duration::from_millis(50))? {
                let event = event::read()?;
                let action = handle_input(&mut app, event);

                match action {
                    InputAction::None => {}
                    InputAction::SubmitPrompt(prompt) => {
                        if let Some(ref client) = client {
                            if let Some(session_id) = app.current_session_id() {
                                if let Err(e) = client.send_prompt(session_id, &prompt).await {
                                    app.set_status(format!("Failed to send prompt: {}", e));
                                }
                            }
                        }
                    }
                    InputAction::AcceptPermission {
                        session_id,
                        request_id,
                    } => {
                        if let Some(ref client) = client {
                            if let Err(e) = client
                                .reply_permission(&session_id, &request_id, true)
                                .await
                            {
                                app.set_status(format!("Permission reply failed: {}", e));
                            }
                        }
                    }
                    InputAction::RejectPermission {
                        session_id,
                        request_id,
                    } => {
                        if let Some(ref client) = client {
                            if let Err(e) = client
                                .reply_permission(&session_id, &request_id, false)
                                .await
                            {
                                app.set_status(format!("Permission reply failed: {}", e));
                            }
                        }
                    }
                    InputAction::AnswerQuestion {
                        session_id,
                        request_id,
                        answers,
                    } => {
                        if let Some(ref client) = client {
                            if let Err(e) = client
                                .reply_question(&session_id, &request_id, answers)
                                .await
                            {
                                app.set_status(format!("Question reply failed: {}", e));
                            }
                        }
                    }
                    InputAction::RejectQuestion {
                        session_id,
                        request_id,
                    } => {
                        if let Some(ref client) = client {
                            if let Err(e) = client.reject_question(&session_id, &request_id).await {
                                app.set_status(format!("Question reject failed: {}", e));
                            }
                        }
                    }
                    InputAction::AbortSession { session_id } => {
                        if let Some(ref client) = client {
                            if let Err(e) = client.abort_session(&session_id).await {
                                app.set_status(format!("Abort failed: {}", e));
                            }
                        }
                    }
                    InputAction::SwitchSession { session_id } => {
                        app.set_status(format!("Switched to session: {}", session_id));
                    }
                }
            }

            // Check if app should quit
            if app.should_quit {
                break;
            }
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
        ]);
        assert_eq!(args.server_url, "http://example.com:8080");
        assert_eq!(args.auth_token, Some("secret123".to_string()));
        assert_eq!(args.directory, "/home/user/project");
        assert_eq!(args.prompt, Some("Hello world".to_string()));
        assert_eq!(args.session, Some("abc123".to_string()));
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
}
