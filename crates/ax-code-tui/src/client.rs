//! HTTP/SSE client for the headless ax-code server.
//!
//! The client connects to the local headless runtime and provides:
//! - Session creation and resumption
//! - Event stream subscription (SSE)
//! - Prompt/command submission
//! - Permission and question responses

use anyhow::{Context, Result};
use base64::{Engine, engine::general_purpose::STANDARD as BASE64_STANDARD};
use reqwest::{Client, RequestBuilder, StatusCode};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

use crate::events::RuntimeEvent;

/// Default server URL for the headless runtime.
pub const DEFAULT_SERVER_URL: &str = "http://127.0.0.1:4096";

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
pub struct HeadlessClient {
    config: ClientConfig,
    http: Client,
}

#[derive(Debug, Deserialize)]
struct SessionListItem {
    id: String,
}

impl HeadlessClient {
    /// Create a new client with the given configuration.
    pub fn new(config: ClientConfig) -> Result<Self> {
        let mut builder = Client::builder().timeout(std::time::Duration::from_secs(30));

        if let Some(ref token) = config.auth_token {
            // Basic auth with empty username and token as password
            let header_value = format!("Basic {}", BASE64_STANDARD.encode(format!(":{}", token)));
            builder = builder.default_headers(
                [(
                    reqwest::header::AUTHORIZATION,
                    reqwest::header::HeaderValue::from_str(&header_value)?,
                )]
                .into_iter()
                .collect(),
            );
        }

        let http = builder.build()?;
        Ok(Self { config, http })
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
            .http
            .get(&url)
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
        let url = format!("{}/global/event", self.config.base_url);
        let response = self
            .http
            .get(&url)
            .header(reqwest::header::ACCEPT, "text/event-stream")
            .header("X-Accel-Buffering", "no")
            .send()
            .await
            .context("Failed to subscribe to event stream")?;

        if !response.status().is_success() {
            anyhow::bail!("Event subscription failed: {}", response.status());
        }

        let (tx, rx) = mpsc::channel(256);

        // Spawn a task to parse SSE events. A carry-over buffer is required
        // because reqwest's `bytes_stream()` splits on network chunk
        // boundaries, which are NOT aligned to SSE line boundaries. A single
        // `data: {...}\n` line commonly arrives across two chunks.
        tokio::spawn(async move {
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
                                // Receiver dropped: TUI is shutting down.
                                return;
                            }
                        }
                    }
                    Err(e) => {
                        tracing::error!("SSE stream error: {}", e);
                        return;
                    }
                }
            }
        });

        Ok(rx)
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

    /// Send a prompt to the current session.
    pub async fn send_prompt(&self, session_id: &str, prompt: &str) -> Result<()> {
        let url = format!(
            "{}/session/{}/prompt_async",
            self.config.base_url,
            urlencoding::encode(session_id)
        );

        #[derive(Serialize)]
        struct PromptBody {
            prompt: String,
        }

        let response = self
            .with_directory_query(self.http.post(&url))
            .json(&PromptBody {
                prompt: prompt.to_string(),
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
            .http
            .post(&url)
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
            .http
            .post(&url)
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
            .http
            .post(&url)
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
        *buffer = buffer[newline_pos + 1..].to_string();

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
