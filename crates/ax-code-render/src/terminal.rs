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
    pub osc52: bool,
    pub notifications: bool,
    pub sgr_pixels: bool,
    pub color_scheme_updates: bool,
    pub sync: bool,
    pub sixel: bool,
    pub kitty_graphics: bool,
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
            osc52: false,
            notifications: false,
            sgr_pixels: false,
            color_scheme_updates: false,
            sync: false,
            sixel: false,
            kitty_graphics: false,
        }
    }
}

/// terminal.zig NotificationProtocol. Discriminant order matches priority
/// (higher = preferred): none < osc9 < osc777 < osc99.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum NotificationProtocol {
    None = 0,
    Osc9 = 1,
    Osc777 = 2,
    Osc99 = 3,
}

/// terminal.zig detectNotificationProtocol — terminal-name → protocol.
fn detect_np(value: &str) -> Option<NotificationProtocol> {
    let has = |n: &str| contains_ignore_case(value, n);
    if has("kitty") || has("foot") {
        return Some(NotificationProtocol::Osc99);
    }
    for n in [
        "ghostty",
        "wezterm",
        "warp",
        "hterm",
        "blink",
        "contour",
        "vte",
        "gnome",
        "tilix",
        "terminator",
        "xfce",
        "urxvt",
        "rxvt",
        "windows terminal",
        "windows_terminal",
    ] {
        if has(n) {
            return Some(NotificationProtocol::Osc777);
        }
    }
    for n in ["iterm", "Apple_Terminal", "Terminal.app", "conemu"] {
        if has(n) {
            return Some(NotificationProtocol::Osc9);
        }
    }
    None
}

/// terminal.zig termFeaturesHasCode — uppercase-initial tokens (e.g. "No").
fn term_features_has_code(features: &str, code: &str) -> bool {
    let bytes = features.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i];
        if !c.is_ascii_alphanumeric() {
            break;
        }
        if !c.is_ascii_uppercase() {
            i += 1;
            continue;
        }
        let start = i;
        i += 1;
        while i < bytes.len() && bytes[i].is_ascii_lowercase() {
            i += 1;
        }
        if &features[start..i] == code {
            return true;
        }
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            i += 1;
        }
    }
    false
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
    remote: bool,
    sty: bool,
    notification_protocol: NotificationProtocol,
    notification_id_counter: u64,
    remote_mode: RemoteMode,
    env_overrides: std::collections::HashMap<String, String>,
    // These are reset to false at every checkEnvironmentOverrides and only ever
    // set true by query responses, which the headless port never processes.
    skip_explicit_width_query: bool,
    // Config kitty flags (opts.kitty_keyboard_flags); 0 unless configured.
    kitty_keyboard_flags_opt: u8,
}

impl Terminal {
    pub fn init(remote_mode: RemoteMode) -> Terminal {
        let overrides = std::collections::HashMap::new();
        let detected = detect(remote_mode, &overrides, false, false);
        Terminal {
            caps: detected.caps,
            cursor: CursorState::default(),
            mouse_pointer: MousePointerStyle::Default,
            state: ModeState::default(),
            multiplexer: detected.multiplexer,
            is_foot: detected.is_foot,
            remote: detected.remote,
            sty: detected.sty,
            notification_protocol: detected.notification_protocol,
            notification_id_counter: 0,
            remote_mode,
            env_overrides: overrides,
            skip_explicit_width_query: false,
            // Options.kitty_keyboard_flags default = 0b00101 (disambiguate +
            // alternate keys), not 0.
            kitty_keyboard_flags_opt: 0b00101,
        }
    }

    pub fn get_capabilities(&self) -> Capabilities {
        self.caps
    }

    /// Zig `setTerminalEnvVar` — inject a host env override and recompute the
    /// capabilities (checkEnvironmentOverrides). Mode state is preserved.
    pub fn set_terminal_env_var(&mut self, key: &str, value: &str) {
        self.env_overrides
            .insert(key.to_string(), value.to_string());
        let detected = detect(
            self.remote_mode,
            &self.env_overrides,
            self.caps.rgb,
            self.caps.osc52,
        );
        self.caps = detected.caps;
        self.multiplexer = detected.multiplexer;
        self.is_foot = detected.is_foot;
        self.remote = detected.remote;
        self.sty = detected.sty;
        self.notification_protocol = detected.notification_protocol;
    }

