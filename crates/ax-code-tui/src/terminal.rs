//! Terminal lifecycle for the native UI.
//!
//! Keep every mode enabled during setup paired with a teardown command.  This
//! mirrors the defensive lifecycle used by Grok's Rust TUI: normal exit and
//! panic paths both run the same idempotent restore routine.

use std::io::{self, Write, stdout};
use std::sync::atomic::{AtomicBool, Ordering};

use crossterm::{
    cursor::{Hide, Show},
    event::{
        DisableBracketedPaste, DisableFocusChange, DisableMouseCapture, EnableBracketedPaste,
        EnableFocusChange, EnableMouseCapture,
    },
    execute,
    terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode},
};
use ratatui::{Terminal, backend::CrosstermBackend};

static TERMINAL_ACTIVE: AtomicBool = AtomicBool::new(false);

pub type NativeTerminal = Terminal<CrosstermBackend<io::Stdout>>;

/// Enter the alternate screen and enable the terminal event modes used by the
/// native UI. If setup fails part-way through, restore everything immediately.
pub fn init_terminal() -> io::Result<NativeTerminal> {
    enable_raw_mode()?;
    let mut output = stdout();
    let setup = execute!(
        output,
        EnterAlternateScreen,
        EnableMouseCapture,
        EnableFocusChange,
        EnableBracketedPaste,
        Hide
    );
    if let Err(error) = setup {
        TERMINAL_ACTIVE.store(true, Ordering::Release);
        let _ = restore_terminal();
        return Err(error);
    }

    TERMINAL_ACTIVE.store(true, Ordering::Release);
    match Terminal::new(CrosstermBackend::new(output)) {
        Ok(terminal) => Ok(terminal),
        Err(error) => {
            let _ = restore_terminal();
            Err(error)
        }
    }
}

/// Restore the terminal after a normal exit, an initialization failure, or a
/// panic. Multiple calls are safe; only the first active call writes resets.
pub fn restore_terminal() -> io::Result<()> {
    if !TERMINAL_ACTIVE.swap(false, Ordering::AcqRel) {
        // Raw mode can be enabled before the active flag is set if setup fails
        // unusually early, so this remains a cheap best-effort safety net.
        return disable_raw_mode().or(Ok(()));
    }

    let raw_result = disable_raw_mode();
    let mut output = stdout();
    let screen_result = execute!(
        output,
        Show,
        DisableBracketedPaste,
        DisableFocusChange,
        DisableMouseCapture,
        LeaveAlternateScreen
    )
    .and_then(|()| output.flush());

    match (raw_result, screen_result) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(raw_error), Ok(())) => Err(raw_error),
        (Ok(()), Err(screen_error)) => Err(screen_error),
        (Err(raw_error), Err(screen_error)) => Err(io::Error::new(
            raw_error.kind(),
            format!(
                "failed to disable raw mode: {raw_error}; failed to restore terminal modes: {screen_error}"
            ),
        )),
    }
}
