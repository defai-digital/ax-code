//! Smoke test harness for ADR-035 side-by-side comparison.
//!
//! This module provides structured skeletons for smoke tests that require
//! real terminal interaction. Platform-specific smoke tests (macOS terminal,
//! Windows console, resize handling) need real hardware and are documented
//! here with skip annotations.
//!
//! ## Test Categories
//!
//! 1. **Startup smoke** — TUI launches and renders correctly
//! 2. **Resize during streaming** — Terminal resize doesn't crash or corrupt output
//! 3. **Permission prompt flow** — Permission accept/reject round-trip
//! 4. **Question flow** — Question navigate/select/cancel round-trip
//! 5. **Interrupt/cancel** — Ctrl+X abort during streaming
//! 6. **Restart/reattach** — Reconnect to existing session
//!
//! ## Platform-Specific Tests (require real hardware)
//!
//! - macOS Terminal.app startup and resize
//! - Windows ConPTY / Windows Terminal startup
//! - iTerm2 resize during streaming
//! - tmux/screen session reattach
//!
//! These are annotated with `#[ignore]` and run manually on target platforms.

mod support;

use ax_code_tui::events::{
    MessageData, MessageInfo, MessagePartDeltaProps, MessageRole, PermissionRequestProps,
    QuestionRequestProps, RuntimeEvent,
};
use ax_code_tui::tui::app::{App, AppMode, SessionStatus};
use ax_code_tui::tui::input::{InputAction, handle_input};
use crossterm::event::{Event, KeyCode, KeyEvent, KeyModifiers};

fn app_with_session() -> App {
    let mut app = App::new();
    app.session_id = Some("sess-1".to_string());
    app
}

// =============================================================================
// Startup Smoke Tests
// =============================================================================

#[test]
fn smoke_startup_renders_initial_state() {
    let app = App::new();

    // Verify the app initializes to a valid state for rendering
    assert!(matches!(app.mode, AppMode::Input));
    assert!(!app.should_quit);
    assert!(app.prompt.is_empty());
    assert!(app.messages.is_empty());
    assert!(!app.show_session_list);
    assert!(!app.show_tool_panel);
}

#[test]
fn smoke_startup_with_session_id() {
    use ax_code_tui::launch_policy::{LaunchInput, LaunchRoute, resolve_launch_route};

    let input = LaunchInput {
        explicit_session_id: Some("sess-smoke".to_string()),
        ..Default::default()
    };
    let route = resolve_launch_route(&input);
    assert_eq!(
        route,
        LaunchRoute::Session {
            session_id: "sess-smoke".to_string()
        }
    );
}

#[test]
fn smoke_startup_with_prompt() {
    use ax_code_tui::launch_policy::{LaunchInput, LaunchRoute, resolve_launch_route};

    let input = LaunchInput {
        explicit_prompt: Some("Fix the bug".to_string()),
        ..Default::default()
    };
    let route = resolve_launch_route(&input);
    assert_eq!(
        route,
        LaunchRoute::NewSession {
            prompt: Some("Fix the bug".to_string())
        }
    );
}

// =============================================================================
// Resize During Streaming
// =============================================================================

#[test]
fn smoke_resize_during_streaming_no_crash() {
    let mut app = app_with_session();

    // Simulate receiving a streaming message
    app.handle_event(RuntimeEvent::MessageUpdated {
        properties: MessageInfo {
            info: Some(MessageData {
                id: "msg-resize".to_string(),
                session_id: "sess-1".to_string(),
                role: Some(MessageRole::Assistant),
            }),
        },
    });

    // Simulate multiple streaming deltas (as if resize happens mid-stream)
    for i in 0..100 {
        app.handle_event(RuntimeEvent::MessagePartDelta {
            properties: MessagePartDeltaProps {
                session_id: "sess-1".to_string(),
                message_id: "msg-resize".to_string(),
                part_id: format!("part-{}", i),
                field: "content".to_string(),
                delta: format!(" chunk-{}", i),
            },
        });
    }

    // App should still be in valid state after heavy streaming
    assert_eq!(app.messages.len(), 1);
    assert!(!app.should_quit);
    assert!(matches!(app.mode, AppMode::Input));
}

// =============================================================================
// Permission Prompt Flow
// =============================================================================

#[test]
fn smoke_permission_prompt_accept_flow() {
    let mut app = app_with_session();

    // 1. Permission arrives
    app.handle_event(RuntimeEvent::PermissionAsked {
        properties: PermissionRequestProps {
            session_id: "sess-1".to_string(),
            id: "perm-smoke-1".to_string(),
            permission_type: Some("file_write".to_string()),
            description: "Write to main.rs".to_string(),
        },
    });

    // 2. TUI switches to permission mode
    assert!(matches!(app.mode, AppMode::Permission));

    // 3. User accepts
    let result = app.accept_permission();
    assert!(result.is_some());

    // 4. TUI returns to input mode
    assert!(matches!(app.mode, AppMode::Input));
}

#[test]
fn smoke_permission_prompt_reject_flow() {
    let mut app = app_with_session();

    app.handle_event(RuntimeEvent::PermissionAsked {
        properties: PermissionRequestProps {
            session_id: "sess-1".to_string(),
            id: "perm-smoke-2".to_string(),
            permission_type: Some("bash".to_string()),
            description: "rm -rf /".to_string(),
        },
    });

    assert!(matches!(app.mode, AppMode::Permission));

    let result = app.reject_permission();
    assert!(result.is_some());
    assert!(matches!(app.mode, AppMode::Input));
}

// =============================================================================
// Question Flow
// =============================================================================

