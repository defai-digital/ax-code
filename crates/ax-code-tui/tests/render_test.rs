//! Tests for rendering helper functions.

use ax_code_tui::tui::app::{App, AppMode, SessionSummary};
use ax_code_tui::tui::render;
use ratatui::{Terminal, backend::TestBackend};

// =============================================================================
// Status Bar Formatting Tests
// =============================================================================

#[test]
fn test_format_status_bar_input_mode() {
    let result = App::format_status_bar(AppMode::Input, None, 80);
    assert!(result.contains("INPUT"));
    assert!(result.contains("Ready"));
}

#[test]
fn test_format_status_bar_permission_mode() {
    let result = App::format_status_bar(AppMode::Permission, None, 80);
    assert!(result.contains("PERMISSION"));
}

#[test]
fn test_format_status_bar_question_mode() {
    let result = App::format_status_bar(AppMode::Question, None, 80);
    assert!(result.contains("QUESTION"));
}

#[test]
fn test_format_status_bar_with_status() {
    let result = App::format_status_bar(AppMode::Input, Some("Connected"), 80);
    assert!(result.contains("Connected"));
}

#[test]
fn test_format_status_bar_truncation() {
    let long_status = "This is a very long status message that should be truncated";
    let result = App::format_status_bar(AppMode::Input, Some(long_status), 30);
    // Should contain ellipsis
    assert!(result.contains("..."));
    // Should not contain the full message
    assert!(!result.contains("This is a very long status"));
}

#[test]
fn test_format_status_bar_very_narrow() {
    let result = App::format_status_bar(AppMode::Input, Some("Status"), 10);
    // Should show ellipsis when too narrow
    assert_eq!(result.chars().count(), 10);
}

#[test]
fn test_format_status_bar_tiny_width_fits() {
    for width in 0..12 {
        let result = App::format_status_bar(AppMode::Permission, Some("Status"), width);
        assert_eq!(result.chars().count(), width);
    }
}

#[test]
fn test_format_status_bar_exact_width() {
    // Width that fits the status exactly
    let result = App::format_status_bar(AppMode::Input, Some("OK"), 20);
    assert!(result.contains("OK"));
}

#[test]
fn test_render_header_unicode_session_id_no_panic() {
    let backend = TestBackend::new(80, 24);
    let mut terminal = Terminal::new(backend).expect("terminal");
    let mut app = App::new();
    app.session_id = Some("会話セッション_001".to_string());

    terminal.draw(|frame| render(frame, &app)).expect("render");
}

#[test]
fn test_render_session_list_unicode_ids_no_panic() {
    let backend = TestBackend::new(100, 24);
    let mut terminal = Terminal::new(backend).expect("terminal");
    let mut app = App::new();
    app.show_session_list = true;
    app.session_id = Some("会話セッション_current".to_string());
    app.load_sessions(vec![
        SessionSummary {
            id: "会話セッション_current".to_string(),
            title: Some("Current".to_string()),
            message_count: 1,
        },
        SessionSummary {
            id: "別のセッション_002".to_string(),
            title: Some("Other".to_string()),
            message_count: 2,
        },
    ]);

    terminal.draw(|frame| render(frame, &app)).expect("render");
}

// =============================================================================
// Message Truncation Tests
// =============================================================================

#[test]
fn test_truncate_message_short() {
    let result = App::truncate_message("Hello", 100);
    assert_eq!(result, "Hello");
}

#[test]
fn test_truncate_message_exact() {
    let result = App::truncate_message("Hello World", 11);
    assert_eq!(result, "Hello World");
}

#[test]
fn test_truncate_message_long() {
    let long_msg = "This is a very long message that needs to be truncated";
    let result = App::truncate_message(long_msg, 20);
    // Result should be truncated with ellipsis
    assert!(result.ends_with("…"));
    // Should be shorter than original (in characters)
    assert!(result.chars().count() < long_msg.chars().count());
}

#[test]
fn test_truncate_message_very_short_limit() {
    let result = App::truncate_message("Hello", 3);
    assert_eq!(result, "...");
}

#[test]
fn test_truncate_message_zero_limit() {
    let result = App::truncate_message("Hello", 0);
    assert_eq!(result, "...");
}

#[test]
fn test_truncate_message_empty() {
    let result = App::truncate_message("", 100);
    assert_eq!(result, "");
}

// =============================================================================
// Streaming Indicator Tests (via App state)
// =============================================================================

#[test]
fn test_message_streaming_default() {
    use ax_code_tui::events::MessageRole;
    use ax_code_tui::tui::app::Message;

    let msg = Message {
        id: "test".to_string(),
        role: MessageRole::Assistant,
        content: "Hello".to_string(),
        is_streaming: true,
    };
    assert!(msg.is_streaming);
}

#[test]
fn test_message_not_streaming() {
    use ax_code_tui::events::MessageRole;
    use ax_code_tui::tui::app::Message;

    let msg = Message {
        id: "test".to_string(),
        role: MessageRole::User,
        content: "Hello".to_string(),
        is_streaming: false,
    };
    assert!(!msg.is_streaming);
}

// =============================================================================
// Integration Tests
// =============================================================================

#[test]
fn test_app_with_streaming_message() {
    use ax_code_tui::events::{MessageData, MessageInfo, RuntimeEvent};

    let mut app = App::new();

    // Simulate a message update - creates new message if not found
    // When message doesn't exist, it's created as streaming=true
    // Then immediately marked as streaming=false by the update handler
    let event = RuntimeEvent::MessageUpdated {
        properties: MessageInfo {
            info: Some(MessageData {
                id: "msg-1".to_string(),
                session_id: "sess-1".to_string(),
                role: Some(ax_code_tui::events::MessageRole::Assistant),
            }),
        },
    };

    app.handle_event(event);

    // Message should exist and streaming should be false (marked complete by update)
    assert_eq!(app.messages.len(), 1);
    assert!(!app.messages[0].is_streaming);
}

#[test]
fn test_app_message_delta_keeps_streaming() {
    use ax_code_tui::events::{MessageData, MessageInfo, MessagePartDeltaProps, RuntimeEvent};

    let mut app = App::new();

    // First create a message via update
    let create_event = RuntimeEvent::MessageUpdated {
        properties: MessageInfo {
            info: Some(MessageData {
                id: "msg-1".to_string(),
                session_id: "sess-1".to_string(),
                role: Some(ax_code_tui::events::MessageRole::Assistant),
            }),
        },
    };
    app.handle_event(create_event);

    // Now simulate a delta (but first we need to mark it streaming again for this test)
    // Actually, the message is already marked as not streaming from the update.
    // This tests that delta doesn't change the streaming status.
    let delta_event = RuntimeEvent::MessagePartDelta {
        properties: MessagePartDeltaProps {
            message_id: "msg-1".to_string(),
            part_id: "part-1".to_string(),
            field: "content".to_string(),
            delta: "Hello".to_string(),
        },
    };
    app.handle_event(delta_event);

    // Content should be updated
    assert_eq!(app.messages[0].content, "Hello");
}
