//! HTTP/SSE client for the headless ax-code server.
//!
//! The client connects to the local headless runtime and provides:
//! - Session creation and resumption
//! - Event stream subscription (SSE)
//! - Prompt/command submission
//! - Permission and question responses

use anyhow::{Context, Result};
use base64::{Engine, engine::general_purpose::STANDARD as BASE64_STANDARD};
use reqwest::{
    Client, RequestBuilder, Response, StatusCode,
    header::{AUTHORIZATION, HeaderMap, HeaderName, HeaderValue},
};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

use crate::events::{
    MessageData, MessageInfo, MessagePartData, MessagePartInfo, MessageRole, RuntimeEvent,
};

/// Maximum number of consecutive SSE reconnection attempts before giving up.
/// With exponential backoff (1s→30s cap), 20 attempts ≈ 5–10 minutes.
const MAX_SSE_RETRIES: u32 = 20;

/// Default server URL for the headless runtime.
pub const DEFAULT_SERVER_URL: &str = "http://127.0.0.1:4096";
pub const RUNTIME_TOKEN_ENV: &str = "AX_CODE_RUNTIME_TOKEN";
pub const RUNTIME_TOKEN_HEADER: &str = "x-ax-code-runtime-token";

/// Configuration for connecting to the headless server.
#[derive(Debug, Clone)]
pub struct ClientConfig {
    pub base_url: String,
    pub directory: Option<String>,
    pub auth_token: Option<String>,
    /// Session ID to attach to (from --session CLI arg).
    pub session: Option<String>,
    /// Initial prompt to send (from --prompt CLI arg).
    pub prompt: Option<String>,
}

impl Default for ClientConfig {
    fn default() -> Self {
        Self {
            base_url: DEFAULT_SERVER_URL.to_string(),
            directory: None,
            auth_token: None,
            session: None,
            prompt: None,
        }
    }
}

/// A stream of runtime events from the headless server.
pub type EventStream = std::pin::Pin<Box<dyn futures_util::Stream<Item = RuntimeEvent> + Send>>;

/// HTTP/SSE client for the headless ax-code server.
#[derive(Clone)]
pub struct HeadlessClient {
    config: ClientConfig,
    http: Client,
    event_http: Client,
}

#[derive(Debug, Deserialize)]
struct SessionListItem {
    id: String,
}

/// Explicit provider/model selection for a prompt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ModelSelection {
    #[serde(rename = "providerID")]
    pub provider_id: String,
    #[serde(rename = "modelID")]
    pub model_id: String,
}

/// Optional per-prompt routing choices forwarded to the existing AX runtime.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PromptOptions {
    pub model: Option<ModelSelection>,
    pub agent: Option<String>,
}

/// Parse the CLI's `provider/model` syntax without losing model IDs that also
/// contain slashes.
pub fn parse_model_selection(value: &str) -> Result<ModelSelection> {
    let (provider_id, model_id) = value
        .split_once('/')
        .ok_or_else(|| anyhow::anyhow!("model must use provider/model format"))?;
    if provider_id.trim().is_empty() || model_id.trim().is_empty() {
        anyhow::bail!("model must use provider/model format");
    }
    Ok(ModelSelection {
        provider_id: provider_id.to_string(),
        model_id: model_id.to_string(),
    })
}

impl HeadlessClient {
    /// Create a new client with the given configuration.
    pub fn new(config: ClientConfig) -> Result<Self> {
        let mut headers = HeaderMap::new();

        if let Some(ref token) = config.auth_token {
            let username =
                std::env::var("AX_CODE_SERVER_USERNAME").unwrap_or_else(|_| "ax-code".to_string());
            let header_value = format!(
                "Basic {}",
                BASE64_STANDARD.encode(format!("{username}:{token}"))
            );
            headers.insert(AUTHORIZATION, HeaderValue::from_str(&header_value)?);
        }

        if let Ok(token) = std::env::var(RUNTIME_TOKEN_ENV) {
            if !token.trim().is_empty() {
                headers.insert(
                    HeaderName::from_static(RUNTIME_TOKEN_HEADER),
                    HeaderValue::from_str(&token)?,
                );
            }
        }
        let http = Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .default_headers(headers.clone())
            .build()?;
        // SSE is intentionally long-lived. A client-wide 30-second timeout
        // made healthy sessions reconnect forever, so the event transport has
        // no total request timeout while ordinary API calls remain bounded.
        let event_http = Client::builder().default_headers(headers).build()?;
        Ok(Self {
            config,
            http,
            event_http,
        })
    }

