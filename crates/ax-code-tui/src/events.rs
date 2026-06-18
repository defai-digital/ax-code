//! Runtime event types from the headless server.
//!
//! These events drive the TUI state. The TUI subscribes to SSE events
//! and updates its rendering accordingly.
//!
//! Event format: `{ "type": "event.name", "properties": { ... } }`

use serde::{Deserialize, Serialize};

/// A runtime event from the headless server.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum RuntimeEvent {
    // === Session events ===
    /// Session created.
    #[serde(rename = "session.created")]
    SessionCreated {
        #[serde(default)]
        properties: SessionInfo,
    },

    /// Session updated.
    #[serde(rename = "session.updated")]
    SessionUpdated {
        #[serde(default)]
        properties: SessionInfo,
    },

    /// Session deleted.
    #[serde(rename = "session.deleted")]
    SessionDeleted {
        #[serde(default)]
        properties: SessionInfo,
    },

    /// Session status changed.
    #[serde(rename = "session.status")]
    SessionStatus {
        #[serde(default)]
        properties: SessionStatusProps,
    },

    /// Session error.
    #[serde(rename = "session.error")]
    SessionError {
        #[serde(default)]
        properties: SessionErrorProps,
    },

    // === Message events ===
    /// Message updated.
    #[serde(rename = "message.updated")]
    MessageUpdated {
        #[serde(default)]
        properties: MessageInfo,
    },

    /// Message removed.
    #[serde(rename = "message.removed")]
    MessageRemoved {
        #[serde(default)]
        properties: MessageRemovedProps,
    },

    /// Message part updated.
    #[serde(rename = "message.part.updated")]
    MessagePartUpdated {
        #[serde(default)]
        properties: MessagePartInfo,
    },

    /// Message part delta (streaming).
    #[serde(rename = "message.part.delta")]
    MessagePartDelta {
        #[serde(default)]
        properties: MessagePartDeltaProps,
    },

    /// Message part removed.
    #[serde(rename = "message.part.removed")]
    MessagePartRemoved {
        #[serde(default)]
        properties: MessagePartRemovedProps,
    },

    // === Permission/Question events ===
    /// Permission requested.
    #[serde(rename = "permission.asked")]
    PermissionAsked {
        #[serde(default)]
        properties: PermissionRequestProps,
    },

    /// Permission replied.
    #[serde(rename = "permission.replied")]
    PermissionReplied {
        #[serde(default)]
        properties: RequestReplyProps,
    },

    /// Question requested.
    #[serde(rename = "question.asked")]
    QuestionAsked {
        #[serde(default)]
        properties: QuestionRequestProps,
    },

    /// Question replied.
    #[serde(rename = "question.replied")]
    QuestionReplied {
        #[serde(default)]
        properties: RequestReplyProps,
    },

    /// Question rejected.
    #[serde(rename = "question.rejected")]
    QuestionRejected {
        #[serde(default)]
        properties: RequestReplyProps,
    },

    // === Todo events ===
    /// Todo list updated.
    #[serde(rename = "todo.updated")]
    TodoUpdated {
        #[serde(default)]
        properties: TodoUpdatedProps,
    },

    // === Diff events ===
    /// Session diff updated.
    #[serde(rename = "session.diff")]
    SessionDiff {
        #[serde(default)]
        properties: SessionDiffProps,
    },

    // === Tool call events ===
    /// Tool call started.
    #[serde(rename = "tool.call.start")]
    ToolCallStart {
        #[serde(default)]
        properties: ToolCallStartProps,
    },

    /// Tool call completed.
    #[serde(rename = "tool.call.complete")]
    ToolCallComplete {
        #[serde(default)]
        properties: ToolCallCompleteProps,
    },

    // === Control events ===
    /// Server connected.
    #[serde(rename = "server.connected")]
    ServerConnected,

    /// Server heartbeat.
    #[serde(rename = "server.heartbeat")]
    ServerHeartbeat,

    /// Server instance disposed.
    #[serde(rename = "server.instance.disposed")]
    ServerInstanceDisposed,

    /// Unknown event (forward compatibility).
    #[serde(other)]
    Unknown,
}

