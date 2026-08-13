//! Ratatui drawing for the Phase 2 skeleton.

use crate::state::{AppState, SessionPhase};
use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Clear, Paragraph, Wrap};

pub fn draw(frame: &mut Frame, state: &AppState) {
    let area = frame.area();
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1),
            Constraint::Min(3),
            Constraint::Length(3),
            Constraint::Length(1),
        ])
        .split(area);

    let title = Paragraph::new(Line::from(vec![
        Span::styled(
            " AX Code TUI ",
            Style::default().add_modifier(Modifier::BOLD),
        ),
        Span::raw(format!(
            "(ratatui · ADR-054)  {}  [{}]",
            state.directory, phase_label(state.phase)
        )),
    ]));
    frame.render_widget(title, chunks[0]);

    let visible = visible_scrollback(state, chunks[1].height.saturating_sub(2) as usize);
    let scroll = Paragraph::new(
        visible
            .into_iter()
            .map(|l| Line::from(l))
            .collect::<Vec<_>>(),
    )
    .block(Block::default().borders(Borders::ALL).title("session"))
    .wrap(Wrap { trim: false });
    frame.render_widget(scroll, chunks[1]);

    let prompt_title = if state.permission.is_some() {
        "prompt (blocked: permission modal)"
    } else {
        "prompt"
    };
    let prompt = Paragraph::new(state.prompt.as_str())
        .block(Block::default().borders(Borders::ALL).title(prompt_title));
    frame.render_widget(prompt, chunks[2]);

    let footer = Paragraph::new(format!(
        "status: {}  |  keys: Enter submit · Ctrl+C abort · y/n permission · q quit",
        state.status
    ));
    frame.render_widget(footer, chunks[3]);

    if let Some(perm) = &state.permission {
        draw_permission_modal(frame, area, &perm.summary, &perm.request_id);
    }

    if let Some(err) = &state.error {
        let err_area = Rect {
            x: area.x,
            y: area.y + area.height.saturating_sub(4),
            width: area.width,
            height: 3,
        };
        let msg = Paragraph::new(err.as_str())
            .block(Block::default().borders(Borders::ALL).title("error"));
        frame.render_widget(Clear, err_area);
        frame.render_widget(msg, err_area);
    }
}

fn phase_label(phase: SessionPhase) -> &'static str {
    match phase {
        SessionPhase::Booting => "booting",
        SessionPhase::AwaitingAuth => "auth",
        SessionPhase::Connecting => "connecting",
        SessionPhase::Ready => "ready",
        SessionPhase::Streaming => "streaming",
        SessionPhase::Failed => "failed",
        SessionPhase::Quit => "quit",
    }
}

fn visible_scrollback(state: &AppState, height: usize) -> Vec<String> {
    let height = height.max(1);
    let len = state.scrollback.len();
    if len <= height {
        return state.scrollback.clone();
    }
    state.scrollback[len - height..].to_vec()
}

fn draw_permission_modal(frame: &mut Frame, area: Rect, summary: &str, request_id: &str) {
    let width = area.width.saturating_mul(3) / 4;
    let height = 7u16;
    let x = area.x + (area.width.saturating_sub(width)) / 2;
    let y = area.y + (area.height.saturating_sub(height)) / 2;
    let modal = Rect {
        x,
        y,
        width,
        height,
    };
    frame.render_widget(Clear, modal);
    let body = Paragraph::new(vec![
        Line::from(format!("Permission required ({request_id})")),
        Line::from(summary.to_string()),
        Line::from(""),
        Line::from("y = allow once · n = deny · Esc = deny"),
    ])
    .block(
        Block::default()
            .borders(Borders::ALL)
            .title("permission")
            .style(Style::default().add_modifier(Modifier::BOLD)),
    );
    frame.render_widget(body, modal);
}

/// Render a single frame into a string buffer for smoke tests (no TTY).
pub fn render_smoke_frame(state: &AppState) -> String {
    let mut lines = Vec::new();
    lines.push(format!(
        "AX Code TUI (ratatui · ADR-054) {} [{}]",
        state.directory,
        phase_label(state.phase)
    ));
    lines.push("--- session ---".into());
    for line in visible_scrollback(state, 12) {
        lines.push(line);
    }
    lines.push(format!("prompt> {}", state.prompt));
    lines.push(format!("status: {}", state.status));
    if let Some(p) = &state.permission {
        lines.push(format!("PERMISSION: {} ({})", p.summary, p.request_id));
    }
    if let Some(e) = &state.error {
        lines.push(format!("ERROR: {e}"));
    }
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smoke_frame_includes_title() {
        let state = AppState::new("/proj");
        let frame = render_smoke_frame(&state);
        assert!(frame.contains("AX Code TUI"));
        assert!(frame.contains("ADR-054"));
        assert!(frame.contains("/proj"));
    }
}
