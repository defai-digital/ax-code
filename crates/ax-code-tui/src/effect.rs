//! Async side effects produced by pure dispatch (executed by the event loop).

use crate::state::PermissionDecision;

/// Description of work the event loop must perform. Never executed inside dispatch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Effect {
    /// Create a new session (or attach when `session_id` is Some).
    EnsureSession { session_id: Option<String> },
    /// Subscribe to the event stream for the active session directory.
    SubscribeEvents,
    /// Submit the current prompt buffer.
    SubmitPrompt { session_id: String, text: String },
    /// Abort the running turn.
    AbortTurn { session_id: String },
    /// Reply to a permission request.
    ReplyPermission {
        request_id: String,
        decision: PermissionDecision,
    },
    /// Restore terminal and exit the process.
    Shutdown,
    /// No-op placeholder for tests.
    None,
}
