//! Functional parity and independence tests for the Ratatui TUI.

mod support;

use ax_code_tui::client::{ClientConfig, HeadlessClient};
use ax_code_tui::events::{
    MessageData, MessageInfo, MessagePartDeltaProps, MessageRole, PermissionRequestProps,
    QuestionRequestProps, RuntimeEvent, SessionData, SessionInfo,
};
use ax_code_tui::tui::app::{
    App, AppMode, SessionStatus, SessionSummary, ToolCall, ToolCallStatus,
};
use ax_code_tui::tui::input::{InputAction, handle_input};
use crossterm::event::{Event, KeyCode, KeyEvent, KeyModifiers};
use support::mock_server::MockServer;

// =============================================================================
// No Dashboard Endpoint Dependency Tests
// =============================================================================

#[tokio::test]
async fn test_no_dashboard_endpoint_on_startup() {
    let server = MockServer::start().await;
    let config = ClientConfig {
        base_url: server.url(),
        auth_token: None,
        directory: None,
        session: None,
        prompt: None,
    };
    let client = HeadlessClient::new(config).expect("Failed to create client");
    let result = client.connect().await;
    assert!(
        result.is_ok(),
        "Startup should succeed without dashboard endpoints"
    );
    server.shutdown().await;
}

#[test]
fn test_tui_works_without_workflow_endpoint() {
    let app = App::new();
    assert_eq!(app.mode, AppMode::Input);
    assert!(!app.should_quit);
    assert!(app.messages.is_empty());
    assert!(app.sessions.is_empty());
}

#[test]
fn test_tui_works_without_desktop_endpoint() {
    let mut app = App::new();
    let event = RuntimeEvent::SessionCreated {
        properties: SessionInfo {
            info: Some(SessionData {
                id: "session-1".to_string(),
                title: Some("Test Session".to_string()),
            }),
        },
    };
    app.handle_event(event);
    assert_eq!(app.session_id, Some("session-1".to_string()));
}

// =============================================================================
// Core Functionality Parity Tests
// =============================================================================

#[test]
fn test_session_creation() {
    let mut app = App::new();
    let event = RuntimeEvent::SessionCreated {
        properties: SessionInfo {
            info: Some(SessionData {
                id: "new-session".to_string(),
                title: Some("New Session".to_string()),
            }),
        },
    };
    app.handle_event(event);
    assert_eq!(app.session_id, Some("new-session".to_string()));
    assert_eq!(app.session_title, Some("New Session".to_string()));
}

#[test]
fn test_message_display() {
    let mut app = App::new();
    let event = RuntimeEvent::MessageUpdated {
        properties: MessageInfo {
            info: Some(MessageData {
                id: "msg-1".to_string(),
                session_id: "sess-1".to_string(),
                role: Some(MessageRole::User),
            }),
        },
    };
    app.handle_event(event);
    assert_eq!(app.messages.len(), 1);
    assert!(matches!(app.messages[0].role, MessageRole::User));
}

#[test]
fn test_message_streaming() {
    let mut app = App::new();
    let create_event = RuntimeEvent::MessageUpdated {
        properties: MessageInfo {
            info: Some(MessageData {
                id: "msg-stream".to_string(),
                session_id: "sess-1".to_string(),
                role: Some(MessageRole::Assistant),
            }),
        },
    };
    app.handle_event(create_event);
    let delta_event = RuntimeEvent::MessagePartDelta {
        properties: MessagePartDeltaProps {
            session_id: "s".to_string(),
            message_id: "msg-stream".to_string(),
            part_id: "part-1".to_string(),
            field: "content".to_string(),
            delta: "Hello, streaming!".to_string(),
        },
    };
    app.handle_event(delta_event);
    assert_eq!(app.messages[0].content, "Hello, streaming!");
}

#[test]
fn test_permission_prompt_accept() {
    let mut app = App::new();
    let event = RuntimeEvent::PermissionAsked {
        properties: PermissionRequestProps {
            session_id: "sess-1".to_string(),
            id: "perm-1".to_string(),
            permission_type: Some("file_write".to_string()),
            description: "Write to test.txt".to_string(),
        },
    };
    app.handle_event(event);
    assert_eq!(app.mode, AppMode::Permission);
    assert_eq!(app.pending_permissions.len(), 1);
    let result = app.accept_permission();
    assert!(result.is_some());
    assert_eq!(app.mode, AppMode::Input);
}

#[test]
fn test_permission_prompt_reject() {
    let mut app = App::new();
    let event = RuntimeEvent::PermissionAsked {
        properties: PermissionRequestProps {
            session_id: "sess-1".to_string(),
            id: "perm-1".to_string(),
            permission_type: Some("bash".to_string()),
            description: "Run command".to_string(),
        },
    };
    app.handle_event(event);
    assert_eq!(app.mode, AppMode::Permission);
    let result = app.reject_permission();
    assert!(result.is_some());
    assert_eq!(app.mode, AppMode::Input);
}

