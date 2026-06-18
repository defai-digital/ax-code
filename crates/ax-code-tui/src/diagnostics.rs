//! Diagnostic / observability events for the Ratatui TUI (ADR-035).
//!
//! Provides structured diagnostic event types that distinguish between
//! launch policy decisions, server availability, renderer startup,
//! session projection, dashboard deprecation, and OpenTUI compatibility.
//!
//! These events are logged via the `tracing` crate for local diagnostics.

use serde::{Deserialize, Serialize};
use tracing::{debug, info, warn};

/// Diagnostic events emitted during TUI startup and operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event", content = "data")]
pub enum DiagnosticEvent {
    /// TUI launched with session-first route resolution.
    #[serde(rename = "tui.startup.sessionFirst")]
    StartupSessionFirst {
        session_id: Option<String>,
        source: LaunchSource,
    },

    /// TUI launched with session picker (multiple recent sessions).
    #[serde(rename = "tui.startup.sessionPicker")]
    StartupSessionPicker { session_count: usize },

    /// Dashboard/home route was requested but deprecated.
    #[serde(rename = "tui.dashboard.routeDeprecated")]
    DashboardRouteDeprecated { requested_route: String },

    /// Workflow dashboard fetch was skipped (not part of default startup).
    #[serde(rename = "tui.workflow.dashboardFetchSkipped")]
    WorkflowDashboardFetchSkipped { reason: String },

    /// Workflow dashboard fetch triggereded on demand.
    #[serde(rename = "tui.workflow.dashboardFetchOnDemand")]
    WorkflowDashboardFetchOnDemand { session_id: String },

    /// Desktop dashboard handoff was triggered.
    #[serde(rename = "desktop.dashboard.handoff")]
    DesktopDashboardHandoff { platform: String, has_url: bool },

    /// Legacy home route rollback was activated.
    #[serde(rename = "tui.rollback.legacyHome")]
    RollbackLegacyHome { reason: String },

    /// Server/headless availability status.
    #[serde(rename = "tui.server.availability")]
    ServerAvailability {
        available: bool,
        url: String,
        error: Option<String>,
    },

    /// Renderer startup status.
    #[serde(rename = "tui.renderer.startup")]
    RendererStartup {
        renderer: String,
        success: bool,
        error: Option<String>,
    },
}

/// Source of the launch route decision.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum LaunchSource {
    /// Explicit --session flag.
    ExplicitSession,
    /// Explicit --prompt flag.
    ExplicitPrompt,
    /// Auto-resume from recent sessions.
    RecentSession,
    /// Fallback to new session.
    Fallback,
    /// Legacy home route (rollback).
    LegacyHome,
}

impl DiagnosticEvent {
    /// Emit this diagnostic event to the tracing log.
    pub fn emit(&self) {
        match self {
            DiagnosticEvent::StartupSessionFirst { session_id, source } => {
                info!(
                    event = "tui.startup.sessionFirst",
                    session_id = session_id.as_deref(),
                    source = ?source,
                    "TUI launched with session-first route"
                );
            }
            DiagnosticEvent::StartupSessionPicker { session_count } => {
                info!(
                    event = "tui.startup.sessionPicker",
                    session_count, "TUI launched with session picker"
                );
            }
            DiagnosticEvent::DashboardRouteDeprecated { requested_route } => {
                warn!(
                    event = "tui.dashboard.routeDeprecated",
                    requested_route = requested_route.as_str(),
                    "Dashboard route deprecated (ADR-035)"
                );
            }
            DiagnosticEvent::WorkflowDashboardFetchSkipped { reason } => {
                debug!(
                    event = "tui.workflow.dashboardFetchSkipped",
                    reason = reason.as_str(),
                    "Workflow dashboard fetch skipped"
                );
            }
            DiagnosticEvent::WorkflowDashboardFetchOnDemand { session_id } => {
                info!(
                    event = "tui.workflow.dashboardFetchOnDemand",
                    session_id = session_id.as_str(),
                    "Workflow dashboard fetch on demand"
                );
            }
            DiagnosticEvent::DesktopDashboardHandoff { platform, has_url } => {
                info!(
                    event = "desktop.dashboard.handoff",
                    platform = platform.as_str(),
                    has_url,
                    "Desktop dashboard handoff"
                );
            }
            DiagnosticEvent::RollbackLegacyHome { reason } => {
                warn!(
                    event = "tui.rollback.legacyHome",
                    reason = reason.as_str(),
                    "Legacy home route rollback activated"
                );
            }
            DiagnosticEvent::ServerAvailability {
                available,
                url,
                error,
            } => {
                if *available {
                    info!(
                        event = "tui.server.availability",
                        url = url.as_str(),
                        "Server available"
                    );
                } else {
                    warn!(
                        event = "tui.server.availability",
                        url = url.as_str(),
                        error = error.as_deref(),
                        "Server unavailable"
                    );
                }
            }
            DiagnosticEvent::RendererStartup {
                renderer,
                success,
                error,
            } => {
                if *success {
                    info!(
                        event = "tui.renderer.startup",
                        renderer = renderer.as_str(),
                        "Renderer started successfully"
                    );
                } else {
                    warn!(
                        event = "tui.renderer.startup",
                        renderer = renderer.as_str(),
                        error = error.as_deref(),
                        "Renderer startup failed"
                    );
                }
            }
        }
    }

