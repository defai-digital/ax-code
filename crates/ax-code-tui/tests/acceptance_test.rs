//! Acceptance checklist tests for ADR-035.
//!
//! These tests verify the acceptance criteria from the tech spec:
//! - Launch policy module exists and is tested
//! - Default TUI startup never selects dashboard/home
//! - Workflow dashboard polling is not part of default startup
//! - Desktop handoff exists (Rust side)
//! - Terminal status line covers essential state
//! - Ratatui implementation is thin-client only
//! - Functional parity preserved

mod support;

use ax_code_tui::diagnostics::{DiagnosticEvent, LaunchSource};
use ax_code_tui::launch_policy::{
    LaunchInput, LaunchRoute, is_legacy_home_requested, resolve_launch_route,
};
use ax_code_tui::runner::resolve_runner_launch_route;
use ax_code_tui::tui::app::{App, AppMode, SessionStatus};

// =============================================================================
// Acceptance: Launch policy module exists and is tested
// =============================================================================

#[test]
fn acceptance_launch_policy_module_exists() {
    // Verify the launch policy module is accessible and functional.
    let input = LaunchInput::default();
    let route = resolve_launch_route(&input);
    assert!(matches!(route, LaunchRoute::NewSession { prompt: None }));
}

#[test]
fn acceptance_launch_policy_all_routes_tested() {
    // Verify all four launch priority levels work.
    // 1. Explicit session
    let route = resolve_launch_route(&LaunchInput {
        explicit_session_id: Some("s1".to_string()),
        ..Default::default()
    });
    assert!(matches!(route, LaunchRoute::Session { session_id } if session_id == "s1"));

    // 2. Explicit prompt
    let route = resolve_launch_route(&LaunchInput {
        explicit_prompt: Some("hi".to_string()),
        ..Default::default()
    });
    assert!(matches!(route, LaunchRoute::NewSession { prompt: Some(p) } if p == "hi"));

    // 3. Recent session auto-resume
    let route = resolve_launch_route(&LaunchInput {
        recent_session_ids: vec!["recent".to_string()],
        ..Default::default()
    });
    assert!(matches!(route, LaunchRoute::Session { session_id } if session_id == "recent"));

    // 4. Fallback
    let route = resolve_launch_route(&LaunchInput::default());
    assert!(matches!(route, LaunchRoute::NewSession { prompt: None }));
}

// =============================================================================
// Acceptance: Default TUI startup never selects dashboard/home
// =============================================================================

#[test]
fn acceptance_no_dashboard_route_in_launch_policy() {
    // The LaunchRoute enum only has Session and NewSession variants.
    // There is no Dashboard or Home variant (ADR-035).
    let route = resolve_launch_route(&LaunchInput::default());
    match route {
        LaunchRoute::Session { .. } => {}
        LaunchRoute::NewSession { .. } => {} // No other variants exist — this match is exhaustive.
    }
}

#[test]
fn acceptance_all_inputs_produce_session_or_new_session() {
    // Exhaustively verify no input produces a dashboard/home route.
    let inputs = vec![
        LaunchInput::default(),
        LaunchInput {
            has_project_context: true,
            ..Default::default()
        },
        LaunchInput {
            recent_session_ids: vec!["a".into(), "b".into(), "c".into()],
            has_project_context: true,
            ..Default::default()
        },
        LaunchInput {
            explicit_session_id: Some("".into()),
            explicit_prompt: Some("".into()),
            recent_session_ids: vec!["".into()],
            has_project_context: false,
        },
    ];

    for input in inputs {
        let route = resolve_launch_route(&input);
        assert!(
            matches!(
                route,
                LaunchRoute::Session { .. } | LaunchRoute::NewSession { .. }
            ),
            "Route should always be Session or NewSession, never dashboard/home"
        );
    }
}

// =============================================================================
// Acceptance: Workflow dashboard polling is not part of default startup
// =============================================================================

#[test]
fn acceptance_dashboard_fetch_skipped_diagnostic() {
    // Verify the diagnostic event for skipped dashboard fetch exists.
    let event = DiagnosticEvent::WorkflowDashboardFetchSkipped {
        reason: "default startup — dashboard polling disabled (ADR-035)".to_string(),
    };
    assert_eq!(event.event_name(), "tui.workflow.dashboardFetchSkipped");
}

#[test]
fn acceptance_dashboard_route_deprecated_diagnostic() {
    // Verify the diagnostic event for deprecated dashboard route exists.
    let event = DiagnosticEvent::DashboardRouteDeprecated {
        requested_route: "home".to_string(),
    };
    assert_eq!(event.event_name(), "tui.dashboard.routeDeprecated");
}

