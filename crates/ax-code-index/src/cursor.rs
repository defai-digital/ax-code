use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::store::{json_str, IndexStore};

#[derive(Debug, Serialize, Deserialize)]
pub struct CursorRow {
  pub project_id: String,
  pub commit_sha: Option<String>,
  pub node_count: i64,
  pub edge_count: i64,
  pub time_created: Option<i64>,
  pub time_updated: Option<i64>,
}

#[napi]
impl IndexStore {
  #[napi]
  pub fn get_cursor(&self, project_id: String) -> napi::Result<Option<String>> {
    self.with_conn(|conn| {
      let mut stmt = conn.prepare_cached(
        "SELECT project_id, commit_sha, node_count, edge_count, time_created, time_updated FROM code_index_cursor WHERE project_id = ?1"
      )?;
      let result = stmt.query_row(params![project_id], |row| {
        Ok(CursorRow {
          project_id: row.get(0)?,
          commit_sha: row.get(1)?,
          node_count: row.get(2)?,
          edge_count: row.get(3)?,
          time_created: row.get(4)?,
          time_updated: row.get(5)?,
        })
      }).optional()?;
      match result {
        Some(r) => Ok(Some(json_str(&r)?)),
        None => Ok(None),
      }
    })
  }

  #[napi]
  pub fn upsert_cursor(
    &self,
    project_id: String,
    commit_sha: Option<String>,
    node_count: i64,
    edge_count: i64,
  ) -> napi::Result<()> {
    self.with_conn(|conn| {
      conn.execute(
        "INSERT INTO code_index_cursor (project_id, commit_sha, node_count, edge_count) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (project_id) DO UPDATE SET commit_sha = ?2, node_count = ?3, edge_count = ?4, time_updated = (unixepoch('now', 'subsec') * 1000)",
        params![project_id, commit_sha, node_count, edge_count],
      )?;
      Ok(())
    })
  }

  /// Clear all data for a project
  #[napi]
  pub fn clear_project(&self, project_id: String) -> napi::Result<()> {
    self.with_conn_mut(|conn| {
      let tx = conn.transaction()?;
      tx.execute("DELETE FROM code_edge WHERE project_id = ?1", params![project_id])?;
      tx.execute("DELETE FROM code_node WHERE project_id = ?1", params![project_id])?;
      tx.execute("DELETE FROM code_file WHERE project_id = ?1", params![project_id])?;
      tx.execute("DELETE FROM code_index_cursor WHERE project_id = ?1", params![project_id])?;
      tx.commit()?;
      Ok(())
    })
  }

  /// Run ANALYZE on graph tables to refresh query planner statistics
  #[napi]
  pub fn analyze(&self) -> napi::Result<()> {
    self.with_conn(|conn| {
      conn.execute_batch("ANALYZE code_node; ANALYZE code_edge; ANALYZE code_file;")?;
      Ok(())
    })
  }
}
