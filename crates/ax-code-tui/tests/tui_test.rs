//! Tests for TUI event handling and input.

use ax_code_tui::events::{MessagePartDeltaProps, MessageRole, RuntimeEvent};
use ax_code_tui::tui::{App, AppMode, InputAction};
use crossterm::event::{Event, KeyCode, KeyEvent, KeyModifiers};

fn app_with_session(session_id: &str) -> App {
    let mut app = App::new();
    app.session_id = Some(session_id.to_string());
    app
}

fn make_key_event(code: KeyCode) -> Event {
    Event::Key(KeyEvent::new(code, KeyModifiers::NONE))
}

fn make_key_event_with_mods(code: KeyCode, mods: KeyModifiers) -> Event {
    Event::Key(KeyEvent::new(code, mods))
}

#[test]
fn test_app_new() {
    let app = App::new();
    assert!(!app.should_quit);
    assert!(app.session_id.is_none());
    assert!(app.messages.is_empty());
    assert!(app.prompt.is_empty());
    assert_eq!(app.mode, AppMode::Input);
}

#[test]
fn test_app_handle_session_created() {
    let mut app = App::new();
    let event = RuntimeEvent::SessionCreated {
        properties: ax_code_tui::events::SessionInfo {
            info: Some(ax_code_tui::events::SessionData {
                id: "sess_123".to_string(),
                title: Some("Test Session".to_string()),
            }),
        },
    };

    app.handle_event(event);

    assert_eq!(app.session_id, Some("sess_123".to_string()));
    assert_eq!(app.session_title, Some("Test Session".to_string()));
}

#[test]
fn test_app_handle_message_updated() {
    let mut app = app_with_session("sess_123");
    let event = RuntimeEvent::MessageUpdated {
        properties: ax_code_tui::events::MessageInfo {
            info: Some(ax_code_tui::events::MessageData {
                id: "msg_001".to_string(),
                session_id: "sess_123".to_string(),
                role: Some(MessageRole::Assistant),
            }),
        },
    };

    app.handle_event(event);

    assert_eq!(app.messages.len(), 1);
    assert_eq!(app.messages[0].id, "msg_001");
    assert!(matches!(app.messages[0].role, MessageRole::Assistant));
}

#[test]
fn test_app_handle_message_part_delta() {
    let mut app = app_with_session("sess_123");

    // First add a message
    app.handle_event(RuntimeEvent::MessageUpdated {
        properties: ax_code_tui::events::MessageInfo {
            info: Some(ax_code_tui::events::MessageData {
                id: "msg_001".to_string(),
                session_id: "sess_123".to_string(),
                role: Some(MessageRole::Assistant),
            }),
        },
    });

    // Then add delta
    app.handle_event(RuntimeEvent::MessagePartDelta {
        properties: MessagePartDeltaProps {
            session_id: "sess_123".to_string(),
            message_id: "msg_001".to_string(),
            part_id: "part_001".to_string(),
            field: "content".to_string(),
            delta: "Hello ".to_string(),
        },
    });

    app.handle_event(RuntimeEvent::MessagePartDelta {
        properties: MessagePartDeltaProps {
            session_id: "sess_123".to_string(),
            message_id: "msg_001".to_string(),
            part_id: "part_001".to_string(),
            field: "content".to_string(),
            delta: "world".to_string(),
        },
    });

    assert_eq!(app.messages[0].content, "Hello world");
}

#[test]
fn test_app_handle_permission_asked() {
    let mut app = app_with_session("sess_123");
    let event = RuntimeEvent::PermissionAsked {
        properties: ax_code_tui::events::PermissionRequestProps {
            session_id: "sess_123".to_string(),
            id: "perm_001".to_string(),
            description: "Allow file write?".to_string(),
            permission_type: Some("file_write".to_string()),
        },
    };

    app.handle_event(event);

    assert_eq!(app.pending_permissions.len(), 1);
    assert_eq!(app.pending_permissions[0].request_id, "perm_001");
    assert_eq!(app.mode, AppMode::Permission);
}