    /// Get the base URL of the headless server.
    pub fn base_url(&self) -> &str {
        &self.config.base_url
    }

    fn with_directory_query(&self, request: RequestBuilder) -> RequestBuilder {
        if let Some(directory) = self.config.directory.as_deref() {
            request.query(&[("directory", directory)])
        } else {
            request
        }
    }

    /// Connect to the server and verify availability.
    pub async fn connect(&self) -> Result<()> {
        let url = format!("{}/global/health", self.config.base_url);
        let response = self
            .with_directory_query(self.http.get(&url))
            .send()
            .await
            .context("Failed to connect to headless server")?;

        if !response.status().is_success() {
            anyhow::bail!("Headless server health check failed: {}", response.status());
        }

        Ok(())
    }

    /// Subscribe to the runtime event stream.
    ///
    /// Returns a stream of runtime events from the headless server.
    /// The stream will emit events as they occur and can be cancelled
    /// by dropping the returned receiver.
    pub async fn subscribe(&self) -> Result<mpsc::Receiver<RuntimeEvent>> {
        let initial_response = self.open_event_stream().await?;
        let (tx, rx) = mpsc::channel(256);
        let client = self.clone();

        tokio::spawn(async move {
            let mut retry_ms = 1_000_u64;
            let mut retries = 0_u32;
            let mut next_response = Some(initial_response);
            loop {
                match match next_response.take() {
                    Some(response) => Ok(response),
                    None => client.open_event_stream().await,
                } {
                    Ok(response) => {
                        retry_ms = 1_000;
                        retries = 0;
                        if tx.send(RuntimeEvent::ServerConnected).await.is_err() {
                            return;
                        }
                        if !drain_sse_response(response, &tx).await {
                            return;
                        }
                    }
                    Err(e) => {
                        retries += 1;
                        tracing::error!(
                            "SSE subscription failed (attempt {}/{}): {}",
                            retries,
                            MAX_SSE_RETRIES,
                            e
                        );
                        if retries >= MAX_SSE_RETRIES {
                            tracing::error!("SSE reconnect limit reached; giving up");
                            let _ = tx.send(RuntimeEvent::ServerDisconnected).await;
                            return;
                        }
                    }
                }

                if tx
                    .send(RuntimeEvent::ServerReconnecting { retry_ms })
                    .await
                    .is_err()
                {
                    return;
                }
                tokio::time::sleep(std::time::Duration::from_millis(retry_ms)).await;
                retry_ms = (retry_ms * 2).min(30_000);
            }
        });

        Ok(rx)
    }

    async fn open_event_stream(&self) -> Result<Response> {
        let url = format!("{}/global/event", self.config.base_url);
        let request = self
            .with_directory_query(self.event_http.get(&url))
            .header(reqwest::header::ACCEPT, "text/event-stream")
            .header("X-Accel-Buffering", "no");
        let response = request
            .send()
            .await
            .context("Failed to subscribe to event stream")?;

        if !response.status().is_success() {
            anyhow::bail!("Event subscription failed: {}", response.status());
        }

        Ok(response)
    }

