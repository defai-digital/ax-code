use rusqlite::Connection;
use std::sync::Mutex;

use crate::schema;

/// Serialize a value to JSON, mapping serde errors into `rusqlite::Error` so
/// callers inside `with_conn` closures can use `?` directly.
pub(crate) fn json_str<T: serde::Serialize>(val: &T) -> Result<String, rusqlite::Error> {
  serde_json::to_string(val).map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))
}

/// `Option<Connection>` rather than bare `Connection` so `close` can take the
/// connection out and run `Connection::close` (which consumes self, runs the
/// final WAL checkpoint, and surfaces close-time errors). After close every
/// further `with_conn*` call returns "store is closed" instead of silently
/// reopening, which would defeat the point of the shutdown release.
#[napi]
pub struct IndexStore {
  pub(crate) conn: Mutex<Option<Connection>>,
}

#[napi]
impl IndexStore {
  #[napi(constructor)]
  pub fn new(db_path: String) -> napi::Result<Self> {
    let conn = Connection::open(&db_path)
      .map_err(|e| napi::Error::from_reason(format!("failed to open database: {e}")))?;

    // Apply PRAGMAs
    conn.execute_batch(schema::PRAGMAS)
      .map_err(|e| napi::Error::from_reason(format!("failed to set pragmas: {e}")))?;

    // Create schema
    conn.execute_batch(schema::CREATE_TABLES)
      .map_err(|e| napi::Error::from_reason(format!("failed to create tables: {e}")))?;

    Ok(Self { conn: Mutex::new(Some(conn)) })
  }

  /// Explicitly release the underlying SQLite connection. Truncates the WAL
  /// before closing so external readers see a fully-checkpointed main DB,
  /// then consumes the connection via `Connection::close` to run SQLite's
  /// own clean-shutdown path. Idempotent — calling close on an already-
  /// closed store is a no-op.
  ///
  /// Once closed, every other method on this store returns
  /// "index store is closed" (see `with_conn` / `with_conn_mut`). Callers
  /// must drop their JS handle and re-construct an `IndexStore` if they
  /// need to resume work; the singleton in `native-store.ts` enforces this
  /// by clearing its cached instance on close.
  #[napi]
  pub fn close(&self) -> napi::Result<()> {
    let mut guard = self
      .conn
      .lock()
      .map_err(|e| napi::Error::from_reason(format!("lock poisoned: {e}")))?;
    let Some(conn) = guard.take() else {
      return Ok(());
    };
    // Best-effort WAL checkpoint. Failure here doesn't block close — the
    // checkpoint is a courtesy for external SQLite readers, not required
    // for correctness, and we still want the connection to be released.
    let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
    if let Err((_, err)) = conn.close() {
      return Err(napi::Error::from_reason(format!(
        "failed to close index store cleanly: {err}"
      )));
    }
    Ok(())
  }
}

impl IndexStore {
  pub(crate) fn with_conn<T, F>(&self, f: F) -> napi::Result<T>
  where
    F: FnOnce(&Connection) -> Result<T, rusqlite::Error>,
  {
    let guard = self
      .conn
      .lock()
      .map_err(|e| napi::Error::from_reason(format!("lock poisoned: {e}")))?;
    let conn = guard
      .as_ref()
      .ok_or_else(|| napi::Error::from_reason("index store is closed"))?;
    f(conn).map_err(|e| napi::Error::from_reason(format!("sqlite error: {e}")))
  }

