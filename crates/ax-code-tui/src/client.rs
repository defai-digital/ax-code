//! HTTP/SSE client for the headless ax-code server.
//!
//! The client connects to the local headless runtime and provides:
//! - Session creation and resumption
//! - Event stream subscription (SSE)
//! - Prompt/command submission
//! - Permission and question responses

use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine};
use reqwest::{Client, StatusCode};
use serde::Serialize;
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
}

impl Default for ClientConfig {
    fn default() -> Self {
        Self {
            base_url: DEFAULT_SERVER_URL.to_string(),
            directory: None,
            auth_token: None,
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

impl HeadlessClient {
    /// Create a new client with the given configuration.
    pub fn new(config: ClientConfig) -> Result<Self> {
        let mut builder = Client::builder()
            .timeout(std::time::Duration::from_secs(30));

        if let Some(ref token) = config.auth_token {
            // Basic auth with empty username and token as password
            let header_value = format!("Basic {}", BASE64_STANDARD.encode(format!(":{}", token)));
            builder = builder.default_headers(
                [(reqwest::header::AUTHORIZATION, reqwest::header::HeaderValue::from_str(&header_value)?)]
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

    /// Connect to the server and verify availability.
    pub async fn connect(&self) -> Result<()> {
        let url = format!("{}/global/health", self.config.base_url);
        let response = self.http
            .get(&url)
            .send()
            .await
            .context("Failed to connect to headless server")?;

        if !response.status().is_success() {
            anyhow::bail!(
                "Headless server health check failed: {}",
                response.status()
            );
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
        let response = self.http
            .get(&url)
            .header(reqwest::header::ACCEPT, "text/event-stream")
            .header("X-Accel-Buffering", "no")
            .send()
            .await
            .context("Failed to subscribe to event stream")?;

        if !response.status().is_success() {
            anyhow::bail!(
                "Event subscription failed: {}",
                response.status()
            );
        }

        let (tx, rx) = mpsc::channel(256);

        // Spawn a task to parse SSE events
        tokio::spawn(async move {
            use futures_util::StreamExt;
            let mut stream = response.bytes_stream();

            while let Some(chunk_result) = stream.next().await {
                match chunk_result {
                    Ok(chunk) => {
                        let text = String::from_utf8_lossy(&chunk);
                        for event in parse_sse_events(&text) {
                            if tx.send(event).await.is_err() {
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

        let response = self.http
            .post(&url)
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
    pub async fn reply_permission(&self, session_id: &str, permission_id: &str, accepted: bool) -> Result<()> {
        let url = format!("{}/permission/reply", self.config.base_url);

        #[derive(Serialize)]
        struct PermissionReply {
            session_id: String,
            id: String,
            accepted: bool,
        }

        let response = self.http
            .post(&url)
            .json(&PermissionReply {
                session_id: session_id.to_string(),
                id: permission_id.to_string(),
                accepted,
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
    pub async fn reply_question(&self, session_id: &str, question_id: &str, answer: &str) -> Result<()> {
        let url = format!("{}/question/reply", self.config.base_url);

        #[derive(Serialize)]
        struct QuestionReply {
            session_id: String,
            id: String,
            answer: String,
        }

        let response = self.http
            .post(&url)
            .json(&QuestionReply {
                session_id: session_id.to_string(),
                id: question_id.to_string(),
                answer: answer.to_string(),
            })
            .send()
            .await
            .context("Failed to reply to question")?;

        if !response.status().is_success() {
            let text = response.text().await.unwrap_or_default();
            anyhow::bail!("Question reply failed: {}", text);
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

        let response = self.http
            .post(&url)
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

/// Parse SSE events from a text chunk.
fn parse_sse_events(text: &str) -> Vec<RuntimeEvent> {
    let mut events = Vec::new();

    for line in text.lines() {
        if let Some(data) = line.strip_prefix("data: ") {
            if let Ok(event) = serde_json::from_str::<RuntimeEvent>(data) {
                events.push(event);
            } else {
                tracing::debug!("Failed to parse SSE event: {}", data);
            }
        }
    }

    events
}