    pub async fn session_transcript_events(&self, session_id: &str) -> Result<Vec<RuntimeEvent>> {
        let url = format!(
            "{}/session/{}/message",
            self.config.base_url,
            urlencoding::encode(session_id)
        );
        let response = self
            .with_directory_query(self.http.get(&url).query(&[("limit", "100")]))
            .send()
            .await
            .context("Failed to load session messages")?;

        if !response.status().is_success() {
            let text = response.text().await.unwrap_or_default();
            anyhow::bail!("Session message load failed: {}", text);
        }

        let messages: Vec<serde_json::Value> = response
            .json()
            .await
            .context("Failed to parse session messages")?;
        Ok(transcript_events_from_messages(messages))
    }

    /// Create a new session on the server.
    ///
    /// Returns the newly assigned session ID. The server's
    /// `SessionCreated` SSE event will also arrive on the subscribed
    /// event stream, which the `App` uses to populate transcript state.
    pub async fn create_session(&self) -> Result<String> {
        let url = format!("{}/session", self.config.base_url);
        let response = self
            .with_directory_query(self.http.post(&url))
            .send()
            .await
            .context("Failed to create session")?;

        if !response.status().is_success() {
            let text = response.text().await.unwrap_or_default();
            anyhow::bail!("Session creation failed: {}", text);
        }

        let body: serde_json::Value = response
            .json()
            .await
            .context("Failed to parse session creation response")?;
        body["id"]
            .as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| anyhow::anyhow!("Session creation response missing 'id'"))
    }

    /// List recent root sessions for the configured workspace directory.
    ///
    /// The headless `/session` route is already sorted by most recently updated,
    /// so callers can pass these IDs directly to launch policy auto-resume.
    pub async fn list_recent_session_ids(&self) -> Result<Vec<String>> {
        let url = format!("{}/session", self.config.base_url);
        let request = self
            .http
            .get(&url)
            .query(&[("roots", "true"), ("limit", "100")]);
        let request = self.with_directory_query(request);

        let response = request.send().await.context("Failed to list sessions")?;

        if !response.status().is_success() {
            let text = response.text().await.unwrap_or_default();
            anyhow::bail!("Session list failed: {}", text);
        }

        let sessions: Vec<SessionListItem> = response
            .json()
            .await
            .context("Failed to parse session list response")?;
        Ok(sessions
            .into_iter()
            .filter_map(|session| {
                let id = session.id.trim();
                if id.is_empty() {
                    None
                } else {
                    Some(id.to_string())
                }
            })
            .collect())
    }

    /// Fork an existing session and return the new session ID.
    pub async fn fork_session(&self, session_id: &str) -> Result<String> {
        let url = format!(
            "{}/session/{}/fork",
            self.config.base_url,
            urlencoding::encode(session_id)
        );
        let response = self
            .with_directory_query(self.http.post(&url))
            .json(&serde_json::json!({}))
            .send()
            .await
            .context("Failed to fork session")?;

        if !response.status().is_success() {
            let text = response.text().await.unwrap_or_default();
            anyhow::bail!("Session fork failed: {text}");
        }

        let body: serde_json::Value = response
            .json()
            .await
            .context("Failed to parse session fork response")?;
        body["id"]
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| anyhow::anyhow!("Session fork response missing 'id'"))
    }

    /// Send a prompt to the current session using the runtime's structured
    /// prompt schema.
    pub async fn send_prompt(&self, session_id: &str, prompt: &str) -> Result<()> {
        self.send_prompt_with_options(session_id, prompt, &PromptOptions::default())
            .await
    }

    pub async fn send_prompt_with_options(
        &self,
        session_id: &str,
        prompt: &str,
        options: &PromptOptions,
    ) -> Result<()> {
        let url = format!(
            "{}/session/{}/prompt_async",
            self.config.base_url,
            urlencoding::encode(session_id)
        );

        #[derive(Serialize)]
        struct PromptPart<'a> {
            #[serde(rename = "type")]
            part_type: &'static str,
            text: &'a str,
        }

        #[derive(Serialize)]
        struct PromptBody<'a> {
            parts: Vec<PromptPart<'a>>,
            #[serde(skip_serializing_if = "Option::is_none")]
            model: Option<&'a ModelSelection>,
            #[serde(skip_serializing_if = "Option::is_none")]
            agent: Option<&'a str>,
        }

        let response = self
            .with_directory_query(self.http.post(&url))
            .json(&PromptBody {
                parts: vec![PromptPart {
                    part_type: "text",
                    text: prompt,
                }],
                model: options.model.as_ref(),
                agent: options.agent.as_deref(),
            })
            .send()
            .await
            .context("Failed to send prompt")?;

        if !response.status().is_success() && response.status() != StatusCode::ACCEPTED {
            let text = response.text().await.unwrap_or_default();
            anyhow::bail!("Prompt submission failed: {}", text);
        }

        Ok(())
    }

    /// Reply to a permission request.
    pub async fn reply_permission(
        &self,
        _session_id: &str,
        permission_id: &str,
        accepted: bool,
    ) -> Result<()> {
        let url = format!(
            "{}/permission/{}/reply",
            self.config.base_url,
            urlencoding::encode(permission_id)
        );

        #[derive(Serialize)]
        struct PermissionReply {
            reply: &'static str,
        }

        let response = self
            .with_directory_query(self.http.post(&url))
            .json(&PermissionReply {
                reply: if accepted { "once" } else { "reject" },
            })
            .send()
            .await
            .context("Failed to reply to permission")?;

        if !response.status().is_success() {
            let text = response.text().await.unwrap_or_default();
            anyhow::bail!("Permission reply failed: {}", text);
        }

        Ok(())
    }

    /// Reply to a question.
    pub async fn reply_question(
        &self,
        _session_id: &str,
        question_id: &str,
        answers: Vec<Vec<String>>,
    ) -> Result<()> {
        let url = format!(
            "{}/question/{}/reply",
            self.config.base_url,
            urlencoding::encode(question_id)
        );

        #[derive(Serialize)]
        struct QuestionReply {
            answers: Vec<Vec<String>>,
        }

        let response = self
            .with_directory_query(self.http.post(&url))
            .json(&QuestionReply { answers })
            .send()
            .await
            .context("Failed to reply to question")?;

        if !response.status().is_success() {
            let text = response.text().await.unwrap_or_default();
            anyhow::bail!("Question reply failed: {}", text);
        }

        Ok(())
    }

    /// Reject a question without providing an answer.
    pub async fn reject_question(&self, _session_id: &str, question_id: &str) -> Result<()> {
        let url = format!(
            "{}/question/{}/reject",
            self.config.base_url,
            urlencoding::encode(question_id)
        );

        let response = self
            .with_directory_query(self.http.post(&url))
            .send()
            .await
            .context("Failed to reject question")?;

        if !response.status().is_success() {
            let text = response.text().await.unwrap_or_default();
            anyhow::bail!("Question reject failed: {}", text);
        }

        Ok(())
    }

    /// Abort the current session.
    pub async fn abort_session(&self, session_id: &str) -> Result<()> {
        let url = format!(
            "{}/session/{}/abort",
            self.config.base_url,
            urlencoding::encode(session_id)
        );

        let response = self
            .with_directory_query(self.http.post(&url))
            .send()
            .await
            .context("Failed to abort session")?;

        if !response.status().is_success() && response.status() != StatusCode::ACCEPTED {
            let text = response.text().await.unwrap_or_default();
            anyhow::bail!("Abort failed: {}", text);
        }

        Ok(())
    }
}