    /// Zig `processCapabilityResponse` (DECRPM subset) — apply capabilities
    /// reported by the terminal's query responses. xtversion/iTerm/OSC-99
    /// sub-parsing (terminal-name + notification-from-xtversion) is not modeled.
    ///
    /// Unicode width method is **not** updated from DECRPM `2027` or terminal-name
    /// heuristics here: the OpenTUI Zig backend keeps the env-detected method
    /// (e.g. Apple_Terminal → wcwidth) and only *enables* mode 2027 later in
    /// `enableDetectedFeatures` when unicode is already selected. Matching that
    /// keeps ADR-046 PCR differential parity.
    pub fn process_capability_response(&mut self, response: &[u8]) {
        let has = |needle: &str| find_subslice(response, needle.as_bytes());
        if has("1016;2$y") {
            self.caps.sgr_pixels = true;
        }
        // Note: `2027;2$y` is intentionally ignored for caps.unicode — see doc
        // comment above. Zig does not flip width method from this DECRPM report.
        if has("2031;1$y") || has("2031;2$y") {
            self.caps.color_scheme_updates = true;
        }
        if has("1004;1$y") || has("1004;2$y") {
            self.caps.focus_tracking = true;
        }
        if has("2026;1$y") || has("2026;2$y") {
            self.caps.sync = true;
        }
        if has("2004;1$y") || has("2004;2$y") {
            self.caps.bracketed_paste = true;
        }

        let s = String::from_utf8_lossy(response);
        // "kitty" in the response advertises a color/sixel/hyperlink family. The
        // kitty_keyboard/kitty_graphics mode caps are NOT set here — the Zig
        // renderer consumes+resets them in enableDetectedFeatures (unported), so
        // they stay at their (off) init value to preserve differential parity.
        // Unicode width is also left unchanged (Zig keeps env-detected method).
        if contains_ignore_case(&s, "kitty") {
            self.caps.rgb = true;
            self.caps.ansi256 = true;
            self.caps.sixel = true;
            self.caps.bracketed_paste = true;
            self.caps.hyperlinks = true;
        }
        if contains_ignore_case(&s, "tmux") {
            self.caps.unicode = WidthMethod::Wcwidth;
            self.caps.explicit_cursor_positioning = true;
        }
        if contains_ignore_case(&s, "alacritty") {
            self.caps.explicit_cursor_positioning = true;
        }
        // Sixel via DA1 (`\x1b[?...;c` containing capability 4).
        if let Some(pos) = response.windows(2).position(|w| w == b";c") {
            if pos >= 4 {
                let mut start = pos;
                while start > 0 && response[start] != 0x1b {
                    start -= 1;
                }
                let da = &response[start..pos + 2];
                if da.starts_with(b"\x1b[?")
                    && (find_subslice(da, b"4;")
                        || find_subslice(da, b";4;")
                        || find_subslice(da, b";4c"))
                {
                    self.caps.sixel = true;
                }
            }
        }
        // isOsc52Term / isHyperlinkTerm response checks.
        if !self.caps.osc52 && is_osc52_term(&s) {
            self.caps.osc52 = true;
        }
        if !self.caps.hyperlinks && is_hyperlink_term(&s) {
            self.caps.hyperlinks = true;
        }
        // rgb -> hyperlinks coupling (applied on any post-init capability pass).
        if self.caps.rgb {
            self.caps.ansi256 = true;
            self.caps.hyperlinks = true;
        }
    }

    pub fn kitty_keyboard_flags(&self) -> u8 {
        self.kitty_keyboard_flags_opt
    }

    fn is_in_tmux(&self) -> bool {
        self.multiplexer == Multiplexer::Tmux
    }

    fn can_write_clipboard(&self) -> bool {
        self.caps.osc52
    }

    /// Multiplexer code for the ExternalCapabilities struct (none/tmux/zellij/screen).
    pub fn multiplexer_code(&self) -> u8 {
        match self.multiplexer {
            Multiplexer::None => 0,
            Multiplexer::Tmux => 1,
            Multiplexer::Zellij => 2,
            Multiplexer::Screen => 3,
        }
    }

