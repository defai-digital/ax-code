//! ax-code-tui binary entry point.
//!
//! Launches the Ratatui-based TUI that connects to the headless ax-code server
//! via HTTP/SSE. This is the experimental native Rust TUI client for ADR-035.

use ax_code_tui::runner::{init_terminal, restore_terminal, CliArgs, Runner};
use clap::Parser;
use std::process::ExitCode;

#[tokio::main]
async fn main() -> ExitCode {
    let args = CliArgs::parse();

    // Initialize terminal
    let terminal = match init_terminal() {
        Ok(t) => t,
        Err(e) => {
            eprintln!("Failed to initialize terminal: {}", e);
            return ExitCode::FAILURE;
        }
    };

    // Create and run the TUI
    let result = Runner::new(args.into_config()).run(terminal).await;

    // Restore terminal
    if let Err(e) = restore_terminal() {
        eprintln!("Warning: Failed to restore terminal: {}", e);
    }

    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("TUI error: {}", e);
            ExitCode::FAILURE
        }
    }
}