    /// Get the event name string.
    pub fn event_name(&self) -> &'static str {
        match self {
            DiagnosticEvent::StartupSessionFirst { .. } => "tui.startup.sessionFirst",
            DiagnosticEvent::StartupSessionPicker { .. } => "tui.startup.sessionPicker",
            DiagnosticEvent::DashboardRouteDeprecated { .. } => "tui.dashboard.routeDeprecated",
            DiagnosticEvent::WorkflowDashboardFetchSkipped { .. } => {
                "tui.workflow.dashboardFetchSkipped"
            }
            DiagnosticEvent::WorkflowDashboardFetchOnDemand { .. } => {
                "tui.workflow.dashboardFetchOnDemand"
            }
            DiagnosticEvent::DesktopDashboardHandoff { .. } => "desktop.dashboard.handoff",
            DiagnosticEvent::RollbackLegacyHome { .. } => "tui.rollback.legacyHome",
            DiagnosticEvent::ServerAvailability { .. } => "tui.server.availability",
            DiagnosticEvent::RendererStartup { .. } => "tui.renderer.startup",
        }
    }
}

/// Create a startup diagnostic from a launch route.
pub fn startup_diagnostic(session_id: Option<String>, source: LaunchSource) -> DiagnosticEvent {
    DiagnosticEvent::StartupSessionFirst { session_id, source }
}