async fn drain_sse_response(response: Response, tx: &mpsc::Sender<RuntimeEvent>) -> bool {
    use futures_util::StreamExt;
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk_result) = stream.next().await {
        match chunk_result {
            Ok(chunk) => {
                buffer.push_str(&String::from_utf8_lossy(&chunk));
                let events = drain_complete_sse_lines(&mut buffer);
                for event in events {
                    if tx.send(event).await.is_err() {
                        return false;
                    }
                }
            }
            Err(e) => {
                tracing::error!("SSE stream error: {}", e);
                return true;
            }
        }
    }
    true
}

fn transcript_events_from_messages(messages: Vec<serde_json::Value>) -> Vec<RuntimeEvent> {
    let mut events = Vec::new();
    for message in messages {
        let Some(info) = message.get("info") else {
            continue;
        };
        let Some(id) = info.get("id").and_then(serde_json::Value::as_str) else {
            continue;
        };
        let Some(session_id) = info.get("sessionID").and_then(serde_json::Value::as_str) else {
            continue;
        };
        let role = info
            .get("role")
            .and_then(|role| serde_json::from_value::<MessageRole>(role.clone()).ok());

        events.push(RuntimeEvent::MessageUpdated {
            properties: MessageInfo {
                info: Some(MessageData {
                    id: id.to_string(),
                    session_id: session_id.to_string(),
                    role,
                }),
            },
        });

        let Some(parts) = message.get("parts").and_then(serde_json::Value::as_array) else {
            continue;
        };
        for part in parts {
            let Some(part_id) = part.get("id").and_then(serde_json::Value::as_str) else {
                continue;
            };
            let Some(part_type) = part.get("type").and_then(serde_json::Value::as_str) else {
                continue;
            };
            if part_type != "text" && part_type != "reasoning" {
                continue;
            }
            events.push(RuntimeEvent::MessagePartUpdated {
                properties: MessagePartInfo {
                    part: Some(MessagePartData {
                        id: part_id.to_string(),
                        session_id: session_id.to_string(),
                        message_id: id.to_string(),
                        part_type: part_type.to_string(),
                        call_id: None,
                        tool: None,
                        state: None,
                        text: part
                            .get("text")
                            .and_then(serde_json::Value::as_str)
                            .map(str::to_string),
                    }),
                },
            });
        }
    }
    events
}

