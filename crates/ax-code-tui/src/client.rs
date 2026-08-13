//! Thin HTTP client for authenticated loopback runtime APIs.

use crate::auth::AuthConfig;
use crate::state::PermissionDecision;
use anyhow::{Context, Result, bail};
use reqwest::Client;
use serde_json::{Value, json};
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
        let http = Client::builder()
            .timeout(std::time::Duration::from_secs(30))
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
        self.base.join(path.trim_start_matches('/')).context("join url")
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
        // Prefer a cheap GET that exists on the server. Fall back through a few.
        for path in ["/global/health", "/doc", "/"] {
            let response = self.request(reqwest::Method::GET, path, None).await?;
            if response.status().is_success() || response.status().as_u16() == 404 {
                // 404 still proves the TCP/auth stack responded.
                if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
                    bail!("unauthorized: {}", response.status());
                }
                return Ok(());
            }
            if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
                bail!("unauthorized: {}", response.status());
            }
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

    /// Read a chunk of the SSE event stream and extract text-ish deltas + permission asks.
    pub async fn poll_events_once(&self) -> Result<Vec<crate::action::Action>> {
        let url = self.url("/event")?;
        let response = self
            .http
            .get(url)
            .header("Authorization", &self.auth.authorization_header)
            .header("x-ax-code-directory", &self.directory)
            .header("Accept", "text/event-stream")
            .timeout(std::time::Duration::from_millis(500))
            .send()
            .await;

        let Ok(response) = response else {
            return Ok(vec![]);
        };
        if !response.status().is_success() {
            return Ok(vec![]);
        }
        // For Phase 2 skeleton we do a short body read if the server buffers;
        // streaming long-lived SSE is handled in the event loop with a background task.
        let text = response.text().await.unwrap_or_default();
        Ok(parse_sse_actions(&text))
    }
}

/// Parse Server-Sent Event payloads into UI actions (best-effort for Phase 2).
pub fn parse_sse_actions(raw: &str) -> Vec<crate::action::Action> {
    let mut out = Vec::new();
    for block in raw.split("\n\n") {
        let data = block
            .lines()
            .filter_map(|line| line.strip_prefix("data:"))
            .map(str::trim)
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
}