    pub fn is_remote(&self) -> bool {
        self.remote
    }

    /// terminal.zig `writeClipboard` — OSC 52 set-clipboard, wrapped for tmux
    /// (DCS, ESC doubled) or screen (DCS) passthrough. Returns false (NotSupported)
    /// when osc52 is not detected.
    pub fn write_clipboard(&self, out: &mut Vec<u8>, target: u8, payload: &[u8]) -> bool {
        if !self.can_write_clipboard() {
            return false;
        }
        let mut osc52: Vec<u8> = Vec::new();
        osc52.extend_from_slice(b"\x1b]52;");
        osc52.push(target);
        osc52.push(b';');
        osc52.extend_from_slice(payload);
        osc52.extend_from_slice(b"\x1b\\");

        if self.is_in_tmux() {
            out.extend_from_slice(b"\x1bPtmux;"); // tmuxDcsStart
            for &c in &osc52 {
                if c == 0x1b {
                    out.push(0x1b);
                }
                out.push(c);
            }
            out.extend_from_slice(b"\x1b\\"); // tmuxDcsEnd
        } else if self.remote {
            out.extend_from_slice(&osc52);
        } else if self.sty {
            out.extend_from_slice(b"\x1bP"); // screenDcsStart
            for &c in &osc52 {
                if c == 0x1b {
                    out.push(0x1b);
                }
                out.push(c);
            }
            out.extend_from_slice(b"\x1b\\"); // screenDcsEnd
        } else {
            out.extend_from_slice(&osc52);
        }
        true
    }

    /// tmux/screen DCS passthrough wrap (ESC doubled), matching
    /// writePassthroughSequence.
    fn passthrough_wrap(&self, out: &mut Vec<u8>, seq: &[u8]) {
        let wrap = |out: &mut Vec<u8>, start: &[u8]| {
            out.extend_from_slice(start);
            for &c in seq {
                if c == 0x1b {
                    out.push(0x1b);
                }
                out.push(c);
            }
            out.extend_from_slice(b"\x1b\\");
        };
        if self.is_in_tmux() {
            wrap(out, b"\x1bPtmux;");
        } else if !self.remote && self.sty {
            wrap(out, b"\x1bP");
        } else {
            out.extend_from_slice(seq);
        }
    }