/// Drain complete SSE lines from `buffer`, leaving any partial trailing line
/// in the buffer for the next chunk.
///
/// SSE frames are newline-terminated. TCP/SSE chunks are NOT aligned to line
/// boundaries, so callers must keep a running buffer: feed each incoming chunk
/// into it, then call this to extract the events from the now-complete lines.
/// Lines ending with `\r\n` (CRLF) are handled by trimming a trailing `\r`.
/// Lines that do not start with `data: ` (comments, `event:`, `id:`, blank
/// keep-alive lines) are ignored. Unparseable `data:` payloads are logged at
/// debug level and skipped so one bad event can't kill the whole stream.
pub(crate) fn drain_complete_sse_lines(buffer: &mut String) -> Vec<RuntimeEvent> {
    let mut events = Vec::new();

    while let Some(newline_pos) = buffer.find('\n') {
        let line = buffer[..newline_pos].trim_end_matches('\r').to_string();
        // Advance the buffer past the consumed line + its newline.
        buffer.drain(..newline_pos + 1);

        if let Some(data) = line
            .strip_prefix("data:")
            .map(str::trim_start)
            .filter(|data| !data.is_empty())
        {
            match parse_sse_runtime_event(data) {
                Some(event) => events.push(event),
                None => tracing::debug!("Failed to parse SSE event: {}", data),
            }
        }
    }

    events
}

