//! ADR-046 Slice E — terminal capability model + cursor/mouse state.
//!
//! Ported from the OpenTUI v0.4.1 `terminal.zig` reference, scoped to what the
//! renderer's escape-sequence output actually branches on:
//!
//!   - `rgb` / `ansi256`   — truecolor vs indexed color emission (`emitColor`)
//!   - `explicit_cursor_positioning` — post-grapheme cursor move
//!   - `explicit_width`    — OSC 66 explicit-width grapheme emission
//!   - `hyperlinks`        — OSC 8 link runs
//!
//! The capability detection mirrors `checkEnvironmentOverrides` for the subset
//! of environment variables that influence those flags, so a Rust renderer and
//! the Zig backend running in the SAME process compute identical capabilities
//! (the parity harness relies on this).

use crate::buffer::{Rgba, rgb_color};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum WidthMethod {
    Wcwidth,
    Unicode,
}

#[derive(Clone, Copy)]
pub struct Capabilities {
    pub rgb: bool,
    pub ansi256: bool,
    pub unicode: WidthMethod,
    pub explicit_width: bool,
    pub hyperlinks: bool,
    pub explicit_cursor_positioning: bool,
}

impl Default for Capabilities {
    fn default() -> Capabilities {
        Capabilities {
            rgb: false,
            ansi256: false,
            unicode: WidthMethod::Unicode,
            explicit_width: false,
            hyperlinks: false,
            explicit_cursor_positioning: false,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum RemoteMode {
    Auto,
    Local,
    Remote,
}

impl RemoteMode {
    pub fn from_code(v: u8) -> RemoteMode {
        match v {
            0 => RemoteMode::Auto,
            2 => RemoteMode::Remote,
            _ => RemoteMode::Local,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum CursorStyle {
    Block,
    Line,
    Underline,
    Default,
}

impl CursorStyle {
    /// Matches the Zig enum tag order used for the diff cache (`styleTag`).
    pub fn tag(self) -> u8 {
        match self {
            CursorStyle::Block => 0,
            CursorStyle::Line => 1,
            CursorStyle::Underline => 2,
            CursorStyle::Default => 3,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum MousePointerStyle {
    Default,
}

impl MousePointerStyle {
    pub fn to_name(self) -> &'static str {
        match self {
            MousePointerStyle::Default => "default",
        }
    }
}

#[derive(Clone, Copy)]
pub struct CursorState {
    pub x: u32,
    pub y: u32,
    pub visible: bool,
    pub style: CursorStyle,
    pub blinking: bool,
    pub color: Rgba,
}

impl Default for CursorState {
    fn default() -> CursorState {
        CursorState {
            x: 1,
            y: 1,
            visible: true,
            style: CursorStyle::Default,
            blinking: false,
            color: rgb_color(255, 255, 255, 255),
        }
    }
}

pub struct Terminal {
    pub caps: Capabilities,
    pub cursor: CursorState,
    pub mouse_pointer: MousePointerStyle,
}

impl Terminal {
    pub fn init(remote_mode: RemoteMode) -> Terminal {
        Terminal {
            caps: detect_capabilities(remote_mode),
            cursor: CursorState::default(),
            mouse_pointer: MousePointerStyle::Default,
        }
    }

    pub fn get_capabilities(&self) -> Capabilities {
        self.caps
    }

    pub fn set_cursor_position(&mut self, x: u32, y: u32, visible: bool) {
        self.cursor.x = x;
        self.cursor.y = y;
        self.cursor.visible = visible;
    }

    pub fn set_cursor_style(&mut self, style: CursorStyle, blinking: bool) {
        self.cursor.style = style;
        self.cursor.blinking = blinking;
    }
}

fn env(key: &str) -> Option<String> {
    std::env::var(key).ok()
}

/// Subset of `checkEnvironmentOverrides` that affects renderer output. Only the
/// capability flags the escape emitter reads are computed; multiplexer/name and
/// notification bookkeeping are intentionally omitted.
fn detect_capabilities(remote_mode: RemoteMode) -> Capabilities {
    let mut caps = Capabilities::default();

    // rgb -> ansi256+hyperlinks coupling fires only when rgb is already set
    // before env detection; on a fresh Terminal it is not, so hyperlinks stay
    // off (matching the reference, which never enables hyperlinks purely from
    // env in a freshly-created Terminal).

    if remote_mode == RemoteMode::Remote {
        // Remote with no injected env map returns before reading env; the
        // renderer path always passes .local, but keep the guard faithful.
        return caps;
    }

    // Multiplexer / terminal-program detection (the `!from_xtversion` branch —
    // always taken here since we perform no xtversion handshake).
    let mut zellij = false;
    if env("TMUX").is_some() {
        caps.unicode = WidthMethod::Wcwidth;
        caps.explicit_cursor_positioning = true;
    } else if env("ZELLIJ").is_some()
        || env("ZELLIJ_SESSION_NAME").is_some()
        || env("ZELLIJ_PANE_ID").is_some()
    {
        zellij = true;
    } else if env("STY").is_some() {
        caps.unicode = WidthMethod::Wcwidth;
        caps.explicit_cursor_positioning = true;
    } else if let Some(term) = env("TERM") {
        if term.starts_with("tmux") {
            caps.unicode = WidthMethod::Wcwidth;
            caps.explicit_cursor_positioning = true;
        } else if term.starts_with("screen") {
            caps.unicode = WidthMethod::Wcwidth;
            caps.explicit_cursor_positioning = true;
        }
        if term.contains("alacritty") {
            caps.explicit_cursor_positioning = true;
        }
    }

    if let Some(term) = env("TERM") {
        if contains_ignore_case(&term, "256color") {
            caps.ansi256 = true;
        }
    }

    if let Some(prog) = env("TERM_PROGRAM") {
        if !zellij && prog == "tmux" {
            caps.unicode = WidthMethod::Wcwidth;
            caps.explicit_cursor_positioning = true;
        }
        if prog == "vscode" {
            caps.unicode = WidthMethod::Unicode;
        } else if prog == "Apple_Terminal" {
            caps.unicode = WidthMethod::Wcwidth;
        } else if prog == "Alacritty" {
            caps.explicit_cursor_positioning = true;
        }
    }

    if env("ALACRITTY_SOCKET").is_some() || env("ALACRITTY_LOG").is_some() {
        caps.explicit_cursor_positioning = true;
    }

    if let Some(colorterm) = env("COLORTERM") {
        if colorterm == "truecolor" || colorterm == "24bit" {
            caps.rgb = true;
            caps.ansi256 = true;
        }
    }

    if env("WT_SESSION").is_some() {
        caps.rgb = true;
        caps.ansi256 = true;
    }

    caps
}

fn contains_ignore_case(haystack: &str, needle: &str) -> bool {
    haystack
        .to_ascii_lowercase()
        .contains(&needle.to_ascii_lowercase())
}
