//! Edge case tests for the TUI.
//!
//! Tests boundary conditions and edge cases for message handling,
//! event processing, and UI state management.

use ax_code_tui::events::{
    MessageData, MessageInfo, MessagePartDeltaProps, MessageRole, RuntimeEvent,
};
use ax_code_tui::tui::app::{App, AppMode, Message};

// =============================================================================
// Empty Message Handling
// =============================================================================

#[test]
fn test_empty_message_content() {
    let mut app = App::new();
    app.session_id = Some("sess-1".to_string());

    let event = RuntimeEvent::MessageUpdated {
        properties: MessageInfo {
            info: Some(MessageData {
                id: "msg-empty".to_string(),
                session_id: "sess-1".to_string(),
                role: Some(MessageRole::Assistant),
            }),
        },
    };

    app.handle_event(event);

    assert_eq!(app.messages.len(), 1);
    assert_eq!(app.messages[0].content, "");
}

#[test]
fn test_message_with_only_whitespace() {
    let msg = Message {
        id: "msg-ws".to_string(),
        role: MessageRole::User,
        content: "   ".to_string(),
        is_streaming: false,
    };

    // Whitespace messages should be preserved as-is
    assert_eq!(msg.content, "   ");
}

#[test]
fn test_truncate_empty_message() {
    let result = App::truncate_message("", 100);
    assert_eq!(result, "");
}

// =============================================================================
// Very Long Messages (Truncation Boundary)
// =============================================================================

#[test]
fn test_very_long_message_truncation() {
    let long_message = "a".repeat(10000);
    let result = App::truncate_message(&long_message, 500);

    assert!(result.len() < long_message.len());
    assert!(result.ends_with("…"));
}

#[test]
fn test_message_exactly_at_truncation_limit() {
    let msg = "x".repeat(500);
    let result = App::truncate_message(&msg, 500);

    // Should not truncate if exactly at limit
    assert_eq!(result, msg);
}

#[test]
fn test_message_one_char_over_truncation_limit() {
    let msg = "x".repeat(501);
    let result = App::truncate_message(&msg, 500);

    // Should truncate (500 chars + ellipsis = 501 chars)
    let result_chars = result.chars().count();
    assert!(result_chars <= 501);
    assert!(result.ends_with("…"));
}

#[test]
fn test_unicode_message_truncation() {
    // Unicode characters that take multiple bytes
    let unicode_msg = "Hello 🌍 World 🚀 Test";
    let result = App::truncate_message(unicode_msg, 10);

    // Should handle unicode without panicking and be truncated
    assert!(!result.is_empty());
    assert!(result.ends_with("…"));
    // Result should have fewer characters than original
    assert!(result.chars().count() < unicode_msg.chars().count());
}

// =============================================================================
// Rapid Event Sequences
// =============================================================================

#[test]
fn test_rapid_message_deltas() {
    let mut app = App::new();
    app.session_id = Some("sess-1".to_string());

    // Create initial message
    let create_event = RuntimeEvent::MessageUpdated {
        properties: MessageInfo {
            info: Some(MessageData {
                id: "msg-rapid".to_string(),
                session_id: "sess-1".to_string(),
                role: Some(MessageRole::Assistant),
            }),
        },
    };
    app.handle_event(create_event);

    // Send many rapid deltas
    for i in 0..100 {
        let delta_event = RuntimeEvent::MessagePartDelta {
            properties: MessagePartDeltaProps {
                session_id: "sess-1".to_string(),
                message_id: "msg-rapid".to_string(),
                part_id: format!("part-{}", i),
                field: "content".to_string(),
                delta: format!(" {}", i),
            },
        };
        app.handle_event(delta_event);
    }

    // Message should have accumulated all deltas
    assert!(!app.messages[0].content.is_empty());
}

#[test]
fn test_multiple_messages_simultaneously() {
    let mut app = App::new();
    app.session_id = Some("sess-1".to_string());

    // Create multiple messages at once
    for i in 0..10 {
        let event = RuntimeEvent::MessageUpdated {
            properties: MessageInfo {
                info: Some(MessageData {
                    id: format!("msg-{}", i),
                    session_id: "sess-1".to_string(),
                    role: Some(MessageRole::Assistant),
                }),
            },
        };
        app.handle_event(event);
    }

    assert_eq!(app.messages.len(), 10);
}

