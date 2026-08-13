//! Thin HTTP client for authenticated loopback runtime APIs.

use crate::auth::AuthConfig;
use crate::state::PermissionDecision;
use anyhow::{Context, Result, bail};
use bytes::Bytes;
use futures::StreamExt;
use reqwest::Client;
use serde_json::{Value, json};
use std::time::Duration;
use tokio::sync::mpsc;
use url::Url;

#[derive(Debug, Clone)]
pub struct RuntimeClient {
    http: Client,
    base: Url,
    auth: AuthConfig,
    directory: String,
}

impl RuntimeClient {
    pub fn new(base_url: &str, auth: AuthConfig, directory: impl Into<String>) -> Result<Self> {
        let base = Url::parse(base_url).context("parse base url")?;
        // No global request timeout: long-lived SSE must not be cut by a client-wide deadline.
        // Per-call timeouts are set on individual non-stream requests.
        let http = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .pool_max_idle_per_host(2)
            .build()
            .context("build http client")?;
        Ok(Self {
            http,
            base,
            auth,
            directory: directory.into(),
        })
    }

    fn url(&self, path: &str) -> Result<Url> {
        self.base
            .join(path.trim_start_matches('/'))
            .context("join url")
    }

    async fn request(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<reqwest::Response> {
        let url = self.url(path)?;
        let mut req = self
            .http
            .request(method, url)
            .timeout(Duration::from_secs(30))
            .header("Authorization", &self.auth.authorization_header)
            .header("x-ax-code-directory", &self.directory)
            .header("Content-Type", "application/json");
        if let Some(body) = body {
            req = req.json(&body);
        }
        let response = req.send().await.context("http send")?;
        Ok(response)
    }

    /// Lightweight connectivity check (OpenAPI or global health if present).
    pub async fn probe(&self) -> Result<()> {
        for path in ["/global/health", "/doc", "/"] {
            let response = self.request(reqwest::Method::GET, path, None).await?;
            let status = response.status().as_u16();
            if status == 401 || status == 403 {
                bail!("unauthorized: {}", response.status());
            }
            // Any non-auth response (including 404) proves TCP + auth stack.
            return Ok(());
        }
        Ok(())
    }

    pub async fn create_session(&self) -> Result<String> {
        let response = self
            .request(reqwest::Method::POST, "/session", Some(json!({})))
            .await?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            bail!("session create failed: {status} {body}");
        }
        let value: Value = response.json().await.context("session json")?;
        let id = value
            .get("id")
            .or_else(|| value.pointer("/info/id"))
            .and_then(|v| v.as_str())
            .context("session id missing")?
            .to_string();
        Ok(id)
    }

    pub async fn get_session(&self, session_id: &str) -> Result<()> {
        let path = format!("/session/{session_id}");
        let response = self.request(reqwest::Method::GET, &path, None).await?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            bail!("session get failed: {status} {body}");
        }
        Ok(())
    }

    pub async fn submit_prompt(&self, session_id: &str, text: &str) -> Result<()> {
        let path = format!("/session/{session_id}/prompt_async");
        let body = json!({
            "parts": [{ "type": "text", "text": text }]
        });
        let response = self
            .request(reqwest::Method::POST, &path, Some(body))
            .await?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            bail!("prompt failed: {status} {body}");
        }
        Ok(())
    }

    pub async fn abort(&self, session_id: &str) -> Result<()> {
        let path = format!("/session/{session_id}/abort");
        let response = self
            .request(reqwest::Method::POST, &path, Some(json!({})))
            .await?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            bail!("abort failed: {status} {body}");
        }
        Ok(())
    }

    pub async fn reply_permission(
        &self,
        request_id: &str,
        decision: PermissionDecision,
    ) -> Result<()> {
        let reply = match decision {
            PermissionDecision::Allow => "once",
            PermissionDecision::Deny => "reject",
        };
        let body = json!({
            "requestID": request_id,
            "reply": reply,
        });
        let response = self
            .request(reqwest::Method::POST, "/permission/reply", Some(body))
            .await?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            bail!("permission reply failed: {status} {body}");
        }
        Ok(())
    }

    /// Spawn a long-lived SSE reader that pushes parsed [`Action`]s onto `tx`.
    ///
    /// The task exits when the stream ends, the channel closes, or a hard HTTP error occurs.
    pub fn spawn_event_stream(&self, tx: mpsc::UnboundedSender<crate::action::Action>) -> tokio::task::JoinHandle<()> {
        let client = self.clone();
        tokio::spawn(async move {
            if let Err(err) = client.stream_events(tx).await {
                // Best-effort: surface stream death as a status line via StreamDelta-like error.
                // Callers may also observe silent end when the channel is dropped.
                let _ = err;
            }
        })
    }

    /// Stream `/event` Server-Sent Events and forward parsed actions.
    pub async fn stream_events(
        &self,
        tx: mpsc::UnboundedSender<crate::action::Action>,
    ) -> Result<()> {
        let url = self.url("/event")?;
        let response = self
            .http
            .get(url)
            .header("Authorization", &self.auth.authorization_header)
            .header("x-ax-code-directory", &self.directory)
            .header("Accept", "text/event-stream")
            .send()
            .await
            .context("sse connect")?;

        if !response.status().is_success() {
            bail!("sse subscribe failed: {}", response.status());
        }

        let mut stream = response.bytes_stream();
        let mut buffer = String::new();

        while let Some(chunk) = stream.next().await {
            let chunk: Bytes = chunk.context("sse chunk")?;
            buffer.push_str(&String::from_utf8_lossy(&chunk));

            // SSE events are delimited by a blank line.
            while let Some(idx) = buffer.find("\n\n") {
                let block = buffer[..idx].to_string();
                buffer = buffer[idx + 2..].to_string();
                for action in parse_sse_actions(&(block + "\n\n")) {
                    if tx.send(action).is_err() {
                        return Ok(());
                    }
                }
            }
        }
        Ok(())
    }

    /// Drain SSE for up to `deadline`, collecting actions (used by headless smoke).
    pub async fn collect_events_for(
        &self,
        deadline: Duration,
    ) -> Result<Vec<crate::action::Action>> {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let handle = self.spawn_event_stream(tx);
        let mut out = Vec::new();
        let sleep = tokio::time::sleep(deadline);
        tokio::pin!(sleep);
        loop {
            tokio::select! {
                _ = &mut sleep => break,
                maybe = rx.recv() => {
                    match maybe {
                        Some(action) => out.push(action),
                        None => break,
                    }
                }
            }
        }
        handle.abort();
        Ok(out)
    }
}

