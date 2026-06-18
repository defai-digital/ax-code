//! Tests for the TUI runner module.

use ax_code_tui::client::DEFAULT_SERVER_URL;
use ax_code_tui::runner::CliArgs;
use clap::Parser;

#[test]
fn test_runner_cli_args_parse_server_url() {
    let args = CliArgs::parse_from(["ax-code-tui", "--server-url", "http://myhost:9000"]);
    assert_eq!(args.server_url, "http://myhost:9000");
}

#[test]
fn test_runner_cli_args_parse_auth_token() {
    let args = CliArgs::parse_from(["ax-code-tui", "--auth-token", "my-secret-token"]);
    assert_eq!(args.auth_token, Some("my-secret-token".to_string()));
}

#[test]
fn test_runner_cli_args_parse_directory() {
    let args = CliArgs::parse_from(["ax-code-tui", "--directory", "/var/project"]);
    assert_eq!(args.directory, "/var/project");
}

#[test]
fn test_runner_cli_args_parse_prompt() {
    let args = CliArgs::parse_from(["ax-code-tui", "--prompt", "Write some code"]);
    assert_eq!(args.prompt, Some("Write some code".to_string()));
}

#[test]
fn test_runner_cli_args_parse_session() {
    let args = CliArgs::parse_from(["ax-code-tui", "--session", "session-123"]);
    assert_eq!(args.session, Some("session-123".to_string()));
}

#[test]
fn test_runner_cli_args_all_options() {
    let args = CliArgs::parse_from([
        "ax-code-tui",
        "--server-url",
        "http://server:8080",
        "--auth-token",
        "token123",
        "--directory",
        "/home/user/code",
        "--prompt",
        "Hello",
        "--session",
        "sess-abc",
    ]);

    assert_eq!(args.server_url, "http://server:8080");
    assert_eq!(args.auth_token, Some("token123".to_string()));
    assert_eq!(args.directory, "/home/user/code");
    assert_eq!(args.prompt, Some("Hello".to_string()));
    assert_eq!(args.session, Some("sess-abc".to_string()));
}

#[test]
fn test_runner_cli_args_into_config_all_fields() {
    let args = CliArgs::parse_from([
        "ax-code-tui",
        "--server-url",
        "http://api.example.com",
        "--auth-token",
        "bearer-token",
        "--directory",
        "/workspace",
    ]);

    let config = args.into_config();

    assert_eq!(config.base_url, "http://api.example.com");
    assert_eq!(config.auth_token, Some("bearer-token".to_string()));
    assert_eq!(config.directory, Some("/workspace".to_string()));
}

#[test]
fn test_runner_cli_args_into_config_defaults() {
    let args = CliArgs::parse_from(["ax-code-tui"]);
    let config = args.into_config();

    assert_eq!(config.base_url, DEFAULT_SERVER_URL);
    assert!(config.auth_token.is_none());
    assert_eq!(config.directory, Some(".".to_string()));
}

#[test]
fn test_runner_cli_args_clone() {
    let args = CliArgs::parse_from([
        "ax-code-tui",
        "--server-url",
        "http://test:5000",
        "--prompt",
        "Test prompt",
    ]);

    let cloned = args.clone();

    assert_eq!(args.server_url, cloned.server_url);
    assert_eq!(args.prompt, cloned.prompt);
    assert_eq!(args.directory, cloned.directory);
}

#[test]
fn test_runner_cli_args_debug_format() {
    let args = CliArgs::parse_from(["ax-code-tui", "--server-url", "http://debug:3000"]);
    let debug_str = format!("{:?}", args);

    assert!(debug_str.contains("server_url"));
    assert!(debug_str.contains("http://debug:3000"));
}
