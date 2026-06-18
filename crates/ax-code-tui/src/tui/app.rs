//! Application state for the TUI.

use crate::events::{MessageRole, RuntimeEvent};

/// Session status.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum SessionStatus {
    /// No active session.
    #[default]
    Idle,
    /// Session is running.
    Running,
    /// Session was aborted.
    Aborted,
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
    /// Text parts keyed by message, preserving event insertion order.
    pub message_text_parts: Vec<MessageTextPart>,
    /// Current prompt input.
    pub prompt: String,
    /// Cursor position in prompt.
    pub cursor_position: usize,
    /// Pending permission requests.
    pub pending_permissions: Vec<PermissionRequest>,
    /// Pending questions.
    pub pending_questions: Vec<QuestionRequest>,
    /// Answers collected for multi-question requests.
    question_answer_progress: Vec<QuestionAnswerProgress>,
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
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum AppMode {
    /// Normal input mode.
    #[default]
    Input,
    /// Permission response mode.
    Permission,
    /// Question response mode.
    Question,
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

/// A text part attached to a message.
#[derive(Debug, Clone)]
pub struct MessageTextPart {
    pub message_id: String,
    pub part_id: String,
    pub text: String,
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
    pub index: usize,
    pub total: usize,
}

#[derive(Debug, Clone)]
struct QuestionAnswerProgress {
    request_id: String,
    answers: Vec<Vec<String>>,
    total: usize,
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
            message_text_parts: Vec::new(),
            prompt: String::new(),
            cursor_position: 0,
            pending_permissions: Vec::new(),
            pending_questions: Vec::new(),
            question_answer_progress: Vec::new(),
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

    /// Reset `mode` to `Input` once no permissions or questions are pending.
    ///
    /// Permission/question requests are FIFO: the oldest pending request is the
    /// one currently being rendered. When it is resolved (locally or via an
    /// out-of-band `*Replied`/`*Rejected` event), the next oldest takes its
    /// place; only when the queue is fully drained do we return to `Input`.
    fn reset_mode_if_idle(&mut self) {
        if self.pending_permissions.is_empty() && self.pending_questions.is_empty() {
            self.mode = AppMode::Input;
        } else if !self.pending_permissions.is_empty() {
            self.mode = AppMode::Permission;
        } else {
            self.mode = AppMode::Question;
        }
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
                    if !self.event_targets_current_session(&info.id) {
                        return;
                    }
                    self.session_id = Some(info.id);
                    self.session_title = info.title;
                    self.status_message = Some("Session created".to_string());
                }
            }
            RuntimeEvent::SessionUpdated { properties } => {
                if let Some(info) = properties.info {
                    if !self.event_targets_current_session(&info.id) {
                        return;
                    }
                    self.session_id = Some(info.id);
                    if info.title.is_some() {
                        self.session_title = info.title;
                    }
                }
            }
            RuntimeEvent::SessionDeleted { properties } => {
                if let Some(info) = properties.info {
                    if !self.event_targets_current_session(&info.id) {
                        return;
                    }
                    self.clear_active_session_state();
                }
                self.status_message = Some("Session deleted".to_string());
            }
            RuntimeEvent::SessionStatus { properties } => {
                if let Some(status) = properties.status {
                    if !self.event_targets_current_session(&properties.session_id) {
                        return;
                    }
                    // Extract the status type string from the JSON value
                    // (either a plain string or an object with a "type" key).
                    let status_text = status
                        .get("type")
                        .and_then(serde_json::Value::as_str)
                        .or_else(|| status.as_str());
                    if let Some(mapped) = session_status_from_value(&status) {
                        self.session_status = mapped;
                    }
                    self.status_message =
                        Some(format!("Status: {}", status_text.unwrap_or("unknown")));
                }
            }
            RuntimeEvent::SessionError { properties } => {
                if !self.event_targets_current_session_option(properties.session_id.as_deref()) {
                    return;
                }
                let error = properties
                    .error
                    .map(|error| error.to_string())
                    .unwrap_or_else(|| "Unknown error".to_string());
                self.session_status = SessionStatus::Idle;
                self.fail_running_tool_calls(&error);
                self.status_message = Some(format!("Error: {}", error));
            }
            RuntimeEvent::MessageUpdated { properties } => {
                if let Some(info) = properties.info {
                    if !self.event_targets_current_session(&info.session_id) {
                        return;
                    }
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
            RuntimeEvent::MessageRemoved { properties } => {
                if !self.event_targets_current_session(&properties.session_id) {
                    return;
                }
                self.messages.retain(|m| m.id != properties.message_id);
                self.message_text_parts
                    .retain(|part| part.message_id != properties.message_id);
                self.scroll_offset = self.scroll_offset.min(self.messages.len());
            }
            RuntimeEvent::MessagePartDelta { properties } => {
                if !self.message_event_targets_current_session(
                    &properties.session_id,
                    &properties.message_id,
                ) {
                    return;
                }
                if properties.field == "text" || properties.field == "content" {
                    self.append_message_text_delta(
                        &properties.message_id,
                        &properties.part_id,
                        &properties.delta,
                    );
                }
            }
            RuntimeEvent::MessagePartUpdated { properties } => {
                if let Some(part) = properties.part {
                    if !self.event_targets_current_session(&part.session_id) {
                        return;
                    }
                    if part.part_type == "text" {
                        self.upsert_message_text_part(
                            &part.message_id,
                            &part.id,
                            part.text.as_deref().unwrap_or_default(),
                        );
                    } else if part.part_type == "tool" {
                        let call_id = part.call_id.as_deref().unwrap_or(&part.id);
                        let tool_name = part.tool.as_deref().unwrap_or("tool");
                        self.upsert_tool_part(call_id, tool_name, part.state.as_ref());
                    }
                }
            }
            RuntimeEvent::MessagePartRemoved { properties } => {
                if !self.message_event_targets_current_session(
                    &properties.session_id,
                    &properties.message_id,
                ) {
                    return;
                }
                self.message_text_parts.retain(|part| {
                    !(part.message_id == properties.message_id
                        && part.part_id == properties.part_id)
                });
                self.rebuild_message_content(&properties.message_id);
            }
            RuntimeEvent::PermissionAsked { properties } => {
                if !self.event_targets_current_session(&properties.session_id) {
                    return;
                }
                let permission_type = properties.permission_type.unwrap_or_default();
                let description = if properties.description.is_empty() {
                    permission_type.clone()
                } else {
                    properties.description
                };
                self.pending_permissions.push(PermissionRequest {
                    session_id: properties.session_id,
                    request_id: properties.id,
                    permission_type,
                    description,
                });
                self.mode = AppMode::Permission;
            }
            RuntimeEvent::PermissionReplied { properties } => {
                if !self.event_targets_current_session(&properties.session_id) {
                    return;
                }
                // The server confirmed a permission reply (may be our own, an
                // out-of-band desktop reply, or a server-side timeout). Remove
                // the matching request by id so we don't keep showing a stale
                // modal for an already-resolved request.
                self.pending_permissions
                    .retain(|p| p.request_id != properties.request_id);
                self.reset_mode_if_idle();
            }
            RuntimeEvent::QuestionAsked { properties } => {
                if !self.event_targets_current_session(&properties.session_id) {
                    return;
                }
                let items = if properties.items.is_empty() {
                    vec![crate::events::QuestionPromptProps {
                        question: properties.display_question(),
                        options: properties.display_options(),
                    }]
                } else {
                    properties.items.clone()
                };
                let total = items.len();
                for (index, item) in items.iter().enumerate() {
                    self.pending_questions.push(QuestionRequest {
                        session_id: properties.session_id.clone(),
                        request_id: properties.id.clone(),
                        question: item.question.clone(),
                        options: item.options.clone(),
                        selected: 0,
                        index,
                        total,
                    });
                }
                self.mode = AppMode::Question;
            }
            RuntimeEvent::QuestionReplied { properties } => {
                if !self.event_targets_current_session(&properties.session_id) {
                    return;
                }
                self.pending_questions
                    .retain(|q| q.request_id != properties.request_id);
                self.question_answer_progress
                    .retain(|progress| progress.request_id != properties.request_id);
                self.reset_mode_if_idle();
            }
            RuntimeEvent::QuestionRejected { properties } => {
                if !self.event_targets_current_session(&properties.session_id) {
                    return;
                }
                self.pending_questions
                    .retain(|q| q.request_id != properties.request_id);
                self.question_answer_progress
                    .retain(|progress| progress.request_id != properties.request_id);
                self.reset_mode_if_idle();
            }
            RuntimeEvent::TodoUpdated { .. } => {
                // TODO: Update todo display
            }
            RuntimeEvent::SessionDiff { .. } => {
                // TODO: Update diff display
            }
            RuntimeEvent::ToolCallStart { properties } => {
                if !self.event_targets_current_session(&properties.session_id) {
                    return;
                }
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
                if !self.event_targets_current_session(&properties.session_id) {
                    return;
                }
                if let Some(tool_call) = self
                    .tool_calls
                    .iter_mut()
                    .find(|t| t.call_id == properties.call_id)
                {
                    tool_call.status = if properties.error.is_some() {
                        ToolCallStatus::Failed
                    } else {
                        ToolCallStatus::Completed
                    };
                    tool_call.result = properties.result;
                    tool_call.error = properties.error;
                }
                // If no more running tools, session is idle
                if !self
                    .tool_calls
                    .iter()
                    .any(|t| t.status == ToolCallStatus::Running)
                {
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

    fn event_targets_current_session(&self, event_session_id: &str) -> bool {
        if event_session_id.is_empty() {
            return self.session_id.is_none();
        }
        match self.session_id.as_deref() {
            Some(current) => current == event_session_id,
            None => true,
        }
    }

    fn event_targets_current_session_option(&self, event_session_id: Option<&str>) -> bool {
        event_session_id
            .map(|session_id| self.event_targets_current_session(session_id))
            .unwrap_or_else(|| self.session_id.is_none())
    }

    fn message_targets_current_session(&self, message_id: &str) -> bool {
        self.session_id.is_none() || self.messages.iter().any(|m| m.id == message_id)
    }

    fn message_event_targets_current_session(
        &self,
        event_session_id: &str,
        message_id: &str,
    ) -> bool {
        if !event_session_id.is_empty() {
            return self.event_targets_current_session(event_session_id);
        }
        self.message_targets_current_session(message_id)
    }

    fn ensure_message(&mut self, message_id: &str) {
        if self.messages.iter().any(|m| m.id == message_id) {
            return;
        }
        self.messages.push(Message {
            id: message_id.to_string(),
            role: MessageRole::Assistant,
            content: String::new(),
            is_streaming: true,
        });
    }

    fn upsert_message_text_part(&mut self, message_id: &str, part_id: &str, text: &str) {
        self.ensure_message(message_id);
        if let Some(part) = self
            .message_text_parts
            .iter_mut()
            .find(|part| part.message_id == message_id && part.part_id == part_id)
        {
            part.text = text.to_string();
        } else {
            self.message_text_parts.push(MessageTextPart {
                message_id: message_id.to_string(),
                part_id: part_id.to_string(),
                text: text.to_string(),
            });
        }
        self.rebuild_message_content(message_id);
    }

    fn append_message_text_delta(&mut self, message_id: &str, part_id: &str, delta: &str) {
        self.ensure_message(message_id);
        if let Some(part) = self
            .message_text_parts
            .iter_mut()
            .find(|part| part.message_id == message_id && part.part_id == part_id)
        {
            part.text.push_str(delta);
        } else {
            self.message_text_parts.push(MessageTextPart {
                message_id: message_id.to_string(),
                part_id: part_id.to_string(),
                text: delta.to_string(),
            });
        }
        self.rebuild_message_content(message_id);
    }

    fn rebuild_message_content(&mut self, message_id: &str) {
        if let Some(msg) = self.messages.iter_mut().find(|m| m.id == message_id) {
            msg.content = self
                .message_text_parts
                .iter()
                .filter(|part| part.message_id == message_id)
                .map(|part| part.text.as_str())
                .collect();
        }
    }

    fn upsert_tool_part(
        &mut self,
        call_id: &str,
        tool_name: &str,
        state: Option<&crate::events::ToolPartState>,
    ) {
        let status = match state.map(|s| s.status.as_str()) {
            Some("completed") => ToolCallStatus::Completed,
            Some("error") => ToolCallStatus::Failed,
            _ => ToolCallStatus::Running,
        };
        let result = state.and_then(|s| s.output.clone());
        let error = state.and_then(|s| s.error.clone());

        if let Some(tool_call) = self.tool_calls.iter_mut().find(|t| t.call_id == call_id) {
            tool_call.tool_name = tool_name.to_string();
            tool_call.status = status;
            tool_call.result = result;
            tool_call.error = error;
        } else {
            self.tool_calls.push(ToolCall {
                call_id: call_id.to_string(),
                tool_name: tool_name.to_string(),
                status,
                result,
                error,
            });
        }

        if self
            .tool_calls
            .iter()
            .any(|t| t.status == ToolCallStatus::Running)
        {
            self.session_status = SessionStatus::Running;
        } else {
            self.session_status = SessionStatus::Idle;
        }
    }

    fn fail_running_tool_calls(&mut self, error: &str) {
        for tool_call in &mut self.tool_calls {
            if tool_call.status == ToolCallStatus::Running {
                tool_call.status = ToolCallStatus::Failed;
                tool_call.error = Some(error.to_string());
            }
        }
    }

    /// Insert a character at the cursor position.
    pub fn insert_char(&mut self, c: char) {
        if self.mode == AppMode::Input {
            // cursor_position is a char index; String::insert takes a byte
            // index that must lie on a UTF-8 code-point boundary. Convert via
            // char_indices() so multi-byte input (CJK, emoji) does not panic.
            let byte_idx = byte_index_at_char(&self.prompt, self.cursor_position);
            self.prompt.insert(byte_idx, c);
            self.cursor_position += 1;
        }
    }

    /// Delete the character before the cursor.
    pub fn backspace(&mut self) {
        if self.mode == AppMode::Input && self.cursor_position > 0 {
            self.cursor_position -= 1;
            // Remove the char now sitting at the (decremented) char cursor.
            let byte_idx = byte_index_at_char(&self.prompt, self.cursor_position);
            self.prompt.remove(byte_idx);
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
        if self.mode == AppMode::Input && self.cursor_position < self.prompt.chars().count() {
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
    ///
    /// Clamped so the user cannot scroll past the last message. The visible
    /// window size is not known here (it depends on terminal height and is
    /// computed in render.rs), so we clamp to `messages.len()` — render's
    /// `skip(scroll_offset)` will simply produce an empty list once the offset
    /// reaches the end, never an underflow.
    pub fn scroll_down(&mut self) {
        let max_offset = self.messages.len();
        if self.scroll_offset < max_offset {
            self.scroll_offset += 1;
        }
    }

    /// Accept the current (front) permission request.
    ///
    /// Permissions are FIFO: the front of `pending_permissions` is the request
    /// currently rendered in the modal. Removing from the front ensures we
    /// answer requests in the order the server asked them, not LIFO.
    pub fn accept_permission(&mut self) -> Option<(String, String)> {
        if self.pending_permissions.is_empty() {
            return None;
        }
        let req = self.pending_permissions.remove(0);
        self.reset_mode_if_idle();
        Some((req.session_id, req.request_id))
    }

    /// Reject the current (front) permission request.
    pub fn reject_permission(&mut self) -> Option<(String, String)> {
        if self.pending_permissions.is_empty() {
            return None;
        }
        let req = self.pending_permissions.remove(0);
        self.reset_mode_if_idle();
        Some((req.session_id, req.request_id))
    }

    /// Move question selection up.
    pub fn question_up(&mut self) {
        if let Some(q) = self.pending_questions.first_mut() {
            if q.selected > 0 {
                q.selected -= 1;
            }
        }
    }

    /// Move question selection down.
    pub fn question_down(&mut self) {
        if let Some(q) = self.pending_questions.first_mut() {
            if q.selected < q.options.len().saturating_sub(1) {
                q.selected += 1;
            }
        }
    }

    /// Select the current (front) question option.
    pub fn select_question(&mut self) -> Option<(String, String, Vec<Vec<String>>)> {
        if self.pending_questions.is_empty() {
            return None;
        }
        let req = self.pending_questions.remove(0);
        let answer = req.options.get(req.selected).cloned().unwrap_or_default();
        let answers = {
            let progress = self
                .question_answer_progress
                .iter_mut()
                .find(|progress| progress.request_id == req.request_id);
            let progress = if let Some(progress) = progress {
                progress
            } else {
                self.question_answer_progress.push(QuestionAnswerProgress {
                    request_id: req.request_id.clone(),
                    answers: Vec::with_capacity(req.total),
                    total: req.total,
                });
                self.question_answer_progress
                    .last_mut()
                    .expect("just inserted question progress")
            };
            progress.answers.push(vec![answer]);
            if progress.answers.len() >= progress.total {
                Some(progress.answers.clone())
            } else {
                None
            }
        };
        self.reset_mode_if_idle();
        if let Some(answers) = answers {
            self.question_answer_progress
                .retain(|progress| progress.request_id != req.request_id);
            Some((req.session_id, req.request_id, answers))
        } else {
            None
        }
    }

    /// Reject the current (front) question.
    pub fn reject_question(&mut self) -> Option<(String, String)> {
        if self.pending_questions.is_empty() {
            return None;
        }
        let req = self.pending_questions.remove(0);
        self.pending_questions
            .retain(|question| question.request_id != req.request_id);
        self.question_answer_progress
            .retain(|progress| progress.request_id != req.request_id);
        self.reset_mode_if_idle();
        Some((req.session_id, req.request_id))
    }

    // === Session switching ===

    /// Load sessions into the session list.
    pub fn load_sessions(&mut self, sessions: Vec<SessionSummary>) {
        self.sessions = sessions;
        // Try to find and select current session
        if let Some(current_id) = &self.session_id {
            if let Some(idx) = self.sessions.iter().position(|s| &s.id == current_id) {
                self.selected_session_index = idx;
                return;
            }
        }
        self.clamp_session_selection();
    }

    /// Toggle session list visibility.
    pub fn toggle_session_list(&mut self) {
        self.show_session_list = !self.show_session_list;
    }

    /// Keep the selected session index inside the current session list.
    fn clamp_session_selection(&mut self) {
        if self.sessions.is_empty() {
            self.selected_session_index = 0;
        } else if self.selected_session_index >= self.sessions.len() {
            self.selected_session_index = self.sessions.len() - 1;
        }
    }

    /// Move to next session in list.
    pub fn next_session(&mut self) {
        self.clamp_session_selection();
        if !self.sessions.is_empty() && self.selected_session_index < self.sessions.len() - 1 {
            self.selected_session_index += 1;
        }
    }

    /// Move to previous session in list.
    pub fn prev_session(&mut self) {
        self.clamp_session_selection();
        if self.selected_session_index > 0 {
            self.selected_session_index -= 1;
        }
    }

    /// Select the currently highlighted session.
    pub fn select_session(&mut self) -> Option<String> {
        self.clamp_session_selection();
        let summary = self.sessions.get(self.selected_session_index).cloned();
        summary.map(|s| {
            self.show_session_list = false;
            self.switch_to_session(&s);
            s.id.clone()
        })
    }

    fn switch_to_session(&mut self, summary: &SessionSummary) {
        self.session_id = Some(summary.id.clone());
        self.session_title = summary.title.clone();
        self.session_status = SessionStatus::Idle;
        self.clear_session_runtime_state();
        self.status_message = Some(format!("Switched to session: {}", summary.id));
    }

    fn clear_active_session_state(&mut self) {
        self.session_id = None;
        self.session_title = None;
        self.session_status = SessionStatus::Idle;
        self.clear_session_runtime_state();
    }

    fn clear_session_runtime_state(&mut self) {
        self.messages.clear();
        self.message_text_parts.clear();
        self.pending_permissions.clear();
        self.pending_questions.clear();
        self.question_answer_progress.clear();
        self.tool_calls.clear();
        self.mode = AppMode::Input;
        self.scroll_offset = 0;
        self.selected_tool_index = 0;
        self.tool_result_expanded = false;
    }

    // === Interrupt/Abort ===

    /// Request to abort the current session.
    ///
    /// Keeps `session_status` as `Running` until the server confirms. The
    /// runner sends the HTTP abort and the authoritative terminal status
    /// arrives via later events (`ToolCallComplete` draining running tools, or
    /// a `SessionStatus`/`SessionError` event). Flipping to `Aborted`
    /// optimistically here would desync the indicator if the abort HTTP call
    /// fails or the server rejects it.
    pub fn request_abort(&mut self) -> Option<String> {
        if self.session_status == SessionStatus::Running {
            self.status_message = Some("Aborting session...".to_string());
            return self.session_id.clone();
        }
        None
    }

    /// Clear completed tool calls from the list.
    pub fn clear_completed_tools(&mut self) {
        self.tool_calls
            .retain(|t| t.status == ToolCallStatus::Running);
        self.clamp_tool_selection();
    }

    /// Get active (running) tool calls.
    pub fn active_tool_calls(&self) -> Vec<&ToolCall> {
        self.tool_calls
            .iter()
            .filter(|t| t.status == ToolCallStatus::Running)
            .collect()
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

    /// Keep the selected tool index inside the completed/failed tool list.
    fn clamp_tool_selection(&mut self) {
        let completed_count = self
            .tool_calls
            .iter()
            .filter(|t| t.status == ToolCallStatus::Completed || t.status == ToolCallStatus::Failed)
            .count();

        if completed_count == 0 {
            self.selected_tool_index = 0;
        } else if self.selected_tool_index >= completed_count {
            self.selected_tool_index = completed_count - 1;
        }
    }

    /// Move to next tool in tool panel.
    pub fn next_tool(&mut self) {
        self.clamp_tool_selection();
        let completed_count = self.completed_tool_calls().len();
        if completed_count > 0 && self.selected_tool_index < completed_count - 1 {
            self.selected_tool_index += 1;
            self.tool_result_expanded = false;
        }
    }

    /// Move to previous tool in tool panel.
    pub fn prev_tool(&mut self) {
        self.clamp_tool_selection();
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
        let completed = self.completed_tool_calls();
        let selected_index = self
            .selected_tool_index
            .min(completed.len().saturating_sub(1));
        completed.get(selected_index).copied()
    }

    /// Truncate a string to a maximum length with ellipsis.
    ///
    /// Uses char-based indexing to avoid panicking on multi-byte UTF-8 characters.
    pub fn truncate_result(result: &str, max_len: usize) -> String {
        let char_count = result.chars().count();
        if char_count <= max_len {
            result.to_string()
        } else if max_len == 0 {
            String::new()
        } else if max_len <= 3 {
            ".".repeat(max_len)
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
    ///
    /// Truncation is char-based so multi-byte UTF-8 status text (server
    /// errors, localized messages) cannot panic by slicing mid-codepoint.
    pub fn format_status_bar(mode: AppMode, status: Option<&str>, width: usize) -> String {
        if width == 0 {
            return String::new();
        }

        let mode_indicator = match mode {
            AppMode::Input => "INPUT",
            AppMode::Permission => "PERMISSION (y/n)",
            AppMode::Question => "QUESTION",
        };

        let status_text = status.unwrap_or("Ready");

        // Calculate available space for status message. `width` covers the
        // whole bar in display columns; the prefix/suffix are ASCII so their
        // byte and char widths coincide.
        let prefix = format!(" [{}] ", mode_indicator);
        let suffix = " ";

        let overhead = prefix.chars().count() + suffix.chars().count();
        if width <= overhead {
            return format!("{}{}", prefix, suffix)
                .chars()
                .take(width)
                .collect();
        }

        let max_status_len = width.saturating_sub(overhead);

        // Truncate status (by char count) if needed.
        let status_len = status_text.chars().count();
        let display_status = if status_len > max_status_len {
            if max_status_len <= 3 {
                ".".repeat(max_status_len)
            } else {
                let truncated: String = status_text
                    .chars()
                    .take(max_status_len.saturating_sub(3))
                    .collect();
                format!("{}...", truncated)
            }
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

/// Convert a char index into a byte index that lies on a UTF-8 code-point
/// boundary of `s`.
///
/// `String::insert` / `String::remove` take byte indices and panic if the
/// index is not on a boundary. The TUI tracks the cursor as a char index
/// (which matches column-based rendering), so every insert/remove site must
/// round-trip through this helper. If `char_idx` is at or past the last char,
/// returns `s.len()` (the valid "end of string" boundary).
fn byte_index_at_char(s: &str, char_idx: usize) -> usize {
    s.char_indices()
        .nth(char_idx)
        .map(|(byte_idx, _)| byte_idx)
        .unwrap_or_else(|| s.len())
}

fn session_status_from_value(value: &serde_json::Value) -> Option<SessionStatus> {
    let status_type = value
        .get("type")
        .and_then(serde_json::Value::as_str)
        .or_else(|| value.as_str())?;

    match status_type {
        "idle" => Some(SessionStatus::Idle),
        "busy" | "retry" => Some(SessionStatus::Running),
        "aborted" => Some(SessionStatus::Aborted),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::{
        MessageData, MessageInfo, MessagePartData, MessagePartDeltaProps, MessagePartInfo,
        MessagePartRemovedProps, MessageRemovedProps, RequestReplyProps, RuntimeEvent,
        SessionErrorProps, SessionStatusProps, ToolPartState,
    };

    // === HIGH 1: multi-byte prompt editing must not panic ===

    #[test]
    fn test_insert_char_multibyte_cjk() {
        // CJK chars are 3 bytes each; char index 1 is byte index 3, NOT 1.
        let mut app = App::new();
        app.insert_char('你');
        app.insert_char('好');
        assert_eq!(app.prompt, "你好");
        assert_eq!(app.cursor_position, 2);
    }

    #[test]
    fn test_insert_char_in_the_middle_of_emoji() {
        // Insert between two 4-byte emoji — the cursor sits at a char boundary
        // that is NOT a byte boundary under naive byte indexing.
        let mut app = App::new();
        app.insert_char('🚀'); // 4 bytes
        app.insert_char('🌍'); // 4 bytes
        app.cursor_position = 1; // between the two emoji
        app.insert_char('X');
        assert_eq!(app.prompt, "🚀X🌍");
    }

    #[test]
    fn test_backspace_multibyte() {
        let mut app = App::new();
        for c in "こんにちは".chars() {
            app.insert_char(c);
        }
        app.backspace(); // delete 'は' (3 bytes) -> last char
        assert_eq!(app.prompt, "こんにち");
        // The previous buggy byte-remove would have panicked here.
    }

    #[test]
    fn test_move_cursor_right_multibyte_bound() {
        let mut app = App::new();
        for c in "あいう".chars() {
            app.insert_char(c);
        }
        app.cursor_position = 0;
        app.move_cursor_right();
        app.move_cursor_right();
        app.move_cursor_right();
        // Past end: should not advance beyond char count (3), regardless of byte len (9).
        app.move_cursor_right();
        assert_eq!(app.cursor_position, 3);
    }

    // === HIGH 2: format_status_bar must not panic on multi-byte text ===

    #[test]
    fn test_format_status_bar_multibyte_truncation() {
        // Japanese status text; byte-slicing at a 3-byte-char offset previously
        // panicked. Now truncation is char-based.
        let status = "エラーが発生しました";
        let formatted = App::format_status_bar(AppMode::Input, Some(status), 20);
        assert!(formatted.starts_with(" [INPUT] "));
        assert!(formatted.ends_with(' '));
    }

    #[test]
    fn test_format_status_bar_very_narrow() {
        // Tiny width exercises the max_status_len <= 3 branch with multi-byte text.
        let formatted = App::format_status_bar(AppMode::Input, Some("テスト"), 5);
        // Must not panic and must fit the available width.
        assert_eq!(formatted.chars().count(), 5);
    }

    // === MEDIUM 1: out-of-band replies clear stale modals ===

    #[test]
    fn test_permission_replied_event_clears_pending() {
        let mut app = App::new();
        app.handle_event(RuntimeEvent::PermissionAsked {
            properties: crate::events::PermissionRequestProps {
                session_id: "s1".to_string(),
                id: "p1".to_string(),
                description: "run bash".to_string(),
                permission_type: Some("bash".to_string()),
            },
        });
        assert_eq!(app.pending_permissions.len(), 1);
        assert!(matches!(app.mode, AppMode::Permission));

        // Server reports the permission was replied out-of-band.
        app.handle_event(RuntimeEvent::PermissionReplied {
            properties: RequestReplyProps {
                session_id: "s1".to_string(),
                request_id: "p1".to_string(),
            },
        });
        assert!(app.pending_permissions.is_empty());
        assert!(matches!(app.mode, AppMode::Input));
    }

    #[test]
    fn test_permission_asked_uses_metadata_description() {
        let mut app = App::new();
        let event: RuntimeEvent = serde_json::from_str(
            r#"{"type":"permission.asked","properties":{"sessionID":"s1","id":"p1","permission":"file_write","patterns":["/tmp/file"],"metadata":{"description":"Write /tmp/file"},"always":[]}}"#,
        )
        .expect("permission event");

        app.handle_event(event);

        assert_eq!(app.pending_permissions.len(), 1);
        assert_eq!(app.pending_permissions[0].description, "Write /tmp/file");
        assert_eq!(
            app.pending_permissions[0].permission_type,
            "file_write".to_string()
        );
    }

    #[test]
    fn test_question_replied_event_clears_pending() {
        let mut app = App::new();
        app.handle_event(RuntimeEvent::QuestionAsked {
            properties: crate::events::QuestionRequestProps {
                session_id: "s1".to_string(),
                id: "q1".to_string(),
                question: "pick one".to_string(),
                options: vec!["a".to_string(), "b".to_string()],
                items: vec![],
            },
        });
        assert!(matches!(app.mode, AppMode::Question));

        app.handle_event(RuntimeEvent::QuestionReplied {
            properties: RequestReplyProps {
                session_id: "s1".to_string(),
                request_id: "q1".to_string(),
            },
        });
        assert!(app.pending_questions.is_empty());
        assert!(matches!(app.mode, AppMode::Input));
    }

    #[test]
    fn test_multi_question_request_collects_answers_before_reply() {
        let mut app = App::new();
        let event: RuntimeEvent = serde_json::from_str(
            r#"{"type":"question.asked","properties":{"sessionID":"s1","id":"q1","questions":[{"question":"Which fix?","header":"Fix","options":[{"label":"Quick","description":""},{"label":"Full","description":""}]},{"question":"Run tests?","header":"Tests","options":[{"label":"Yes","description":""},{"label":"No","description":""}]}]}}"#,
        )
        .expect("question event");

        app.handle_event(event);

        assert_eq!(app.pending_questions.len(), 2);
        assert!(matches!(app.mode, AppMode::Question));

        app.question_down();
        let first = app.select_question();
        assert!(first.is_none());
        assert_eq!(app.pending_questions.len(), 1);
        assert!(matches!(app.mode, AppMode::Question));

        let second = app.select_question().expect("complete answers");
        assert_eq!(second.0, "s1");
        assert_eq!(second.1, "q1");
        assert_eq!(
            second.2,
            vec![vec!["Full".to_string()], vec!["Yes".to_string()]]
        );
        assert!(app.pending_questions.is_empty());
        assert!(matches!(app.mode, AppMode::Input));
    }

    #[test]
    fn test_permission_replied_for_other_id_keeps_oldest() {
        // Only the matching request should be cleared; others stay.
        let mut app = App::new();
        app.handle_event(RuntimeEvent::PermissionAsked {
            properties: crate::events::PermissionRequestProps {
                session_id: "s1".to_string(),
                id: "p1".to_string(),
                description: "a".to_string(),
                permission_type: None,
            },
        });
        app.handle_event(RuntimeEvent::PermissionAsked {
            properties: crate::events::PermissionRequestProps {
                session_id: "s1".to_string(),
                id: "p2".to_string(),
                description: "b".to_string(),
                permission_type: None,
            },
        });
        app.handle_event(RuntimeEvent::PermissionReplied {
            properties: RequestReplyProps {
                session_id: "s1".to_string(),
                request_id: "p2".to_string(),
            },
        });
        // p2 cleared out-of-band, p1 still pending.
        assert_eq!(app.pending_permissions.len(), 1);
        assert_eq!(app.pending_permissions[0].request_id, "p1");
    }

    // === MEDIUM 2: FIFO ordering for multiple pending requests ===

    #[test]
    fn test_permissions_are_fifo_not_lifo() {
        let mut app = App::new();
        for id in ["p1", "p2", "p3"] {
            app.handle_event(RuntimeEvent::PermissionAsked {
                properties: crate::events::PermissionRequestProps {
                    session_id: "s".to_string(),
                    id: id.to_string(),
                    description: id.to_string(),
                    permission_type: None,
                },
            });
        }
        // Accept must resolve p1 first (front), not p3 (back).
        let first = app.accept_permission().expect("first accept");
        assert_eq!(first.1, "p1");
        let second = app.accept_permission().expect("second accept");
        assert_eq!(second.1, "p2");
        let third = app.accept_permission().expect("third accept");
        assert_eq!(third.1, "p3");
        assert!(app.accept_permission().is_none());
    }

    #[test]
    fn test_questions_are_fifo_not_lifo() {
        let mut app = App::new();
        for id in ["q1", "q2"] {
            app.handle_event(RuntimeEvent::QuestionAsked {
                properties: crate::events::QuestionRequestProps {
                    session_id: "s".to_string(),
                    id: id.to_string(),
                    question: id.to_string(),
                    options: vec!["opt".to_string()],
                    items: vec![],
                },
            });
        }
        let first = app.select_question().expect("first select");
        assert_eq!(first.1, "q1");
        let second = app.select_question().expect("second select");
        assert_eq!(second.1, "q2");
    }

    #[test]
    fn test_accept_permission_advances_to_next_then_input() {
        // With multiple pending, resolving one should NOT drop to Input while
        // others remain; mode stays Permission until the queue drains.
        let mut app = App::new();
        for id in ["p1", "p2"] {
            app.handle_event(RuntimeEvent::PermissionAsked {
                properties: crate::events::PermissionRequestProps {
                    session_id: "s".to_string(),
                    id: id.to_string(),
                    description: id.to_string(),
                    permission_type: None,
                },
            });
        }
        app.accept_permission();
        assert!(matches!(app.mode, AppMode::Permission)); // still one left
        app.accept_permission();
        assert!(matches!(app.mode, AppMode::Input)); // drained
    }

    // === LOW 1: scroll_down is bounded ===

    #[test]
    fn test_scroll_down_bounded_by_message_count() {
        let mut app = App::new();
        for i in 0..3 {
            app.handle_event(RuntimeEvent::MessageUpdated {
                properties: MessageInfo {
                    info: Some(MessageData {
                        id: format!("m{}", i),
                        session_id: "s".to_string(),
                        role: Some(crate::events::MessageRole::Assistant),
                    }),
                },
            });
        }
        assert_eq!(app.messages.len(), 3);

        // scroll_down past the end must clamp at messages.len() (3), not grow.
        for _ in 0..10 {
            app.scroll_down();
        }
        assert_eq!(app.scroll_offset, 3);
    }

    #[test]
    fn test_message_part_delta_accepts_headless_text_field() {
        let mut app = App::new();
        app.handle_event(RuntimeEvent::MessageUpdated {
            properties: MessageInfo {
                info: Some(MessageData {
                    id: "m1".to_string(),
                    session_id: "s".to_string(),
                    role: Some(crate::events::MessageRole::Assistant),
                }),
            },
        });

        app.handle_event(RuntimeEvent::MessagePartDelta {
            properties: MessagePartDeltaProps {
                session_id: "s".to_string(),
                message_id: "m1".to_string(),
                part_id: "p1".to_string(),
                field: "text".to_string(),
                delta: "streamed text".to_string(),
            },
        });

        assert_eq!(app.messages[0].content, "streamed text");
    }

    #[test]
    fn test_message_part_delta_uses_session_id_before_message_update() {
        let mut app = App::new();
        app.session_id = Some("s1".to_string());

        app.handle_event(RuntimeEvent::MessagePartDelta {
            properties: MessagePartDeltaProps {
                session_id: "s2".to_string(),
                message_id: "m_other".to_string(),
                part_id: "p1".to_string(),
                field: "text".to_string(),
                delta: "wrong".to_string(),
            },
        });

        assert!(app.messages.is_empty());

        app.handle_event(RuntimeEvent::MessagePartDelta {
            properties: MessagePartDeltaProps {
                session_id: "s1".to_string(),
                message_id: "m_current".to_string(),
                part_id: "p1".to_string(),
                field: "text".to_string(),
                delta: "first chunk".to_string(),
            },
        });

        assert_eq!(app.messages.len(), 1);
        assert_eq!(app.messages[0].id, "m_current");
        assert_eq!(app.messages[0].content, "first chunk");
    }

    #[test]
    fn test_message_part_updated_sets_text_content() {
        let mut app = App::new();
        app.handle_event(RuntimeEvent::MessageUpdated {
            properties: MessageInfo {
                info: Some(MessageData {
                    id: "m1".to_string(),
                    session_id: "s".to_string(),
                    role: Some(crate::events::MessageRole::Assistant),
                }),
            },
        });

        app.handle_event(RuntimeEvent::MessagePartUpdated {
            properties: MessagePartInfo {
                part: Some(MessagePartData {
                    id: "p1".to_string(),
                    session_id: "s".to_string(),
                    message_id: "m1".to_string(),
                    part_type: "text".to_string(),
                    call_id: None,
                    tool: None,
                    state: None,
                    text: Some("full text".to_string()),
                }),
            },
        });

        assert_eq!(app.messages[0].content, "full text");
    }

    #[test]
    fn test_message_part_updated_replaces_delta_content() {
        let mut app = App::new();
        app.handle_event(RuntimeEvent::MessagePartDelta {
            properties: MessagePartDeltaProps {
                session_id: "s".to_string(),
                message_id: "m1".to_string(),
                part_id: "p1".to_string(),
                field: "text".to_string(),
                delta: "partial".to_string(),
            },
        });

        app.handle_event(RuntimeEvent::MessagePartUpdated {
            properties: MessagePartInfo {
                part: Some(MessagePartData {
                    id: "p1".to_string(),
                    session_id: "s".to_string(),
                    message_id: "m1".to_string(),
                    part_type: "text".to_string(),
                    call_id: None,
                    tool: None,
                    state: None,
                    text: Some("partial final".to_string()),
                }),
            },
        });

        assert_eq!(app.messages[0].content, "partial final");
    }

    #[test]
    fn test_message_removed_clears_message_and_parts() {
        let mut app = App::new();
        app.handle_event(RuntimeEvent::MessagePartDelta {
            properties: MessagePartDeltaProps {
                session_id: "s".to_string(),
                message_id: "m1".to_string(),
                part_id: "p1".to_string(),
                field: "text".to_string(),
                delta: "visible".to_string(),
            },
        });
        app.scroll_offset = 10;

        app.handle_event(RuntimeEvent::MessageRemoved {
            properties: MessageRemovedProps {
                session_id: "s".to_string(),
                message_id: "m1".to_string(),
            },
        });

        assert!(app.messages.is_empty());
        assert!(app.message_text_parts.is_empty());
        assert_eq!(app.scroll_offset, 0);
    }

    #[test]
    fn test_message_part_removed_rebuilds_content() {
        let mut app = App::new();
        for (part_id, delta) in [("p1", "hello "), ("p2", "world")] {
            app.handle_event(RuntimeEvent::MessagePartDelta {
                properties: MessagePartDeltaProps {
                    session_id: "s".to_string(),
                    message_id: "m1".to_string(),
                    part_id: part_id.to_string(),
                    field: "text".to_string(),
                    delta: delta.to_string(),
                },
            });
        }
        assert_eq!(app.messages[0].content, "hello world");

        app.handle_event(RuntimeEvent::MessagePartRemoved {
            properties: MessagePartRemovedProps {
                session_id: "s".to_string(),
                message_id: "m1".to_string(),
                part_id: "p1".to_string(),
            },
        });

        assert_eq!(app.messages[0].content, "world");
    }

    #[test]
    fn test_message_part_removed_ignores_other_session() {
        let mut app = App::new();
        app.session_id = Some("s1".to_string());
        app.handle_event(RuntimeEvent::MessagePartDelta {
            properties: MessagePartDeltaProps {
                session_id: "s1".to_string(),
                message_id: "m1".to_string(),
                part_id: "p1".to_string(),
                field: "text".to_string(),
                delta: "visible".to_string(),
            },
        });

        app.handle_event(RuntimeEvent::MessagePartRemoved {
            properties: MessagePartRemovedProps {
                session_id: "s2".to_string(),
                message_id: "m1".to_string(),
                part_id: "p1".to_string(),
            },
        });

        assert_eq!(app.messages[0].content, "visible");
        assert_eq!(app.message_text_parts.len(), 1);
    }

    #[test]
    fn test_session_status_event_updates_running_state() {
        let mut app = App::new();
        app.session_id = Some("s1".to_string());

        app.handle_event(RuntimeEvent::SessionStatus {
            properties: SessionStatusProps {
                session_id: "s1".to_string(),
                status: Some(serde_json::json!({ "type": "busy" })),
            },
        });
        assert_eq!(app.session_status, SessionStatus::Running);

        app.handle_event(RuntimeEvent::SessionStatus {
            properties: SessionStatusProps {
                session_id: "s1".to_string(),
                status: Some(
                    serde_json::json!({ "type": "retry", "attempt": 1, "message": "x", "next": 1 }),
                ),
            },
        });
        assert_eq!(app.session_status, SessionStatus::Running);

        app.handle_event(RuntimeEvent::SessionStatus {
            properties: SessionStatusProps {
                session_id: "s1".to_string(),
                status: Some(serde_json::json!({ "type": "idle" })),
            },
        });
        assert_eq!(app.session_status, SessionStatus::Idle);
    }

    #[test]
    fn test_session_status_event_formats_readable_status_message() {
        // Status messages must show the human-readable type string (e.g. "busy"),
        // not the raw JSON value (e.g. {"type":"busy"} or "busy" with quotes).
        let mut app = App::new();
        app.session_id = Some("s1".to_string());

        app.handle_event(RuntimeEvent::SessionStatus {
            properties: SessionStatusProps {
                session_id: "s1".to_string(),
                status: Some(serde_json::json!({ "type": "busy" })),
            },
        });
        assert_eq!(app.status_message.as_deref(), Some("Status: busy"));

        app.handle_event(RuntimeEvent::SessionStatus {
            properties: SessionStatusProps {
                session_id: "s1".to_string(),
                status: Some(serde_json::json!("idle")),
            },
        });
        assert_eq!(app.status_message.as_deref(), Some("Status: idle"));

        // Unknown status type falls back to "unknown" rather than dumping raw JSON.
        app.handle_event(RuntimeEvent::SessionStatus {
            properties: SessionStatusProps {
                session_id: "s1".to_string(),
                status: Some(serde_json::json!({ "unexpected": true })),
            },
        });
        assert_eq!(app.status_message.as_deref(), Some("Status: unknown"));
    }

    #[test]
    fn test_session_status_event_ignores_other_session() {
        let mut app = App::new();
        app.session_id = Some("s1".to_string());
        app.session_status = SessionStatus::Idle;
        app.status_message = Some("Current status".to_string());

        app.handle_event(RuntimeEvent::SessionStatus {
            properties: SessionStatusProps {
                session_id: "s2".to_string(),
                status: Some(serde_json::json!({ "type": "busy" })),
            },
        });

        assert_eq!(app.session_status, SessionStatus::Idle);
        assert_eq!(app.status_message.as_deref(), Some("Current status"));
    }

    #[test]
    fn test_session_error_marks_running_session_idle_and_fails_tools() {
        let mut app = App::new();
        app.session_id = Some("s1".to_string());
        app.session_status = SessionStatus::Running;
        app.tool_calls.push(ToolCall {
            call_id: "call_running".to_string(),
            tool_name: "bash".to_string(),
            status: ToolCallStatus::Running,
            result: None,
            error: None,
        });
        app.tool_calls.push(ToolCall {
            call_id: "call_done".to_string(),
            tool_name: "read".to_string(),
            status: ToolCallStatus::Completed,
            result: Some("ok".to_string()),
            error: None,
        });

        app.handle_event(RuntimeEvent::SessionError {
            properties: SessionErrorProps {
                session_id: Some("s1".to_string()),
                error: Some(serde_json::json!({ "name": "AbortError", "message": "cancelled" })),
            },
        });

        assert_eq!(app.session_status, SessionStatus::Idle);
        assert_eq!(app.tool_calls[0].status, ToolCallStatus::Failed);
        assert!(
            app.tool_calls[0]
                .error
                .as_deref()
                .is_some_and(|error| error.contains("cancelled"))
        );
        assert_eq!(app.tool_calls[1].status, ToolCallStatus::Completed);
        assert!(
            app.status_message
                .as_deref()
                .is_some_and(|message| message.contains("cancelled"))
        );
    }

    #[test]
    fn test_session_error_ignores_other_session() {
        let mut app = App::new();
        app.session_id = Some("s1".to_string());
        app.session_status = SessionStatus::Running;
        app.tool_calls.push(ToolCall {
            call_id: "call_running".to_string(),
            tool_name: "bash".to_string(),
            status: ToolCallStatus::Running,
            result: None,
            error: None,
        });

        app.handle_event(RuntimeEvent::SessionError {
            properties: SessionErrorProps {
                session_id: Some("s2".to_string()),
                error: Some(serde_json::json!("other session failed")),
            },
        });

        assert_eq!(app.session_status, SessionStatus::Running);
        assert_eq!(app.tool_calls[0].status, ToolCallStatus::Running);
        assert!(app.status_message.is_none());
    }

    #[test]
    fn test_ignores_events_for_other_sessions() {
        let mut app = App::new();
        app.session_id = Some("s1".to_string());
        app.session_title = Some("Current".to_string());

        app.handle_event(RuntimeEvent::SessionUpdated {
            properties: crate::events::SessionInfo {
                info: Some(crate::events::SessionData {
                    id: "s2".to_string(),
                    title: Some("Other".to_string()),
                }),
            },
        });
        app.handle_event(RuntimeEvent::MessageUpdated {
            properties: MessageInfo {
                info: Some(MessageData {
                    id: "msg_s2".to_string(),
                    session_id: "s2".to_string(),
                    role: Some(crate::events::MessageRole::Assistant),
                }),
            },
        });
        app.handle_event(RuntimeEvent::MessagePartDelta {
            properties: MessagePartDeltaProps {
                session_id: "s".to_string(),
                message_id: "msg_s2".to_string(),
                part_id: "part_s2".to_string(),
                field: "text".to_string(),
                delta: "wrong session".to_string(),
            },
        });
        app.handle_event(RuntimeEvent::PermissionAsked {
            properties: crate::events::PermissionRequestProps {
                session_id: "s2".to_string(),
                id: "perm_s2".to_string(),
                description: "other".to_string(),
                permission_type: Some("bash".to_string()),
            },
        });
        app.handle_event(RuntimeEvent::QuestionAsked {
            properties: crate::events::QuestionRequestProps {
                session_id: "s2".to_string(),
                id: "q_s2".to_string(),
                question: "other?".to_string(),
                options: vec!["yes".to_string()],
                items: vec![],
            },
        });
        app.handle_event(RuntimeEvent::ToolCallStart {
            properties: crate::events::ToolCallStartProps {
                session_id: "s2".to_string(),
                call_id: "call_s2".to_string(),
                tool_name: "bash".to_string(),
            },
        });

        assert_eq!(app.session_id.as_deref(), Some("s1"));
        assert_eq!(app.session_title.as_deref(), Some("Current"));
        assert!(app.messages.is_empty());
        assert!(app.pending_permissions.is_empty());
        assert!(app.pending_questions.is_empty());
        assert!(app.tool_calls.is_empty());
        assert_eq!(app.mode, AppMode::Input);
        assert_eq!(app.session_status, SessionStatus::Idle);
    }

    #[test]
    fn test_active_session_ignores_unscoped_events() {
        let mut app = App::new();
        app.session_id = Some("s1".to_string());
        app.session_status = SessionStatus::Running;
        app.tool_calls.push(ToolCall {
            call_id: "call_current".to_string(),
            tool_name: "bash".to_string(),
            status: ToolCallStatus::Running,
            result: None,
            error: None,
        });

        app.handle_event(RuntimeEvent::SessionStatus {
            properties: SessionStatusProps {
                session_id: String::new(),
                status: Some(serde_json::json!({ "type": "idle" })),
            },
        });
        app.handle_event(RuntimeEvent::SessionError {
            properties: SessionErrorProps {
                session_id: None,
                error: Some(serde_json::json!("unscoped failure")),
            },
        });
        app.handle_event(RuntimeEvent::MessageUpdated {
            properties: MessageInfo {
                info: Some(MessageData {
                    id: "msg_unscoped".to_string(),
                    session_id: String::new(),
                    role: Some(crate::events::MessageRole::Assistant),
                }),
            },
        });
        app.handle_event(RuntimeEvent::PermissionAsked {
            properties: crate::events::PermissionRequestProps {
                session_id: String::new(),
                id: "perm_unscoped".to_string(),
                description: "unscoped".to_string(),
                permission_type: Some("bash".to_string()),
            },
        });
        app.handle_event(RuntimeEvent::QuestionAsked {
            properties: crate::events::QuestionRequestProps {
                session_id: String::new(),
                id: "q_unscoped".to_string(),
                question: "unscoped?".to_string(),
                options: vec!["yes".to_string()],
                items: vec![],
            },
        });
        app.handle_event(RuntimeEvent::ToolCallStart {
            properties: crate::events::ToolCallStartProps {
                session_id: String::new(),
                call_id: "call_unscoped".to_string(),
                tool_name: "bash".to_string(),
            },
        });

        assert_eq!(app.session_id.as_deref(), Some("s1"));
        assert_eq!(app.session_status, SessionStatus::Running);
        assert!(app.messages.is_empty());
        assert!(app.pending_permissions.is_empty());
        assert!(app.pending_questions.is_empty());
        assert_eq!(app.tool_calls.len(), 1);
        assert_eq!(app.tool_calls[0].status, ToolCallStatus::Running);
        assert!(app.status_message.is_none());
        assert_eq!(app.mode, AppMode::Input);
    }

    #[test]
    fn test_session_deleted_clears_current_session_state() {
        let mut app = App::new();
        app.session_id = Some("s1".to_string());
        app.session_title = Some("Current".to_string());
        app.session_status = SessionStatus::Running;
        app.mode = AppMode::Permission;
        app.scroll_offset = 10;
        app.tool_result_expanded = true;
        app.messages.push(Message {
            id: "msg1".to_string(),
            role: crate::events::MessageRole::Assistant,
            content: "stale".to_string(),
            is_streaming: false,
        });
        app.message_text_parts.push(MessageTextPart {
            message_id: "msg1".to_string(),
            part_id: "part1".to_string(),
            text: "stale".to_string(),
        });
        app.pending_permissions.push(PermissionRequest {
            session_id: "s1".to_string(),
            request_id: "perm1".to_string(),
            permission_type: "bash".to_string(),
            description: "run".to_string(),
        });
        app.pending_questions.push(QuestionRequest {
            session_id: "s1".to_string(),
            request_id: "q1".to_string(),
            question: "continue?".to_string(),
            options: vec!["yes".to_string()],
            selected: 0,
            index: 0,
            total: 1,
        });
        app.tool_calls.push(ToolCall {
            call_id: "call1".to_string(),
            tool_name: "bash".to_string(),
            status: ToolCallStatus::Running,
            result: None,
            error: None,
        });

        app.handle_event(RuntimeEvent::SessionDeleted {
            properties: crate::events::SessionInfo {
                info: Some(crate::events::SessionData {
                    id: "s1".to_string(),
                    title: None,
                }),
            },
        });

        assert!(app.session_id.is_none());
        assert!(app.session_title.is_none());
        assert!(app.messages.is_empty());
        assert!(app.message_text_parts.is_empty());
        assert!(app.pending_permissions.is_empty());
        assert!(app.pending_questions.is_empty());
        assert!(app.tool_calls.is_empty());
        assert_eq!(app.session_status, SessionStatus::Idle);
        assert_eq!(app.mode, AppMode::Input);
        assert_eq!(app.scroll_offset, 0);
        assert!(!app.tool_result_expanded);
        assert_eq!(app.status_message.as_deref(), Some("Session deleted"));
    }

    #[test]
    fn test_tool_message_part_updates_tool_state() {
        let mut app = App::new();
        app.handle_event(RuntimeEvent::MessagePartUpdated {
            properties: MessagePartInfo {
                part: Some(MessagePartData {
                    id: "part_tool".to_string(),
                    session_id: "s".to_string(),
                    message_id: "m1".to_string(),
                    part_type: "tool".to_string(),
                    call_id: Some("call_1".to_string()),
                    tool: Some("bash".to_string()),
                    state: Some(ToolPartState {
                        status: "running".to_string(),
                        output: None,
                        error: None,
                    }),
                    text: None,
                }),
            },
        });

        assert_eq!(app.tool_calls.len(), 1);
        assert_eq!(app.tool_calls[0].call_id, "call_1");
        assert_eq!(app.tool_calls[0].tool_name, "bash");
        assert_eq!(app.tool_calls[0].status, ToolCallStatus::Running);
        assert_eq!(app.session_status, SessionStatus::Running);

        app.handle_event(RuntimeEvent::MessagePartUpdated {
            properties: MessagePartInfo {
                part: Some(MessagePartData {
                    id: "part_tool".to_string(),
                    session_id: "s".to_string(),
                    message_id: "m1".to_string(),
                    part_type: "tool".to_string(),
                    call_id: Some("call_1".to_string()),
                    tool: Some("bash".to_string()),
                    state: Some(ToolPartState {
                        status: "completed".to_string(),
                        output: Some("done".to_string()),
                        error: None,
                    }),
                    text: None,
                }),
            },
        });

        assert_eq!(app.tool_calls.len(), 1);
        assert_eq!(app.tool_calls[0].status, ToolCallStatus::Completed);
        assert_eq!(app.tool_calls[0].result.as_deref(), Some("done"));
        assert_eq!(app.session_status, SessionStatus::Idle);
    }

    // === LOW 2: request_abort does not optimistically flip status ===

    #[test]
    fn test_request_abort_keeps_running_until_confirm() {
        let mut app = App::new();
        app.session_id = Some("s".to_string());
        app.session_status = SessionStatus::Running;
        let result = app.request_abort();
        assert!(result.is_some());
        assert!(matches!(app.session_status, SessionStatus::Running));
    }

    // === helper coverage ===

    #[test]
    fn test_byte_index_at_char_helper() {
        // 'a' = 1 byte, '日' = 3 bytes. char idx 2 -> byte idx 4.
        assert_eq!(byte_index_at_char("a日b", 0), 0);
        assert_eq!(byte_index_at_char("a日b", 1), 1);
        assert_eq!(byte_index_at_char("a日b", 2), 4);
        assert_eq!(byte_index_at_char("a日b", 3), 5); // end of string
        assert_eq!(byte_index_at_char("a日b", 99), 5); // past end -> len
    }
}
