//! Composition-root binary for the AX Code Ratatui TUI (ADR-054).

use ax_code_tui::auth::{AuthConfig, AuthError};
use ax_code_tui::event_loop::{self, LaunchConfig};
use clap::Parser;
use std::process::ExitCode;

#[derive(Debug, Parser)]
#[command(
    name = "ax-code-tui",
    about = "AX Code Ratatui presentation client (dogfood; ADR-054)"
)]
struct Args {
    /// Base URL of the authenticated loopback runtime (e.g. http://127.0.0.1:4096).
    #[arg(long, env = "AX_CODE_TUI_URL")]
    url: Option<String>,

    /// Workspace directory for x-ax-code-directory.
    #[arg(long, env = "AX_CODE_TUI_DIRECTORY")]
    directory: Option<String>,

    /// Optional session id to attach.
    #[arg(long, env = "AX_CODE_TUI_SESSION_ID")]
    session: Option<String>,

    /// Optional initial prompt text.
    #[arg(long, env = "AX_CODE_TUI_PROMPT")]
    prompt: Option<String>,

    /// Headless smoke: one frame + clean quit (no raw TTY).
    #[arg(long, env = "AX_CODE_TUI_SMOKE")]
    smoke: bool,

    /// Alias for --smoke (CI).
    #[arg(long)]
    headless: bool,
}

#[tokio::main]
async fn main() -> ExitCode {
    let args = Args::parse();

    let auth = match AuthConfig::from_env() {
        Ok(auth) => auth,
        Err(AuthError::Missing) => {
            eprintln!(
                "ax-code-tui: runtime authorization required (set AX_CODE_TUI_AUTH_HEADER or AX_CODE_TUI_PASSWORD)"
            );
            // Drive pure dispatch fail-closed path for observability.
            let mut state = ax_code_tui::AppState::new(
                args.directory
                    .clone()
                    .unwrap_or_else(|| std::env::current_dir().map(|p| p.display().to_string()).unwrap_or_default()),
            );
            let effects = ax_code_tui::dispatch(&mut state, ax_code_tui::Action::AuthMissing);
            debug_assert!(effects.iter().any(|e| matches!(e, ax_code_tui::Effect::Shutdown)));
            return ExitCode::from(2);
        }
    };

    let Some(url) = args.url.filter(|u| !u.trim().is_empty()) else {
        eprintln!("ax-code-tui: missing --url / AX_CODE_TUI_URL");
        return ExitCode::from(2);
    };

    let directory = args.directory.unwrap_or_else(|| {
        std::env::current_dir()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|_| ".".into())
    });

    let config = LaunchConfig {
        base_url: url,
        directory,
        session_id: args.session,
        initial_prompt: args.prompt,
        auth,
        smoke: args.smoke || args.headless,
        headless: args.headless || args.smoke,
    };

    match event_loop::run(config).await {
        Ok(code) => ExitCode::from(code as u8),
        Err(err) => {
            eprintln!("ax-code-tui: {err:#}");
            ExitCode::from(1)
        }
    }
}
