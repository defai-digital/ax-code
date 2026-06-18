//! Lifecycle tests for the TUI client.
//!
//! Tests server attach, connection, reconnection, and failure handling.

mod support;

use ax_code_tui::client::{ClientConfig, HeadlessClient};
use support::mock_server::MockServer;

// =============================================================================
// Server Attach Tests
// =============================================================================

#[tokio::test]
async fn test_server_attach_healthy() {
    let server = MockServer::start().await;

    let config = ClientConfig {
        base_url: server.url(),
        auth_token: None,
        directory: None,
        session: None,
        prompt: None,
    };

    let client = HeadlessClient::new(config).expect("Failed to create client");

    // Health check should succeed
    let result = client.connect().await;
    assert!(
        result.is_ok(),
        "Health check should succeed for healthy server"
    );

    server.shutdown().await;
}

#[tokio::test]
async fn test_server_attach_unhealthy() {
    let server = MockServer::start().await;
    server.set_healthy(false);

    let config = ClientConfig {
        base_url: server.url(),
        auth_token: None,
        directory: None,
        session: None,
        prompt: None,
    };

    let client = HeadlessClient::new(config).expect("Failed to create client");

    // Health check should fail
    let result = client.connect().await;
    assert!(
        result.is_err(),
        "Health check should fail for unhealthy server"
    );

    server.shutdown().await;
}

#[tokio::test]
async fn test_server_attach_with_auth() {
    let server = MockServer::start().await;

    let config = ClientConfig {
        base_url: server.url(),
        auth_token: Some("test-token-123".to_string()),
        directory: Some("/test/dir".to_string()),
        session: None,
        prompt: None,
    };

    let client = HeadlessClient::new(config).expect("Failed to create client with auth");

    // Should still work with auth token
    let result = client.connect().await;
    assert!(
        result.is_ok(),
        "Health check should succeed with auth token"
    );

    server.shutdown().await;
}

#[tokio::test]
async fn test_create_session_uses_headless_route() {
    let server = MockServer::start().await;
    let config = ClientConfig {
        base_url: server.url(),
        auth_token: None,
        directory: None,
        session: None,
        prompt: None,
    };
    let client = HeadlessClient::new(config).expect("Failed to create client");

    let session_id = client.create_session().await.expect("create session");
    assert_eq!(session_id, "mock-session");

    server.shutdown().await;
}

#[tokio::test]
async fn test_list_recent_session_ids_uses_headless_session_route() {
    let server = MockServer::start().await;
    let config = ClientConfig {
        base_url: server.url(),
        auth_token: None,
        directory: Some("/workspace/project".to_string()),
        session: None,
        prompt: None,
    };
    let client = HeadlessClient::new(config).expect("Failed to create client");

    let session_ids = client
        .list_recent_session_ids()
        .await
        .expect("list recent session ids");
    assert_eq!(session_ids, vec!["recent-session", "older-session"]);

    server.shutdown().await;
}

#[tokio::test]
async fn test_permission_reply_uses_headless_route() {
    let server = MockServer::start().await;
    let config = ClientConfig {
        base_url: server.url(),
        auth_token: None,
        directory: None,
        session: None,
        prompt: None,
    };
    let client = HeadlessClient::new(config).expect("Failed to create client");

    let result = client.reply_permission("sess_123", "perm_123", true).await;
    assert!(
        result.is_ok(),
        "Permission reply should use /permission/:requestID/reply"
    );

    server.shutdown().await;
}

#[tokio::test]
async fn test_question_reply_and_reject_use_headless_routes() {
    let server = MockServer::start().await;
    let config = ClientConfig {
        base_url: server.url(),
        auth_token: None,
        directory: None,
        session: None,
        prompt: None,
    };
    let client = HeadlessClient::new(config).expect("Failed to create client");

    let reply = client
        .reply_question("sess_123", "q_123", vec![vec!["A".to_string()]])
        .await;
    assert!(
        reply.is_ok(),
        "Question reply should use /question/:requestID/reply"
    );

    let reject = client.reject_question("sess_123", "q_123").await;
    assert!(
        reject.is_ok(),
        "Question reject should use /question/:requestID/reject"
    );

    server.shutdown().await;
}

// =============================================================================
// Connection Failure Tests
// =============================================================================

#[tokio::test]
async fn test_server_connection_refused() {
    // Try to connect to a port that isn't listening
    let config = ClientConfig {
        base_url: "http://127.0.0.1:1".to_string(), // Port 1 is unlikely to be open
        auth_token: None,
        directory: None,
        session: None,
        prompt: None,
    };

    let client = HeadlessClient::new(config).expect("Failed to create client");

    // Connection should fail
    let result = client.connect().await;
    assert!(result.is_err(), "Connection should be refused");
}

#[tokio::test]
async fn test_server_invalid_url() {
    let config = ClientConfig {
        base_url: "not-a-valid-url".to_string(),
        auth_token: None,
        directory: None,
        session: None,
        prompt: None,
    };

    let client = HeadlessClient::new(config).expect("Failed to create client");

    // Should fail on connection attempt
    let result = client.connect().await;
    assert!(
        result.is_err(),
        "Invalid URL should cause connection failure"
    );
}

// =============================================================================
// Event Queue Tests
// =============================================================================

#[tokio::test]
async fn test_mock_server_event_queue() {
    let server = MockServer::start().await;

    // Queue some events
    server.queue_event(r#"{"type":"test.event","data":"hello"}"#);
    server.queue_event(r#"{"type":"test.event","data":"world"}"#);

    // Verify URL is correct
    let url = server.url();
    assert!(url.starts_with("http://127.0.0.1:"));

    server.shutdown().await;
}

#[tokio::test]
async fn test_mock_server_multiple_events() {
    let server = MockServer::start().await;

    let events = vec![
        r#"{"type":"event1"}"#,
        r#"{"type":"event2"}"#,
        r#"{"type":"event3"}"#,
    ];

    server.queue_events(&events);

    // Server should still be responsive
    let config = ClientConfig {
        base_url: server.url(),
        auth_token: None,
        directory: None,
        session: None,
        prompt: None,
    };

    let client = HeadlessClient::new(config).expect("Failed to create client");
    let result = client.connect().await;
    assert!(result.is_ok());

    server.shutdown().await;
}

// =============================================================================
// Fixture Replay Tests
// =============================================================================

#[tokio::test]
async fn test_fixture_session_created_replay() {
    let server = MockServer::start().await;

    // Load and queue fixture events
    let events = support::load_fixture("session_created");
    for event in &events {
        server.queue_event(event);
    }

    // Connect to verify server is working
    let config = ClientConfig {
        base_url: server.url(),
        auth_token: None,
        directory: None,
        session: None,
        prompt: None,
    };

    let client = HeadlessClient::new(config).expect("Failed to create client");
    let result = client.connect().await;
    assert!(
        result.is_ok(),
        "Should connect to server with queued events"
    );

    server.shutdown().await;
}

#[tokio::test]
async fn test_fixture_streaming_message_replay() {
    let server = MockServer::start().await;

    // Load streaming message fixture
    let events = support::load_fixture("streaming_message");
    for event in &events {
        server.queue_event(event);
    }

    let config = ClientConfig {
        base_url: server.url(),
        auth_token: None,
        directory: None,
        session: None,
        prompt: None,
    };

    let client = HeadlessClient::new(config).expect("Failed to create client");
    let result = client.connect().await;
    assert!(result.is_ok());

    server.shutdown().await;
}