#[test]
fn test_app_handle_question_asked() {
    let mut app = app_with_session("sess_123");
    let event = RuntimeEvent::QuestionAsked {
        properties: ax_code_tui::events::QuestionRequestProps {
            session_id: "sess_123".to_string(),
            id: "q_001".to_string(),
            question: "Which option?".to_string(),
            options: vec!["A".to_string(), "B".to_string(), "C".to_string()],
            items: vec![],
        },
    };

    app.handle_event(event);

    assert_eq!(app.pending_questions.len(), 1);
    assert_eq!(app.pending_questions[0].request_id, "q_001");
    assert_eq!(app.pending_questions[0].options.len(), 3);
    assert_eq!(app.mode, AppMode::Question);
}

#[test]
fn test_app_insert_char() {
    let mut app = App::new();
    app.insert_char('H');
    app.insert_char('i');

    assert_eq!(app.prompt, "Hi");
    assert_eq!(app.cursor_position, 2);
}

#[test]
fn test_app_backspace() {
    let mut app = App::new();
    app.insert_char('H');
    app.insert_char('i');
    app.backspace();

    assert_eq!(app.prompt, "H");
    assert_eq!(app.cursor_position, 1);
}

#[test]
fn test_paste_and_grapheme_safe_backspace() {
    let mut app = App::new();
    let action =
        ax_code_tui::tui::handle_input(&mut app, Event::Paste("第一行\r\n👩‍💻 e\u{301}".to_string()));

    assert!(matches!(action, InputAction::None));
    assert_eq!(app.prompt, "第一行\n👩‍💻 e\u{301}");
    assert_eq!(app.cursor_position, 7);
    app.backspace();
    assert_eq!(app.prompt, "第一行\n👩‍💻 ");
}

#[test]
fn test_shift_enter_inserts_newline_without_submitting() {
    let mut app = App::new();
    app.insert_text("review");
    let action = ax_code_tui::tui::handle_input(
        &mut app,
        make_key_event_with_mods(KeyCode::Enter, KeyModifiers::SHIFT),
    );

    assert!(matches!(action, InputAction::None));
    assert_eq!(app.prompt, "review\n");
}

#[test]
fn test_app_cursor_movement() {
    let mut app = App::new();
    app.insert_char('H');
    app.insert_char('i');
    app.move_cursor_left();

    assert_eq!(app.cursor_position, 1);

    app.move_cursor_right();
    assert_eq!(app.cursor_position, 2);
}

#[test]
fn test_app_take_prompt() {
    let mut app = App::new();
    app.insert_char('H');
    app.insert_char('i');

    let prompt = app.take_prompt();

    assert_eq!(prompt, "Hi");
    assert!(app.prompt.is_empty());
    assert_eq!(app.cursor_position, 0);
}

#[test]
fn test_input_submit_prompt() {
    let mut app = App::new();
    app.insert_char('H');
    app.insert_char('i');

    let action = ax_code_tui::tui::handle_input(&mut app, make_key_event(KeyCode::Enter));

    match action {
        InputAction::SubmitPrompt(prompt) => assert_eq!(prompt, "Hi"),
        _ => panic!("Expected SubmitPrompt"),
    }
}

#[test]
fn test_input_quit_ctrl_c() {
    let mut app = App::new();

    let action = ax_code_tui::tui::handle_input(
        &mut app,
        make_key_event_with_mods(KeyCode::Char('c'), KeyModifiers::CONTROL),
    );

    assert!(app.should_quit);
    assert!(matches!(action, InputAction::None));
}

#[test]
fn test_input_permission_accept() {
    let mut app = app_with_session("sess_123");

    // Add a permission request
    app.handle_event(RuntimeEvent::PermissionAsked {
        properties: ax_code_tui::events::PermissionRequestProps {
            session_id: "sess_123".to_string(),
            id: "perm_001".to_string(),
            description: "Test".to_string(),
            permission_type: None,
        },
    });

    let action = ax_code_tui::tui::handle_input(&mut app, make_key_event(KeyCode::Char('y')));

    match action {
        InputAction::AcceptPermission {
            session_id,
            request_id,
        } => {
            assert_eq!(session_id, "sess_123");
            assert_eq!(request_id, "perm_001");
        }
        _ => panic!("Expected AcceptPermission"),
    }

    assert_eq!(app.mode, AppMode::Input);
}

