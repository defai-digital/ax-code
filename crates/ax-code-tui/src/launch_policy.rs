//! Renderer-neutral launch policy for session-first TUI (ADR-035).
//!
//! Decides the initial route from CLI args and available sessions.
//! Mirrors the TypeScript `launch-policy.ts` module.

use serde::{Deserialize, Serialize};

/// Input to the launch policy decision.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LaunchInput {
    /// Explicit session ID from --session flag.
    pub explicit_session_id: Option<String>,
    /// Explicit prompt from --prompt flag.
    pub explicit_prompt: Option<String>,
    /// Recent session IDs from the server (most recent first).
    pub recent_session_ids: Vec<String>,
    /// Whether the current directory has project context.
    pub has_project_context: bool,
}

/// The resolved launch route. Never returns a dashboard/home route (ADR-035).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum LaunchRoute {
    /// Attach to an existing session.
    Session { session_id: String },
    /// Create a new session (optionally with an initial prompt).
    NewSession { prompt: Option<String> },
}

/// Resolve the session-first launch route.
///
/// Priority:
/// 1. Explicit session ID (`--session`)
/// 2. Explicit prompt (`--prompt`)
/// 3. Most recent session (auto-resume)
/// 4. New session fallback
///
/// **Never** returns a dashboard/home route.
pub fn resolve_launch_route(input: &LaunchInput) -> LaunchRoute {
    // 1. Explicit session ID takes highest priority
    if let Some(ref session_id) = input.explicit_session_id {
        if !session_id.is_empty() {
            return LaunchRoute::Session {
                session_id: session_id.clone(),
            };
        }
    }

    // 2. Explicit prompt creates a new session
    if let Some(ref prompt) = input.explicit_prompt {
        if !prompt.is_empty() {
            return LaunchRoute::NewSession {
                prompt: Some(prompt.clone()),
            };
        }
    }

    // 3. Most recent session (auto-resume)
    if let Some(session_id) = input.recent_session_ids.first() {
        if !session_id.is_empty() {
            return LaunchRoute::Session {
                session_id: session_id.clone(),
            };
        }
    }

    // 4. New session fallback
    LaunchRoute::NewSession { prompt: None }
}

/// Check if the legacy home route rollback is requested.
///
/// When `AX_CODE_TUI_LEGACY_HOME=1`, the TUI should skip session-first
/// routing and fall back to the legacy home route for one release.
pub fn is_legacy_home_requested() -> bool {
    std::env::var("AX_CODE_TUI_LEGACY_HOME")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_explicit_session_id() {
        let input = LaunchInput {
            explicit_session_id: Some("sess-123".to_string()),
            explicit_prompt: Some("ignored".to_string()),
            recent_session_ids: vec!["sess-456".to_string()],
            has_project_context: true,
        };
        let route = resolve_launch_route(&input);
        assert_eq!(
            route,
            LaunchRoute::Session {
                session_id: "sess-123".to_string()
            }
        );
    }

    #[test]
    fn test_explicit_prompt() {
        let input = LaunchInput {
            explicit_session_id: None,
            explicit_prompt: Some("Hello world".to_string()),
            recent_session_ids: vec!["sess-456".to_string()],
            has_project_context: false,
        };
        let route = resolve_launch_route(&input);
        assert_eq!(
            route,
            LaunchRoute::NewSession {
                prompt: Some("Hello world".to_string())
            }
        );
    }

    #[test]
    fn test_recent_session_auto_resume() {
        let input = LaunchInput {
            explicit_session_id: None,
            explicit_prompt: None,
            recent_session_ids: vec!["sess-abc".to_string(), "sess-def".to_string()],
            has_project_context: true,
        };
        let route = resolve_launch_route(&input);
        assert_eq!(
            route,
            LaunchRoute::Session {
                session_id: "sess-abc".to_string()
            }
        );
    }

    #[test]
    fn test_new_session_fallback() {
        let input = LaunchInput::default();
        let route = resolve_launch_route(&input);
        assert_eq!(route, LaunchRoute::NewSession { prompt: None });
    }

    #[test]
    fn test_empty_session_id_ignored() {
        let input = LaunchInput {
            explicit_session_id: Some("".to_string()),
            explicit_prompt: None,
            recent_session_ids: vec![],
            has_project_context: false,
        };
        let route = resolve_launch_route(&input);
        assert_eq!(route, LaunchRoute::NewSession { prompt: None });
    }

    #[test]
    fn test_empty_prompt_ignored() {
        let input = LaunchInput {
            explicit_session_id: None,
            explicit_prompt: Some("".to_string()),
            recent_session_ids: vec![],
            has_project_context: false,
        };
        let route = resolve_launch_route(&input);
        assert_eq!(route, LaunchRoute::NewSession { prompt: None });
    }

    #[test]
    fn test_never_returns_dashboard_route() {
        // Verify that no input combination ever produces a dashboard/home route.
        // The LaunchRoute enum only has Session and NewSession variants (ADR-035).
        let inputs = vec![
            LaunchInput::default(),
            LaunchInput {
                explicit_session_id: Some("x".to_string()),
                ..Default::default()
            },
            LaunchInput {
                explicit_prompt: Some("y".to_string()),
                ..Default::default()
            },
            LaunchInput {
                recent_session_ids: vec!["z".to_string()],
                ..Default::default()
            },
            LaunchInput {
                has_project_context: true,
                ..Default::default()
            },
        ];

        for input in inputs {
            let route = resolve_launch_route(&input);
            match route {
                LaunchRoute::Session { .. } | LaunchRoute::NewSession { .. } => {
                    // Only valid routes; no dashboard/home
                }
            }
        }
    }

    #[test]
    fn test_launch_input_default() {
        let input = LaunchInput::default();
        assert!(input.explicit_session_id.is_none());
        assert!(input.explicit_prompt.is_none());
        assert!(input.recent_session_ids.is_empty());
        assert!(!input.has_project_context);
    }

    #[test]
    fn test_launch_route_serialization() {
        let route = LaunchRoute::Session {
            session_id: "test".to_string(),
        };
        let json = serde_json::to_string(&route).unwrap();
        let deserialized: LaunchRoute = serde_json::from_str(&json).unwrap();
        assert_eq!(route, deserialized);

        let route2 = LaunchRoute::NewSession {
            prompt: Some("hello".to_string()),
        };
        let json2 = serde_json::to_string(&route2).unwrap();
        let deserialized2: LaunchRoute = serde_json::from_str(&json2).unwrap();
        assert_eq!(route2, deserialized2);
    }
}
