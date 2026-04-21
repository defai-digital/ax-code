#[macro_use]
extern crate napi_derive;

use serde::{Deserialize, Serialize};
use thiserror::Error;

const MAX_VIEWPORT_COLS: u16 = 1_000;
const MAX_VIEWPORT_ROWS: u16 = 1_000;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum TerminalError {
    #[error("raw mode is already active")]
    RawModeAlreadyActive,
    #[error("raw mode is not active")]
    RawModeNotActive,
    #[error("alternate screen is already active")]
    AlternateScreenAlreadyActive,
    #[error("alternate screen is not active")]
    AlternateScreenNotActive,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Viewport {
    pub cols: u16,
    pub rows: u16,
}

impl Viewport {
    pub fn new(cols: u16, rows: u16) -> Self {
        Self {
            cols: cols.clamp(1, MAX_VIEWPORT_COLS),
            rows: rows.clamp(1, MAX_VIEWPORT_ROWS),
        }
    }
}

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalLifecycle {
    pub raw_mode: bool,
    pub alternate_screen: bool,
}

impl TerminalLifecycle {
    pub fn enter_raw_mode(&mut self) -> Result<(), TerminalError> {
        if self.raw_mode {
            return Err(TerminalError::RawModeAlreadyActive);
        }
        self.raw_mode = true;
        Ok(())
    }

    pub fn leave_raw_mode(&mut self) -> Result<(), TerminalError> {
        if !self.raw_mode {
            return Err(TerminalError::RawModeNotActive);
        }
        self.raw_mode = false;
        Ok(())
    }

    pub fn enter_alternate_screen(&mut self) -> Result<(), TerminalError> {
        if self.alternate_screen {
            return Err(TerminalError::AlternateScreenAlreadyActive);
        }
        self.alternate_screen = true;
        Ok(())
    }

    pub fn leave_alternate_screen(&mut self) -> Result<(), TerminalError> {
        if !self.alternate_screen {
            return Err(TerminalError::AlternateScreenNotActive);
        }
        self.alternate_screen = false;
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum InputEvent {
    Key {
        name: String,
        ctrl: bool,
        alt: bool,
        shift: bool,
    },
    Text {
        text: String,
    },
    Paste {
        text: String,
    },
    Mouse {
        kind: MouseKind,
        button: u16,
        x: u16,
        y: u16,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MouseKind {
    Down,
    Up,
    Drag,
    Move,
    WheelUp,
    WheelDown,
}

pub fn parse_input(input: &str) -> Vec<InputEvent> {
    let mut out = Vec::new();
    let mut idx = 0;

    while idx < input.len() {
        let rest = &input[idx..];
        if let Some(text) = rest.strip_prefix("\x1b[200~") {
            if let Some(end) = text.find("\x1b[201~") {
                out.push(InputEvent::Paste {
                    text: text[..end].to_string(),
                });
                idx += "\x1b[200~".len() + end + "\x1b[201~".len();
                continue;
            }
        }

        if rest.starts_with("\x1b[<") {
            if let Some((event, consumed)) = parse_sgr_mouse(rest) {
                out.push(event);
                idx += consumed;
                continue;
            }
        }

        if let Some((event, consumed)) = parse_csi_key(rest) {
            out.push(event);
            idx += consumed;
            continue;
        }

        let ch = rest.chars().next().expect("idx is within input bounds");
        match ch {
            '\x03' => out.push(key("c", true, false, false)),
            '\x04' => out.push(key("d", true, false, false)),
            '\x1b' => out.push(key("escape", false, false, false)),
            '\r' | '\n' => out.push(key("enter", false, false, false)),
            '\t' => out.push(key("tab", false, false, false)),
            '\x7f' => out.push(key("backspace", false, false, false)),
            _ => out.push(InputEvent::Text {
                text: ch.to_string(),
            }),
        }
        idx += ch.len_utf8();
    }

    out
}

fn key(name: &str, ctrl: bool, alt: bool, shift: bool) -> InputEvent {
    InputEvent::Key {
        name: name.to_string(),
        ctrl,
        alt,
        shift,
    }
}

fn parse_csi_key(input: &str) -> Option<(InputEvent, usize)> {
    if !input.starts_with("\x1b[") {
        return None;
    }

    let rest = &input[2..];
    let final_idx = rest.find(|ch: char| matches!(ch, 'A' | 'B' | 'C' | 'D' | 'F' | 'H' | '~'))?;
    let final_ch = rest.as_bytes().get(final_idx).copied()? as char;
    let body = &rest[..final_idx];
    let consumed = 2 + final_idx + 1;
    let params: Vec<u16> = body
        .split(';')
        .filter_map(|item| item.parse().ok())
        .collect();

    let name = match final_ch {
        'A' => "up",
        'B' => "down",
        'C' => "right",
        'D' => "left",
        'H' => "home",
        'F' => "end",
        '~' => match params.first().copied()? {
            1 | 7 => "home",
            3 => "delete",
            4 | 8 => "end",
            _ => return None,
        },
        _ => return None,
    };

    let modifier = if final_ch == '~' {
        params.get(1).copied()
    } else {
        params.get(1).copied().or_else(|| params.first().copied())
    };
    let (shift, alt, ctrl) = key_modifiers(modifier);
    Some((key(name, ctrl, alt, shift), consumed))
}

fn key_modifiers(value: Option<u16>) -> (bool, bool, bool) {
    match value {
        Some(2) => (true, false, false),
        Some(3) => (false, true, false),
        Some(4) => (true, true, false),
        Some(5) => (false, false, true),
        Some(6) => (true, false, true),
        Some(7) => (false, true, true),
        Some(8) => (true, true, true),
        _ => (false, false, false),
    }
}

fn parse_sgr_mouse(input: &str) -> Option<(InputEvent, usize)> {
    let end = input.find(['M', 'm'])?;
    let suffix = input.as_bytes().get(end).copied()? as char;
    let body = &input["\x1b[<".len()..end];
    let mut parts = body.split(';');
    let code: u16 = parts.next()?.parse().ok()?;
    let x = parts.next()?.parse().ok()?;
    let y = parts.next()?.parse().ok()?;
    if parts.next().is_some() || x == 0 || y == 0 {
        return None;
    }

    let kind = if suffix == 'm' {
        MouseKind::Up
    } else if code & 64 != 0 {
        if code & 1 == 0 {
            MouseKind::WheelUp
        } else {
            MouseKind::WheelDown
        }
    } else if code & 32 != 0 && code & 0b11 == 3 {
        MouseKind::Move
    } else if code & 32 != 0 {
        MouseKind::Drag
    } else {
        MouseKind::Down
    };

    Some((
        InputEvent::Mouse {
            kind,
            button: code & 0b11,
            x,
            y,
        },
        end + 1,
    ))
}

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Style {
    pub fg: Option<String>,
    pub bg: Option<String>,
    pub bold: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextRun {
    pub text: String,
    pub style: Style,
}

pub fn parse_ansi(input: &str) -> Vec<TextRun> {
    let mut runs = Vec::new();
    let mut style = Style::default();
    let mut text = String::new();
    let mut idx = 0;

    while idx < input.len() {
        let rest = &input[idx..];
        if rest.starts_with("\x1b[") {
            if let Some(end) = rest.find('m') {
                if !text.is_empty() {
                    runs.push(TextRun {
                        text: std::mem::take(&mut text),
                        style: style.clone(),
                    });
                }
                apply_sgr(&mut style, &rest[2..end]);
                idx += end + 1;
                continue;
            }
        }
        let ch = rest.chars().next().expect("idx is within input bounds");
        text.push(ch);
        idx += ch.len_utf8();
    }

    if !text.is_empty() {
        runs.push(TextRun { text, style });
    }
    runs
}

fn apply_sgr(style: &mut Style, codes: &str) {
    let values: Vec<u16> = if codes.is_empty() {
        vec![0]
    } else {
        codes
            .split(';')
            .filter_map(|item| item.parse().ok())
            .collect()
    };

    let mut idx = 0;
    while idx < values.len() {
        let code = values[idx];
        match code {
            0 => *style = Style::default(),
            1 => style.bold = true,
            22 => style.bold = false,
            38 | 48 => {
                if let Some((color, consumed)) = extended_color(&values[idx + 1..]) {
                    if code == 38 {
                        style.fg = Some(color);
                    } else {
                        style.bg = Some(color);
                    }
                    idx += consumed;
                }
            }
            30..=37 | 90..=97 => style.fg = Some(color_name(code)),
            39 => style.fg = None,
            40..=47 | 100..=107 => style.bg = Some(color_name(code - 10)),
            49 => style.bg = None,
            _ => {}
        }
        idx += 1;
    }
}

fn extended_color(values: &[u16]) -> Option<(String, usize)> {
    match values {
        [5, color, ..] => Some((format!("ansi256:{color}"), 2)),
        [2, r, g, b, ..] => Some((format!("rgb:{r},{g},{b}"), 4)),
        _ => None,
    }
}

fn color_name(code: u16) -> String {
    match code % 10 {
        0 => "black",
        1 => "red",
        2 => "green",
        3 => "yellow",
        4 => "blue",
        5 => "magenta",
        6 => "cyan",
        7 => "white",
        _ => "default",
    }
    .to_string()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cell {
    pub text: String,
    pub width: u8,
    pub style: Style,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellBuffer {
    pub viewport: Viewport,
    pub cells: Vec<Cell>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellPatch {
    pub x: u16,
    pub y: u16,
    pub cell: Cell,
}

impl CellBuffer {
    pub fn blank(viewport: Viewport) -> Self {
        let viewport = Viewport::new(viewport.cols, viewport.rows);
        let cell = Cell {
            text: " ".to_string(),
            width: 1,
            style: Style::default(),
        };
        Self {
            viewport,
            cells: vec![cell; viewport.cols as usize * viewport.rows as usize],
        }
    }

    pub fn write_wrapped(mut self, text: &str, style: Style) -> Self {
        self.normalize_cells();
        let mut x = 0usize;
        let mut y = 0usize;
        let cols = self.viewport.cols as usize;
        let rows = self.viewport.rows as usize;

        for ch in text.chars() {
            if ch == '\n' {
                x = 0;
                y += 1;
                if y >= rows {
                    break;
                }
                continue;
            }

            let width = char_width(ch);
            if width == 0 {
                continue;
            }
            if x + width > cols {
                x = 0;
                y += 1;
                if y >= rows {
                    break;
                }
            }

            let idx = y * cols + x;
            self.cells[idx] = Cell {
                text: ch.to_string(),
                width: width as u8,
                style: style.clone(),
            };
            if width == 2 && x + 1 < cols {
                self.cells[idx + 1] = Cell {
                    text: String::new(),
                    width: 0,
                    style: style.clone(),
                };
            }
            x += width;
        }

        self
    }

    fn normalize_cells(&mut self) {
        self.viewport = Viewport::new(self.viewport.cols, self.viewport.rows);
        let expected = self.viewport.cols as usize * self.viewport.rows as usize;
        let blank = Cell {
            text: " ".to_string(),
            width: 1,
            style: Style::default(),
        };
        if self.cells.len() < expected {
            self.cells.resize(expected, blank);
        } else if self.cells.len() > expected {
            self.cells.truncate(expected);
        }
    }
}

pub fn char_width(ch: char) -> usize {
    if ch.is_control() || is_combining(ch) {
        0
    } else if is_wide(ch) {
        2
    } else {
        1
    }
}

fn is_combining(ch: char) -> bool {
    matches!(
        ch as u32,
        0x0300..=0x036F
            | 0x1AB0..=0x1AFF
            | 0x1DC0..=0x1DFF
            | 0x20D0..=0x20FF
            | 0xFE20..=0xFE2F
    )
}

fn is_wide(ch: char) -> bool {
    matches!(
      ch as u32,
      0x1100..=0x115F
        | 0x2329..=0x232A
        | 0x2E80..=0xA4CF
        | 0xAC00..=0xD7A3
        | 0xF900..=0xFAFF
        | 0xFE10..=0xFE19
        | 0xFE30..=0xFE6F
        | 0xFF00..=0xFF60
        | 0xFFE0..=0xFFE6
    )
}

pub fn diff_buffers(old: &CellBuffer, new: &CellBuffer) -> Vec<CellPatch> {
    let old_viewport = Viewport::new(old.viewport.cols, old.viewport.rows);
    let new_viewport = Viewport::new(new.viewport.cols, new.viewport.rows);
    let old_stride = old_viewport.cols as usize;
    let new_stride = new_viewport.cols as usize;
    let cols = new_stride;
    let rows = new_viewport.rows as usize;
    let mut patches = Vec::new();
    let blank = Cell {
        text: " ".to_string(),
        width: 1,
        style: Style::default(),
    };

    for y in 0..rows {
        for x in 0..cols {
            let new_idx = y * new_stride + x;
            let old_cell = if x < old_stride && y < old_viewport.rows as usize {
                old.cells.get(y * old_stride + x).unwrap_or(&blank)
            } else {
                &blank
            };
            let new_cell = new.cells.get(new_idx).unwrap_or(&blank);

            if old_cell != new_cell {
                patches.push(CellPatch {
                    x: x as u16 + 1,
                    y: y as u16 + 1,
                    cell: new_cell.clone(),
                });
            }
        }
    }

    patches
}

#[napi]
pub fn parse_input_json(input: String) -> napi::Result<String> {
    serde_json::to_string(&parse_input(&input))
        .map_err(|err| napi::Error::from_reason(err.to_string()))
}

#[napi]
pub fn parse_ansi_json(input: String) -> napi::Result<String> {
    serde_json::to_string(&parse_ansi(&input))
        .map_err(|err| napi::Error::from_reason(err.to_string()))
}

#[napi]
pub fn wrapped_buffer_json(cols: u32, rows: u32, text: String) -> napi::Result<String> {
    let cols = u16::try_from(cols).unwrap_or(u16::MAX);
    let rows = u16::try_from(rows).unwrap_or(u16::MAX);
    let buffer =
        CellBuffer::blank(Viewport::new(cols, rows)).write_wrapped(&text, Style::default());
    serde_json::to_string(&buffer).map_err(|err| napi::Error::from_reason(err.to_string()))
}

#[napi]
pub fn diff_buffers_json(old_json: String, new_json: String) -> napi::Result<String> {
    let old: CellBuffer =
        serde_json::from_str(&old_json).map_err(|err| napi::Error::from_reason(err.to_string()))?;
    let new: CellBuffer =
        serde_json::from_str(&new_json).map_err(|err| napi::Error::from_reason(err.to_string()))?;
    serde_json::to_string(&diff_buffers(&old, &new))
        .map_err(|err| napi::Error::from_reason(err.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_bracketed_paste_without_splitting_payload() {
        assert_eq!(
            parse_input("a\x1b[200~hello\n\u{4e16}\u{754c}\x1b[201~b"),
            vec![
                InputEvent::Text { text: "a".into() },
                InputEvent::Paste {
                    text: "hello\n\u{4e16}\u{754c}".into()
                },
                InputEvent::Text { text: "b".into() },
            ]
        );
    }

    #[test]
    fn parses_ctrl_d_as_shutdown_key() {
        assert_eq!(parse_input("\x04"), vec![key("d", true, false, false)]);
    }

    #[test]
    fn parses_sgr_mouse_and_csi_keys() {
        assert_eq!(
            parse_input(
                "\x1b[A\x1b[1;5A\x1b[1;4C\x1b[3;5~\x1b[<0;10;5M\x1b[<0;10;5m\x1b[<35;11;6M\x1b[<64;12;7M"
            ),
            vec![
                key("up", false, false, false),
                key("up", true, false, false),
                key("right", false, true, true),
                key("delete", true, false, false),
                InputEvent::Mouse {
                    kind: MouseKind::Down,
                    button: 0,
                    x: 10,
                    y: 5,
                },
                InputEvent::Mouse {
                    kind: MouseKind::Up,
                    button: 0,
                    x: 10,
                    y: 5,
                },
                InputEvent::Mouse {
                    kind: MouseKind::Move,
                    button: 3,
                    x: 11,
                    y: 6,
                },
                InputEvent::Mouse {
                    kind: MouseKind::WheelUp,
                    button: 0,
                    x: 12,
                    y: 7,
                },
            ]
        );
    }

    #[test]
    fn parses_basic_ansi_runs() {
        let runs = parse_ansi("plain \x1b[1;31mred\x1b[0m ok");
        assert_eq!(runs[0].text, "plain ");
        assert_eq!(runs[1].text, "red");
        assert_eq!(runs[1].style.fg.as_deref(), Some("red"));
        assert!(runs[1].style.bold);
        assert_eq!(runs[2].text, " ok");
        assert_eq!(runs[2].style, Style::default());
    }

    #[test]
    fn parses_extended_ansi_colors() {
        let runs = parse_ansi("\x1b[38;5;196;1mhot\x1b[48;2;1;2;3mbg");
        assert_eq!(runs[0].style.fg.as_deref(), Some("ansi256:196"));
        assert!(runs[0].style.bold);
        assert_eq!(runs[1].style.fg.as_deref(), Some("ansi256:196"));
        assert_eq!(runs[1].style.bg.as_deref(), Some("rgb:1,2,3"));
        assert!(runs[1].style.bold);
    }

    #[test]
    fn wraps_wide_characters_without_splitting_cells() {
        let buffer =
            CellBuffer::blank(Viewport::new(4, 2)).write_wrapped("ab\u{754c}c", Style::default());
        assert_eq!(buffer.cells[0].text, "a");
        assert_eq!(buffer.cells[1].text, "b");
        assert_eq!(buffer.cells[2].text, "\u{754c}");
        assert_eq!(buffer.cells[2].width, 2);
        assert_eq!(buffer.cells[3].width, 0);
        assert_eq!(buffer.cells[4].text, "c");
    }

    #[test]
    fn combining_marks_do_not_consume_cells() {
        assert_eq!(char_width('\u{0301}'), 0);
        let buffer =
            CellBuffer::blank(Viewport::new(3, 1)).write_wrapped("a\u{0301}b", Style::default());
        assert_eq!(buffer.cells[0].text, "a");
        assert_eq!(buffer.cells[1].text, "b");
    }

    #[test]
    fn diffs_changed_cells_only() {
        let old = CellBuffer::blank(Viewport::new(3, 1)).write_wrapped("abc", Style::default());
        let new = CellBuffer::blank(Viewport::new(3, 1)).write_wrapped("axc", Style::default());
        let patches = diff_buffers(&old, &new);
        assert_eq!(patches.len(), 1);
        assert_eq!(patches[0].x, 2);
        assert_eq!(patches[0].cell.text, "x");
    }

    #[test]
    fn lifecycle_rejects_invalid_state_transitions() {
        let mut lifecycle = TerminalLifecycle::default();
        assert_eq!(
            lifecycle.leave_raw_mode(),
            Err(TerminalError::RawModeNotActive)
        );
        assert_eq!(lifecycle.enter_raw_mode(), Ok(()));
        assert_eq!(
            lifecycle.enter_raw_mode(),
            Err(TerminalError::RawModeAlreadyActive)
        );
        assert_eq!(lifecycle.leave_raw_mode(), Ok(()));
    }

    #[test]
    fn viewport_clamps_zero_dimensions() {
        assert_eq!(Viewport::new(0, 0), Viewport { cols: 1, rows: 1 });
    }

    #[test]
    fn viewport_clamps_unbounded_dimensions() {
        assert_eq!(
            Viewport::new(u16::MAX, u16::MAX),
            Viewport {
                cols: MAX_VIEWPORT_COLS,
                rows: MAX_VIEWPORT_ROWS,
            }
        );
    }

    #[test]
    fn diff_includes_cells_added_by_resize() {
        let old = CellBuffer::blank(Viewport::new(2, 1)).write_wrapped("ab", Style::default());
        let new = CellBuffer::blank(Viewport::new(3, 1)).write_wrapped("abc", Style::default());
        let patches = diff_buffers(&old, &new);
        assert_eq!(patches.len(), 1);
        assert_eq!(patches[0].x, 3);
        assert_eq!(patches[0].cell.text, "c");
    }

    #[test]
    fn write_wrapped_repairs_short_deserialized_buffers() {
        let mut buffer = CellBuffer::blank(Viewport::new(3, 1));
        buffer.cells.truncate(1);
        let repaired = buffer.write_wrapped("abc", Style::default());
        assert_eq!(repaired.cells.len(), 3);
        assert_eq!(repaired.cells[2].text, "c");
    }
}
