//! Rendering logic using Ratatui.

use ratatui::{
    Frame,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    symbols,
    text::{Line, Span},
    widgets::{Block, Borders, Clear, List, ListItem, Paragraph, Wrap},
};

use super::app::{App, AppMode, SessionStatus};
use crate::events::MessageRole;

const ASCII_BORDER: symbols::border::Set = symbols::border::Set {
    top_left: "+",
    top_right: "+",
    bottom_left: "+",
    bottom_right: "+",
    vertical_left: "|",
    vertical_right: "|",
    horizontal_top: "-",
    horizontal_bottom: "-",
};

fn use_ascii_borders() -> bool {
    cfg!(windows) || std::env::var("AX_CODE_TUI_ASCII_BORDERS").is_ok_and(|value| value != "0")
}

fn bordered_block() -> Block<'static> {
    let block = Block::default().borders(Borders::ALL);
    if use_ascii_borders() {
        block.border_set(ASCII_BORDER)
    } else {
        block
    }
}

fn glyph(unicode: &'static str, ascii: &'static str) -> &'static str {
    if use_ascii_borders() { ascii } else { unicode }
}

/// Render the TUI to the given frame.
pub fn render(frame: &mut Frame, app: &App) {
    let size = frame.area();

    // If session list is shown, use split layout
    if app.show_session_list {
        let main_chunks = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([
                Constraint::Percentage(70), // Main content
                Constraint::Percentage(30), // Session list
            ])
            .split(size);

        render_main_content(frame, app, main_chunks[0]);
        render_session_list(frame, app, main_chunks[1]);
    } else {
        render_main_content(frame, app, size);
    }

    // Render modal overlays if needed
    match app.mode {
        AppMode::Permission => render_permission_modal(frame, app, size),
        AppMode::Question => render_question_modal(frame, app, size),
        AppMode::Input => {}
    }
}

/// Render the main content area.
fn render_main_content(frame: &mut Frame, app: &App, area: Rect) {
    // If tool panel is shown, split horizontally
    if app.show_tool_panel {
        let chunks = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([
                Constraint::Percentage(60), // Main
                Constraint::Percentage(40), // Tool panel
            ])
            .split(area);

        render_main_vertical(frame, app, chunks[0]);
        render_tool_panel(frame, app, chunks[1]);
    } else {
        render_main_vertical(frame, app, area);
    }
}

/// Render the main vertical layout.
fn render_main_vertical(frame: &mut Frame, app: &App, area: Rect) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3), // Header
            Constraint::Min(10),   // Transcript
            Constraint::Length(3), // Footer (prompt)
            Constraint::Length(1), // Status bar
        ])
        .split(area);

    render_header(frame, app, chunks[0]);
    render_transcript(frame, app, chunks[1]);
    render_footer(frame, app, chunks[2]);
    render_status_bar(frame, app, chunks[3]);
}

/// Render the header with session info.
fn render_header(frame: &mut Frame, app: &App, area: Rect) {
    let title = app.session_title.as_deref().unwrap_or("AX Code TUI");

    let session_info = app
        .session_id
        .as_ref()
        .map(|id| format!(" [{}]", short_id(id)))
        .unwrap_or_default();

    // Status indicator
    let status_indicator = match app.session_status {
        SessionStatus::Idle => "",
        SessionStatus::Running => glyph(" ●", " *"),
        SessionStatus::Aborted => glyph(" ○", " o"),
    };

    let status_color = match app.session_status {
        SessionStatus::Idle => Color::Gray,
        SessionStatus::Running => Color::Green,
        SessionStatus::Aborted => Color::Red,
    };

    // Active tool calls count
    let tool_count = app.active_tool_calls().len();
    let tool_info = if tool_count > 0 {
        format!(" [{} tools]", tool_count)
    } else {
        String::new()
    };

    let header_line = Line::from(vec![
        Span::styled(
            format!("{}{}", title, session_info),
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(status_indicator, Style::default().fg(status_color)),
        Span::styled(tool_info, Style::default().fg(Color::Yellow)),
    ]);

    let header = Paragraph::new(header_line).block(bordered_block().title(" Session "));

    frame.render_widget(header, area);
}

/// Render the message transcript.
fn render_transcript(frame: &mut Frame, app: &App, area: Rect) {
    // Maximum content length for message display
    const MAX_MESSAGE_LEN: usize = 500;

    let messages: Vec<ListItem> = app
        .messages
        .iter()
        .skip(app.scroll_offset)
        .map(|msg| {
            let role_style = match msg.role {
                MessageRole::User => Style::default()
                    .fg(Color::Green)
                    .add_modifier(Modifier::BOLD),
                MessageRole::Assistant => Style::default().fg(Color::Blue),
                MessageRole::System => Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::ITALIC),
            };

            let role_prefix = match msg.role {
                MessageRole::User => "You: ",
                MessageRole::Assistant => "Assistant: ",
                MessageRole::System => "System: ",
            };

            // Truncate long messages
            let content = if msg.content.is_empty() {
                "...".to_string()
            } else {
                App::truncate_message(&msg.content, MAX_MESSAGE_LEN)
            };

            // Show streaming indicator for partial messages
            let streaming_indicator = if msg.is_streaming {
                glyph(" ●", " *")
            } else {
                ""
            };

            let line = Line::from(vec![
                Span::styled(role_prefix, role_style),
                Span::raw(content),
                Span::styled(streaming_indicator, Style::default().fg(Color::Yellow)),
            ]);

            ListItem::new(line)
        })
        .collect();

    let transcript = List::new(messages)
        .block(bordered_block().title(" Transcript "))
        .style(Style::default().fg(Color::White));

    frame.render_widget(transcript, area);
}

