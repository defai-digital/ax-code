//! Tests for tool calls, session switching, and abort functionality.

use ax_code_tui::events::{
    MessageData, MessageInfo, MessagePartDeltaProps, MessageRole, RuntimeEvent,
    ToolCallCompleteProps, ToolCallStartProps,
};
use ax_code_tui::tui::{App, InputAction, SessionStatus, SessionSummary, ToolCallStatus};
use crossterm::event::{Event, KeyCode, KeyEvent, KeyModifiers};

fn make_key_event(code: KeyCode) -> Event {
    Event::Key(KeyEvent::new(code, KeyModifiers::NONE))
}

fn make_key_event_with_mods(code: KeyCode, mods: KeyModifiers) -> Event {
    Event::Key(KeyEvent::new(code, mods))
}

#[test]
fn test_tool_call_start() {
    let mut app = App::new();

    app.handle_event(RuntimeEvent::ToolCallStart {
        properties: ToolCallStartProps {
            session_id: "sess_123".to_string(),
            call_id: "call_001".to_string(),
            tool_name: "bash".to_string(),
        },
    });

    assert_eq!(app.tool_calls.len(), 1);
    assert_eq!(app.tool_calls[0].call_id, "call_001");
    assert_eq!(app.tool_calls[0].tool_name, "bash");
    assert_eq!(app.tool_calls[0].status, ToolCallStatus::Running);
    assert_eq!(app.session_status, SessionStatus::Running);
}

#[test]
fn test_tool_call_complete() {
    let mut app = App::new();

    // Start a tool call
    app.handle_event(RuntimeEvent::ToolCallStart {
        properties: ToolCallStartProps {
            session_id: "sess_123".to_string(),
            call_id: "call_001".to_string(),
            tool_name: "bash".to_string(),
        },
    });

    // Complete the tool call
    app.handle_event(RuntimeEvent::ToolCallComplete {
        properties: ToolCallCompleteProps {
            session_id: "sess_123".to_string(),
            call_id: "call_001".to_string(),
            tool_name: "bash".to_string(),
            result: Some("success".to_string()),
            error: None,
        },
    });

    assert_eq!(app.tool_calls[0].status, ToolCallStatus::Completed);
    assert_eq!(app.tool_calls[0].result, Some("success".to_string()));
    assert_eq!(app.session_status, SessionStatus::Idle);
}

#[test]
fn test_tool_call_failed() {
    let mut app = App::new();

    app.handle_event(RuntimeEvent::ToolCallStart {
        properties: ToolCallStartProps {
            session_id: "sess_123".to_string(),
            call_id: "call_001".to_string(),
            tool_name: "bash".to_string(),
        },
    });

    app.handle_event(RuntimeEvent::ToolCallComplete {
        properties: ToolCallCompleteProps {
            session_id: "sess_123".to_string(),
            call_id: "call_001".to_string(),
            tool_name: "bash".to_string(),
            result: None,
            error: Some("command failed".to_string()),
        },
    });

    assert_eq!(app.tool_calls[0].status, ToolCallStatus::Failed);
    assert_eq!(app.tool_calls[0].error, Some("command failed".to_string()));
}

#[test]
fn test_multiple_tool_calls() {
    let mut app = App::new();

    // Start two tool calls
    app.handle_event(RuntimeEvent::ToolCallStart {
        properties: ToolCallStartProps {
            session_id: "sess_123".to_string(),
            call_id: "call_001".to_string(),
            tool_name: "bash".to_string(),
        },
    });

    app.handle_event(RuntimeEvent::ToolCallStart {
        properties: ToolCallStartProps {
            session_id: "sess_123".to_string(),
            call_id: "call_002".to_string(),
            tool_name: "edit".to_string(),
        },
    });

    assert_eq!(app.tool_calls.len(), 2);
    assert_eq!(app.session_status, SessionStatus::Running);

    // Complete first tool
    app.handle_event(RuntimeEvent::ToolCallComplete {
        properties: ToolCallCompleteProps {
            session_id: "sess_123".to_string(),
            call_id: "call_001".to_string(),
            tool_name: "bash".to_string(),
            result: Some("done".to_string()),
            error: None,
        },
    });

    // Session should still be running (one tool still active)
    assert_eq!(app.session_status, SessionStatus::Running);

    // Complete second tool
    app.handle_event(RuntimeEvent::ToolCallComplete {
        properties: ToolCallCompleteProps {
            session_id: "sess_123".to_string(),
            call_id: "call_002".to_string(),
            tool_name: "edit".to_string(),
            result: Some("done".to_string()),
            error: None,
        },
    });

    // Now session should be idle
    assert_eq!(app.session_status, SessionStatus::Idle);
}

