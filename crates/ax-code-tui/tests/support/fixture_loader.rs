//! Event fixture loader for replaying recorded event sequences.

use std::path::Path;

use serde_json::Value;

/// Load events from a JSON fixture file.
pub fn load_fixture(name: &str) -> Vec<String> {
    let fixture_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join(format!("{}.json", name));

    let content = std::fs::read_to_string(&fixture_path)
        .unwrap_or_else(|e| panic!("Failed to read fixture {}: {}", name, e));

    let events: Vec<Value> = serde_json::from_str(&content)
        .unwrap_or_else(|e| panic!("Failed to parse fixture {}: {}", name, e));

    events
        .into_iter()
        .map(|v| serde_json::to_string(&v).unwrap())
        .collect()
}

/// Load and parse events from a JSON string.
pub fn parse_events(json: &str) -> Vec<String> {
    let events: Vec<Value> = serde_json::from_str(json)
        .unwrap_or_else(|e| panic!("Failed to parse events JSON: {}", e));

    events
        .into_iter()
        .map(|v| serde_json::to_string(&v).unwrap())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_load_session_created_fixture() {
        let events = load_fixture("session_created");
        assert!(!events.is_empty());
        assert!(events[0].contains("session.created"));
    }

    #[test]
    fn test_load_streaming_message_fixture() {
        let events = load_fixture("streaming_message");
        assert!(!events.is_empty());
        // Should have multiple delta events
        let delta_count = events.iter().filter(|e| e.contains("message.part.delta")).count();
        assert!(delta_count >= 2);
    }

    #[test]
    fn test_load_permission_flow_fixture() {
        let events = load_fixture("permission_flow");
        assert!(!events.is_empty());
        // Should have a permission.asked event
        assert!(events.iter().any(|e| e.contains("permission.asked")));
    }

    #[test]
    fn test_parse_events() {
        let json = r#"[{"type":"test.event","data":"hello"}]"#;
        let events = parse_events(json);
        assert_eq!(events.len(), 1);
        assert!(events[0].contains("test.event"));
    }
}