// === Property structs ===

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SessionInfo {
    #[serde(default)]
    pub info: Option<SessionData>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SessionData {
    pub id: String,
    #[serde(default)]
    pub title: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SessionStatusProps {
    #[serde(rename = "sessionID", default)]
    pub session_id: String,
    #[serde(default)]
    pub status: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SessionErrorProps {
    #[serde(rename = "sessionID", default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub error: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MessageInfo {
    #[serde(default)]
    pub info: Option<MessageData>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MessageData {
    pub id: String,
    #[serde(rename = "sessionID", default)]
    pub session_id: String,
    #[serde(default)]
    pub role: Option<MessageRole>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MessageRemovedProps {
    #[serde(rename = "sessionID", default)]
    pub session_id: String,
    #[serde(rename = "messageID", default)]
    pub message_id: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MessagePartInfo {
    #[serde(default)]
    pub part: Option<MessagePartData>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MessagePartData {
    pub id: String,
    #[serde(rename = "sessionID", default)]
    pub session_id: String,
    #[serde(rename = "messageID", default)]
    pub message_id: String,
    #[serde(rename = "type", default)]
    pub part_type: String,
    #[serde(rename = "callID", default)]
    pub call_id: Option<String>,
    #[serde(default)]
    pub tool: Option<String>,
    #[serde(default)]
    pub state: Option<ToolPartState>,
    #[serde(default)]
    pub text: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ToolPartState {
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub output: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MessagePartDeltaProps {
    #[serde(rename = "sessionID", default)]
    pub session_id: String,
    #[serde(rename = "messageID", default)]
    pub message_id: String,
    #[serde(rename = "partID", default)]
    pub part_id: String,
    #[serde(default)]
    pub field: String,
    #[serde(default)]
    pub delta: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MessagePartRemovedProps {
    #[serde(rename = "sessionID", default)]
    pub session_id: String,
    #[serde(rename = "messageID", default)]
    pub message_id: String,
    #[serde(rename = "partID", default)]
    pub part_id: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PermissionRequestProps {
    #[serde(rename = "sessionID", default)]
    pub session_id: String,
    #[serde(default, alias = "requestID")]
    pub id: String,
    #[serde(default)]
    pub description: String,
    #[serde(
        default,
        rename = "permission_type",
        alias = "permissionType",
        alias = "permission"
    )]
    pub permission_type: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct QuestionRequestProps {
    pub session_id: String,
    pub id: String,
    pub question: String,
    pub options: Vec<String>,
}

impl QuestionRequestProps {
    pub fn display_question(&self) -> String {
        self.question.clone()
    }

    pub fn display_options(&self) -> Vec<String> {
        self.options.clone()
    }
}

impl<'de> Deserialize<'de> for QuestionRequestProps {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Default, Deserialize)]
        struct RawQuestionRequestProps {
            #[serde(rename = "sessionID", default)]
            session_id: String,
            #[serde(default, alias = "requestID")]
            id: String,
            #[serde(default)]
            question: String,
            #[serde(default)]
            options: Vec<String>,
            #[serde(default)]
            questions: Vec<QuestionInfoProps>,
        }

        let raw = RawQuestionRequestProps::deserialize(deserializer)?;
        let first_question = raw.questions.first();
        let question = if !raw.question.is_empty() {
            raw.question
        } else {
            first_question
                .map(|q| {
                    if !q.question.is_empty() {
                        q.question.clone()
                    } else {
                        q.header.clone()
                    }
                })
                .unwrap_or_default()
        };

        let options = if !raw.options.is_empty() {
            raw.options
        } else {
            first_question
                .map(|q| {
                    q.options
                        .iter()
                        .map(|option| option.label.clone())
                        .collect()
                })
                .unwrap_or_default()
        };

        Ok(Self {
            session_id: raw.session_id,
            id: raw.id,
            question,
            options,
        })
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
struct QuestionInfoProps {
    #[serde(default)]
    question: String,
    #[serde(default)]
    header: String,
    #[serde(default)]
    options: Vec<QuestionOptionProps>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct QuestionOptionProps {
    #[serde(default)]
    label: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RequestReplyProps {
    #[serde(rename = "sessionID", default)]
    pub session_id: String,
    #[serde(rename = "requestID", default)]
    pub request_id: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TodoUpdatedProps {
    #[serde(rename = "sessionID", default)]
    pub session_id: String,
    #[serde(default)]
    pub todos: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SessionDiffProps {
    #[serde(rename = "sessionID", default)]
    pub session_id: String,
    #[serde(default)]
    pub diff: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ToolCallStartProps {
    #[serde(rename = "sessionID", default)]
    pub session_id: String,
    #[serde(rename = "callID", alias = "call_id", default)]
    pub call_id: String,
    #[serde(rename = "toolName", alias = "tool_name", default)]
    pub tool_name: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ToolCallCompleteProps {
    #[serde(rename = "sessionID", default)]
    pub session_id: String,
    #[serde(rename = "callID", alias = "call_id", default)]
    pub call_id: String,
    #[serde(rename = "toolName", alias = "tool_name", default)]
    pub tool_name: String,
    #[serde(default)]
    pub result: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
}

/// Message role in a session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    User,
    Assistant,
    System,
}