/// Render the prompt input area.
fn render_footer(frame: &mut Frame, app: &App, area: Rect) {
    let input_style = if app.mode == AppMode::Input {
        Style::default().fg(Color::White)
    } else {
        Style::default().fg(Color::DarkGray)
    };

    let prompt = Paragraph::new(app.prompt.as_str())
        .style(input_style)
        .block(bordered_block().title(" Prompt "));

    frame.render_widget(prompt, area);

    // Show cursor if in input mode
    if app.mode == AppMode::Input && area.width > 1 && area.height > 1 {
        let inner_width = area.width.saturating_sub(2);
        let cursor_offset = app
            .cursor_position
            .min(inner_width.saturating_sub(1) as usize) as u16;
        frame.set_cursor_position((area.x + cursor_offset + 1, area.y + 1));
    }
}

/// Render the status bar.
fn render_status_bar(frame: &mut Frame, app: &App, area: Rect) {
    let width = area.width as usize;
    let status_text = App::format_status_bar(app.mode, app.status_message.as_deref(), width);

    let status_bar =
        Paragraph::new(status_text).style(Style::default().fg(Color::Black).bg(Color::Gray));

    frame.render_widget(status_bar, area);
}

/// Render the permission request modal.
fn render_permission_modal(frame: &mut Frame, app: &App, area: Rect) {
    // FIFO: the front request is the one the user is currently answering.
    if let Some(req) = app.pending_permissions.first() {
        let modal_area = centered_rect(60, 40, area);

        let text = format!(
            "Permission Required\n\n{}\n\nType: {}\n\n[y] Accept  [n] Reject",
            req.description, req.permission_type
        );

        let modal = Paragraph::new(text)
            .style(Style::default().fg(Color::Yellow))
            .block(
                bordered_block()
                    .title(" Permission ")
                    .style(Style::default().fg(Color::Yellow)),
            )
            .wrap(Wrap { trim: true });

        frame.render_widget(Clear, modal_area);
        frame.render_widget(modal, modal_area);
    }
}

/// Render the question request modal.
fn render_question_modal(frame: &mut Frame, app: &App, area: Rect) {
    // FIFO: the front request is the one the user is currently answering.
    if let Some(req) = app.pending_questions.first() {
        let modal_area = centered_rect(70, 50, area);

        let items: Vec<ListItem> = req
            .options
            .iter()
            .enumerate()
            .map(|(i, opt)| {
                let prefix = if i == req.selected {
                    glyph("▶ ", "> ")
                } else {
                    "  "
                };
                let style = if i == req.selected {
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD)
                } else {
                    Style::default().fg(Color::White)
                };
                ListItem::new(Line::from(Span::styled(
                    format!("{}{}. {}", prefix, i + 1, opt),
                    style,
                )))
            })
            .collect();

        // Show progress indicator for multi-question requests so the user
        // knows which sub-question they are answering (e.g. "(2/3)").
        let progress = if req.total > 1 {
            format!(" ({}/{})", req.index + 1, req.total)
        } else {
            String::new()
        };

        let list = List::new(items)
            .block(
                bordered_block()
                    .title(format!(" {}{} ", req.question, progress))
                    .style(Style::default().fg(Color::Cyan)),
            )
            .style(Style::default().fg(Color::White));

        frame.render_widget(Clear, modal_area);
        frame.render_widget(list, modal_area);

        // Render footer hint
        let footer_area = Rect {
            x: modal_area.x,
            y: modal_area.y + modal_area.height.saturating_sub(1),
            width: modal_area.width,
            height: 1,
        };
        let footer = Paragraph::new(format!(
            " [{}] Navigate  [Enter/1-9] Select  [Esc] Cancel ",
            glyph("↑↓", "Up/Down")
        ))
        .style(Style::default().fg(Color::Black).bg(Color::Gray));
        frame.render_widget(footer, footer_area);
    }
}

