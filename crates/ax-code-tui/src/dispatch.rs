//! Pure Action → state mutation + Effects. No TTY, network, or filesystem.

use crate::action::Action;
use crate::effect::Effect;
use crate::state::{AppState, PermissionDecision, SessionPhase};

/// Apply one action. Returns effects for the event loop to execute.
pub fn dispatch(state: &mut AppState, action: Action) -> Vec<Effect> {
    match action {
        Action::Boot => {
            state.phase = SessionPhase::Connecting;
            state.status = "connecting".into();
            vec![Effect::EnsureSession {
                session_id: state.session_id.clone(),
            }]
        }
        Action::AuthMissing => {
            state.phase = SessionPhase::AwaitingAuth;
            state.error = Some("runtime authorization required".into());
            state.status = "auth missing".into();
            state.should_quit = true;
            vec![Effect::Shutdown]
        }
        Action::BackendUnreachable { message } => {
            state.phase = SessionPhase::Failed;
            state.error = Some(message);
            state.status = "backend unreachable".into();
            vec![]
        }
        Action::SessionReady { session_id } => {
            state.session_id = Some(session_id.clone());
            state.phase = SessionPhase::Ready;
            state.status = format!("session {session_id}");
            state.push_line(format!("session ready: {session_id}"));
            vec![Effect::SubscribeEvents]
        }
        Action::SessionFailed { message } => {
            state.phase = SessionPhase::Failed;
            state.error = Some(message.clone());
            state.status = "session failed".into();
            state.push_line(format!("session failed: {message}"));
            vec![]
        }
        Action::StreamDelta { text } => {
            if !text.is_empty() {
                state.phase = SessionPhase::Streaming;
                state.push_line(text);
            }
            vec![]
        }
        Action::PermissionAsked {
            request_id,
            summary,
        } => {
            state.permission = Some(crate::state::PermissionPrompt {
                request_id,
                summary: summary.clone(),
            });
            state.status = "permission required".into();
            state.push_line(format!("permission: {summary}"));
            vec![]
        }
        Action::PermissionReply { decision } => {
            let Some(prompt) = state.permission.take() else {
                return vec![];
            };
            state.status = match decision {
                PermissionDecision::Allow => "permission allow".into(),
                PermissionDecision::Deny => "permission deny".into(),
            };
            vec![Effect::ReplyPermission {
                request_id: prompt.request_id,
                decision,
            }]
        }
        Action::PermissionReplyAck => {
            state.status = "permission replied".into();
            vec![]
        }
        Action::PromptSet { text } => {
            state.prompt = text;
            vec![]
        }
        Action::PromptSubmit => {
            let text = state.prompt.trim().to_string();
            if text.is_empty() {
                return vec![];
            }
            if state.permission.is_some() {
                // Permission modal owns focus — do not submit.
                return vec![];
            }
            let Some(session_id) = state.session_id.clone() else {
                state.status = "no session".into();
                return vec![];
            };
            state.push_line(format!("> {text}"));
            state.prompt.clear();
            state.turn_active = true;
            state.status = "submitting".into();
            vec![Effect::SubmitPrompt { session_id, text }]
        }
        Action::PromptAccepted => {
            state.status = "turn running".into();
            state.phase = SessionPhase::Streaming;
            vec![]
        }
        Action::AbortTurn => {
            let Some(session_id) = state.session_id.clone() else {
                return vec![];
            };
            if !state.turn_active {
                return vec![];
            }
            state.status = "aborting".into();
            vec![Effect::AbortTurn { session_id }]
        }
        Action::AbortAck => {
            state.turn_active = false;
            state.status = "aborted".into();
            state.phase = SessionPhase::Ready;
            state.push_line("(aborted)");
            vec![]
        }
        Action::Resize { cols, rows } => {
            state.cols = cols;
            state.rows = rows;
            vec![]
        }
        Action::Quit => {
            state.phase = SessionPhase::Quit;
            state.should_quit = true;
            state.status = "quitting".into();
            vec![Effect::Shutdown]
        }
        Action::QuitComplete => {
            state.should_quit = true;
            vec![]
        }
        Action::Tick => vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;

    #[test]
    fn boot_ensures_session() {
        let mut state = AppState::new("/tmp/proj");
        let effects = dispatch(&mut state, Action::Boot);
        assert_eq!(state.phase, SessionPhase::Connecting);
        assert_eq!(
            effects,
            vec![Effect::EnsureSession { session_id: None }]
        );
    }

    #[test]
    fn auth_missing_fail_closed() {
        let mut state = AppState::new("/tmp/proj");
        let effects = dispatch(&mut state, Action::AuthMissing);
        assert!(state.should_quit);
        assert_eq!(state.phase, SessionPhase::AwaitingAuth);
        assert_eq!(effects, vec![Effect::Shutdown]);
        assert!(state.error.as_deref() == Some("runtime authorization required"));
    }

    #[test]
    fn prompt_submit_requires_session_and_clears_buffer() {
        let mut state = AppState::new("/tmp/proj");
        state.session_id = Some("ses_1".into());
        state.phase = SessionPhase::Ready;
        dispatch(
            &mut state,
            Action::PromptSet {
                text: "hello".into(),
            },
        );
        let effects = dispatch(&mut state, Action::PromptSubmit);
        assert_eq!(state.prompt, "");
        assert!(state.turn_active);
        assert_eq!(
            effects,
            vec![Effect::SubmitPrompt {
                session_id: "ses_1".into(),
                text: "hello".into(),
            }]
        );
    }

    #[test]
    fn permission_modal_blocks_prompt_submit() {
        let mut state = AppState::new("/tmp/proj");
        state.session_id = Some("ses_1".into());
        state.prompt = "x".into();
        dispatch(
            &mut state,
            Action::PermissionAsked {
                request_id: "req_1".into(),
                summary: "run bash".into(),
            },
        );
        let effects = dispatch(&mut state, Action::PromptSubmit);
        assert!(effects.is_empty());
        assert_eq!(state.prompt, "x");
    }

    #[test]
    fn permission_reply_emits_effect_once() {
        let mut state = AppState::new("/tmp/proj");
        dispatch(
            &mut state,
            Action::PermissionAsked {
                request_id: "req_9".into(),
                summary: "edit file".into(),
            },
        );
        let effects = dispatch(
            &mut state,
            Action::PermissionReply {
                decision: PermissionDecision::Allow,
            },
        );
        assert!(state.permission.is_none());
        assert_eq!(
            effects,
            vec![Effect::ReplyPermission {
                request_id: "req_9".into(),
                decision: PermissionDecision::Allow,
            }]
        );
        // Second reply is a no-op (latch).
        let effects2 = dispatch(
            &mut state,
            Action::PermissionReply {
                decision: PermissionDecision::Deny,
            },
        );
        assert!(effects2.is_empty());
    }

    #[test]
    fn abort_only_when_turn_active() {
        let mut state = AppState::new("/tmp/proj");
        state.session_id = Some("ses_1".into());
        assert!(dispatch(&mut state, Action::AbortTurn).is_empty());
        state.turn_active = true;
        assert_eq!(
            dispatch(&mut state, Action::AbortTurn),
            vec![Effect::AbortTurn {
                session_id: "ses_1".into()
            }]
        );
    }

    #[test]
    fn stream_delta_appends_scrollback() {
        let mut state = AppState::new("/tmp/proj");
        dispatch(
            &mut state,
            Action::StreamDelta {
                text: "hi".into(),
            },
        );
        assert_eq!(state.scrollback, vec!["hi".to_string()]);
        assert_eq!(state.phase, SessionPhase::Streaming);
    }

    #[test]
    fn quit_requests_shutdown() {
        let mut state = AppState::new("/tmp/proj");
        let effects = dispatch(&mut state, Action::Quit);
        assert!(state.should_quit);
        assert_eq!(effects, vec![Effect::Shutdown]);
    }
}