fn parse_sse_runtime_event(data: &str) -> Option<RuntimeEvent> {
    if let Ok(event) = serde_json::from_str::<RuntimeEvent>(data) {
        return Some(event);
    }

    let value = serde_json::from_str::<serde_json::Value>(data).ok()?;
    for key in ["payload", "details"] {
        if let Some(inner) = value.get(key) {
            if let Ok(event) = serde_json::from_value::<RuntimeEvent>(inner.clone()) {
                return Some(event);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    // === MEDIUM 3: cross-chunk SSE buffering ===

    #[test]
    fn test_sse_single_complete_line() {
        let mut buf = "data: {\"type\":\"server.heartbeat\"}\n".to_string();
        let events = drain_complete_sse_lines(&mut buf);
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], RuntimeEvent::ServerHeartbeat));
        assert!(buf.is_empty());
    }

    #[test]
    fn test_sse_event_split_across_chunks() {
        // The exact regression from the original bug: one `data:` line arrives
        // split across two chunks. The first chunk must NOT parse anything and
        // must retain the partial line in the buffer; the second completes it.
        let mut buf = "data: {\"type\":\"server".to_string();
        let first = drain_complete_sse_lines(&mut buf);
        assert!(first.is_empty(), "no complete line yet");
        assert!(!buf.is_empty(), "partial line retained");

        buf.push_str(".heartbeat\"}\n");
        let second = drain_complete_sse_lines(&mut buf);
        assert_eq!(second.len(), 1);
        assert!(matches!(second[0], RuntimeEvent::ServerHeartbeat));
        assert!(buf.is_empty());
    }

    #[test]
    fn test_sse_handles_crlf_endings() {
        let mut buf = "data: {\"type\":\"server.connected\"}\r\n".to_string();
        let events = drain_complete_sse_lines(&mut buf);
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], RuntimeEvent::ServerConnected));
    }

    #[test]
    fn test_sse_accepts_data_without_space() {
        // SSE allows "data:<payload>" as well as "data: <payload>". Some
        // proxies normalize the whitespace, so the parser must accept both.
        let mut buf = "data:{\"type\":\"server.heartbeat\"}\n".to_string();
        let events = drain_complete_sse_lines(&mut buf);
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], RuntimeEvent::ServerHeartbeat));
    }

    #[test]
    fn test_sse_unwraps_global_payload_envelope() {
        // /global/event emits {"payload": RuntimeEvent}; parsing only the
        // outer object drops every real event from that stream.
        let mut buf =
            "data: {\"payload\":{\"type\":\"server.connected\",\"properties\":{}}}\n".to_string();
        let events = drain_complete_sse_lines(&mut buf);
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], RuntimeEvent::ServerConnected));
    }

    #[test]
    fn test_sse_unwraps_headless_details_envelope() {
        // The headless runtime type also documents a details envelope. Keep
        // this accepted so desktop/headless emitters can share the client.
        let mut buf =
            "data: {\"details\":{\"type\":\"server.heartbeat\",\"properties\":{}}}\n".to_string();
        let events = drain_complete_sse_lines(&mut buf);
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], RuntimeEvent::ServerHeartbeat));
    }

    #[test]
    fn test_sse_ignores_non_data_lines() {
        // Comments (:), event/id fields, and blank keep-alive lines must be
        // skipped without erroring — only `data:` payloads become events.
        let mut buf = [
            ": keep-alive",
            "event: message",
            "id: 42",
            "",
            "data: {\"type\":\"server.heartbeat\"}",
            "",
        ]
        .join("\n");
        buf.push('\n');
        let events = drain_complete_sse_lines(&mut buf);
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], RuntimeEvent::ServerHeartbeat));
    }

    #[test]
    fn test_sse_skips_unparseable_payload() {
        // One malformed event must not break the stream; the next valid one
        // still parses.
        let mut buf = [
            "data: {not valid json}",
            "data: {\"type\":\"server.heartbeat\"}",
        ]
        .join("\n");
        buf.push('\n');
        let events = drain_complete_sse_lines(&mut buf);
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], RuntimeEvent::ServerHeartbeat));
    }

    #[test]
    fn test_sse_multiple_events_one_chunk() {
        let mut buf = [
            "data: {\"type\":\"server.connected\"}",
            "data: {\"type\":\"server.heartbeat\"}",
            "data: {\"type\":\"server.heartbeat\"}",
        ]
        .join("\n");
        buf.push('\n');
        let events = drain_complete_sse_lines(&mut buf);
        assert_eq!(events.len(), 3);
        assert!(matches!(events[0], RuntimeEvent::ServerConnected));
        assert!(matches!(events[1], RuntimeEvent::ServerHeartbeat));
        assert!(matches!(events[2], RuntimeEvent::ServerHeartbeat));
    }
}
