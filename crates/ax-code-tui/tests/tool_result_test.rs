//! Tests for tool result readability features.

use ax_code_tui::events::{RuntimeEvent, ToolCallCompleteProps, ToolCallStartProps};
use ax_code_tui::tui::{App, ToolCall, ToolCallStatus};
use crossterm::event::{Event, KeyCode, KeyEvent, KeyModifiers};

fn make_key_event(code: KeyCode) -> Event {
    Event::Key(KeyEvent::new(code, KeyModifiers::NONE))
}

#[test]
fn test_tool_panel_toggle() {
    let mut app = App::new();

    assert!(!app.show_tool_panel);

    app.toggle_tool_panel();
    assert!(app.show_tool_panel);

    app.toggle_tool_panel();
    assert!(!app.show_tool_panel);
}

#[test]
fn test_completed_tool_calls_empty() {
    let app = App::new();
    assert!(app.completed_tool_calls().is_empty());
}

#[test]
fn test_completed_tool_calls_filters() {
    let mut app = App::new();

    // Add running tool
    app.handle_event(RuntimeEvent::ToolCallStart {
        properties: ToolCallStartProps {
            session_id: "sess_123".to_string(),
            call_id: "call_001".to_string(),
            tool_name: "bash".to_string(),
        },
    });

    // Should have no completed tools yet
    assert!(app.completed_tool_calls().is_empty());

    // Complete the tool
    app.handle_event(RuntimeEvent::ToolCallComplete {
        properties: ToolCallCompleteProps {
            session_id: "sess_123".to_string(),
            call_id: "call_001".to_string(),
            tool_name: "bash".to_string(),
            result: Some("output".to_string()),
            error: None,
        },
    });

    // Now should have 1 completed tool
    assert_eq!(app.completed_tool_calls().len(), 1);
}

#[test]
fn test_tool_navigation() {
    let mut app = App::new();

    // Add multiple completed tools
    for i in 1..=3 {
        app.handle_event(RuntimeEvent::ToolCallStart {
            properties: ToolCallStartProps {
                session_id: "sess_123".to_string(),
                call_id: format!("call_00{}", i),
                tool_name: format!("tool_{}", i),
            },
        });
        app.handle_event(RuntimeEvent::ToolCallComplete {
            properties: ToolCallCompleteProps {
                session_id: "sess_123".to_string(),
                call_id: format!("call_00{}", i),
                tool_name: format!("tool_{}", i),
                result: Some(format!("result_{}", i)),
                error: None,
            },
        });
    }

    assert_eq!(app.selected_tool_index, 0);

    app.next_tool();
    assert_eq!(app.selected_tool_index, 1);

    app.next_tool();
    assert_eq!(app.selected_tool_index, 2);

    // Can't go past last
    app.next_tool();
    assert_eq!(app.selected_tool_index, 2);

    app.prev_tool();
    assert_eq!(app.selected_tool_index, 1);

    app.prev_tool();
    assert_eq!(app.selected_tool_index, 0);

    // Can't go below 0
    app.prev_tool();
    assert_eq!(app.selected_tool_index, 0);
}

#[test]
fn test_tool_expanded_toggle() {
    let mut app = App::new();

    assert!(!app.tool_result_expanded);

    app.toggle_tool_expanded();
    assert!(app.tool_result_expanded);

    app.toggle_tool_expanded();
    assert!(!app.tool_result_expanded);
}

#[test]
fn test_selected_completed_tool() {
    let mut app = App::new();

    // No tools initially
    assert!(app.selected_completed_tool().is_none());

    // Add a completed tool
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
            result: Some("output".to_string()),
            error: None,
        },
    });

    let tool = app.selected_completed_tool();
    assert!(tool.is_some());
    assert_eq!(tool.unwrap().tool_name, "bash");
}

#[test]
fn test_truncate_result_short() {
    let result = "short text";
    let truncated = App::truncate_result(result, 50);
    assert_eq!(truncated, "short text");
}

#[test]
fn test_truncate_result_long() {
    let result = "This is a very long result that should be truncated when displayed";
    let truncated = App::truncate_result(result, 20);
    assert!(truncated.len() <= 20);
    assert!(truncated.ends_with("..."));
}

#[test]
fn test_truncate_result_exact() {
    let result = "exact";
    let truncated = App::truncate_result(result, 5);
    assert_eq!(truncated, "exact");
}

#[test]
fn test_truncate_result_multibyte_utf8() {
    // Multi-byte UTF-8 characters should not cause a panic
    let result = "こんにちは世界"; // 7 chars, each 3 bytes
    let truncated = App::truncate_result(result, 5);
    // Should truncate to 2 chars + "..." = 5 chars total
    assert_eq!(truncated.chars().count(), 5);
    assert!(truncated.ends_with("..."));

    // Emoji test (4-byte characters)
    let emoji_result = "🎉🎊🎁🎈🎄";
    let truncated = App::truncate_result(emoji_result, 4);
    assert_eq!(truncated.chars().count(), 4);
    assert!(truncated.ends_with("..."));
}