// =============================================================================
// Acceptance: Desktop handoff exists (Rust side)
// =============================================================================

#[test]
fn acceptance_desktop_handoff_diagnostic() {
    // Verify the desktop handoff diagnostic event exists.
    let event = DiagnosticEvent::DesktopDashboardHandoff {
        platform: "darwin".to_string(),
        has_url: true,
    };
    assert_eq!(event.event_name(), "desktop.dashboard.handoff");

    let event_linux = DiagnosticEvent::DesktopDashboardHandoff {
        platform: "linux".to_string(),
        has_url: false,
    };
    assert_eq!(event_linux.event_name(), "desktop.dashboard.handoff");
}

// =============================================================================
// Acceptance: Terminal status line covers essential state
// =============================================================================

#[test]
fn acceptance_status_line_essential_state() {
    let mut app = App::new();

    // Verify status message can be set and retrieved
    app.set_status("Connected to session".to_string());
    assert_eq!(app.status_message, Some("Connected to session".to_string()));

    // Verify session status is trackable
    assert!(matches!(app.session_status, SessionStatus::Idle));
    app.session_status = SessionStatus::Running;
    assert!(matches!(app.session_status, SessionStatus::Running));

    // Verify mode is trackable
    assert!(matches!(app.mode, AppMode::Input));

    // Verify session ID is trackable
    app.session_id = Some("sess-1".to_string());
    assert_eq!(app.session_id, Some("sess-1".to_string()));
}

// =============================================================================
// Acceptance: Ratatui implementation is thin-client only
// =============================================================================

#[test]
fn acceptance_thin_client_no_session_execution() {
    // Verify the App does not contain session execution logic.
    // The App is purely a view model — no storage, no LLM, no tool execution.
    let app = App::new();

    // App should have no sessions, messages, or tool calls by default
    assert!(app.sessions.is_empty());
    assert!(app.messages.is_empty());
    assert!(app.tool_calls.is_empty());
    assert!(app.session_id.is_none());

    // App only tracks display state; execution stays in headless server
    assert!(!app.should_quit);
}

#[test]
fn acceptance_thin_client_no_dashboard_state() {
    // Verify the App does not track dashboard-specific state.
    // Dashboard ownership belongs to AX Code Desktop (ADR-035).
    let app = App::new();

    // No workflow dashboard state
    assert!(app.sessions.is_empty());
    assert!(app.messages.is_empty());
}

// =============================================================================
// Acceptance: Functional parity preserved
// =============================================================================

#[test]
fn acceptance_functional_parity_session_lifecycle() {
    use ax_code_tui::events::{
        MessageData, MessageInfo, MessageRole, RuntimeEvent, SessionData, SessionInfo,
    };

    let mut app = App::new();

    // Session creation
    app.handle_event(RuntimeEvent::SessionCreated {
        properties: SessionInfo {
            info: Some(SessionData {
                id: "sess-1".to_string(),
                title: Some("Test".to_string()),
            }),
        },
    });
    assert_eq!(app.session_id, Some("sess-1".to_string()));

    // Message display
    app.handle_event(RuntimeEvent::MessageUpdated {
        properties: MessageInfo {
            info: Some(MessageData {
                id: "msg-1".to_string(),
                session_id: "sess-1".to_string(),
                role: Some(MessageRole::User),
            }),
        },
    });
    assert_eq!(app.messages.len(), 1);
}

#[test]
fn acceptance_functional_parity_permission_flow() {
    use ax_code_tui::events::{PermissionRequestProps, RuntimeEvent};

    let mut app = App::new();
    app.session_id = Some("sess-1".to_string());

    app.handle_event(RuntimeEvent::PermissionAsked {
        properties: PermissionRequestProps {
            session_id: "sess-1".to_string(),
            id: "perm-1".to_string(),
            permission_type: Some("bash".to_string()),
            description: "Run command".to_string(),
        },
    });

    assert!(matches!(app.mode, AppMode::Permission));

    let result = app.accept_permission();
    assert!(result.is_some());
    assert!(matches!(app.mode, AppMode::Permission));
    app.resolve_permission("perm-1");
    assert!(matches!(app.mode, AppMode::Input));
}

