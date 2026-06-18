//! Application state for the TUI.

use crate::events::{MessageRole, RuntimeEvent};

/// Session status.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionStatus {
    /// No active session.
    Idle,
    /// Session is running.
    Running,
    /// Session was aborted.
    Aborted,
}

impl Default for SessionStatus {
    fn default() -> Self {
        Self::Idle
    }
}

/// Main application state.
pub struct App {
    /// Whether the app should quit.
    pub should_quit: bool,
    /// Current session ID.
    pub session_id: Option<String>,
    /// Session title.
    pub session_title: Option<String>,
    /// Session status.
    pub session_status: SessionStatus,
    /// Session messages (transcript).
    pub messages: Vec<Message>,
    /// Current prompt input.
    pub prompt: String,
    /// Cursor position in prompt.
    pub cursor_position: usize,
    /// Pending permission requests.
    pub pending_permissions: Vec<PermissionRequest>,
    /// Pending questions.
    pub pending_questions: Vec<QuestionRequest>,
    /// Active tool calls.
    pub tool_calls: Vec<ToolCall>,
    /// Current mode (input, permission, question).
    pub mode: AppMode,
    /// Status message to display.
    pub status_message: Option<String>,
    /// Scroll offset for transcript.
    pub scroll_offset: usize,
    /// Available sessions.
    pub sessions: Vec<SessionSummary>,
    /// Selected session index (for session switcher).
    pub selected_session_index: usize,
    /// Whether session list is visible.
    pub show_session_list: bool,
    /// Whether tool results panel is visible.
    pub show_tool_panel: bool,
    /// Selected tool index in tool panel.
    pub selected_tool_index: usize,
    /// Whether the selected tool result is expanded (showing full content).
    pub tool_result_expanded: bool,
}

/// Application mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppMode {
    /// Normal input mode.
    Input,
    /// Permission response mode.
    Permission,
    /// Question response mode.
    Question,
}

impl Default for AppMode {
    fn default() -> Self {
        Self::Input
    }
}

/// A message in the session transcript.
#[derive(Debug, Clone)]
pub struct Message {
    pub id: String,
    pub role: MessageRole,
    pub content: String,
    /// Whether this message is currently being streamed (partial).
    pub is_streaming: bool,
}

/// A pending permission request.
#[derive(Debug, Clone)]
pub struct PermissionRequest {
    pub session_id: String,
    pub request_id: String,
    pub permission_type: String,
    pub description: String,
}

/// A pending question.
#[derive(Debug, Clone)]
pub struct QuestionRequest {
    pub session_id: String,
    pub request_id: String,
    pub question: String,
    pub options: Vec<String>,
    pub selected: usize,
}

/// A tool call in progress.
#[derive(Debug, Clone)]
pub struct ToolCall {
    pub call_id: String,
    pub tool_name: String,
    pub status: ToolCallStatus,
    pub result: Option<String>,
    pub error: Option<String>,
}

/// Tool call status.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolCallStatus {
    Running,
    Completed,
    Failed,
}

/// Summary of a session for the session list.
#[derive(Debug, Clone)]
pub struct SessionSummary {
    pub id: String,
    pub title: Option<String>,
    pub message_count: usize,
}

impl App {
    /// Create a new application instance.
    pub fn new() -> Self {
        Self {
            should_quit: false,
            session_id: None,
            session_title: None,
            session_status: SessionStatus::Idle,
            messages: Vec::new(),
            prompt: String::new(),
            cursor_position: 0,
            pending_permissions: Vec::new(),
            pending_questions: Vec::new(),
            tool_calls: Vec::new(),
            mode: AppMode::Input,
            status_message: None,
            scroll_offset: 0,
            sessions: Vec::new(),
            selected_session_index: 0,
            show_session_list: false,
            show_tool_panel: false,
            selected_tool_index: 0,
            tool_result_expanded: false,
        }
    }

    /// Get the current session ID if available.
    pub fn current_session_id(&self) -> Option<&str> {
        self.session_id.as_deref()
    }

    /// Set a status message to display.
    pub fn set_status(&mut self, message: String) {
        self.status_message = Some(message);
    }