#[test]
fn test_format_tool_preview_with_result() {
    let tool = ToolCall {
        call_id: "call_001".to_string(),
        tool_name: "bash".to_string(),
        status: ToolCallStatus::Completed,
        result: Some("command output".to_string()),
        error: None,
    };

    let preview = App::format_tool_preview(&tool, 50);
    assert_eq!(preview, "command output");
}

#[test]
fn test_format_tool_preview_with_error() {
    let tool = ToolCall {
        call_id: "call_001".to_string(),
        tool_name: "bash".to_string(),
        status: ToolCallStatus::Failed,
        result: None,
        error: Some("command not found".to_string()),
    };

    let preview = App::format_tool_preview(&tool, 50);
    assert_eq!(preview, "Error: command not found");
}

#[test]
fn test_format_tool_preview_no_output() {
    let tool = ToolCall {
        call_id: "call_001".to_string(),
        tool_name: "bash".to_string(),
        status: ToolCallStatus::Completed,
        result: None,
        error: None,
    };

    let preview = App::format_tool_preview(&tool, 50);
    assert_eq!(preview, "(no output)");
}

#[test]
fn test_format_tool_preview_truncated() {
    let tool = ToolCall {
        call_id: "call_001".to_string(),
        tool_name: "bash".to_string(),
        status: ToolCallStatus::Completed,
        result: Some("a".repeat(100)),
        error: None,
    };

    let preview = App::format_tool_preview(&tool, 20);
    assert!(preview.len() <= 20);
    assert!(preview.ends_with("..."));
}

#[test]
fn test_input_toggle_tool_panel() {
    let mut app = App::new();

    // 't' should toggle tool panel when prompt is empty
    ax_code_tui::tui::handle_input(&mut app, make_key_event(KeyCode::Char('t')));

    assert!(app.show_tool_panel);
}

#[test]
fn test_input_tool_panel_navigation() {
    let mut app = App::new();

    // Add some completed tools
    for i in 1..=3 {
        app.handle_event(RuntimeEvent::ToolCallStart {
            properties: ToolCallStartProps {
                session_id: "sess_123".to_string(),
                call_id: format!("call_00{}", i),
                tool_name: format!("tool_{}", i),
            },
        });
        app.handle_event(RuntimeEvent::ToolCallComplete {
            properties: ToolCallCompleteProps {
                session_id: "sess_123".to_string(),
                call_id: format!("call_00{}", i),
                tool_name: format!("tool_{}", i),
                result: Some(format!("result_{}", i)),
                error: None,
            },
        });
    }

    // Open tool panel
    app.show_tool_panel = true;

    // Navigate down
    ax_code_tui::tui::handle_input(&mut app, make_key_event(KeyCode::Down));
    assert_eq!(app.selected_tool_index, 1);

    // Navigate with 'j'
    ax_code_tui::tui::handle_input(&mut app, make_key_event(KeyCode::Char('j')));
    assert_eq!(app.selected_tool_index, 2);

    // Navigate up
    ax_code_tui::tui::handle_input(&mut app, make_key_event(KeyCode::Up));
    assert_eq!(app.selected_tool_index, 1);

    // Navigate with 'k'
    ax_code_tui::tui::handle_input(&mut app, make_key_event(KeyCode::Char('k')));
    assert_eq!(app.selected_tool_index, 0);
}

#[test]
fn test_input_tool_panel_expand() {
    let mut app = App::new();

    // Add a completed tool
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
            result: Some("output".to_string()),
            error: None,
        },
    });

    app.show_tool_panel = true;

    // Enter should toggle expanded view
    ax_code_tui::tui::handle_input(&mut app, make_key_event(KeyCode::Enter));
    assert!(app.tool_result_expanded);

    ax_code_tui::tui::handle_input(&mut app, make_key_event(KeyCode::Enter));
    assert!(!app.tool_result_expanded);
}

#[test]
fn test_input_tool_panel_close() {
    let mut app = App::new();
    app.show_tool_panel = true;

    // 't' should close tool panel
    ax_code_tui::tui::handle_input(&mut app, make_key_event(KeyCode::Char('t')));
    assert!(!app.show_tool_panel);

    // Reopen and close with Esc
    app.show_tool_panel = true;
    ax_code_tui::tui::handle_input(&mut app, make_key_event(KeyCode::Esc));
    assert!(!app.show_tool_panel);
}

#[test]
fn test_tool_panel_resets_expanded_on_toggle() {
    let mut app = App::new();

    app.toggle_tool_panel();
    app.tool_result_expanded = true;

    app.toggle_tool_panel();
    assert!(!app.tool_result_expanded);
}