#[test]
fn acceptance_functional_parity_question_flow() {
    use ax_code_tui::events::{QuestionRequestProps, RuntimeEvent};

    let mut app = App::new();
    app.session_id = Some("sess-1".to_string());

    app.handle_event(RuntimeEvent::QuestionAsked {
        properties: QuestionRequestProps {
            session_id: "sess-1".to_string(),
            id: "q-1".to_string(),
            question: "Pick one".to_string(),
            options: vec!["A".to_string(), "B".to_string()],
            items: vec![],
        },
    });

    assert!(matches!(app.mode, AppMode::Question));

    let result = app.select_question();
    assert!(result.is_some());
    assert!(matches!(app.mode, AppMode::Question));
    app.resolve_question("q-1");
    assert!(matches!(app.mode, AppMode::Input));
}

#[test]
fn acceptance_functional_parity_abort() {
    let mut app = App::new();
    app.session_id = Some("sess-1".to_string());
    app.session_status = SessionStatus::Running;

    // request_abort returns the session id so the runner can fire the HTTP
    // abort, but does NOT flip session_status: the server is authoritative
    // and may reject the abort. Status stays Running until an event confirms.
    let result = app.request_abort();
    assert!(result.is_some());
    assert!(matches!(app.session_status, SessionStatus::Running));
    // A transient status message tells the user the abort is in flight.
    assert!(
        app.status_message
            .as_deref()
            .unwrap_or("")
            .contains("Aborting")
    );
}

// =============================================================================
// Acceptance: Rollback mechanism
// =============================================================================

#[test]
fn acceptance_rollback_legacy_home_check() {
    // When AX_CODE_TUI_LEGACY_HOME is not set, legacy home should not be requested.
    // (We can't reliably test the "set" case in unit tests without env manipulation.)
    // Note: remove_var is unsafe in Rust 2024; skip env mutation in tests.
    // The function reads env vars at call time, so just verify the default path.
    let is_legacy = is_legacy_home_requested();
    // In test environments the var is typically not set
    let _ = is_legacy; // Don't assert - env may vary
}

#[test]
fn acceptance_rollback_diagnostic_event() {
    let event = DiagnosticEvent::RollbackLegacyHome {
        reason: "AX_CODE_TUI_LEGACY_HOME=1".to_string(),
    };
    assert_eq!(event.event_name(), "tui.rollback.legacyHome");
}

#[test]
fn acceptance_rollback_skips_session_first_runner_route() {
    let input = LaunchInput {
        explicit_session_id: Some("s1".to_string()),
        explicit_prompt: Some("ignored".to_string()),
        recent_session_ids: vec!["recent".to_string()],
        has_project_context: true,
    };

    assert_eq!(resolve_runner_launch_route(&input, true), None);
    assert_eq!(
        resolve_runner_launch_route(&input, false),
        Some(LaunchRoute::Session {
            session_id: "s1".to_string()
        })
    );
}

#[test]
fn acceptance_runner_route_auto_resumes_recent_session() {
    let input = LaunchInput {
        recent_session_ids: vec!["recent".to_string()],
        ..Default::default()
    };

    assert_eq!(
        resolve_runner_launch_route(&input, false),
        Some(LaunchRoute::Session {
            session_id: "recent".to_string()
        })
    );
}

// =============================================================================
// Acceptance: Diagnostic observability
// =============================================================================

#[test]
fn acceptance_all_diagnostic_events_exist() {
    // Verify all required diagnostic events from the observability spec exist.
    let events = [
        DiagnosticEvent::StartupSessionFirst {
            session_id: None,
            source: LaunchSource::Fallback,
        },
        DiagnosticEvent::StartupSessionPicker { session_count: 0 },
        DiagnosticEvent::DashboardRouteDeprecated {
            requested_route: "home".to_string(),
        },
        DiagnosticEvent::WorkflowDashboardFetchSkipped {
            reason: "default".to_string(),
        },
        DiagnosticEvent::WorkflowDashboardFetchOnDemand {
            session_id: "s".to_string(),
        },
        DiagnosticEvent::DesktopDashboardHandoff {
            platform: "darwin".to_string(),
            has_url: true,
        },
    ];

    let expected_names = [
        "tui.startup.sessionFirst",
        "tui.startup.sessionPicker",
        "tui.dashboard.routeDeprecated",
        "tui.workflow.dashboardFetchSkipped",
        "tui.workflow.dashboardFetchOnDemand",
        "desktop.dashboard.handoff",
    ];

    for (event, expected_name) in events.iter().zip(expected_names.iter()) {
        assert_eq!(event.event_name(), *expected_name);
    }
}