#[test]
fn test_input_permission_reject() {
    let mut app = app_with_session("sess_123");

    app.handle_event(RuntimeEvent::PermissionAsked {
        properties: ax_code_tui::events::PermissionRequestProps {
            session_id: "sess_123".to_string(),
            id: "perm_001".to_string(),
            description: "Test".to_string(),
            permission_type: None,
        },
    });

    let action = ax_code_tui::tui::handle_input(&mut app, make_key_event(KeyCode::Char('n')));

    match action {
        InputAction::RejectPermission {
            session_id,
            request_id,
        } => {
            assert_eq!(session_id, "sess_123");
            assert_eq!(request_id, "perm_001");
        }
        _ => panic!("Expected RejectPermission"),
    }
}

#[test]
fn test_input_question_navigate_and_select() {
    let mut app = app_with_session("sess_123");

    app.handle_event(RuntimeEvent::QuestionAsked {
        properties: ax_code_tui::events::QuestionRequestProps {
            session_id: "sess_123".to_string(),
            id: "q_001".to_string(),
            question: "Choose".to_string(),
            options: vec!["Option A".to_string(), "Option B".to_string()],
            items: vec![],
        },
    });

    // Navigate down
    ax_code_tui::tui::handle_input(&mut app, make_key_event(KeyCode::Down));
    assert_eq!(app.pending_questions[0].selected, 1);

    // Navigate up
    ax_code_tui::tui::handle_input(&mut app, make_key_event(KeyCode::Up));
    assert_eq!(app.pending_questions[0].selected, 0);

    // Select with number key
    let action = ax_code_tui::tui::handle_input(&mut app, make_key_event(KeyCode::Char('2')));

    match action {
        InputAction::AnswerQuestion {
            session_id,
            request_id,
            answers,
        } => {
            assert_eq!(session_id, "sess_123");
            assert_eq!(request_id, "q_001");
            assert_eq!(answers, vec![vec!["Option B".to_string()]]);
        }
        _ => panic!("Expected AnswerQuestion"),
    }
}

#[test]
fn test_input_question_escape() {
    let mut app = app_with_session("sess_123");

    app.handle_event(RuntimeEvent::QuestionAsked {
        properties: ax_code_tui::events::QuestionRequestProps {
            session_id: "sess_123".to_string(),
            id: "q_001".to_string(),
            question: "Choose".to_string(),
            options: vec!["A".to_string()],
            items: vec![],
        },
    });

    let action = ax_code_tui::tui::handle_input(&mut app, make_key_event(KeyCode::Esc));

    match action {
        InputAction::RejectQuestion {
            session_id,
            request_id,
        } => {
            assert_eq!(session_id, "sess_123");
            assert_eq!(request_id, "q_001");
        }
        _ => panic!("Expected RejectQuestion"),
    }
}

#[test]
fn test_scroll() {
    let mut app = App::new();

    // Seed a transcript so scroll_down has somewhere to go. Without messages
    // the new bounded scroll_down stays at 0 (you cannot scroll past nothing).
    use ax_code_tui::events::{MessageData, MessageInfo, MessageRole, RuntimeEvent};
    for i in 0..5 {
        app.handle_event(RuntimeEvent::MessageUpdated {
            properties: MessageInfo {
                info: Some(MessageData {
                    id: format!("m{}", i),
                    session_id: "s".to_string(),
                    role: Some(MessageRole::Assistant),
                }),
            },
        });
    }

    app.scroll_up();
    assert_eq!(app.scroll_offset, 3);

    app.scroll_up();
    assert_eq!(app.scroll_offset, 6);

    app.scroll_down();
    assert_eq!(app.scroll_offset, 3);

    app.scroll_down();
    assert_eq!(app.scroll_offset, 0);

    // Can't scroll below the live bottom.
    for _ in 0..20 {
        app.scroll_down();
    }
    assert_eq!(app.scroll_offset, 0);
}

#[test]
fn test_scroll_empty_transcript_is_clamped_to_zero() {
    // No messages => scroll_down is a no-op (regression for the old unbounded
    // behavior that let users scroll into a blank transcript).
    let mut app = App::new();
    app.scroll_down();
    app.scroll_down();
    assert_eq!(app.scroll_offset, 0);
}
