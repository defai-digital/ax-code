//! Synchronous user / runtime intents consumed by pure dispatch.

use crate::state::PermissionDecision;

/// Synchronous, side-effect-free intent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    /// Application bootstrap after auth validated.
    Boot,
    /// Runtime rejected missing credentials.
    AuthMissing,
    /// HTTP client reported connection failure.
    BackendUnreachable { message: String },
    /// Session create/attach succeeded.
    SessionReady { session_id: String },
    /// Session create/attach failed.
    SessionFailed { message: String },
    /// SSE or polled stream delivered assistant text.
    StreamDelta { text: String },
    /// A permission request arrived from the backend.
    PermissionAsked {
        request_id: String,
        summary: String,
    },
    /// User chose allow/deny on the active permission modal.
    PermissionReply { decision: PermissionDecision },
    /// Permission reply acknowledged by backend.
    PermissionReplyAck,
    /// User typed into the prompt (append/replace handled by caller).
    PromptSet { text: String },
    /// User pressed Enter to submit the prompt.
    PromptSubmit,
    /// Prompt accepted by backend (async run started).
    PromptAccepted,
    /// User aborted the in-flight turn.
    AbortTurn,
    /// Abort acknowledged.
    AbortAck,
    /// Terminal resized.
    Resize { cols: u16, rows: u16 },
    /// Request clean shutdown.
    Quit,
    /// Terminal teardown finished.
    QuitComplete,
    /// Tick for status line animation (optional).
    Tick,
}