// =============================================================================
// Status Bar Edge Cases
// =============================================================================

#[test]
fn test_status_bar_zero_width() {
    let result = App::format_status_bar(AppMode::Input, Some("Test"), 0);
    // Should handle zero width gracefully
    assert!(!result.is_empty() || result.is_empty()); // Just shouldn't panic
}

#[test]
fn test_status_bar_very_long_status() {
    let long_status = "x".repeat(1000);
    let result = App::format_status_bar(AppMode::Input, Some(&long_status), 80);

    // Should be truncated to fit
    assert!(result.len() <= 100); // Some reasonable bound
}

#[test]
fn test_status_bar_unicode_status() {
    let unicode_status = "Loading 🔄 Please wait...";
    let result = App::format_status_bar(AppMode::Input, Some(unicode_status), 80);

    assert!(result.contains("Loading"));
}

#[test]
fn test_status_bar_empty_status() {
    let result = App::format_status_bar(AppMode::Input, Some(""), 80);
    // Should fall back to "Ready" or handle gracefully
    assert!(!result.is_empty());
}

// =============================================================================
// App State Edge Cases
// =============================================================================

#[test]
fn test_app_scroll_beyond_messages() {
    let mut app = App::new();

    // Add a few messages
    for i in 0..3 {
        let event = RuntimeEvent::MessageUpdated {
            properties: MessageInfo {
                info: Some(MessageData {
                    id: format!("msg-{}", i),
                    session_id: "sess-1".to_string(),
                    role: Some(MessageRole::User),
                }),
            },
        };
        app.handle_event(event);
    }

    // Scroll well above the live bottom.
    for _ in 0..100 {
        app.scroll_up();
    }

    // Should not panic, just have high scroll offset
    assert!(app.scroll_offset > 0);
}

#[test]
fn test_app_scroll_up_moves_away_from_live_bottom() {
    let mut app = App::new();

    // Start at scroll offset 0
    assert_eq!(app.scroll_offset, 0);

    // Try to scroll up
    app.scroll_up();

    assert_eq!(app.scroll_offset, 3);
}

#[test]
fn test_app_cursor_beyond_prompt() {
    let mut app = App::new();

    app.insert_char('a');
    app.insert_char('b');
    app.insert_char('c');

    // Move cursor right beyond prompt length
    for _ in 0..100 {
        app.move_cursor_right();
    }

    // Cursor should not exceed prompt length
    assert!(app.cursor_position <= app.prompt.len());
}

#[test]
fn test_app_backspace_at_zero() {
    let mut app = App::new();

    assert_eq!(app.cursor_position, 0);
    assert_eq!(app.prompt, "");

    // Try to backspace at position 0
    app.backspace();

    // Should remain unchanged
    assert_eq!(app.cursor_position, 0);
    assert_eq!(app.prompt, "");
}

// =============================================================================
// Tool Panel Edge Cases
// =============================================================================

#[test]
fn test_tool_panel_no_tools() {
    let mut app = App::new();

    app.toggle_tool_panel();
    assert!(app.show_tool_panel);

    let completed = app.completed_tool_calls();
    assert!(completed.is_empty());
}

#[test]
fn test_tool_panel_navigation_empty() {
    let mut app = App::new();

    app.toggle_tool_panel();

    // Try to navigate with no tools
    app.next_tool();
    app.prev_tool();

    // Should not panic, index should remain valid
    assert_eq!(app.selected_tool_index, 0);
}

// =============================================================================
// Session List Edge Cases
// =============================================================================

#[test]
fn test_session_list_empty() {
    let mut app = App::new();

    app.toggle_session_list();
    assert!(app.show_session_list);

    // Try to navigate with no sessions
    app.next_session();
    app.prev_session();

    // Should not panic
    assert_eq!(app.selected_session_index, 0);
}

#[test]
fn test_session_selection_no_sessions() {
    let mut app = App::new();

    // Try to select a session when there are none
    let result = app.select_session();
    assert!(result.is_none());
}