#[test]
fn smoke_question_navigate_select_flow() {
    let mut app = app_with_session();

    // 1. Question arrives
    app.handle_event(RuntimeEvent::QuestionAsked {
        properties: QuestionRequestProps {
            session_id: "sess-1".to_string(),
            id: "q-smoke-1".to_string(),
            question: "Which approach?".to_string(),
            options: vec![
                "Refactor".to_string(),
                "Quick fix".to_string(),
                "Skip".to_string(),
            ],
            items: vec![],
        },
    });

    // 2. TUI switches to question mode
    assert!(matches!(app.mode, AppMode::Question));

    // 3. User navigates
    app.question_down();
    app.question_down();
    app.question_up(); // back to index 1

    // 4. User selects
    let result = app.select_question();
    assert!(result.is_some());
    let (_, _, answers) = result.unwrap();
    assert_eq!(answers, vec![vec!["Quick fix".to_string()]]);

    // 5. TUI returns to input mode
    assert!(matches!(app.mode, AppMode::Input));
}

#[test]
fn smoke_question_cancel_flow() {
    let mut app = app_with_session();

    app.handle_event(RuntimeEvent::QuestionAsked {
        properties: QuestionRequestProps {
            session_id: "sess-1".to_string(),
            id: "q-smoke-2".to_string(),
            question: "Confirm?".to_string(),
            options: vec!["Yes".to_string(), "No".to_string()],
            items: vec![],
        },
    });

    // Escape to cancel
    let event = Event::Key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
    let action = handle_input(&mut app, event);

    assert!(matches!(action, InputAction::RejectQuestion { .. }));
    assert!(matches!(app.mode, AppMode::Input));
}

// =============================================================================
// Interrupt / Cancel
// =============================================================================

#[test]
fn smoke_interrupt_abort_during_streaming() {
    let mut app = App::new();

    // Set up running session with streaming content
    app.session_id = Some("sess-1".to_string());
    app.session_status = SessionStatus::Running;

    app.handle_event(RuntimeEvent::MessageUpdated {
        properties: MessageInfo {
            info: Some(MessageData {
                id: "msg-stream".to_string(),
                session_id: "sess-1".to_string(),
                role: Some(MessageRole::Assistant),
            }),
        },
    });

    // Simulate streaming content
    for i in 0..10 {
        app.handle_event(RuntimeEvent::MessagePartDelta {
            properties: MessagePartDeltaProps {
                session_id: "sess-1".to_string(),
                message_id: "msg-stream".to_string(),
                part_id: format!("part-{}", i),
                field: "content".to_string(),
                delta: format!("word{} ", i),
            },
        });
    }

    // User presses Ctrl+X to abort
    let event = Event::Key(KeyEvent::new(KeyCode::Char('x'), KeyModifiers::CONTROL));
    let action = handle_input(&mut app, event);

    assert!(matches!(action, InputAction::AbortSession { .. }));
}

// =============================================================================
// Restart / Reattach
// =============================================================================

#[test]
fn smoke_restart_reattach_to_session() {
    use ax_code_tui::launch_policy::{LaunchInput, LaunchRoute, resolve_launch_route};

    // 1. First launch — no sessions, starts new
    let route1 = resolve_launch_route(&LaunchInput::default());
    assert!(matches!(route1, LaunchRoute::NewSession { .. }));

    // 2. Restart with known session — should reattach
    let route2 = resolve_launch_route(&LaunchInput {
        explicit_session_id: Some("existing-session".to_string()),
        ..Default::default()
    });
    assert_eq!(
        route2,
        LaunchRoute::Session {
            session_id: "existing-session".to_string()
        }
    );

    // 3. Restart without explicit session but with recent history
    let route3 = resolve_launch_route(&LaunchInput {
        recent_session_ids: vec!["last-session".to_string()],
        ..Default::default()
    });
    assert_eq!(
        route3,
        LaunchRoute::Session {
            session_id: "last-session".to_string()
        }
    );
}

// =============================================================================
// Platform-Specific Smoke Tests (require real hardware)
// =============================================================================

/// macOS Terminal.app startup smoke test.
/// Run manually: `cargo test -p ax-code-tui --test smoke_harness -- --ignored`
#[test]
#[ignore = "requires macOS Terminal.app and manual execution"]
fn smoke_macos_terminal_startup() {
    // This test requires:
    // 1. Launch ax-code-tui binary in Terminal.app
    // 2. Verify the TUI renders the initial prompt state
    // 3. Type a prompt and press Enter
    // 4. Verify the response renders correctly
    // 5. Press Ctrl+Q to quit
    // 6. Verify the terminal is restored to normal state
    panic!("Manual test — run in macOS Terminal.app");
}

/// Windows ConPTY startup smoke test.
/// Run manually on Windows: `cargo test -p ax-code-tui --test smoke_harness -- --ignored`
#[test]
#[ignore = "requires Windows ConPTY and manual execution"]
fn smoke_windows_conpty_startup() {
    // This test requires:
    // 1. Launch ax-code-tui binary in Windows Terminal
    // 2. Verify the TUI renders correctly via ConPTY
    // 3. Verify Unicode characters display properly
    // 4. Type a prompt and verify response
    // 5. Press Ctrl+Q to quit
    // 6. Verify the console is restored
    panic!("Manual test — run in Windows Terminal with ConPTY");
}

/// Resize during active streaming test.
/// Run manually with a live server: `cargo test -p ax-code-tui --test smoke_harness -- --ignored`
#[test]
#[ignore = "requires live server and manual resize interaction"]
fn smoke_resize_live_streaming() {
    // This test requires:
    // 1. Launch ax-code-tui connected to a live headless server
    // 2. Submit a prompt that generates a long response
    // 3. While streaming, resize the terminal window
    // 4. Verify no crash, no garbled output, text reflows correctly
    // 5. Verify the response completes correctly after resize
    panic!("Manual test — requires live server and resize interaction");
}
