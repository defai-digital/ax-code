//! Event handling for the TUI application state.
//!
//! This module extends `App` with event dispatch and message management methods,
//! split from `app.rs` to keep file sizes manageable.

use super::app::{
    App, AppMode, Message, MessageTextPart, PermissionRequest, QuestionRequest, SessionStatus,
    ToolCall, ToolCallStatus,
};
use crate::events::{MessageRole, RuntimeEvent};

impl App {
    pub(crate) fn reset_mode_if_idle(&mut self) {
        if self.pending_permissions.is_empty() && self.pending_questions.is_empty() {
            self.mode = AppMode::Input;
        } else if !self.pending_permissions.is_empty() {
            self.mode = AppMode::Permission;
        } else {
            self.mode = AppMode::Question;
        }
    }

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
                    self.status_message = Some("Session deleted".to_string());
                }
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
                if self.messages.is_empty() {
                    self.scroll_offset = 0;
                }
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
                // Upsert: if the call_id already exists (e.g. from an SSE
                // replay after reconnection), reset it to Running instead of
                // pushing a duplicate that would become a zombie entry.
                if let Some(existing) = self
                    .tool_calls
                    .iter_mut()
                    .find(|t| t.call_id == properties.call_id)
                {
                    existing.tool_name = properties.tool_name;
                    existing.status = ToolCallStatus::Running;
                    existing.result = None;
                    existing.error = None;
                } else {
                    self.tool_calls.push(ToolCall {
                        call_id: properties.call_id,
                        tool_name: properties.tool_name,
                        status: ToolCallStatus::Running,
                        result: None,
                        error: None,
                    });
                }
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
            RuntimeEvent::ServerReconnecting { retry_ms } => {
                self.status_message =
                    Some(format!("Event stream lost; reconnecting in {}ms", retry_ms));
            }
            RuntimeEvent::ServerDisconnected => {
                self.status_message = Some("Event stream disconnected".to_string());
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

    pub(crate) fn event_targets_current_session(&self, event_session_id: &str) -> bool {
        if event_session_id.is_empty() {
            return self.session_id.is_none();
        }
        match self.session_id.as_deref() {
            Some(current) => current == event_session_id,
            None => true,
        }
    }

    pub(crate) fn event_targets_current_session_option(
        &self,
        event_session_id: Option<&str>,
    ) -> bool {
        event_session_id
            .map(|session_id| self.event_targets_current_session(session_id))
            .unwrap_or_else(|| self.session_id.is_none())
    }

    pub(crate) fn message_targets_current_session(&self, message_id: &str) -> bool {
        self.session_id.is_none() || self.messages.iter().any(|m| m.id == message_id)
    }

    pub(crate) fn message_event_targets_current_session(
        &self,
        event_session_id: &str,
        message_id: &str,
    ) -> bool {
        if !event_session_id.is_empty() {
            return self.event_targets_current_session(event_session_id);
        }
        self.message_targets_current_session(message_id)
    }

    pub(crate) fn ensure_message(&mut self, message_id: &str) {
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

    pub(crate) fn upsert_message_text_part(&mut self, message_id: &str, part_id: &str, text: &str) {
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

    pub(crate) fn append_message_text_delta(
        &mut self,
        message_id: &str,
        part_id: &str,
        delta: &str,
    ) {
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

    pub(crate) fn rebuild_message_content(&mut self, message_id: &str) {
        if let Some(msg) = self.messages.iter_mut().find(|m| m.id == message_id) {
            msg.content = self
                .message_text_parts
                .iter()
                .filter(|part| part.message_id == message_id)
                .map(|part| part.text.as_str())
                .collect();
        }
    }

    pub(crate) fn upsert_tool_part(
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

    pub(crate) fn fail_running_tool_calls(&mut self, error: &str) {
        for tool_call in &mut self.tool_calls {
            if tool_call.status == ToolCallStatus::Running {
                tool_call.status = ToolCallStatus::Failed;
                tool_call.error = Some(error.to_string());
            }
        }
    }

    pub(crate) fn clear_active_session_state(&mut self) {
        self.session_id = None;
        self.session_title = None;
        self.session_status = SessionStatus::Idle;
        self.clear_session_runtime_state();
    }

    pub(crate) fn clear_session_runtime_state(&mut self) {
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