    /// Handle an incoming runtime event.
    pub fn handle_event(&mut self, event: RuntimeEvent) {
        match event {
            RuntimeEvent::SessionCreated { properties } => {
                if let Some(info) = properties.info {
                    self.session_id = Some(info.id);
                    self.session_title = info.title;
                    self.status_message = Some("Session created".to_string());
                }
            }
            RuntimeEvent::SessionUpdated { properties } => {
                if let Some(info) = properties.info {
                    self.session_id = Some(info.id);
                    if info.title.is_some() {
                        self.session_title = info.title;
                    }
                }
            }
            RuntimeEvent::SessionDeleted { .. } => {
                self.status_message = Some("Session deleted".to_string());
            }
            RuntimeEvent::SessionStatus { properties } => {
                if let Some(status) = properties.status {
                    self.status_message = Some(format!("Status: {}", status));
                }
            }
            RuntimeEvent::SessionError { properties } => {
                if let Some(error) = properties.error {
                    self.status_message = Some(format!("Error: {}", error));
                }
            }
            RuntimeEvent::MessageUpdated { properties } => {
                if let Some(info) = properties.info {
                    // Check if message already exists, update or add
                    if let Some(msg) = self.messages.iter_mut().find(|m| m.id == info.id) {
                        if let Some(role) = info.role {
                            msg.role = role;
                        }
                        // Message update means streaming is complete
                        msg.is_streaming = false;
                    } else {
                        // New message from update event - already complete
                        self.messages.push(Message {
                            id: info.id,
                            role: info.role.unwrap_or(MessageRole::Assistant),
                            content: String::new(),
                            is_streaming: false,
                        });
                    }
                }
            }
            RuntimeEvent::MessagePartDelta { properties } => {
                // Find message by ID and append delta to content
                if let Some(msg) = self.messages.iter_mut().find(|m| m.id == properties.message_id) {
                    if properties.field == "content" {
                        msg.content.push_str(&properties.delta);
                    }
                }
            }
            RuntimeEvent::PermissionAsked { properties } => {
                self.pending_permissions.push(PermissionRequest {
                    session_id: properties.session_id,
                    request_id: properties.id,
                    permission_type: properties.permission_type.unwrap_or_default(),
                    description: properties.description,
                });
                self.mode = AppMode::Permission;
            }
            RuntimeEvent::PermissionReplied { .. } => {
                // Remove the permission from pending list
                // (The actual removal happens when we send the reply)
            }
            RuntimeEvent::QuestionAsked { properties } => {
                self.pending_questions.push(QuestionRequest {
                    session_id: properties.session_id,
                    request_id: properties.id,
                    question: properties.question,
                    options: properties.options,
                    selected: 0,
                });
                self.mode = AppMode::Question;
            }
            RuntimeEvent::QuestionReplied { .. } | RuntimeEvent::QuestionRejected { .. } => {
                // Remove the question from pending list
            }
            RuntimeEvent::TodoUpdated { .. } => {
                // TODO: Update todo display
            }
            RuntimeEvent::SessionDiff { .. } => {
                // TODO: Update diff display
            }
            RuntimeEvent::ToolCallStart { properties } => {
                self.tool_calls.push(ToolCall {
                    call_id: properties.call_id,
                    tool_name: properties.tool_name,
                    status: ToolCallStatus::Running,
                    result: None,
                    error: None,
                });
                self.session_status = SessionStatus::Running;
            }
            RuntimeEvent::ToolCallComplete { properties } => {
                if let Some(tool_call) = self.tool_calls.iter_mut().find(|t| t.call_id == properties.call_id) {
                    tool_call.status = if properties.error.is_some() {
                        ToolCallStatus::Failed
                    } else {
                        ToolCallStatus::Completed
                    };
                    tool_call.result = properties.result;
                    tool_call.error = properties.error;
                }
                // If no more running tools, session is idle
                if !self.tool_calls.iter().any(|t| t.status == ToolCallStatus::Running) {
                    self.session_status = SessionStatus::Idle;
                }
            }
            RuntimeEvent::ServerConnected => {
                self.status_message = Some("Connected to server".to_string());
            }
            RuntimeEvent::ServerHeartbeat => {
                // Heartbeat, no action needed
            }
            RuntimeEvent::ServerInstanceDisposed => {
                self.status_message = Some("Server instance disposed".to_string());
                self.should_quit = true;
            }
            RuntimeEvent::Unknown => {
                // Ignore unknown events
            }
        }
    }

    /// Request app shutdown.
    pub fn quit(&mut self) {
        self.should_quit = true;
    }

    /// Insert a character at the cursor position.
    pub fn insert_char(&mut self, c: char) {
        if self.mode == AppMode::Input {
            self.prompt.insert(self.cursor_position, c);
            self.cursor_position += 1;
        }
    }