/// Check if legacy home route is requested and emit rollback diagnostic.
pub fn check_legacy_rollback() -> bool {
    let requested = crate::launch_policy::is_legacy_home_requested();
    if requested {
        DiagnosticEvent::RollbackLegacyHome {
            reason: "AX_CODE_TUI_LEGACY_HOME=1".to_string(),
        }
        .emit();
    }
    requested
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_event_names() {
        assert_eq!(
            DiagnosticEvent::StartupSessionFirst {
                session_id: None,
                source: LaunchSource::Fallback,
            }
            .event_name(),
            "tui.startup.sessionFirst"
        );
        assert_eq!(
            DiagnosticEvent::StartupSessionPicker { session_count: 3 }.event_name(),
            "tui.startup.sessionPicker"
        );
        assert_eq!(
            DiagnosticEvent::DashboardRouteDeprecated {
                requested_route: "home".to_string(),
            }
            .event_name(),
            "tui.dashboard.routeDeprecated"
        );
        assert_eq!(
            DiagnosticEvent::WorkflowDashboardFetchSkipped {
                reason: "default startup".to_string(),
            }
            .event_name(),
            "tui.workflow.dashboardFetchSkipped"
        );
        assert_eq!(
            DiagnosticEvent::WorkflowDashboardFetchOnDemand {
                session_id: "s1".to_string(),
            }
            .event_name(),
            "tui.workflow.dashboardFetchOnDemand"
        );
        assert_eq!(
            DiagnosticEvent::DesktopDashboardHandoff {
                platform: "darwin".to_string(),
                has_url: true,
            }
            .event_name(),
            "desktop.dashboard.handoff"
        );
        assert_eq!(
            DiagnosticEvent::RollbackLegacyHome {
                reason: "test".to_string(),
            }
            .event_name(),
            "tui.rollback.legacyHome"
        );
        assert_eq!(
            DiagnosticEvent::ServerAvailability {
                available: true,
                url: "http://localhost:3000".to_string(),
                error: None,
            }
            .event_name(),
            "tui.server.availability"
        );
        assert_eq!(
            DiagnosticEvent::RendererStartup {
                renderer: "ratatui".to_string(),
                success: true,
                error: None,
            }
            .event_name(),
            "tui.renderer.startup"
        );
    }

    #[test]
    fn test_startup_diagnostic_helper() {
        let event = startup_diagnostic(Some("sess-1".to_string()), LaunchSource::ExplicitSession);
        assert_eq!(event.event_name(), "tui.startup.sessionFirst");
        if let DiagnosticEvent::StartupSessionFirst { session_id, source } = event {
            assert_eq!(session_id, Some("sess-1".to_string()));
            assert_eq!(source, LaunchSource::ExplicitSession);
        } else {
            panic!("Expected StartupSessionFirst");
        }
    }

    #[test]
    fn test_event_serialization() {
        let event = DiagnosticEvent::StartupSessionFirst {
            session_id: Some("sess-1".to_string()),
            source: LaunchSource::RecentSession,
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("tui.startup.sessionFirst"));
        assert!(json.contains("sess-1"));

        let deserialized: DiagnosticEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.event_name(), "tui.startup.sessionFirst");
    }

    #[test]
    fn test_all_events_serialize() {
        let events = vec![
            DiagnosticEvent::StartupSessionFirst {
                session_id: None,
                source: LaunchSource::Fallback,
            },
            DiagnosticEvent::StartupSessionPicker { session_count: 5 },
            DiagnosticEvent::DashboardRouteDeprecated {
                requested_route: "home".to_string(),
            },
            DiagnosticEvent::WorkflowDashboardFetchSkipped {
                reason: "default startup".to_string(),
            },
            DiagnosticEvent::WorkflowDashboardFetchOnDemand {
                session_id: "s1".to_string(),
            },
            DiagnosticEvent::DesktopDashboardHandoff {
                platform: "darwin".to_string(),
                has_url: true,
            },
            DiagnosticEvent::RollbackLegacyHome {
                reason: "env var".to_string(),
            },
            DiagnosticEvent::ServerAvailability {
                available: false,
                url: "http://localhost:3000".to_string(),
                error: Some("connection refused".to_string()),
            },
            DiagnosticEvent::RendererStartup {
                renderer: "ratatui".to_string(),
                success: true,
                error: None,
            },
        ];

        for event in events {
            let json = serde_json::to_string(&event).unwrap();
            let back: DiagnosticEvent = serde_json::from_str(&json).unwrap();
            assert_eq!(event.event_name(), back.event_name());
        }
    }

    #[test]
    fn test_emit_does_not_panic() {
        // Verify that emit() doesn't panic for any event variant.
        let events = vec![
            DiagnosticEvent::StartupSessionFirst {
                session_id: Some("s".to_string()),
                source: LaunchSource::ExplicitSession,
            },
            DiagnosticEvent::StartupSessionPicker { session_count: 0 },
            DiagnosticEvent::DashboardRouteDeprecated {
                requested_route: "home".to_string(),
            },
            DiagnosticEvent::WorkflowDashboardFetchSkipped {
                reason: "test".to_string(),
            },
            DiagnosticEvent::WorkflowDashboardFetchOnDemand {
                session_id: "s".to_string(),
            },
            DiagnosticEvent::DesktopDashboardHandoff {
                platform: "linux".to_string(),
                has_url: false,
            },
            DiagnosticEvent::RollbackLegacyHome {
                reason: "test".to_string(),
            },
            DiagnosticEvent::ServerAvailability {
                available: true,
                url: "http://x".to_string(),
                error: None,
            },
            DiagnosticEvent::RendererStartup {
                renderer: "ratatui".to_string(),
                success: false,
                error: Some("fail".to_string()),
            },
        ];

        for event in events {
            event.emit(); // Should not panic
        }
    }
}
