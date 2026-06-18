//! Mock server for testing the TUI client.
//!
//! Provides a simulated headless server that can be configured to return
//! specific event sequences for integration testing.

#![allow(dead_code)]

use std::collections::VecDeque;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use tokio::sync::mpsc;

/// A mock headless server for testing.
pub struct MockServer {
    /// Server address
    pub addr: SocketAddr,
    /// Events to emit via SSE
    events: Arc<Mutex<VecDeque<String>>>,
    /// Health check response
    healthy: Arc<Mutex<bool>>,
    /// Request lines received by the mock server
    requests: Arc<Mutex<Vec<String>>>,
    /// Shutdown signal sender
    shutdown_tx: Option<mpsc::Sender<()>>,
}

impl MockServer {
    /// Create a new mock server with default settings.
    pub fn new() -> Self {
        Self {
            addr: SocketAddr::from(([127, 0, 0, 1], 0)),
            events: Arc::new(Mutex::new(VecDeque::new())),
            healthy: Arc::new(Mutex::new(true)),
            requests: Arc::new(Mutex::new(Vec::new())),
            shutdown_tx: None,
        }
    }

    /// Create and start a mock server.
    pub async fn start() -> Self {
        let events: Arc<Mutex<VecDeque<String>>> = Arc::new(Mutex::new(VecDeque::new()));
        let healthy: Arc<Mutex<bool>> = Arc::new(Mutex::new(true));
        let requests: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));

        let events_clone = events.clone();
        let healthy_clone = healthy.clone();
        let requests_clone = requests.clone();

        let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);

        // Create a simple TCP listener
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("Failed to bind mock server");
        let addr = listener.local_addr().expect("Failed to get local addr");

        // Spawn server task
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    result = listener.accept() => {
                        if let Ok((mut stream, _)) = result {
                            let events = events_clone.clone();
                            let healthy = healthy_clone.clone();
                            let requests = requests_clone.clone();
                            tokio::spawn(async move {
                                handle_connection(&mut stream, &events, &healthy, &requests).await;
                            });
                        }
                    }
                    _ = shutdown_rx.recv() => {
                        break;
                    }
                }
            }
        });

        Self {
            addr,
            events,
            healthy,
            requests,
            shutdown_tx: Some(shutdown_tx),
        }
    }

    /// Get the server URL.
    pub fn url(&self) -> String {
        format!("http://{}", self.addr)
    }

    /// Queue an event to be emitted via SSE.
    pub fn queue_event(&self, event_json: &str) {
        let mut events = self.events.lock().unwrap();
        events.push_back(format!("data: {}\n\n", event_json));
    }

    /// Queue multiple events.
    pub fn queue_events(&self, events: &[&str]) {
        for event in events {
            self.queue_event(event);
        }
    }

    /// Set the health check response.
    pub fn set_healthy(&self, healthy: bool) {
        let mut h = self.healthy.lock().unwrap();
        *h = healthy;
    }

    /// Return request lines received by the mock server.
    pub fn requests(&self) -> Vec<String> {
        self.requests.lock().unwrap().clone()
    }

    /// Shutdown the server.
    pub async fn shutdown(mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(()).await;
        }
    }
}

impl Drop for MockServer {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.try_send(());
        }
    }
}

