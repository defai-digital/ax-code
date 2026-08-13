//! UI projection state mutated only by pure dispatch.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionPhase {
    Booting,
    AwaitingAuth,
    Connecting,
    Ready,
    Streaming,
    Failed,
    Quit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionDecision {
    Allow,
    Deny,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PermissionPrompt {
    pub request_id: String,
    pub summary: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppState {
    pub phase: SessionPhase,
    pub directory: String,
    pub session_id: Option<String>,
    pub prompt: String,
    pub scrollback: Vec<String>,
    pub status: String,
    pub permission: Option<PermissionPrompt>,
    /// True while a turn is running (submit accepted, not yet idle).
    pub turn_active: bool,
    pub cols: u16,
    pub rows: u16,
    pub error: Option<String>,
    pub should_quit: bool,
}

impl AppState {
    pub fn new(directory: impl Into<String>) -> Self {
        Self {
            phase: SessionPhase::Booting,
            directory: directory.into(),
            session_id: None,
            prompt: String::new(),
            scrollback: Vec::new(),
            status: "starting".into(),
            permission: None,
            turn_active: false,
            cols: 80,
            rows: 24,
            error: None,
            should_quit: false,
        }
    }

    pub fn push_line(&mut self, line: impl Into<String>) {
        self.scrollback.push(line.into());
        const MAX: usize = 2_000;
        if self.scrollback.len() > MAX {
            let drop = self.scrollback.len() - MAX;
            self.scrollback.drain(0..drop);
        }
    }
}