#[test]
fn test_active_tool_calls() {
    let mut app = App::new();

    app.handle_event(RuntimeEvent::ToolCallStart {
        properties: ToolCallStartProps {
            session_id: "sess_123".to_string(),
            call_id: "call_001".to_string(),
            tool_name: "bash".to_string(),
        },
    });

    assert_eq!(app.active_tool_calls().len(), 1);

    app.handle_event(RuntimeEvent::ToolCallComplete {
        properties: ToolCallCompleteProps {
            session_id: "sess_123".to_string(),
            call_id: "call_001".to_string(),
            tool_name: "bash".to_string(),
            result: None,
            error: None,
        },
    });

    assert_eq!(app.active_tool_calls().len(), 0);
}

#[test]
fn test_session_list() {
    let mut app = App::new();
    app.session_id = Some("sess_002".to_string());

    let sessions = vec![
        SessionSummary {
            id: "sess_001".to_string(),
            title: Some("First Session".to_string()),
            message_count: 10,
        },
        SessionSummary {
            id: "sess_002".to_string(),
            title: Some("Second Session".to_string()),
            message_count: 5,
        },
        SessionSummary {
            id: "sess_003".to_string(),
            title: Some("Third Session".to_string()),
            message_count: 20,
        },
    ];

    app.load_sessions(sessions);

    assert_eq!(app.sessions.len(), 3);
    assert_eq!(app.selected_session_index, 1); // Should select current session
}

#[test]
fn test_session_navigation() {
    let mut app = App::new();

    app.load_sessions(vec![
        SessionSummary {
            id: "sess_001".to_string(),
            title: None,
            message_count: 0,
        },
        SessionSummary {
            id: "sess_002".to_string(),
            title: None,
            message_count: 0,
        },
        SessionSummary {
            id: "sess_003".to_string(),
            title: None,
            message_count: 0,
        },
    ]);

    app.selected_session_index = 0;

    app.next_session();
    assert_eq!(app.selected_session_index, 1);

    app.next_session();
    assert_eq!(app.selected_session_index, 2);

    // Can't go past last
    app.next_session();
    assert_eq!(app.selected_session_index, 2);

    app.prev_session();
    assert_eq!(app.selected_session_index, 1);

    app.prev_session();
    assert_eq!(app.selected_session_index, 0);

    // Can't go below 0
    app.prev_session();
    assert_eq!(app.selected_session_index, 0);
}

#[test]
fn test_session_selection() {
    let mut app = App::new();
    app.show_session_list = true;

    app.load_sessions(vec![
        SessionSummary {
            id: "sess_001".to_string(),
            title: None,
            message_count: 0,
        },
        SessionSummary {
            id: "sess_002".to_string(),
            title: None,
            message_count: 0,
        },
    ]);

    app.selected_session_index = 1;

    let session_id = app.select_session();
    assert_eq!(session_id, Some("sess_002".to_string()));
    assert!(!app.show_session_list); // Should close the list
}

#[test]
fn test_load_sessions_clamps_stale_selection() {
    let mut app = App::new();
    app.show_session_list = true;
    app.selected_session_index = 4;

    app.load_sessions(vec![SessionSummary {
        id: "sess_only".to_string(),
        title: None,
        message_count: 0,
    }]);

    assert_eq!(app.selected_session_index, 0);
    assert_eq!(app.select_session(), Some("sess_only".to_string()));
}

#[test]
fn test_load_sessions_resets_empty_selection() {
    let mut app = App::new();
    app.selected_session_index = 3;

    app.load_sessions(Vec::new());

    assert_eq!(app.selected_session_index, 0);
    assert!(app.select_session().is_none());
}

#[test]
fn test_toggle_session_list() {
    let mut app = App::new();

    assert!(!app.show_session_list);

    app.toggle_session_list();
    assert!(app.show_session_list);

    app.toggle_session_list();
    assert!(!app.show_session_list);
}

#[test]
fn test_abort_session() {
    let mut app = App::new();
    app.session_id = Some("sess_123".to_string());
    app.session_status = SessionStatus::Running;

    let session_id = app.request_abort();

    assert_eq!(session_id, Some("sess_123".to_string()));
    // Status stays Running until the server confirms via an event; the TUI no
    // longer optimistically flips to Aborted (which desynced on abort failure).
    assert_eq!(app.session_status, SessionStatus::Running);
}

#[test]
fn test_abort_when_not_running() {
    let mut app = App::new();
    app.session_id = Some("sess_123".to_string());
    app.session_status = SessionStatus::Idle;

    let session_id = app.request_abort();

    assert_eq!(session_id, None);
    assert_eq!(app.session_status, SessionStatus::Idle);
}