#[test]
fn test_question_prompt_navigate_and_select() {
    let mut app = App::new();
    let event = RuntimeEvent::QuestionAsked {
        properties: QuestionRequestProps {
            session_id: "sess-1".to_string(),
            id: "q-1".to_string(),
            question: "Choose an option".to_string(),
            options: vec![
                "Option A".to_string(),
                "Option B".to_string(),
                "Option C".to_string(),
            ],
            items: vec![],
        },
    };
    app.handle_event(event);
    assert_eq!(app.mode, AppMode::Question);
    app.question_down();
    assert_eq!(app.pending_questions.last().unwrap().selected, 1);
    app.question_up();
    assert_eq!(app.pending_questions.last().unwrap().selected, 0);
    let result = app.select_question();
    assert!(result.is_some());
    let (_, _, answers) = result.unwrap();
    assert_eq!(answers, vec![vec!["Option A".to_string()]]);
}

#[test]
fn test_tool_call_tracking() {
    let mut app = App::new();
    app.tool_calls.push(ToolCall {
        call_id: "call-1".to_string(),
        tool_name: "bash".to_string(),
        status: ToolCallStatus::Running,
        result: None,
        error: None,
    });
    assert_eq!(app.active_tool_calls().len(), 1);
    app.tool_calls[0].status = ToolCallStatus::Completed;
    app.tool_calls[0].result = Some("output".to_string());
    assert_eq!(app.active_tool_calls().len(), 0);
    assert_eq!(app.completed_tool_calls().len(), 1);
}

#[test]
fn test_session_switching() {
    let mut app = App::new();
    app.sessions.push(SessionSummary {
        id: "sess-1".to_string(),
        title: Some("Session 1".to_string()),
        message_count: 5,
    });
    app.sessions.push(SessionSummary {
        id: "sess-2".to_string(),
        title: Some("Session 2".to_string()),
        message_count: 10,
    });
    app.next_session();
    let selected = app.select_session();
    assert_eq!(selected, Some("sess-2".to_string()));
}

// =============================================================================
// Input Handling Parity Tests
// =============================================================================

fn key_event(code: KeyCode) -> KeyEvent {
    KeyEvent::new(code, KeyModifiers::NONE)
}

fn ctrl_key_event(code: KeyCode) -> KeyEvent {
    KeyEvent::new(code, KeyModifiers::CONTROL)
}

#[test]
fn test_input_ctrl_c_quit() {
    let mut app = App::new();
    let event = Event::Key(ctrl_key_event(KeyCode::Char('c')));
    let action = handle_input(&mut app, event);
    assert!(app.should_quit);
    assert!(matches!(action, InputAction::None));
}

#[test]
fn test_input_ctrl_q_quit() {
    let mut app = App::new();
    let event = Event::Key(ctrl_key_event(KeyCode::Char('q')));
    handle_input(&mut app, event);
    assert!(app.should_quit);
}

#[test]
fn test_input_ctrl_x_abort() {
    let mut app = App::new();
    app.session_id = Some("sess-1".to_string());
    app.session_status = SessionStatus::Running;
    let event = Event::Key(ctrl_key_event(KeyCode::Char('x')));
    let action = handle_input(&mut app, event);
    assert!(matches!(action, InputAction::AbortSession { .. }));
}

#[test]
fn test_input_tab_toggle_session_list() {
    let mut app = App::new();
    assert!(!app.show_session_list);
    let event = Event::Key(key_event(KeyCode::Tab));
    handle_input(&mut app, event);
    assert!(app.show_session_list);
    let event = Event::Key(key_event(KeyCode::Tab));
    handle_input(&mut app, event);
    assert!(!app.show_session_list);
}

#[test]
fn test_input_t_toggle_tool_panel() {
    let mut app = App::new();
    assert!(!app.show_tool_panel);
    let event = Event::Key(key_event(KeyCode::Char('t')));
    handle_input(&mut app, event);
    assert!(app.show_tool_panel);
}

#[test]
fn test_input_enter_submit_prompt() {
    let mut app = App::new();
    app.insert_char('H');
    app.insert_char('i');
    let event = Event::Key(key_event(KeyCode::Enter));
    let action = handle_input(&mut app, event);
    assert!(matches!(action, InputAction::SubmitPrompt(text) if text == "Hi"));
    assert!(app.prompt.is_empty());
}

