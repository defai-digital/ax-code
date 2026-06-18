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
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{backend::CrosstermBackend, Terminal};
use tokio::sync::mpsc;

use crate::client::{ClientConfig, HeadlessClient};
use crate::events::RuntimeEvent;
use crate::tui::app::App;
use crate::tui::input::{handle_input, InputAction};
use crate::tui::render::render;

/// Command-line arguments for the TUI binary.
#[derive(Parser, Debug, Clone)]
#[command(name = "ax-code-tui", about = "AX Code native TUI client (experimental)")]
pub struct CliArgs {
    /// URL of the headless ax-code server.
    /// Format: http://host:port
    #[arg(long, default_value = "http://localhost:3000")]
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

        // Create the SSE event channel
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

        // Spawn the client connection task if we have a client
        let client_handle = if let Some(ref client) = client {
            let base_url = client.base_url().to_string();
            let event_tx = event_tx.clone();
            Some(tokio::spawn(async move {
                // Try to connect and subscribe
                match reqwest::Client::new()
                    .get(&format!("{}/global/event", base_url))
                    .header(reqwest::header::ACCEPT, "text/event-stream")
                    .send()
                    .await
                {
                    Ok(response) if response.status().is_success() => {
                        use futures_util::StreamExt;
                        let mut stream = response.bytes_stream();
                        let mut buffer = String::new();
                        while let Some(chunk_result) = stream.next().await {
                            if let Ok(chunk) = chunk_result {
                                buffer.push_str(&String::from_utf8_lossy(&chunk));
                                // Process complete lines from the buffer
                                while let Some(newline_pos) = buffer.find('\n') {
                                    let line = buffer[..newline_pos].trim_end_matches('\r').to_string();
                                    buffer = buffer[newline_pos + 1..].to_string();
                                    if let Some(data) = line.strip_prefix("data: ") {
                                        if let Ok(event) = serde_json::from_str::<RuntimeEvent>(data) {
                                            if event_tx.send(event).await.is_err() {
                                                return;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    _ => {
                        // Connection failed, just exit the task
                    }
                }
            }))
        } else {
            None
        };

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
                            if let Err(e) = client.reply_permission(&session_id, &request_id, true).await {
                                app.set_status(format!("Permission reply failed: {}", e));
                            }
                        }
                    }
                    InputAction::RejectPermission {
                        session_id,
                        request_id,
                    } => {
                        if let Some(ref client) = client {
                            if let Err(e) = client.reply_permission(&session_id, &request_id, false).await {
                                app.set_status(format!("Permission reply failed: {}", e));
                            }
                        }
                    }
                    InputAction::AnswerQuestion {
                        session_id,
                        request_id,
                        answer,
                    } => {
                        if let Some(ref client) = client {
                            if let Err(e) = client.reply_question(&session_id, &request_id, &answer).await {
                                app.set_status(format!("Question reply failed: {}", e));
                            }
                        }
                    }
                    InputAction::RejectQuestion {
                        session_id,
                        request_id,
                    } => {
                        // Treat rejection as answering with empty string
                        if let Some(ref client) = client {
                            if let Err(e) = client.reply_question(&session_id, &request_id, "").await {
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
                        // TODO: Implement session switching via client
                        app.set_status(format!("Switching to session: {}", session_id));
                    }
                }
            }

            // Check if app should quit
            if app.should_quit {
                break;
            }
        }

        // Clean up client task
        if let Some(handle) = client_handle {
            handle.abort();
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cli_args_default() {
        let args = CliArgs::parse_from(["ax-code-tui"]);
        assert_eq!(args.server_url, "http://localhost:3000");
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
        ]);

        let config = args.into_config();
        assert_eq!(config.base_url, "http://test:3000");
        assert_eq!(config.auth_token, Some("token".to_string()));
        assert_eq!(config.directory, Some("/test".to_string()));
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