/// Handle a single HTTP connection (simplified).
async fn handle_connection(
    stream: &mut tokio::net::TcpStream,
    events: &Arc<Mutex<VecDeque<String>>>,
    healthy: &Arc<Mutex<bool>>,
    requests: &Arc<Mutex<Vec<String>>>,
) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let mut buf = vec![0u8; 4096];
    let n = match stream.read(&mut buf).await {
        Ok(n) => n,
        Err(_) => return,
    };

    let request = String::from_utf8_lossy(&buf[..n]);
    if let Some(line) = request.lines().next() {
        requests.lock().unwrap().push(line.to_string());
    }

    let response = if request.starts_with("GET /global/health") {
        let is_healthy = *healthy.lock().unwrap();
        if is_healthy {
            "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK"
        } else {
            "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 5\r\n\r\nERROR"
        }
        .to_string()
    } else if request.starts_with("GET /global/event") {
        // SSE endpoint - emit queued events
        let mut response = String::from(
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\n\r\n",
        );

        let events_to_send: Vec<String> = {
            let mut events_lock = events.lock().unwrap();
            events_lock.drain(..).collect()
        };

        for event in events_to_send {
            response.push_str(&event);
        }

        response
    } else if request.starts_with("GET /session ") || request.starts_with("GET /session?") {
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 58\r\n\r\n[{\"id\":\"recent-session\"},{\"id\":\"\"},{\"id\":\"older-session\"}]".to_string()
    } else if request.starts_with("POST /session ") || request.starts_with("POST /session?") {
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 21\r\n\r\n{\"id\":\"mock-session\"}".to_string()
    } else if request.starts_with("POST /session/") {
        "HTTP/1.1 202 Accepted\r\nContent-Length: 0\r\n\r\n".to_string()
    } else if is_permission_reply_request(&request)
        || is_question_reply_request(&request)
        || is_question_reject_request(&request)
    {
        "HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n".to_string()
    } else {
        "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n".to_string()
    };

    let _ = stream.write_all(response.as_bytes()).await;
}

/// Create a session created event JSON.
pub fn session_created_event(id: &str, title: Option<&str>) -> String {
    let title_json = title
        .map(|t| format!(r#","title":"{}""#, t))
        .unwrap_or_default();
    format!(
        r#"{{"type":"session.created","properties":{{"info":{{"id":"{}","sessionID":"{}"{},"role":"assistant"}}}}}}"#,
        id, id, title_json
    )
}

/// Create a message updated event JSON.
pub fn message_updated_event(id: &str, session_id: &str, role: &str) -> String {
    format!(
        r#"{{"type":"message.updated","properties":{{"info":{{"id":"{}","sessionID":"{}","role":"{}"}}}}}}"#,
        id, session_id, role
    )
}

/// Create a message part delta event JSON.
pub fn message_part_delta_event(message_id: &str, delta: &str) -> String {
    format!(
        r#"{{"type":"message.part.delta","properties":{{"messageID":"{}","partID":"part-1","field":"content","delta":"{}"}}}}"#,
        message_id, delta
    )
}

/// Create a permission asked event JSON.
pub fn permission_asked_event(
    session_id: &str,
    request_id: &str,
    perm_type: &str,
    description: &str,
) -> String {
    format!(
        r#"{{"type":"permission.asked","properties":{{"sessionID":"{}","id":"{}","permission":"{}","patterns":[],"metadata":{{"description":"{}"}},"always":[]}}}}"#,
        session_id, request_id, perm_type, description
    )
}

/// Create a question asked event JSON.
pub fn question_asked_event(
    session_id: &str,
    request_id: &str,
    question: &str,
    options: &[&str],
) -> String {
    let options_json: Vec<String> = options
        .iter()
        .map(|o| format!(r#"{{"label":"{}","description":""}}"#, o))
        .collect();
    format!(
        r#"{{"type":"question.asked","properties":{{"sessionID":"{}","id":"{}","questions":[{{"question":"{}","header":"Question","options":[{}]}}]}}}}"#,
        session_id,
        request_id,
        question,
        options_json.join(",")
    )
}

fn is_permission_reply_request(request: &str) -> bool {
    request.starts_with("POST /permission/")
        && (request.contains("/reply ") || request.contains("/reply?"))
}

fn is_question_reply_request(request: &str) -> bool {
    request.starts_with("POST /question/")
        && (request.contains("/reply ") || request.contains("/reply?"))
}

fn is_question_reject_request(request: &str) -> bool {
    request.starts_with("POST /question/")
        && (request.contains("/reject ") || request.contains("/reject?"))
}

/// Create a tool call start event JSON.
pub fn tool_call_start_event(session_id: &str, call_id: &str, tool_name: &str) -> String {
    format!(
        r#"{{"type":"tool.call.start","properties":{{"sessionID":"{}","callID":"{}","toolName":"{}"}}}}"#,
        session_id, call_id, tool_name
    )
}

/// Create a tool call complete event JSON.
pub fn tool_call_complete_event(
    session_id: &str,
    call_id: &str,
    tool_name: &str,
    result: Option<&str>,
    error: Option<&str>,
) -> String {
    let result_json = result
        .map(|r| format!(r#","result":"{}""#, r))
        .unwrap_or_default();
    let error_json = error
        .map(|e| format!(r#","error":"{}""#, e))
        .unwrap_or_default();
    format!(
        r#"{{"type":"tool.call.complete","properties":{{"sessionID":"{}","callID":"{}","toolName":"{}"{}{}}}}}"#,
        session_id, call_id, tool_name, result_json, error_json
    )
}