    /// Delete the character before the cursor.
    pub fn backspace(&mut self) {
        if self.mode == AppMode::Input && self.cursor_position > 0 {
            self.cursor_position -= 1;
            self.prompt.remove(self.cursor_position);
        }
    }

    /// Move cursor left.
    pub fn move_cursor_left(&mut self) {
        if self.mode == AppMode::Input && self.cursor_position > 0 {
            self.cursor_position -= 1;
        }
    }

    /// Move cursor right.
    pub fn move_cursor_right(&mut self) {
        if self.mode == AppMode::Input && self.cursor_position < self.prompt.len() {
            self.cursor_position += 1;
        }
    }

    /// Clear the prompt.
    pub fn clear_prompt(&mut self) {
        self.prompt.clear();
        self.cursor_position = 0;
    }

    /// Get the current prompt and clear it.
    pub fn take_prompt(&mut self) -> String {
        let prompt = std::mem::take(&mut self.prompt);
        self.cursor_position = 0;
        prompt
    }

    /// Scroll transcript up.
    pub fn scroll_up(&mut self) {
        if self.scroll_offset > 0 {
            self.scroll_offset -= 1;
        }
    }

    /// Scroll transcript down.
    pub fn scroll_down(&mut self) {
        self.scroll_offset += 1;
    }

    /// Accept the current permission request.
    pub fn accept_permission(&mut self) -> Option<(String, String)> {
        if let Some(req) = self.pending_permissions.pop() {
            self.mode = AppMode::Input;
            return Some((req.session_id, req.request_id));
        }
        None
    }

    /// Reject the current permission request.
    pub fn reject_permission(&mut self) -> Option<(String, String)> {
        if let Some(req) = self.pending_permissions.pop() {
            self.mode = AppMode::Input;
            return Some((req.session_id, req.request_id));
        }
        None
    }

    /// Move question selection up.
    pub fn question_up(&mut self) {
        if let Some(q) = self.pending_questions.last_mut() {
            if q.selected > 0 {
                q.selected -= 1;
            }
        }
    }

    /// Move question selection down.
    pub fn question_down(&mut self) {
        if let Some(q) = self.pending_questions.last_mut() {
            if q.selected < q.options.len().saturating_sub(1) {
                q.selected += 1;
            }
        }
    }

    /// Select the current question option.
    pub fn select_question(&mut self) -> Option<(String, String, String)> {
        if let Some(req) = self.pending_questions.pop() {
            let answer = req.options.get(req.selected).cloned().unwrap_or_default();
            self.mode = AppMode::Input;
            return Some((req.session_id, req.request_id, answer));
        }
        None
    }

    /// Reject the current question.
    pub fn reject_question(&mut self) -> Option<(String, String)> {
        if let Some(req) = self.pending_questions.pop() {
            self.mode = AppMode::Input;
            return Some((req.session_id, req.request_id));
        }
        None
    }

    // === Session switching ===

    /// Load sessions into the session list.
    pub fn load_sessions(&mut self, sessions: Vec<SessionSummary>) {
        self.sessions = sessions;
        // Try to find and select current session
        if let Some(current_id) = &self.session_id {
            if let Some(idx) = self.sessions.iter().position(|s| &s.id == current_id) {
                self.selected_session_index = idx;
            }
        }
    }

    /// Toggle session list visibility.
    pub fn toggle_session_list(&mut self) {
        self.show_session_list = !self.show_session_list;
    }

    /// Move to next session in list.
    pub fn next_session(&mut self) {
        if !self.sessions.is_empty() && self.selected_session_index < self.sessions.len() - 1 {
            self.selected_session_index += 1;
        }
    }

    /// Move to previous session in list.
    pub fn prev_session(&mut self) {
        if self.selected_session_index > 0 {
            self.selected_session_index -= 1;
        }
    }

    /// Select the currently highlighted session.
    pub fn select_session(&mut self) -> Option<String> {
        self.sessions.get(self.selected_session_index).map(|s| {
            self.show_session_list = false;
            s.id.clone()
        })
    }

    // === Interrupt/Abort ===

    /// Request to abort the current session.
    pub fn request_abort(&mut self) -> Option<String> {
        if self.session_status == SessionStatus::Running {
            self.session_status = SessionStatus::Aborted;
            self.status_message = Some("Aborting session...".to_string());
            return self.session_id.clone();
        }
        None
    }

    /// Clear completed tool calls from the list.
    pub fn clear_completed_tools(&mut self) {
        self.tool_calls.retain(|t| t.status == ToolCallStatus::Running);
    }

