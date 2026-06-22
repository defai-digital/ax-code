//! Input handling for keyboard and mouse events.

use crossterm::event::{Event, KeyCode, KeyEvent, KeyModifiers};

use super::app::{App, AppMode};

/// Actions that can result from input handling.
#[derive(Debug, Clone)]
pub enum InputAction {
    /// No action needed.
    None,
    /// Submit a prompt.
    SubmitPrompt(String),
    /// Accept a permission request.
    AcceptPermission {
        session_id: String,
        request_id: String,
    },
    /// Reject a permission request.
    RejectPermission {
        session_id: String,
        request_id: String,
    },
    /// Answer a question.
    AnswerQuestion {
        session_id: String,
        request_id: String,
        answers: Vec<Vec<String>>,
    },
    /// Reject a question.
    RejectQuestion {
        session_id: String,
        request_id: String,
    },
    /// Abort the current session.
    AbortSession { session_id: String },
    /// Switch to a different session.
    SwitchSession { session_id: String },
}

/// Handle an input event and update app state.
pub fn handle_input(app: &mut App, event: Event) -> InputAction {
    match event {
        Event::Key(key_event) => handle_key(app, key_event),
        Event::Mouse(mouse_event) => handle_mouse(app, mouse_event),
        Event::Resize(_, _) => {
            // Terminal will re-render automatically
            InputAction::None
        }
        _ => InputAction::None,
    }
}

/// Handle a key event.
fn handle_key(app: &mut App, event: KeyEvent) -> InputAction {
    match app.mode {
        AppMode::Input => handle_input_mode_key(app, event),
        AppMode::Permission => handle_permission_mode_key(app, event),
        AppMode::Question => handle_question_mode_key(app, event),
    }
}

fn handle_quit_shortcut(app: &mut App, event: KeyEvent) -> Option<InputAction> {
    match event.code {
        KeyCode::Char('c') | KeyCode::Char('q')
            if event.modifiers.contains(KeyModifiers::CONTROL) =>
        {
            app.quit();
            Some(InputAction::None)
        }
        _ => None,
    }
}

/// Handle key in input mode.
fn handle_input_mode_key(app: &mut App, event: KeyEvent) -> InputAction {
    // If session list is shown, handle session navigation
    if app.show_session_list {
        return handle_session_list_key(app, event);
    }

    // If tool panel is shown, handle tool navigation
    if app.show_tool_panel {
        return handle_tool_panel_key(app, event);
    }

    match event.code {
        // Quit on Ctrl+C or Ctrl+Q
        KeyCode::Char('c') if event.modifiers.contains(KeyModifiers::CONTROL) => {
            app.quit();
            InputAction::None
        }
        KeyCode::Char('q') if event.modifiers.contains(KeyModifiers::CONTROL) => {
            app.quit();
            InputAction::None
        }
        // Abort session on Ctrl+X
        KeyCode::Char('x') if event.modifiers.contains(KeyModifiers::CONTROL) => {
            if let Some(session_id) = app.request_abort() {
                InputAction::AbortSession { session_id }
            } else {
                InputAction::None
            }
        }
        // Tab toggles session list
        KeyCode::Tab => {
            app.toggle_session_list();
            InputAction::None
        }
        // 't' toggles tool panel (only when not in prompt)
        KeyCode::Char('t') if app.prompt.is_empty() => {
            app.toggle_tool_panel();
            InputAction::None
        }
        // Enter submits prompt
        KeyCode::Enter => {
            let prompt = app.take_prompt();
            if !prompt.is_empty() {
                InputAction::SubmitPrompt(prompt)
            } else {
                InputAction::None
            }
        }
        // Backspace deletes character
        KeyCode::Backspace => {
            app.backspace();
            InputAction::None
        }
        // Arrow keys for cursor movement and scrolling
        KeyCode::Left => {
            app.move_cursor_left();
            InputAction::None
        }
        KeyCode::Right => {
            app.move_cursor_right();
            InputAction::None
        }
        KeyCode::Up => {
            app.scroll_up();
            InputAction::None
        }
        KeyCode::Down => {
            app.scroll_down();
            InputAction::None
        }
        // Home/End for cursor
        KeyCode::Home => {
            app.cursor_position = 0;
            InputAction::None
        }
        KeyCode::End => {
            app.cursor_position = app.prompt.chars().count();
            InputAction::None
        }
        // Regular character input
        KeyCode::Char(c) => {
            app.insert_char(c);
            InputAction::None
        }
        _ => InputAction::None,
    }
}

/// Handle key when tool panel is visible.
fn handle_tool_panel_key(app: &mut App, event: KeyEvent) -> InputAction {
    match event.code {
        // Navigate tools
        KeyCode::Up | KeyCode::Char('k') => {
            app.prev_tool();
            InputAction::None
        }
        KeyCode::Down | KeyCode::Char('j') => {
            app.next_tool();
            InputAction::None
        }
        // Toggle expanded view
        KeyCode::Enter => {
            app.toggle_tool_expanded();
            InputAction::None
        }
        // Close tool panel
        KeyCode::Esc | KeyCode::Char('t') => {
            app.show_tool_panel = false;
            InputAction::None
        }
        _ => InputAction::None,
    }
}