#[test]
fn test_input_abort_ctrl_x() {
    let mut app = App::new();
    app.session_id = Some("sess_123".to_string());
    app.session_status = SessionStatus::Running;

    let action = ax_code_tui::tui::handle_input(
        &mut app,
        make_key_event_with_mods(KeyCode::Char('x'), KeyModifiers::CONTROL),
    );

    match action {
        InputAction::AbortSession { session_id } => {
            assert_eq!(session_id, "sess_123");
        }
        _ => panic!("Expected AbortSession action"),
    }
}

#[test]
fn test_input_toggle_session_list_tab() {
    let mut app = App::new();

    let action = ax_code_tui::tui::handle_input(&mut app, make_key_event(KeyCode::Tab));

    assert!(app.show_session_list);
    assert!(matches!(action, InputAction::None));
}

#[test]
fn test_input_session_navigation() {
    let mut app = App::new();
    app.show_session_list = true;
    app.load_sessions(vec![
        SessionSummary {
            id: "sess_001".to_string(),
            title: None,
            message_count: 0,
        },
        SessionSummary {
            id: "sess_002".to_string(),
            title: None,
            message_count: 0,
        },
    ]);
    app.selected_session_index = 0;

    // Navigate down
    ax_code_tui::tui::handle_input(&mut app, make_key_event(KeyCode::Down));
    assert_eq!(app.selected_session_index, 1);

    // Select with Enter
    let action = ax_code_tui::tui::handle_input(&mut app, make_key_event(KeyCode::Enter));

    match action {
        InputAction::SwitchSession { session_id } => {
            assert_eq!(session_id, "sess_002");
        }
        _ => panic!("Expected SwitchSession action"),
    }

    assert!(!app.show_session_list);
}

#[test]
fn test_select_session_updates_active_session_and_clears_stale_state() {
    let mut app = App::new();
    app.session_id = Some("sess_001".to_string());
    app.show_session_list = true;
    app.load_sessions(vec![
        SessionSummary {
            id: "sess_001".to_string(),
            title: Some("Old".to_string()),
            message_count: 1,
        },
        SessionSummary {
            id: "sess_002".to_string(),
            title: Some("New".to_string()),
            message_count: 0,
        },
    ]);
    app.selected_session_index = 1;
    app.handle_event(RuntimeEvent::MessageUpdated {
        properties: MessageInfo {
            info: Some(MessageData {
                id: "msg_old".to_string(),
                session_id: "sess_001".to_string(),
                role: Some(MessageRole::Assistant),
            }),
        },
    });
    app.handle_event(RuntimeEvent::MessagePartDelta {
        properties: MessagePartDeltaProps {
            message_id: "msg_old".to_string(),
            part_id: "part_old".to_string(),
            field: "text".to_string(),
            delta: "old transcript".to_string(),
        },
    });
    app.handle_event(RuntimeEvent::ToolCallStart {
        properties: ToolCallStartProps {
            session_id: "sess_001".to_string(),
            call_id: "call_old".to_string(),
            tool_name: "bash".to_string(),
        },
    });

    let selected = app.select_session();

    assert_eq!(selected.as_deref(), Some("sess_002"));
    assert_eq!(app.session_id.as_deref(), Some("sess_002"));
    assert_eq!(app.session_title.as_deref(), Some("New"));
    assert!(app.messages.is_empty());
    assert!(app.message_text_parts.is_empty());
    assert!(app.tool_calls.is_empty());
    assert_eq!(app.session_status, SessionStatus::Idle);
}

#[test]
fn test_is_running() {
    let mut app = App::new();

    assert!(!app.is_running());

    app.session_status = SessionStatus::Running;
    assert!(app.is_running());

    app.session_status = SessionStatus::Aborted;
    assert!(!app.is_running());
}

#[test]
fn test_clear_completed_tools() {
    let mut app = App::new();

    // Add some tool calls
    app.handle_event(RuntimeEvent::ToolCallStart {
        properties: ToolCallStartProps {
            session_id: "sess_123".to_string(),
            call_id: "call_001".to_string(),
            tool_name: "bash".to_string(),
        },
    });

    app.handle_event(RuntimeEvent::ToolCallStart {
        properties: ToolCallStartProps {
            session_id: "sess_123".to_string(),
            call_id: "call_002".to_string(),
            tool_name: "edit".to_string(),
        },
    });

    // Complete first tool
    app.handle_event(RuntimeEvent::ToolCallComplete {
        properties: ToolCallCompleteProps {
            session_id: "sess_123".to_string(),
            call_id: "call_001".to_string(),
            tool_name: "bash".to_string(),
            result: None,
            error: None,
        },
    });

    assert_eq!(app.tool_calls.len(), 2);

    app.clear_completed_tools();

    assert_eq!(app.tool_calls.len(), 1);
    assert_eq!(app.tool_calls[0].call_id, "call_002");
}