  pub(crate) fn with_conn_mut<T, F>(&self, f: F) -> napi::Result<T>
  where
    F: FnOnce(&mut Connection) -> Result<T, rusqlite::Error>,
  {
    let mut guard = self
      .conn
      .lock()
      .map_err(|e| napi::Error::from_reason(format!("lock poisoned: {e}")))?;
    let conn = guard
      .as_mut()
      .ok_or_else(|| napi::Error::from_reason("index store is closed"))?;
    f(conn).map_err(|e| napi::Error::from_reason(format!("sqlite error: {e}")))
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::node::NodeRow;
  use crate::edge::EdgeRow;
  use crate::file::FileRow;
  use crate::cursor::CursorRow;

  fn test_store() -> IndexStore {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(crate::schema::PRAGMAS).unwrap();
    conn.execute_batch(crate::schema::CREATE_TABLES).unwrap();
    IndexStore { conn: Mutex::new(Some(conn)) }
  }

  fn make_node(id: &str, project_id: &str, name: &str, file: &str) -> NodeRow {
    NodeRow {
      id: id.to_string(),
      project_id: project_id.to_string(),
      kind: "function".to_string(),
      name: name.to_string(),
      qualified_name: name.to_string(),
      file: file.to_string(),
      range_start_line: 1,
      range_start_char: 0,
      range_end_line: 10,
      range_end_char: 0,
      signature: None,
      visibility: None,
      metadata: None,
      indexed_at: None,
      time_created: None,
      time_updated: None,
    }
  }

  fn make_edge(id: &str, project_id: &str, from_node: &str, to_node: &str, file: &str) -> EdgeRow {
    EdgeRow {
      id: id.to_string(),
      project_id: project_id.to_string(),
      kind: "calls".to_string(),
      from_node: from_node.to_string(),
      to_node: to_node.to_string(),
      file: file.to_string(),
      range_start_line: 5,
      range_start_char: 0,
      range_end_line: 5,
      range_end_char: 20,
      time_created: None,
      time_updated: None,
    }
  }

  fn make_file(id: &str, project_id: &str, path: &str, sha: &str) -> FileRow {
    FileRow {
      id: id.to_string(),
      project_id: project_id.to_string(),
      path: path.to_string(),
      sha: sha.to_string(),
      size: 100,
      lang: "typescript".to_string(),
      indexed_at: None,
      completeness: "full".to_string(),
      time_created: None,
      time_updated: None,
    }
  }

  #[test]
  fn test_insert_and_find_nodes() {
    let store = test_store();
    let nodes = vec![
      make_node("n1", "proj1", "alpha", "/a.ts"),
      make_node("n2", "proj1", "beta", "/b.ts"),
      make_node("n3", "proj1", "alpha", "/c.ts"),
    ];
    let json = serde_json::to_string(&nodes).unwrap();
    store.insert_nodes(json).unwrap();

    let opts = r#"{}"#.to_string();
    let result = store.find_nodes_by_name("proj1".into(), "alpha".into(), opts).unwrap();
    let found: Vec<NodeRow> = serde_json::from_str(&result).unwrap();
    assert_eq!(found.len(), 2);
    assert!(found.iter().all(|n| n.name == "alpha"));

    let count = store.count_nodes("proj1".into()).unwrap();
    assert_eq!(count, 3);
  }

  #[test]
  fn test_find_nodes_by_prefix() {
    let store = test_store();
    let nodes = vec![
      make_node("n1", "proj1", "getFoo", "/a.ts"),
      make_node("n2", "proj1", "getBar", "/a.ts"),
      make_node("n3", "proj1", "setFoo", "/a.ts"),
    ];
    let json = serde_json::to_string(&nodes).unwrap();
    store.insert_nodes(json).unwrap();

    let opts = r#"{}"#.to_string();
    let result = store.find_nodes_by_prefix("proj1".into(), "get".into(), opts).unwrap();
    let found: Vec<NodeRow> = serde_json::from_str(&result).unwrap();
    assert_eq!(found.len(), 2);
    assert!(found.iter().all(|n| n.name.starts_with("get")));
  }

  #[test]
  fn test_nodes_in_file() {
    let store = test_store();
    let nodes = vec![
      make_node("n1", "proj1", "foo", "/src/a.ts"),
      make_node("n2", "proj1", "bar", "/src/a.ts"),
      make_node("n3", "proj1", "baz", "/src/b.ts"),
    ];
    let json = serde_json::to_string(&nodes).unwrap();
    store.insert_nodes(json).unwrap();

    let result = store.nodes_in_file("proj1".into(), "/src/a.ts".into()).unwrap();
    let found: Vec<NodeRow> = serde_json::from_str(&result).unwrap();
    assert_eq!(found.len(), 2);
    assert!(found.iter().all(|n| n.file == "/src/a.ts"));
  }

  #[test]
  fn test_insert_and_query_edges() {
    let store = test_store();
    let nodes = vec![
      make_node("n1", "proj1", "caller", "/a.ts"),
      make_node("n2", "proj1", "callee", "/a.ts"),
      make_node("n3", "proj1", "other", "/a.ts"),
    ];
    store.insert_nodes(serde_json::to_string(&nodes).unwrap()).unwrap();

    let edges = vec![
      make_edge("e1", "proj1", "n1", "n2", "/a.ts"),
      make_edge("e2", "proj1", "n1", "n3", "/a.ts"),
      make_edge("e3", "proj1", "n3", "n2", "/a.ts"),
    ];
    store.insert_edges(serde_json::to_string(&edges).unwrap()).unwrap();

    let result = store.edges_from("proj1".into(), "n1".into(), None).unwrap();
    let found: Vec<EdgeRow> = serde_json::from_str(&result).unwrap();
    assert_eq!(found.len(), 2);

    let result = store.edges_to("proj1".into(), "n2".into(), None).unwrap();
    let found: Vec<EdgeRow> = serde_json::from_str(&result).unwrap();
    assert_eq!(found.len(), 2);

    let count = store.count_edges("proj1".into()).unwrap();
    assert_eq!(count, 3);
  }

  #[test]
  fn test_delete_edges_touching_file() {
    let store = test_store();
    let nodes = vec![
      make_node("n1", "proj1", "funcA", "/file1.ts"),
      make_node("n2", "proj1", "funcB", "/file2.ts"),
    ];
    store.insert_nodes(serde_json::to_string(&nodes).unwrap()).unwrap();

    let edges = vec![
      make_edge("e1", "proj1", "n1", "n2", "/file1.ts"),
    ];
    store.insert_edges(serde_json::to_string(&edges).unwrap()).unwrap();

    assert_eq!(store.count_edges("proj1".into()).unwrap(), 1);

    store.delete_edges_touching_file("proj1".into(), "/file1.ts".into()).unwrap();
    assert_eq!(store.count_edges("proj1".into()).unwrap(), 0);
  }

  #[test]
  fn test_upsert_file() {
    let store = test_store();
    let f1 = make_file("f1", "proj1", "/src/main.ts", "sha_v1");
    store.upsert_file(serde_json::to_string(&f1).unwrap()).unwrap();

    let f1_v2 = make_file("f1_v2", "proj1", "/src/main.ts", "sha_v2");
    store.upsert_file(serde_json::to_string(&f1_v2).unwrap()).unwrap();

    let result = store.list_files("proj1".into()).unwrap();
    let files: Vec<FileRow> = serde_json::from_str(&result).unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].sha, "sha_v2");
  }

  #[test]
  fn test_get_file() {
    let store = test_store();
    let f = make_file("f1", "proj1", "/lib/utils.ts", "abc123");
    store.upsert_file(serde_json::to_string(&f).unwrap()).unwrap();

    let result = store.get_file("proj1".into(), "/lib/utils.ts".into()).unwrap();
    assert!(result.is_some());
    let file: FileRow = serde_json::from_str(&result.unwrap()).unwrap();
    assert_eq!(file.path, "/lib/utils.ts");
    assert_eq!(file.sha, "abc123");
    assert_eq!(file.lang, "typescript");

    let missing = store.get_file("proj1".into(), "/nope.ts".into()).unwrap();
    assert!(missing.is_none());
  }

  #[test]
  fn test_prune_orphan_files() {
    let store = test_store();

    let files = vec![
      make_file("f1", "proj1", "/src/keep.ts", "aaa"),
      make_file("f2", "proj1", "/src/remove.ts", "bbb"),
      make_file("f3", "proj1", "/src/also_remove.ts", "ccc"),
    ];
    for f in &files {
      store.upsert_file(serde_json::to_string(f).unwrap()).unwrap();
    }

    let nodes = vec![
      make_node("n1", "proj1", "kept", "/src/keep.ts"),
      make_node("n2", "proj1", "removed", "/src/remove.ts"),
    ];
    store.insert_nodes(serde_json::to_string(&nodes).unwrap()).unwrap();

    let live = serde_json::to_string(&vec!["/src/keep.ts"]).unwrap();
    let result = store.prune_orphan_files("proj1".into(), live, "/src/".into()).unwrap();
    let prune: crate::file::PruneResult = serde_json::from_str(&result).unwrap();
    assert_eq!(prune.files, 2);
    assert_eq!(prune.nodes, 1);

    let remaining = store.list_files("proj1".into()).unwrap();
    let remaining_files: Vec<FileRow> = serde_json::from_str(&remaining).unwrap();
    assert_eq!(remaining_files.len(), 1);
    assert_eq!(remaining_files[0].path, "/src/keep.ts");
  }

  #[test]
  fn test_ingest_file_atomic() {
    let store = test_store();

    let old_nodes = vec![make_node("old_n1", "proj1", "oldFunc", "/app.ts")];
    store.insert_nodes(serde_json::to_string(&old_nodes).unwrap()).unwrap();
    let old_edges = vec![make_edge("old_e1", "proj1", "old_n1", "old_n1", "/app.ts")];
    store.insert_edges(serde_json::to_string(&old_edges).unwrap()).unwrap();

    assert_eq!(store.count_nodes("proj1".into()).unwrap(), 1);
    assert_eq!(store.count_edges("proj1".into()).unwrap(), 1);

    let new_nodes = vec![
      make_node("new_n1", "proj1", "newFuncA", "/app.ts"),
      make_node("new_n2", "proj1", "newFuncB", "/app.ts"),
    ];
    let new_edges = vec![
      make_edge("new_e1", "proj1", "new_n1", "new_n2", "/app.ts"),
    ];
    let file_meta = make_file("fm1", "proj1", "/app.ts", "sha_new");

    store.ingest_file(
      "proj1".into(),
      "/app.ts".into(),
      serde_json::to_string(&new_nodes).unwrap(),
      serde_json::to_string(&new_edges).unwrap(),
      serde_json::to_string(&file_meta).unwrap(),
    ).unwrap();

    assert_eq!(store.count_nodes("proj1".into()).unwrap(), 2);
    assert_eq!(store.count_edges("proj1".into()).unwrap(), 1);

    let result = store.nodes_in_file("proj1".into(), "/app.ts".into()).unwrap();
    let found: Vec<NodeRow> = serde_json::from_str(&result).unwrap();
    assert_eq!(found.len(), 2);
    assert!(found.iter().any(|n| n.name == "newFuncA"));
    assert!(found.iter().any(|n| n.name == "newFuncB"));

    let fmeta = store.get_file("proj1".into(), "/app.ts".into()).unwrap();
    assert!(fmeta.is_some());
  }

  #[test]
  fn test_cursor_upsert_and_get() {
    let store = test_store();

    let result = store.get_cursor("proj1".into()).unwrap();
    assert!(result.is_none());

    store.upsert_cursor("proj1".into(), Some("abc123".into()), 42, 17).unwrap();

    let result = store.get_cursor("proj1".into()).unwrap();
    assert!(result.is_some());
    let cursor: CursorRow = serde_json::from_str(&result.unwrap()).unwrap();
    assert_eq!(cursor.project_id, "proj1");
    assert_eq!(cursor.commit_sha, Some("abc123".to_string()));
    assert_eq!(cursor.node_count, 42);
    assert_eq!(cursor.edge_count, 17);

    store.upsert_cursor("proj1".into(), Some("def456".into()), 100, 50).unwrap();
    let result = store.get_cursor("proj1".into()).unwrap();
    let cursor: CursorRow = serde_json::from_str(&result.unwrap()).unwrap();
    assert_eq!(cursor.commit_sha, Some("def456".to_string()));
    assert_eq!(cursor.node_count, 100);
    assert_eq!(cursor.edge_count, 50);
  }

  #[test]
  fn test_clear_project() {
    let store = test_store();

    let nodes = vec![make_node("n1", "proj1", "func", "/a.ts")];
    store.insert_nodes(serde_json::to_string(&nodes).unwrap()).unwrap();
    let edges = vec![make_edge("e1", "proj1", "n1", "n1", "/a.ts")];
    store.insert_edges(serde_json::to_string(&edges).unwrap()).unwrap();
    let f = make_file("f1", "proj1", "/a.ts", "sha");
    store.upsert_file(serde_json::to_string(&f).unwrap()).unwrap();
    store.upsert_cursor("proj1".into(), Some("abc".into()), 1, 1).unwrap();

    assert_eq!(store.count_nodes("proj1".into()).unwrap(), 1);
    assert_eq!(store.count_edges("proj1".into()).unwrap(), 1);

    store.clear_project("proj1".into()).unwrap();

    assert_eq!(store.count_nodes("proj1".into()).unwrap(), 0);
    assert_eq!(store.count_edges("proj1".into()).unwrap(), 0);
    let files = store.list_files("proj1".into()).unwrap();
    let files: Vec<FileRow> = serde_json::from_str(&files).unwrap();
    assert!(files.is_empty());
    let cursor = store.get_cursor("proj1".into()).unwrap();
    assert!(cursor.is_none());
  }

  #[test]
  fn test_analyze() {
    let store = test_store();
    store.analyze().unwrap();

    let nodes = vec![make_node("n1", "proj1", "func", "/a.ts")];
    store.insert_nodes(serde_json::to_string(&nodes).unwrap()).unwrap();
    store.analyze().unwrap();
  }

  #[test]
  fn test_close_releases_connection_and_blocks_further_ops() {
    let store = test_store();
    let nodes = vec![make_node("n1", "proj1", "func", "/a.ts")];
    store.insert_nodes(serde_json::to_string(&nodes).unwrap()).unwrap();

    // Close consumes the connection.
    store.close().unwrap();

    // Subsequent operations must fail rather than silently reopening.
    let err = store.count_nodes("proj1".into()).unwrap_err();
    assert!(err.reason.contains("closed"), "got: {}", err.reason);

    // Idempotent: a second close on an already-closed store is a no-op.
    store.close().unwrap();
  }
}