/// Render the session list sidebar.
fn render_session_list(frame: &mut Frame, app: &App, area: Rect) {
    let items: Vec<ListItem> = app
        .sessions
        .iter()
        .enumerate()
        .map(|(i, session)| {
            let is_current = app.session_id.as_ref() == Some(&session.id);
            let is_selected = i == app.selected_session_index;

            let prefix = if is_current {
                glyph("▶ ", "> ")
            } else {
                "  "
            };
            let title = session.title.as_deref().unwrap_or("Untitled");
            let id_short = short_id(&session.id);

            let style = if is_selected {
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD)
                    .bg(Color::DarkGray)
            } else if is_current {
                Style::default().fg(Color::Green)
            } else {
                Style::default().fg(Color::White)
            };

            ListItem::new(Line::from(Span::styled(
                format!("{}{} ({})", prefix, title, id_short),
                style,
            )))
        })
        .collect();

    let list = List::new(items).block(
        bordered_block()
            .title(" Sessions ")
            .style(Style::default().fg(Color::Cyan)),
    );

    frame.render_widget(list, area);
}

/// Render the tool results panel.
fn render_tool_panel(frame: &mut Frame, app: &App, area: Rect) {
    use super::app::ToolCallStatus;

    let completed_tools = app.completed_tool_calls();

    if completed_tools.is_empty() {
        let empty_msg = Paragraph::new("No completed tool calls")
            .style(Style::default().fg(Color::DarkGray))
            .block(
                bordered_block()
                    .title(" Tool Results ")
                    .style(Style::default().fg(Color::Magenta)),
            );
        frame.render_widget(empty_msg, area);
        return;
    }

    // Split area: tool list at top, result preview at bottom
    let panel_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(completed_tools.len().min(10) as u16 + 2), // Tool list
            Constraint::Min(5),                                           // Result preview
        ])
        .split(area);

    // Render tool list
    let tool_items: Vec<ListItem> = completed_tools
        .iter()
        .enumerate()
        .map(|(i, tool)| {
            let is_selected = i == app.selected_tool_index;

            let status_icon = match tool.status {
                ToolCallStatus::Running => glyph("●", "*"),
                ToolCallStatus::Completed => glyph("✓", "v"),
                ToolCallStatus::Failed => glyph("✗", "x"),
            };

            let status_color = match tool.status {
                ToolCallStatus::Running => Color::Yellow,
                ToolCallStatus::Completed => Color::Green,
                ToolCallStatus::Failed => Color::Red,
            };

            let style = if is_selected {
                Style::default()
                    .fg(Color::Magenta)
                    .add_modifier(Modifier::BOLD)
                    .bg(Color::DarkGray)
            } else {
                Style::default().fg(Color::White)
            };

            ListItem::new(Line::from(vec![
                Span::styled(
                    format!("{} ", status_icon),
                    Style::default().fg(status_color),
                ),
                Span::styled(&tool.tool_name, style),
            ]))
        })
        .collect();

    let tool_list = List::new(tool_items).block(
        bordered_block()
            .title(" Tools ")
            .style(Style::default().fg(Color::Magenta)),
    );

    frame.render_widget(tool_list, panel_chunks[0]);

    // Render selected tool result
    if let Some(tool) = app.selected_completed_tool() {
        let result_content = if let Some(ref error) = tool.error {
            format!("Error: {}", error)
        } else if let Some(ref result) = tool.result {
            result.clone()
        } else {
            "(no output)".to_string()
        };

        let display_content = if app.tool_result_expanded {
            result_content
        } else {
            App::truncate_result(&result_content, 200)
        };

        let expand_hint = if app.tool_result_expanded {
            " [Enter] Collapse "
        } else {
            " [Enter] Expand "
        };

        let result_block = bordered_block()
            .title(format!(" {} Result ", tool.tool_name))
            .style(Style::default().fg(Color::Magenta));

        let result_para = Paragraph::new(display_content)
            .block(result_block)
            .style(Style::default().fg(Color::White))
            .wrap(Wrap { trim: false });

        frame.render_widget(result_para, panel_chunks[1]);

        // Render hint at bottom
        if panel_chunks[1].height > 2 {
            let hint_area = Rect {
                x: panel_chunks[1].x,
                y: panel_chunks[1].y + panel_chunks[1].height.saturating_sub(1),
                width: panel_chunks[1].width,
                height: 1,
            };
            let hint = Paragraph::new(format!(
                " [{}] Navigate{}[t] Close ",
                glyph("↑↓", "Up/Down"),
                expand_hint
            ))
            .style(Style::default().fg(Color::Black).bg(Color::Gray));
            frame.render_widget(hint, hint_area);
        }
    }
}

/// Helper to create a centered rectangle.
fn centered_rect(percent_x: u16, percent_y: u16, r: Rect) -> Rect {
    let popup_layout = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Percentage((100 - percent_y) / 2),
            Constraint::Percentage(percent_y),
            Constraint::Percentage((100 - percent_y) / 2),
        ])
        .split(r);

    Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage((100 - percent_x) / 2),
            Constraint::Percentage(percent_x),
            Constraint::Percentage((100 - percent_x) / 2),
        ])
        .split(popup_layout[1])[1]
}

fn short_id(id: &str) -> String {
    id.chars().take(8).collect()
}