#[test]
fn test_input_character_insertion() {
    let mut app = App::new();
    let event = Event::Key(key_event(KeyCode::Char('a')));
    handle_input(&mut app, event);
    let event = Event::Key(key_event(KeyCode::Char('b')));
    handle_input(&mut app, event);
    assert_eq!(app.prompt, "ab");
}

#[test]
fn test_input_backspace() {
    let mut app = App::new();
    app.insert_char('a');
    app.insert_char('b');
    let event = Event::Key(key_event(KeyCode::Backspace));
    handle_input(&mut app, event);
    assert_eq!(app.prompt, "a");
}

// =============================================================================
// State Management Tests
// =============================================================================

#[test]
fn test_mode_transition_input_to_permission() {
    let mut app = App::new();
    assert_eq!(app.mode, AppMode::Input);
    let event = RuntimeEvent::PermissionAsked {
        properties: PermissionRequestProps {
            session_id: "sess-1".to_string(),
            id: "perm-1".to_string(),
            permission_type: Some("test".to_string()),
            description: "Test".to_string(),
        },
    };
    app.handle_event(event);
    assert_eq!(app.mode, AppMode::Permission);
}

#[test]
fn test_mode_transition_permission_to_input() {
    let mut app = App::new();
    let event = RuntimeEvent::PermissionAsked {
        properties: PermissionRequestProps {
            session_id: "sess-1".to_string(),
            id: "perm-1".to_string(),
            permission_type: Some("test".to_string()),
            description: "Test".to_string(),
        },
    };
    app.handle_event(event);
    assert_eq!(app.mode, AppMode::Permission);
    app.accept_permission();
    assert_eq!(app.mode, AppMode::Input);
}

#[test]
fn test_mode_transition_input_to_question() {
    let mut app = App::new();
    assert_eq!(app.mode, AppMode::Input);
    let event = RuntimeEvent::QuestionAsked {
        properties: QuestionRequestProps {
            session_id: "sess-1".to_string(),
            id: "q-1".to_string(),
            question: "Test?".to_string(),
            options: vec!["Yes".to_string(), "No".to_string()],
            items: vec![],
        },
    };
    app.handle_event(event);
    assert_eq!(app.mode, AppMode::Question);
}

#[test]
fn test_message_accumulation() {
    let mut app = App::new();
    for i in 0..5 {
        let event = RuntimeEvent::MessageUpdated {
            properties: MessageInfo {
                info: Some(MessageData {
                    id: format!("msg-{}", i),
                    session_id: "sess-1".to_string(),
                    role: Some(if i % 2 == 0 {
                        MessageRole::User
                    } else {
                        MessageRole::Assistant
                    }),
                }),
            },
        };
        app.handle_event(event);
    }
    assert_eq!(app.messages.len(), 5);
}

#[test]
fn test_tool_call_lifecycle_start_complete() {
    let mut app = App::new();
    app.tool_calls.push(ToolCall {
        call_id: "call-1".to_string(),
        tool_name: "bash".to_string(),
        status: ToolCallStatus::Running,
        result: None,
        error: None,
    });
    assert_eq!(app.active_tool_calls().len(), 1);
    assert!(matches!(app.tool_calls[0].status, ToolCallStatus::Running));
    app.tool_calls[0].status = ToolCallStatus::Completed;
    app.tool_calls[0].result = Some("done".to_string());
    assert_eq!(app.active_tool_calls().len(), 0);
    assert_eq!(app.completed_tool_calls().len(), 1);
    assert!(matches!(
        app.tool_calls[0].status,
        ToolCallStatus::Completed
    ));
}

#[test]
fn test_tool_call_lifecycle_start_fail() {
    let mut app = App::new();
    app.tool_calls.push(ToolCall {
        call_id: "call-1".to_string(),
        tool_name: "bash".to_string(),
        status: ToolCallStatus::Running,
        result: None,
        error: None,
    });
    assert!(matches!(app.tool_calls[0].status, ToolCallStatus::Running));
    app.tool_calls[0].status = ToolCallStatus::Failed;
    app.tool_calls[0].error = Some("error occurred".to_string());
    assert_eq!(app.completed_tool_calls().len(), 1);
    assert!(matches!(app.tool_calls[0].status, ToolCallStatus::Failed));
    assert_eq!(app.tool_calls[0].error, Some("error occurred".to_string()));
}

#[test]
fn test_session_status_transitions() {
    let mut app = App::new();
    app.session_id = Some("sess-1".to_string());
    assert!(matches!(app.session_status, SessionStatus::Idle));
    app.session_status = SessionStatus::Running;
    assert!(matches!(app.session_status, SessionStatus::Running));
    // request_abort stays Running until the server confirms via an event.
    let result = app.request_abort();
    assert!(result.is_some());
    assert!(matches!(app.session_status, SessionStatus::Running));
}