    /// Get active (running) tool calls.
    pub fn active_tool_calls(&self) -> Vec<&ToolCall> {
        self.tool_calls.iter().filter(|t| t.status == ToolCallStatus::Running).collect()
    }

    /// Check if session is currently running.
    pub fn is_running(&self) -> bool {
        self.session_status == SessionStatus::Running
    }

    // === Tool Panel ===

    /// Toggle tool results panel visibility.
    pub fn toggle_tool_panel(&mut self) {
        self.show_tool_panel = !self.show_tool_panel;
        self.tool_result_expanded = false;
    }

    /// Get completed/failed tool calls (for display).
    pub fn completed_tool_calls(&self) -> Vec<&ToolCall> {
        self.tool_calls
            .iter()
            .filter(|t| t.status == ToolCallStatus::Completed || t.status == ToolCallStatus::Failed)
            .collect()
    }

    /// Move to next tool in tool panel.
    pub fn next_tool(&mut self) {
        let completed = self.completed_tool_calls();
        if !completed.is_empty() && self.selected_tool_index < completed.len() - 1 {
            self.selected_tool_index += 1;
            self.tool_result_expanded = false;
        }
    }

    /// Move to previous tool in tool panel.
    pub fn prev_tool(&mut self) {
        if self.selected_tool_index > 0 {
            self.selected_tool_index -= 1;
            self.tool_result_expanded = false;
        }
    }

    /// Toggle expanded view of selected tool result.
    pub fn toggle_tool_expanded(&mut self) {
        self.tool_result_expanded = !self.tool_result_expanded;
    }

    /// Get the currently selected completed tool.
    pub fn selected_completed_tool(&self) -> Option<&ToolCall> {
        self.completed_tool_calls().get(self.selected_tool_index).copied()
    }

    /// Truncate a string to a maximum length with ellipsis.
    ///
    /// Uses char-based indexing to avoid panicking on multi-byte UTF-8 characters.
    pub fn truncate_result(result: &str, max_len: usize) -> String {
        let char_count = result.chars().count();
        if char_count <= max_len {
            result.to_string()
        } else if max_len <= 3 {
            "...".to_string()
        } else {
            let truncated: String = result.chars().take(max_len.saturating_sub(3)).collect();
            format!("{}...", truncated)
        }
    }

    /// Format a tool result for display (single line preview).
    pub fn format_tool_preview(tool: &ToolCall, max_len: usize) -> String {
        let content = if let Some(ref error) = tool.error {
            format!("Error: {}", error)
        } else if let Some(ref result) = tool.result {
            result.clone()
        } else {
            "(no output)".to_string()
        };
        Self::truncate_result(&content, max_len)
    }

    /// Format the status bar content with width constraints.
    ///
    /// Returns a formatted string containing mode indicator, status message,
    /// and keybinding hints, truncated to fit within the given width.
    pub fn format_status_bar(mode: AppMode, status: Option<&str>, width: usize) -> String {
        let mode_indicator = match mode {
            AppMode::Input => "INPUT",
            AppMode::Permission => "PERMISSION (y/n)",
            AppMode::Question => "QUESTION",
        };

        let status_text = status.unwrap_or("Ready");

        // Calculate available space for status message
        let prefix = format!(" [{}] ", mode_indicator);
        let suffix = " "; // Space at end

        let overhead = prefix.len() + suffix.len();
        let max_status_len = width.saturating_sub(overhead);

        // Truncate status if needed
        let display_status = if status_text.len() > max_status_len && max_status_len > 3 {
            format!("{}...", &status_text[..max_status_len.saturating_sub(3)])
        } else if max_status_len <= 3 {
            "...".to_string()
        } else {
            status_text.to_string()
        };

        format!("{}{}{}", prefix, display_status, suffix)
    }

    /// Truncate a message content for display in the transcript.
    ///
    /// Messages longer than max_len (in characters) are truncated with an ellipsis indicator.
    /// This function is Unicode-aware and will not split multi-byte characters.
    pub fn truncate_message(content: &str, max_chars: usize) -> String {
        let char_count = content.chars().count();
        if char_count <= max_chars {
            content.to_string()
        } else if max_chars <= 3 {
            "...".to_string()
        } else {
            // Use char-based slicing to avoid splitting multi-byte characters
            let truncated: String = content.chars().take(max_chars.saturating_sub(1)).collect();
            format!("{}…", truncated)
        }
    }
}

impl Default for App {
    fn default() -> Self {
        Self::new()
    }
}
