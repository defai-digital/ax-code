//! Tests for the headless client.

use ax_code_tui::client::{ClientConfig, HeadlessClient, DEFAULT_SERVER_URL};
use ax_code_tui::events::RuntimeEvent;

#[test]
fn test_client_config_default() {
    let config = ClientConfig::default();
    assert_eq!(config.base_url, DEFAULT_SERVER_URL);
    assert!(config.directory.is_none());
    assert!(config.auth_token.is_none());
}

#[test]
fn test_client_creation() {
    let config = ClientConfig {
        base_url: "http://localhost:8080".to_string(),
        directory: Some("/tmp/test".to_string()),
        auth_token: Some("secret-token".to_string()),
    };

    let client = HeadlessClient::new(config);
    assert!(client.is_ok());

    let client = client.unwrap();
    assert_eq!(client.base_url(), "http://localhost:8080");
}

#[test]
fn test_client_creation_with_auth() {
    let config = ClientConfig {
        base_url: "http://localhost:4096".to_string(),
        directory: None,
        auth_token: Some("my-password".to_string()),
    };

    let client = HeadlessClient::new(config);
    assert!(client.is_ok());
}

#[tokio::test]
async fn test_parse_sse_events() {
    // Test parsing a valid SSE event
    let json = r#"{"type":"session.created","properties":{"info":{"id":"sess_123","title":"Test Session"}}}"#;
    let event: RuntimeEvent = serde_json::from_str(json).unwrap();

    match event {
        RuntimeEvent::SessionCreated { properties } => {
            assert_eq!(properties.info.as_ref().unwrap().id, "sess_123");
            assert_eq!(properties.info.as_ref().unwrap().title.as_deref(), Some("Test Session"));
        }
        _ => panic!("Expected SessionCreated event"),
    }
}

#[tokio::test]
async fn test_parse_message_event() {
    let json = r#"{"type":"message.updated","properties":{"info":{"id":"msg_456","sessionID":"sess_123","role":"assistant"}}}"#;
    let event: RuntimeEvent = serde_json::from_str(json).unwrap();

    match event {
        RuntimeEvent::MessageUpdated { properties } => {
            assert_eq!(properties.info.as_ref().unwrap().id, "msg_456");
            assert_eq!(properties.info.as_ref().unwrap().session_id, "sess_123");
        }
        _ => panic!("Expected MessageUpdated event"),
    }
}

#[tokio::test]
async fn test_parse_permission_event() {
    let json = r#"{"type":"permission.asked","properties":{"sessionID":"sess_123","id":"perm_789","description":"Allow file write?","permission_type":"file_write"}}"#;
    let event: RuntimeEvent = serde_json::from_str(json).unwrap();

    match event {
        RuntimeEvent::PermissionAsked { properties } => {
            assert_eq!(properties.session_id, "sess_123");
            assert_eq!(properties.id, "perm_789");
            assert_eq!(properties.description, "Allow file write?");
        }
        _ => panic!("Expected PermissionAsked event"),
    }
}

#[tokio::test]
async fn test_parse_question_event() {
    let json = r#"{"type":"question.asked","properties":{"sessionID":"sess_123","id":"q_001","question":"Which option?","options":["A","B","C"]}}"#;
    let event: RuntimeEvent = serde_json::from_str(json).unwrap();

    match event {
        RuntimeEvent::QuestionAsked { properties } => {
            assert_eq!(properties.session_id, "sess_123");
            assert_eq!(properties.id, "q_001");
            assert_eq!(properties.question, "Which option?");
            assert_eq!(properties.options, vec!["A", "B", "C"]);
        }
        _ => panic!("Expected QuestionAsked event"),
    }
}

#[tokio::test]
async fn test_parse_unknown_event() {
    let json = r#"{"type":"some.future.event","properties":{"foo":"bar"}}"#;
    let event: RuntimeEvent = serde_json::from_str(json).unwrap();

    assert!(matches!(event, RuntimeEvent::Unknown));
}

#[tokio::test]
async fn test_parse_message_part_delta() {
    let json = r#"{"type":"message.part.delta","properties":{"messageID":"msg_123","partID":"part_456","field":"content","delta":"Hello world"}}"#;
    let event: RuntimeEvent = serde_json::from_str(json).unwrap();

    match event {
        RuntimeEvent::MessagePartDelta { properties } => {
            assert_eq!(properties.message_id, "msg_123");
            assert_eq!(properties.part_id, "part_456");
            assert_eq!(properties.field, "content");
            assert_eq!(properties.delta, "Hello world");
        }
        _ => panic!("Expected MessagePartDelta event"),
    }
}

#[tokio::test]
async fn test_parse_todo_event() {
    let json = r#"{"type":"todo.updated","properties":{"sessionID":"sess_123","todos":[{"id":"todo_1","content":"Do something","status":"pending"}]}}"#;
    let event: RuntimeEvent = serde_json::from_str(json).unwrap();

    match event {
        RuntimeEvent::TodoUpdated { properties } => {
            assert_eq!(properties.session_id, "sess_123");
            assert_eq!(properties.todos.len(), 1);
        }
        _ => panic!("Expected TodoUpdated event"),
    }
}

#[tokio::test]
async fn test_parse_server_events() {
    // Server connected
    let json = r#"{"type":"server.connected"}"#;
    let event: RuntimeEvent = serde_json::from_str(json).unwrap();
    assert!(matches!(event, RuntimeEvent::ServerConnected));

    // Server heartbeat
    let json = r#"{"type":"server.heartbeat"}"#;
    let event: RuntimeEvent = serde_json::from_str(json).unwrap();
    assert!(matches!(event, RuntimeEvent::ServerHeartbeat));

    // Server instance disposed
    let json = r#"{"type":"server.instance.disposed"}"#;
    let event: RuntimeEvent = serde_json::from_str(json).unwrap();
    assert!(matches!(event, RuntimeEvent::ServerInstanceDisposed));
}
