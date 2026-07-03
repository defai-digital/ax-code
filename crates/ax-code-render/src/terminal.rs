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

use std::io::Write as _;

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
    pub kitty_keyboard: bool,
    pub bracketed_paste: bool,
    pub focus_tracking: bool,
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
            kitty_keyboard: false,
            bracketed_paste: false,
            focus_tracking: false,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Multiplexer {
    None,
    Tmux,
    Zellij,
    Screen,
}

/// Mutable mode state tracked so teardown/restore re-emit only active modes
/// (terminal.zig `state`).
#[derive(Clone, Copy)]
pub struct ModeState {
    pub alt_screen: bool,
    pub modify_other_keys: bool,
    pub kitty_keyboard: bool,
    pub kitty_keyboard_flags: u8,
    pub bracketed_paste: bool,
    pub focus_tracking: bool,
    pub color_scheme_updates: bool,
    pub theme_queries_sent: bool,
    pub mouse: bool,
    pub mouse_movement: bool,
    pub mouse_was_enabled: bool,
    pub pixel_mouse: bool,
}

impl Default for ModeState {
    fn default() -> ModeState {
        ModeState {
            alt_screen: false,
            modify_other_keys: false,
            kitty_keyboard: false,
            kitty_keyboard_flags: 0,
            bracketed_paste: false,
            focus_tracking: false,
            color_scheme_updates: false,
            theme_queries_sent: false,
            mouse: false,
            mouse_movement: true,
            mouse_was_enabled: false,
            pixel_mouse: false,
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
    Pointer,
    Text,
    Crosshair,
    Move,
    NotAllowed,
}

impl MousePointerStyle {
    pub fn from_code(v: u8) -> Option<MousePointerStyle> {
        Some(match v {
            0 => MousePointerStyle::Default,
            1 => MousePointerStyle::Pointer,
            2 => MousePointerStyle::Text,
            3 => MousePointerStyle::Crosshair,
            4 => MousePointerStyle::Move,
            5 => MousePointerStyle::NotAllowed,
            _ => return None,
        })
    }

    pub fn to_name(self) -> &'static str {
        match self {
            MousePointerStyle::Default => "default",
            MousePointerStyle::Pointer => "pointer",
            MousePointerStyle::Text => "text",
            MousePointerStyle::Crosshair => "crosshair",
            MousePointerStyle::Move => "move",
            MousePointerStyle::NotAllowed => "not-allowed",
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
    pub state: ModeState,
    multiplexer: Multiplexer,
    is_foot: bool,
    // These are reset to false at every checkEnvironmentOverrides and only ever
    // set true by query responses, which the headless port never processes.
    skip_explicit_width_query: bool,
    // Config kitty flags (opts.kitty_keyboard_flags); 0 unless configured.
    kitty_keyboard_flags_opt: u8,
}

impl Terminal {
    pub fn init(remote_mode: RemoteMode) -> Terminal {
        let detected = detect(remote_mode);
        Terminal {
            caps: detected.caps,
            cursor: CursorState::default(),
            mouse_pointer: MousePointerStyle::Default,
            state: ModeState::default(),
            multiplexer: detected.multiplexer,
            is_foot: detected.is_foot,
            skip_explicit_width_query: false,
            // Options.kitty_keyboard_flags default = 0b00101 (disambiguate +
            // alternate keys), not 0.
            kitty_keyboard_flags_opt: 0b00101,
        }
    }

    pub fn get_capabilities(&self) -> Capabilities {
        self.caps
    }

    pub fn kitty_keyboard_flags(&self) -> u8 {
        self.kitty_keyboard_flags_opt
    }

    fn is_in_tmux(&self) -> bool {
        self.multiplexer == Multiplexer::Tmux
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

    // --- setup/teardown escape emitters (each appends to `out`) ---------------

    /// terminal.zig `queryTerminalSend` — capability/theme/cursor probes.
    pub fn query_terminal_send(&mut self, out: &mut Vec<u8>) {
        self.set_color_scheme_updates(out, true);
        self.query_theme_colors(out);
        self.state.theme_queries_sent = true;

        // xtversion ++ hideCursor ++ saveCursorState
        out.extend_from_slice(b"\x1b[>0q\x1b[?25l\x1b[s");
        // cursorPositionRequest
        out.extend_from_slice(b"\x1b[6n");

        if self.is_in_tmux() {
            push_capability_queries(out, self.is_foot, true);
        } else {
            push_capability_queries(out, self.is_foot, false);
        }

        if !self.skip_explicit_width_query {
            // home + explicitWidthQuery + CPR + home + scaledTextQuery + CPR
            out.extend_from_slice(b"\x1b[H");
            out.extend_from_slice(b"\x1b]66;w=1; \x1b\\");
            out.extend_from_slice(b"\x1b[6n");
            out.extend_from_slice(b"\x1b[H");
            out.extend_from_slice(b"\x1b]66;s=2; \x1b\\");
            out.extend_from_slice(b"\x1b[6n");
        }

        // restoreCursorState
        out.extend_from_slice(b"\x1b[u");
    }

    /// terminal.zig `enableDetectedFeatures` (non-Windows path).
    pub fn enable_detected_features(&mut self, out: &mut Vec<u8>, use_kitty_keyboard: bool) {
        if !self.state.modify_other_keys && !self.state.kitty_keyboard {
            self.set_modify_other_keys(out, true);
        }
        if self.caps.kitty_keyboard && use_kitty_keyboard {
            if self.state.modify_other_keys {
                self.set_modify_other_keys(out, false);
            }
            let flags = self.kitty_keyboard_flags_opt;
            self.set_kitty_keyboard(out, true, flags);
        }
        if self.caps.unicode == WidthMethod::Unicode && !self.caps.explicit_width {
            out.extend_from_slice(b"\x1b[?2027h"); // unicodeSet
        }
        if self.caps.bracketed_paste {
            self.set_bracketed_paste(out, true);
        }
        if self.caps.focus_tracking {
            self.set_focus_tracking(out, true);
        }
        if !self.state.color_scheme_updates {
            self.set_color_scheme_updates(out, true);
        }
        if !self.state.theme_queries_sent {
            self.query_theme_colors(out);
            self.state.theme_queries_sent = true;
        }
    }

    pub fn query_theme_colors(&self, out: &mut Vec<u8>) {
        out.extend_from_slice(b"\x1b]10;?\x07\x1b]11;?\x07"); // oscThemeQueries
    }

    /// terminal.zig `restoreTerminalModes` — re-emit active modes (focus-in).
    pub fn restore_terminal_modes(&self, out: &mut Vec<u8>) {
        if self.state.mouse {
            if !self.state.mouse_movement {
                out.extend_from_slice(b"\x1b[?1003l"); // disableAnyEventTracking
            }
            out.extend_from_slice(b"\x1b[?1000h"); // enableMouseTracking
            out.extend_from_slice(b"\x1b[?1002h"); // enableButtonEventTracking
            if self.state.mouse_movement {
                out.extend_from_slice(b"\x1b[?1003h"); // enableAnyEventTracking
            }
            out.extend_from_slice(b"\x1b[?1006h"); // enableSGRMouseMode
        }
        if self.state.focus_tracking {
            out.extend_from_slice(b"\x1b[?1004h"); // focusSet
        }
        if self.state.bracketed_paste {
            out.extend_from_slice(b"\x1b[?2004h"); // bracketedPasteSet
        }
        if self.state.kitty_keyboard {
            out.extend_from_slice(b"\x1b[<u"); // csiUPop
            let _ = write!(out, "\x1b[>{}u", self.state.kitty_keyboard_flags); // csiUPush
        }
        if self.state.modify_other_keys {
            out.extend_from_slice(b"\x1b[>4;1m"); // modifyOtherKeysSet
        }
    }

    pub fn enter_alt_screen(&mut self, out: &mut Vec<u8>) {
        out.extend_from_slice(b"\x1b[?1049h"); // switchToAlternateScreen
        self.state.alt_screen = true;
    }

    pub fn exit_alt_screen(&mut self, out: &mut Vec<u8>) {
        out.extend_from_slice(b"\x1b[?1049l"); // switchToMainScreen
        self.state.alt_screen = false;
    }

    fn set_color_scheme_updates(&mut self, out: &mut Vec<u8>, enable: bool) {
        out.extend_from_slice(if enable {
            b"\x1b[?2031h"
        } else {
            b"\x1b[?2031l"
        });
        self.state.color_scheme_updates = enable;
    }

    fn set_modify_other_keys(&mut self, out: &mut Vec<u8>, enable: bool) {
        out.extend_from_slice(if enable { b"\x1b[>4;1m" } else { b"\x1b[>4;0m" });
        self.state.modify_other_keys = enable;
    }

    fn set_bracketed_paste(&mut self, out: &mut Vec<u8>, enable: bool) {
        out.extend_from_slice(if enable {
            b"\x1b[?2004h"
        } else {
            b"\x1b[?2004l"
        });
        self.state.bracketed_paste = enable;
    }

    fn set_focus_tracking(&mut self, out: &mut Vec<u8>, enable: bool) {
        out.extend_from_slice(if enable {
            b"\x1b[?1004h"
        } else {
            b"\x1b[?1004l"
        });
        self.state.focus_tracking = enable;
    }

    fn set_kitty_keyboard(&mut self, out: &mut Vec<u8>, enable: bool, flags: u8) {
        if enable {
            if !self.state.kitty_keyboard {
                let _ = write!(out, "\x1b[>{}u", flags); // csiUPush
                self.state.kitty_keyboard = true;
                self.state.kitty_keyboard_flags = flags;
            }
        } else if self.state.kitty_keyboard {
            out.extend_from_slice(b"\x1b[<u"); // csiUPop
            self.state.kitty_keyboard = false;
            self.state.kitty_keyboard_flags = 0;
        }
    }

    pub fn set_terminal_title(&self, out: &mut Vec<u8>, title: &str) {
        out.extend_from_slice(b"\x1b]0;"); // setTerminalTitle prefix (OSC 0)
        out.extend_from_slice(title.as_bytes());
        out.push(0x07); // BEL
    }

    pub fn set_kitty_keyboard_flags(&mut self, flags: u8) {
        self.kitty_keyboard_flags_opt = flags;
    }

    pub fn enable_kitty_keyboard(&mut self, out: &mut Vec<u8>, flags: u8) {
        self.set_kitty_keyboard(out, true, flags);
    }

    pub fn disable_kitty_keyboard(&mut self, out: &mut Vec<u8>) {
        self.set_kitty_keyboard(out, false, 0);
    }

    pub fn set_cursor_color(&mut self, color: Rgba) {
        self.cursor.color = color;
    }

    pub fn set_mouse_pointer_style(&mut self, style: MousePointerStyle) {
        self.mouse_pointer = style;
    }

    /// terminal.zig `setMouseMode`.
    pub fn set_mouse_mode(&mut self, out: &mut Vec<u8>, enable: bool, enable_movement: bool) {
        if enable {
            if self.state.mouse && self.state.mouse_movement == enable_movement {
                return;
            }
        } else if !self.state.mouse {
            return;
        }

        if enable {
            self.state.mouse = true;
            self.state.mouse_movement = enable_movement;
            self.state.mouse_was_enabled = true;
            if !enable_movement {
                out.extend_from_slice(b"\x1b[?1003l"); // disableAnyEventTracking
            }
            out.extend_from_slice(b"\x1b[?1000h"); // enableMouseTracking
            out.extend_from_slice(b"\x1b[?1002h"); // enableButtonEventTracking
            if enable_movement {
                out.extend_from_slice(b"\x1b[?1003h"); // enableAnyEventTracking
            }
            out.extend_from_slice(b"\x1b[?1006h"); // enableSGRMouseMode
        } else {
            self.state.mouse = false;
            self.state.pixel_mouse = false;
            write_mouse_disable_sequences(out);
        }
    }

    /// terminal.zig `resetState` — best-effort teardown (non-Windows path):
    /// unconditional show-cursor/SGR-reset/mouse-pointer reset, then disable
    /// each mode that our state tracking says is currently active.
    pub fn reset_state(&mut self, out: &mut Vec<u8>) {
        out.extend_from_slice(b"\x1b[?25h"); // showCursor
        out.extend_from_slice(b"\x1b[0m"); // reset
        out.extend_from_slice(b"\x1b]22;\x07"); // resetMousePointer
        self.mouse_pointer = MousePointerStyle::Default;

        if self.state.kitty_keyboard {
            self.set_kitty_keyboard(out, false, 0);
        }
        if self.state.modify_other_keys {
            self.set_modify_other_keys(out, false);
        }
        if self.state.mouse_was_enabled {
            // forceDisableMouseMode: emit disables even if tracked state drifted.
            self.state.mouse = false;
            self.state.pixel_mouse = false;
            write_mouse_disable_sequences(out);
        }
        if self.state.bracketed_paste {
            self.set_bracketed_paste(out, false);
        }
        if self.state.focus_tracking {
            self.set_focus_tracking(out, false);
        }
        if self.state.alt_screen {
            self.exit_alt_screen(out);
        }
        // else (non-alt): non-Windows emits nothing here.
        if self.state.color_scheme_updates {
            self.set_color_scheme_updates(out, false);
        }
        self.set_terminal_title(out, "");
    }
}

/// terminal.zig `writeMouseDisableSequences`.
fn write_mouse_disable_sequences(out: &mut Vec<u8>) {
    out.extend_from_slice(b"\x1b[?1003l"); // disableAnyEventTracking
    out.extend_from_slice(b"\x1b[?1002l"); // disableButtonEventTracking
    out.extend_from_slice(b"\x1b[?1000l"); // disableMouseTracking
    out.extend_from_slice(b"\x1b[?1006l"); // disableSGRMouseMode
}

/// Append the capability-query block (terminal.zig `queryTerminalSend`). The
/// tmux variant DCS-wraps only the base queries; csiU + notification queries are
/// appended unwrapped. The foot-is-broken variant drops the notification queries.
fn push_capability_queries(out: &mut Vec<u8>, is_foot: bool, tmux: bool) {
    const BASE: &[u8] = b"\x1b[?1016$p\x1b[?2027$p\x1b[?2031$p\x1b[?1004$p\x1b[?2004$p\x1b[?2026$p";
    const CSI_U_QUERY: &[u8] = b"\x1b[?u";
    const NOTIFICATION_QUERIES: &[u8] =
        b"\x1b]99;i=opentui-notifications:p=?;\x1b\\\x1b]1337;Capabilities\x1b\\";

    if tmux {
        push_wrap_for_tmux(out, BASE);
    } else {
        out.extend_from_slice(BASE);
    }
    out.extend_from_slice(CSI_U_QUERY);
    if !is_foot {
        out.extend_from_slice(NOTIFICATION_QUERIES);
    }
}

/// ansi.zig `wrapForTmux` — DCS passthrough with every ESC (0x1b) doubled.
fn push_wrap_for_tmux(out: &mut Vec<u8>, seq: &[u8]) {
    out.extend_from_slice(b"\x1bPtmux;"); // tmuxDcsStart
    for &c in seq {
        if c == 0x1b {
            out.extend_from_slice(b"\x1b\x1b");
        } else {
            out.push(c);
        }
    }
    out.extend_from_slice(b"\x1b\\"); // tmuxDcsEnd
}

fn env(key: &str) -> Option<String> {
    std::env::var(key).ok()
}

struct Detected {
    caps: Capabilities,
    multiplexer: Multiplexer,
    is_foot: bool,
}

/// `checkEnvironmentOverrides`, scoped to the state the setup/teardown escape
/// emitters and render path branch on (caps, multiplexer, foot). Notification
/// protocol / terminal-name bookkeeping is intentionally omitted. Both the Rust
/// renderer and the Zig backend read the same process env, so mirroring this
/// yields identical setup output.
fn detect(remote_mode: RemoteMode) -> Detected {
    let mut caps = Capabilities::default();
    let mut multiplexer = Multiplexer::None;

    // Always try to enable bracketed paste (checkEnvironmentOverrides).
    caps.bracketed_paste = true;

    // rgb -> ansi256+hyperlinks coupling fires only when rgb is already set
    // before env detection; on a fresh Terminal it is not, so hyperlinks stay
    // off (matching the reference).

    if remote_mode == RemoteMode::Remote {
        return Detected {
            caps,
            multiplexer,
            is_foot: false,
        };
    }

    // Multiplexer / terminal-program detection (the `!from_xtversion` branch —
    // always taken here since we perform no xtversion handshake).
    let mut zellij = false;
    if env("TMUX").is_some() {
        multiplexer = Multiplexer::Tmux;
        caps.unicode = WidthMethod::Wcwidth;
        caps.explicit_cursor_positioning = true;
    } else if env("ZELLIJ").is_some()
        || env("ZELLIJ_SESSION_NAME").is_some()
        || env("ZELLIJ_PANE_ID").is_some()
    {
        multiplexer = Multiplexer::Zellij;
        zellij = true;
    } else if env("STY").is_some() {
        multiplexer = Multiplexer::Screen;
        caps.unicode = WidthMethod::Wcwidth;
        caps.explicit_cursor_positioning = true;
    } else if let Some(term) = env("TERM") {
        if term.starts_with("tmux") {
            multiplexer = Multiplexer::Tmux;
            caps.unicode = WidthMethod::Wcwidth;
            caps.explicit_cursor_positioning = true;
        } else if term.starts_with("screen") {
            multiplexer = Multiplexer::Screen;
            caps.unicode = WidthMethod::Wcwidth;
            caps.explicit_cursor_positioning = true;
        }
        if term.contains("alacritty") {
            caps.explicit_cursor_positioning = true;
        }
    }

    let mut is_foot = false;
    if let Some(term) = env("TERM") {
        if contains_ignore_case(&term, "256color") {
            caps.ansi256 = true;
        }
        if contains_ignore_case(&term, "foot") {
            is_foot = true;
        }
    }

    if let Some(prog) = env("TERM_PROGRAM") {
        if !zellij && prog == "tmux" {
            multiplexer = Multiplexer::Tmux;
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

    Detected {
        caps,
        multiplexer,
        is_foot,
    }
}

fn contains_ignore_case(haystack: &str, needle: &str) -> bool {
    haystack
        .to_ascii_lowercase()
        .contains(&needle.to_ascii_lowercase())
}