/// Handle key when session list is visible.
fn handle_session_list_key(app: &mut App, event: KeyEvent) -> InputAction {
    match event.code {
        // Navigate sessions
        KeyCode::Up | KeyCode::Char('k') => {
            app.prev_session();
            InputAction::None
        }
        KeyCode::Down | KeyCode::Char('j') => {
            app.next_session();
            InputAction::None
        }
        // Select session
        KeyCode::Enter => {
            if let Some(session_id) = app.select_session() {
                InputAction::SwitchSession { session_id }
            } else {
                InputAction::None
            }
        }
        // Close session list
        KeyCode::Esc | KeyCode::Tab => {
            app.show_session_list = false;
            InputAction::None
        }
        _ => InputAction::None,
    }
}

/// Handle key in permission mode.
fn handle_permission_mode_key(app: &mut App, event: KeyEvent) -> InputAction {
    if let Some(action) = handle_quit_shortcut(app, event) {
        return action;
    }

    match event.code {
        // Accept on 'y' or 'Y'
        KeyCode::Char('y') | KeyCode::Char('Y') => {
            if let Some((session_id, request_id)) = app.accept_permission() {
                InputAction::AcceptPermission {
                    session_id,
                    request_id,
                }
            } else {
                InputAction::None
            }
        }
        // Reject on 'n' or 'N'
        KeyCode::Char('n') | KeyCode::Char('N') => {
            if let Some((session_id, request_id)) = app.reject_permission() {
                InputAction::RejectPermission {
                    session_id,
                    request_id,
                }
            } else {
                InputAction::None
            }
        }
        // Escape also rejects
        KeyCode::Esc => {
            if let Some((session_id, request_id)) = app.reject_permission() {
                InputAction::RejectPermission {
                    session_id,
                    request_id,
                }
            } else {
                InputAction::None
            }
        }
        _ => InputAction::None,
    }
}

/// Handle key in question mode.
fn handle_question_mode_key(app: &mut App, event: KeyEvent) -> InputAction {
    if let Some(action) = handle_quit_shortcut(app, event) {
        return action;
    }

    match event.code {
        // Navigate up
        KeyCode::Up | KeyCode::Char('k') => {
            app.question_up();
            InputAction::None
        }
        // Navigate down
        KeyCode::Down | KeyCode::Char('j') => {
            app.question_down();
            InputAction::None
        }
        // Number keys for direct selection
        KeyCode::Char('1') => select_question_option(app, 0),
        KeyCode::Char('2') => select_question_option(app, 1),
        KeyCode::Char('3') => select_question_option(app, 2),
        KeyCode::Char('4') => select_question_option(app, 3),
        KeyCode::Char('5') => select_question_option(app, 4),
        KeyCode::Char('6') => select_question_option(app, 5),
        KeyCode::Char('7') => select_question_option(app, 6),
        KeyCode::Char('8') => select_question_option(app, 7),
        KeyCode::Char('9') => select_question_option(app, 8),
        // Enter selects current
        KeyCode::Enter => {
            if let Some((session_id, request_id, answers)) = app.select_question() {
                InputAction::AnswerQuestion {
                    session_id,
                    request_id,
                    answers,
                }
            } else {
                InputAction::None
            }
        }
        // Escape rejects
        KeyCode::Esc => {
            if let Some((session_id, request_id)) = app.reject_question() {
                InputAction::RejectQuestion {
                    session_id,
                    request_id,
                }
            } else {
                InputAction::None
            }
        }
        _ => InputAction::None,
    }
}

/// Select a specific question option by index.
fn select_question_option(app: &mut App, index: usize) -> InputAction {
    if let Some(req) = app.pending_questions.first_mut() {
        if index < req.options.len() {
            req.selected = index;
            if let Some((session_id, request_id, answers)) = app.select_question() {
                return InputAction::AnswerQuestion {
                    session_id,
                    request_id,
                    answers,
                };
            }
        }
    }
    InputAction::None
}

/// Handle mouse events.
fn handle_mouse(app: &mut App, event: crossterm::event::MouseEvent) -> InputAction {
    use crossterm::event::MouseEventKind;

    match event.kind {
        MouseEventKind::ScrollUp => {
            app.scroll_up();
        }
        MouseEventKind::ScrollDown => {
            app.scroll_down();
        }
        _ => {}
    }

    InputAction::None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctrl_key(ch: char) -> Event {
        Event::Key(KeyEvent::new(KeyCode::Char(ch), KeyModifiers::CONTROL))
    }

    #[test]
    fn ctrl_c_quits_in_permission_mode() {
        let mut app = App::new();
        app.mode = AppMode::Permission;

        let action = handle_input(&mut app, ctrl_key('c'));

        assert!(matches!(action, InputAction::None));
        assert!(app.should_quit);
    }

    #[test]
    fn ctrl_q_quits_in_question_mode() {
        let mut app = App::new();
        app.mode = AppMode::Question;

        let action = handle_input(&mut app, ctrl_key('q'));

        assert!(matches!(action, InputAction::None));
        assert!(app.should_quit);
    }
}
