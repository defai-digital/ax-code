use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::store::{json_str, IndexStore};

#[derive(Debug, Serialize, Deserialize)]
pub struct FileRow {
  pub id: String,
  pub project_id: String,
  pub path: String,
  pub sha: String,
  pub size: i64,
  pub lang: String,
  pub indexed_at: Option<i64>,
  pub completeness: String,
  pub time_created: Option<i64>,
  pub time_updated: Option<i64>,
}

fn row_to_file(row: &rusqlite::Row) -> rusqlite::Result<FileRow> {
  Ok(FileRow {
    id: row.get(0)?,
    project_id: row.get(1)?,
    path: row.get(2)?,
    sha: row.get(3)?,
    size: row.get(4)?,
    lang: row.get(5)?,
    indexed_at: row.get(6)?,
    completeness: row.get(7)?,
    time_created: row.get(8)?,
    time_updated: row.get(9)?,
  })
}

const SELECT_COLS: &str = "id, project_id, path, sha, size, lang, indexed_at, completeness, time_created, time_updated";

fn query_files(conn: &rusqlite::Connection, sql: &str, p: &[&dyn rusqlite::types::ToSql]) -> rusqlite::Result<Vec<FileRow>> {
  let mut stmt = conn.prepare(sql)?;
  let rows = stmt.query_map(p, row_to_file)?
    .filter_map(|r| r.ok())
    .collect();
  Ok(rows)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PruneResult {
  pub files: u32,
  pub nodes: u32,
  pub edges: u32,
}

#[napi]
impl IndexStore {
  #[napi]
  pub fn upsert_file(&self, json: String) -> napi::Result<()> {
    let row: FileRow = serde_json::from_str(&json)
      .map_err(|e| napi::Error::from_reason(format!("invalid JSON: {e}")))?;

    self.with_conn(|conn| {
      conn.execute(
        "INSERT INTO code_file (id, project_id, path, sha, size, lang, completeness) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT (project_id, path) DO UPDATE SET sha = ?4, size = ?5, lang = ?6, completeness = ?7, indexed_at = (unixepoch('now', 'subsec') * 1000), time_updated = (unixepoch('now', 'subsec') * 1000)",
        params![row.id, row.project_id, row.path, row.sha, row.size, row.lang, row.completeness],
      )?;
      Ok(())
    })
  }

  #[napi]
  pub fn get_file(&self, project_id: String, path: String) -> napi::Result<Option<String>> {
    self.with_conn(|conn| {
      let sql = format!("SELECT {SELECT_COLS} FROM code_file WHERE project_id = ?1 AND path = ?2");
      let mut stmt = conn.prepare(&sql)?;
      let result = stmt.query_row(params![project_id, path], row_to_file).optional()?;
      match result {
        Some(r) => Ok(Some(json_str(&r)?)),
        None => Ok(None),
      }
    })
  }

  #[napi]
  pub fn list_files(&self, project_id: String) -> napi::Result<String> {
    self.with_conn(|conn| {
      let sql = format!("SELECT {SELECT_COLS} FROM code_file WHERE project_id = ?1 ORDER BY path");
      let rows = query_files(conn, &sql, &[&project_id as &dyn rusqlite::types::ToSql])?;
      json_str(&rows)
    })
  }

  #[napi]
  pub fn delete_file(&self, project_id: String, path: String) -> napi::Result<()> {
    self.with_conn(|conn| {
      conn.execute(
        "DELETE FROM code_file WHERE project_id = ?1 AND path = ?2",
        params![project_id, path],
      )?;
      Ok(())
    })
  }

  /// Prune files (and their nodes/edges) that are NOT in the live set.
  #[napi]
  pub fn prune_orphan_files(&self, project_id: String, live_paths_json: String, scope_prefix: String) -> napi::Result<String> {
    let live_paths: Vec<String> = serde_json::from_str(&live_paths_json)
      .map_err(|e| napi::Error::from_reason(format!("invalid JSON: {e}")))?;

    let live_set: std::collections::HashSet<String> = live_paths.into_iter().collect();

    self.with_conn_mut(|conn| {
      // Get all files for this project first
      let all_files = {
        let sql = format!("SELECT {SELECT_COLS} FROM code_file WHERE project_id = ?1");
        query_files(conn, &sql, &[&project_id as &dyn rusqlite::types::ToSql])?
      };

      let orphan_paths: Vec<String> = all_files.iter()
        .filter(|f| f.path.starts_with(&scope_prefix) && !live_set.contains(&f.path))
        .map(|f| f.path.clone())
        .collect();

      if orphan_paths.is_empty() {
        return json_str(&PruneResult { files: 0, nodes: 0, edges: 0 });
      }

      let tx = conn.transaction()?;
      let mut total_files = 0u32;
      let mut total_nodes = 0u32;
      let mut total_edges = 0u32;

      for orphan_path in &orphan_paths {
        // Get node IDs in this file for edge cleanup
        let node_ids: Vec<String> = {
          let mut s = tx.prepare("SELECT id FROM code_node WHERE project_id = ?1 AND file = ?2")?;
          let ids: Vec<String> = s.query_map(params![project_id, orphan_path], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();
          ids
        };

        // Delete edges touching these nodes
        for chunk in node_ids.chunks(500) {
          if chunk.is_empty() { continue; }
          let placeholders: String = chunk.iter().enumerate()
            .map(|(i, _)| format!("?{}", i + 2))
            .collect::<Vec<_>>()
            .join(", ");
          let sql = format!(
            "DELETE FROM code_edge WHERE project_id = ?1 AND (from_node IN ({placeholders}) OR to_node IN ({placeholders}))"
          );
          let mut params_vec: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(project_id.clone())];
          for id in chunk { params_vec.push(Box::new(id.clone())); }
          let params_ref: Vec<&dyn rusqlite::types::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
          let deleted = tx.execute(&sql, params_ref.as_slice())?;
          total_edges += deleted as u32;
        }

        // Delete nodes
        let deleted_nodes = tx.execute(
          "DELETE FROM code_node WHERE project_id = ?1 AND file = ?2",
          params![project_id, orphan_path],
        )?;
        total_nodes += deleted_nodes as u32;

        // Delete file record
        tx.execute(
          "DELETE FROM code_file WHERE project_id = ?1 AND path = ?2",
          params![project_id, orphan_path],
        )?;
        total_files += 1;
      }

      tx.commit()?;
      json_str(&PruneResult { files: total_files, nodes: total_nodes, edges: total_edges })
    })
  }

  /// Atomic ingest: delete old data for a file and insert new nodes/edges/file metadata.
  #[napi]
  pub fn ingest_file(
    &self,
    project_id: String,
    file_path: String,
    nodes_json: String,
    edges_json: String,
    file_meta_json: String,
  ) -> napi::Result<()> {
    let nodes: Vec<crate::node::NodeRow> = serde_json::from_str(&nodes_json)
      .map_err(|e| napi::Error::from_reason(format!("invalid nodes JSON: {e}")))?;
    let edges: Vec<crate::edge::EdgeRow> = serde_json::from_str(&edges_json)
      .map_err(|e| napi::Error::from_reason(format!("invalid edges JSON: {e}")))?;
    let file_meta: FileRow = serde_json::from_str(&file_meta_json)
      .map_err(|e| napi::Error::from_reason(format!("invalid file meta JSON: {e}")))?;

    self.with_conn_mut(|conn| {
      let tx = conn.transaction()?;

      // 1. Get node IDs for edge cleanup
      let node_ids: Vec<String> = {
        let mut s = tx.prepare("SELECT id FROM code_node WHERE project_id = ?1 AND file = ?2")?;
        let ids: Vec<String> = s.query_map(params![project_id, file_path], |row| row.get(0))?
          .filter_map(|r| r.ok())
          .collect();
        ids
      };

      // 2. Delete edges touching this file's nodes
      for chunk in node_ids.chunks(500) {
        if chunk.is_empty() { continue; }
        let placeholders: String = chunk.iter().enumerate()
          .map(|(i, _)| format!("?{}", i + 2))
          .collect::<Vec<_>>()
          .join(", ");
        let sql = format!(
          "DELETE FROM code_edge WHERE project_id = ?1 AND (from_node IN ({placeholders}) OR to_node IN ({placeholders}))"
        );
        let mut params_vec: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(project_id.clone())];
        for id in chunk { params_vec.push(Box::new(id.clone())); }
        let params_ref: Vec<&dyn rusqlite::types::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
        tx.execute(&sql, params_ref.as_slice())?;
      }

      // 3. Delete old nodes
      tx.execute(
        "DELETE FROM code_node WHERE project_id = ?1 AND file = ?2",
        params![project_id, file_path],
      )?;

      // 4. Insert new nodes
      for node in &nodes {
        tx.execute(
          "INSERT INTO code_node (id, project_id, kind, name, qualified_name, file, range_start_line, range_start_char, range_end_line, range_end_char, signature, visibility, metadata) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
          params![
            node.id, node.project_id, node.kind, node.name, node.qualified_name,
            node.file, node.range_start_line, node.range_start_char,
            node.range_end_line, node.range_end_char, node.signature,
            node.visibility, node.metadata,
          ],
        )?;
      }

      // 5. Insert new edges
      for edge in &edges {
        tx.execute(
          "INSERT INTO code_edge (id, project_id, kind, from_node, to_node, file, range_start_line, range_start_char, range_end_line, range_end_char) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
          params![
            edge.id, edge.project_id, edge.kind, edge.from_node, edge.to_node,
            edge.file, edge.range_start_line, edge.range_start_char,
            edge.range_end_line, edge.range_end_char,
          ],
        )?;
      }

      // 6. Upsert file metadata
      tx.execute(
        "INSERT INTO code_file (id, project_id, path, sha, size, lang, completeness) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT (project_id, path) DO UPDATE SET sha = ?4, size = ?5, lang = ?6, completeness = ?7, indexed_at = (unixepoch('now', 'subsec') * 1000), time_updated = (unixepoch('now', 'subsec') * 1000)",
        params![file_meta.id, file_meta.project_id, file_meta.path, file_meta.sha, file_meta.size, file_meta.lang, file_meta.completeness],
      )?;

      tx.commit()?;
      Ok(())
    })
  }
}
