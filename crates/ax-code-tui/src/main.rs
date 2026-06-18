//! ax-code-tui binary entry point.
//!
//! Launches the Ratatui-based TUI that connects to the headless ax-code server
//! via HTTP/SSE. This is the experimental native Rust TUI client for ADR-035.

use ax_code_tui::runner::{CliArgs, Runner, init_terminal, restore_terminal};
use clap::Parser;
use std::panic;
use std::process::ExitCode;

#[tokio::main]
async fn main() -> ExitCode {
    let args = CliArgs::parse();

    // Install a panic hook BEFORE entering raw mode so any later panic (in the
    // runner, an awaited task, or ratatui itself) restores the terminal before
    // the default hook prints the panic message. Without this, a panic leaves
    // the user in raw mode + alternate screen + mouse capture, which makes the
    // panic message unreadable and the shell unusable.
    let original_hook = panic::take_hook();
    panic::set_hook(Box::new(move |info| {
        let _ = restore_terminal();
        original_hook(info);
    }));

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