/// Parse Server-Sent Event payloads into UI actions (best-effort for Phase 2).
pub fn parse_sse_actions(raw: &str) -> Vec<crate::action::Action> {
    let mut out = Vec::new();
    for block in raw.split("\n\n") {
        let data = block
            .lines()
            .filter_map(|line| {
                line.strip_prefix("data:")
                    .or_else(|| line.strip_prefix("data: "))
            })
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(&data) else {
            continue;
        };
        let event_type = value
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        match event_type {
            "message.part.updated" | "message.part.delta" => {
                if let Some(text) = extract_text_delta(&value) {
                    out.push(crate::action::Action::StreamDelta { text });
                }
            }
            "permission.asked" => {
                let props = value.get("properties").unwrap_or(&value);
                let request_id = props
                    .get("id")
                    .or_else(|| props.get("requestID"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string();
                let summary = props
                    .get("permission")
                    .and_then(|v| v.as_str())
                    .or_else(|| props.get("title").and_then(|v| v.as_str()))
                    .unwrap_or("permission")
                    .to_string();
                out.push(crate::action::Action::PermissionAsked {
                    request_id,
                    summary,
                });
            }
            _ => {
                if let Some(text) = extract_text_delta(&value) {
                    out.push(crate::action::Action::StreamDelta { text });
                }
            }
        }
    }
    out
}

fn extract_text_delta(value: &Value) -> Option<String> {
    value
        .pointer("/properties/part/text")
        .or_else(|| value.pointer("/properties/delta"))
        .or_else(|| value.pointer("/properties/text"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::action::Action;
    use crate::auth::AuthConfig;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    #[test]
    fn parse_permission_sse() {
        let raw = r#"data: {"type":"permission.asked","properties":{"id":"r1","permission":"bash"}}

"#;
        let actions = parse_sse_actions(raw);
        assert_eq!(
            actions,
            vec![Action::PermissionAsked {
                request_id: "r1".into(),
                summary: "bash".into(),
            }]
        );
    }

    #[test]
    fn parse_text_delta_sse() {
        let raw = r#"data: {"type":"message.part.updated","properties":{"part":{"text":"hello"}}}

"#;
        let actions = parse_sse_actions(raw);
        assert_eq!(
            actions,
            vec![Action::StreamDelta {
                text: "hello".into()
            }]
        );
    }

    #[tokio::test]
    async fn stream_events_reads_live_sse_deltas() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = [0u8; 2048];
            let _ = stream.read(&mut buf);
            let body = concat!(
                "data: {\"type\":\"message.part.updated\",\"properties\":{\"part\":{\"text\":\"streamed-chunk\"}}}\n",
                "\n",
                "data: {\"type\":\"permission.asked\",\"properties\":{\"id\":\"p1\",\"permission\":\"bash\"}}\n",
                "\n",
            );
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.flush();
        });

        let auth = AuthConfig::from_parts(None, Some("ax-code"), Some("secret")).unwrap();
        let client = RuntimeClient::new(&format!("http://{addr}"), auth, "/tmp").unwrap();
        let (tx, mut rx) = mpsc::unbounded_channel();
        let handle = tokio::spawn(async move { client.stream_events(tx).await });

        let mut got = Vec::new();
        let deadline = tokio::time::Instant::now() + Duration::from_secs(2);
        while got.len() < 2 && tokio::time::Instant::now() < deadline {
            if let Ok(action) = tokio::time::timeout(Duration::from_millis(200), rx.recv()).await {
                if let Some(action) = action {
                    got.push(action);
                }
            }
        }
        let _ = handle.await;

        assert!(
            got.iter().any(|a| matches!(a, Action::StreamDelta { text } if text == "streamed-chunk")),
            "expected StreamDelta, got {got:?}"
        );
        assert!(
            got.iter().any(|a| matches!(a, Action::PermissionAsked { request_id, .. } if request_id == "p1")),
            "expected PermissionAsked, got {got:?}"
        );
    }
}