    /// terminal.zig `writeNotification` — emit the desktop-notification escape
    /// for the detected protocol (OSC 99 base64 / OSC 777 / OSC 9). Returns
    /// false when notifications are unsupported.
    pub fn write_notification(
        &mut self,
        out: &mut Vec<u8>,
        message: &[u8],
        title: Option<&[u8]>,
    ) -> bool {
        if !self.caps.notifications || self.notification_protocol == NotificationProtocol::None {
            return false;
        }
        self.notification_id_counter = self.notification_id_counter.wrapping_add(1);
        let mut seq: Vec<u8> = Vec::new();
        match self.notification_protocol {
            NotificationProtocol::None => return false,
            NotificationProtocol::Osc99 => {
                let id = format!("opentui-{}", self.notification_id_counter);
                match title {
                    Some(t) if !t.is_empty() => {
                        write_osc99_payload(&mut seq, &id, "title", t, false);
                        write_osc99_payload(&mut seq, &id, "body", message, true);
                    }
                    _ => write_osc99_payload(&mut seq, &id, "body", message, true),
                }
            }
            NotificationProtocol::Osc777 => {
                seq.extend_from_slice(b"\x1b]777;notify;");
                match title {
                    Some(t) => {
                        write_sanitized(&mut seq, t, true);
                        seq.push(b';');
                        write_sanitized(&mut seq, message, true);
                    }
                    None => {
                        write_sanitized(&mut seq, message, true);
                        seq.push(b';');
                    }
                }
                seq.extend_from_slice(b"\x1b\\");
            }
            NotificationProtocol::Osc9 => {
                seq.extend_from_slice(b"\x1b]9;");
                if let Some(t) = title {
                    if !t.is_empty() {
                        write_sanitized(&mut seq, t, false);
                        seq.extend_from_slice(b": ");
                    }
                }
                write_sanitized(&mut seq, message, false);
                seq.extend_from_slice(b"\x1b\\");
            }
        }
        self.passthrough_wrap(out, &seq);
        true
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

struct Detected {
    caps: Capabilities,
    multiplexer: Multiplexer,
    is_foot: bool,
    remote: bool,
    sty: bool,
    notification_protocol: NotificationProtocol,
}

/// `checkEnvironmentOverrides`, scoped to the state the setup/teardown escape
/// emitters and render path branch on (caps, multiplexer, foot). Notification
/// protocol / terminal-name bookkeeping is intentionally omitted. Both the Rust
/// renderer and the Zig backend read the same process env, so mirroring this
/// yields identical setup output.
fn detect(
    remote_mode: RemoteMode,
    overrides: &std::collections::HashMap<String, String>,
    prev_rgb: bool,
    prev_osc52: bool,
) -> Detected {
    // Env lookup mirrors Zig `setHostEnvVar`: once ANY override is injected,
    // opts.env_map points at the host_env_map, so detection reads ONLY the
    // injected vars (the process env is used only at init, when there are none).
    let env = |k: &str| -> Option<String> {
        if overrides.is_empty() {
            std::env::var(k).ok()
        } else {
            overrides.get(k).cloned()
        }
    };
    let mut caps = Capabilities::default();
    let mut multiplexer = Multiplexer::None;

    // checkEnvironmentOverrides mutates caps in place across calls; the rgb ->
    // ansi256+hyperlinks coupling at the top fires when rgb was ALREADY set
    // before this call (e.g. the 2nd call via setTerminalEnvVar). prev_rgb
    // carries that pre-existing state (false at init).
    if prev_rgb {
        caps.rgb = true;
        caps.ansi256 = true;
        caps.hyperlinks = true;
    }
    // osc52 also persists once set (the detection block is `if !caps.osc52`).
    caps.osc52 = prev_osc52;

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
            remote: true,
            sty: false,
            notification_protocol: NotificationProtocol::None,
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

    // osc52 detection (checkEnvironmentOverrides, `if !caps.osc52` — skipped
    // entirely once osc52 is already set).
    let sty = env("STY").is_some();
    if !caps.osc52 {
        if env("WT_SESSION").is_some() {
            caps.osc52 = true;
        }
        if !caps.osc52
            && (multiplexer == Multiplexer::Tmux || multiplexer == Multiplexer::Screen || sty)
        {
            caps.osc52 = true;
        }
        if !caps.osc52 {
            if let Some(prog) = env("TERM_PROGRAM") {
                if is_osc52_term(&prog) {
                    caps.osc52 = true;
                }
            }
        }
        if !caps.osc52 {
            if let Some(term) = env("TERM") {
                if is_osc52_term(&term)
                    || contains_ignore_case(&term, "256color")
                    || contains_ignore_case(&term, "xterm")
                {
                    caps.osc52 = true;
                }
            }
        }
    }

    // Notification protocol (checkEnvironmentOverrides). Heuristic sources have
    // equal priority, so the highest-priority protocol among them wins; an
    // override replaces it. In zellij, heuristics are ignored (only overrides
    // survive — enforceNotificationProtocolForMultiplexer).
    let mut notification_protocol = NotificationProtocol::None;
    if !zellij {
        let mut best = NotificationProtocol::None;
        let mut consider = |p: Option<NotificationProtocol>| {
            if let Some(p) = p {
                if (p as u8) > (best as u8) {
                    best = p;
                }
            }
        };
        if let Some(term) = env("TERM") {
            consider(detect_np(&term));
        }
        if let Some(f) = env("TERM_FEATURES") {
            if term_features_has_code(&f, "No") {
                consider(Some(NotificationProtocol::Osc9));
            }
        }
        if let Some(prog) = env("TERM_PROGRAM") {
            consider(detect_np(&prog));
        }
        if env("WT_SESSION").is_some() {
            consider(Some(NotificationProtocol::Osc777));
        }
        notification_protocol = best;
    }
    if let Some(v) = env("OPENTUI_NOTIFICATION_PROTOCOL") {
        let lv = v.to_ascii_lowercase();
        if v == "0" || lv == "false" || lv == "off" || lv == "none" {
            notification_protocol = NotificationProtocol::None;
        } else if v == "1" || lv == "true" || lv == "on" {
            // explicit-on keeps the detected protocol
        } else if lv == "osc99" {
            notification_protocol = NotificationProtocol::Osc99;
        } else if lv == "osc777" {
            notification_protocol = NotificationProtocol::Osc777;
        } else if lv == "osc9" {
            notification_protocol = NotificationProtocol::Osc9;
        }
    }
    if let Some(v) = env("OPENTUI_NOTIFICATIONS") {
        let lv = v.to_ascii_lowercase();
        if v == "0" || lv == "false" || lv == "off" {
            notification_protocol = NotificationProtocol::None;
        }
    }
    caps.notifications = notification_protocol != NotificationProtocol::None;

    let remote = match remote_mode {
        RemoteMode::Auto => {
            env("SSH_CONNECTION").is_some()
                || env("SSH_CLIENT").is_some()
                || env("SSH_TTY").is_some()
                || env("MOSH_CONNECTION").is_some()
        }
        _ => false,
    };

    Detected {
        caps,
        multiplexer,
        is_foot,
        remote,
        sty,
        notification_protocol,
    }
}

/// terminal.zig isHyperlinkTerm.
fn is_hyperlink_term(value: &str) -> bool {
    ["ghostty", "kitty", "wezterm", "alacritty", "iterm"]
        .iter()
        .any(|n| contains_ignore_case(value, n))
}

fn is_osc52_term(value: &str) -> bool {
    for needle in [
        "iterm",
        "kitty",
        "alacritty",
        "wezterm",
        "contour",
        "foot",
        "rio",
        "ghostty",
        "tmux",
        "screen",
    ] {
        if contains_ignore_case(value, needle) {
            return true;
        }
    }
    false
}

fn contains_ignore_case(haystack: &str, needle: &str) -> bool {
    haystack
        .to_ascii_lowercase()
        .contains(&needle.to_ascii_lowercase())
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> bool {
    if needle.is_empty() || needle.len() > haystack.len() {
        return needle.is_empty();
    }
    haystack.windows(needle.len()).any(|w| w == needle)
}

/// terminal.zig writeOsc99Payload — `\x1b]99;i={id}:p={type}:e=1:d={done};<b64>\x1b\\`.
fn write_osc99_payload(
    out: &mut Vec<u8>,
    id: &str,
    payload_type: &str,
    payload: &[u8],
    done: bool,
) {
    let _ = write!(
        out,
        "\x1b]99;i={}:p={}:e=1:d={};",
        id, payload_type, done as u8
    );
    base64_encode(out, payload);
    out.extend_from_slice(b"\x1b\\");
}

/// terminal.zig writeSanitizedNotificationText — control chars / ESC (and
/// optionally ';') become spaces.
fn write_sanitized(out: &mut Vec<u8>, text: &[u8], replace_semicolon: bool) {
    for &c in text {
        if c < 0x20 || c == 0x7f || c == 0x1b || (replace_semicolon && c == b';') {
            out.push(b' ');
        } else {
            out.push(c);
        }
    }
}

/// Standard base64 (std.base64.standard.Encoder) with '=' padding.
fn base64_encode(out: &mut Vec<u8>, data: &[u8]) {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut chunks = data.chunks_exact(3);
    for c in &mut chunks {
        let n = (c[0] as u32) << 16 | (c[1] as u32) << 8 | c[2] as u32;
        out.push(T[(n >> 18) as usize & 63]);
        out.push(T[(n >> 12) as usize & 63]);
        out.push(T[(n >> 6) as usize & 63]);
        out.push(T[n as usize & 63]);
    }
    let rem = chunks.remainder();
    match rem.len() {
        1 => {
            let n = (rem[0] as u32) << 16;
            out.push(T[(n >> 18) as usize & 63]);
            out.push(T[(n >> 12) as usize & 63]);
            out.push(b'=');
            out.push(b'=');
        }
        2 => {
            let n = (rem[0] as u32) << 16 | (rem[1] as u32) << 8;
            out.push(T[(n >> 18) as usize & 63]);
            out.push(T[(n >> 12) as usize & 63]);
            out.push(T[(n >> 6) as usize & 63]);
            out.push(b'=');
        }
        _ => {}
    }
}
