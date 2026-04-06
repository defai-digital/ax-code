use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::store::{json_str, IndexStore};

#[derive(Debug, Serialize, Deserialize)]
pub struct NodeRow {
  pub id: String,
  pub project_id: String,
  pub kind: String,
  pub name: String,
  pub qualified_name: String,
  pub file: String,
  pub range_start_line: i64,
  pub range_start_char: i64,
  pub range_end_line: i64,
  pub range_end_char: i64,
  pub signature: Option<String>,
  pub visibility: Option<String>,
  pub metadata: Option<String>,
  pub indexed_at: Option<i64>,
  pub time_created: Option<i64>,
  pub time_updated: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FindOpts {
  #[serde(default)]
  pub kind: Option<String>,
  #[serde(default)]
  pub file: Option<String>,
  #[serde(default)]
  pub limit: Option<u32>,
}

fn row_to_node(row: &rusqlite::Row) -> rusqlite::Result<NodeRow> {
  Ok(NodeRow {
    id: row.get(0)?,
    project_id: row.get(1)?,
    kind: row.get(2)?,
    name: row.get(3)?,
    qualified_name: row.get(4)?,
    file: row.get(5)?,
    range_start_line: row.get(6)?,
    range_start_char: row.get(7)?,
    range_end_line: row.get(8)?,
    range_end_char: row.get(9)?,
    signature: row.get(10)?,
    visibility: row.get(11)?,
    metadata: row.get(12)?,
    indexed_at: row.get(13)?,
    time_created: row.get(14)?,
    time_updated: row.get(15)?,
  })
}

const SELECT_COLS: &str = "id, project_id, kind, name, qualified_name, file, range_start_line, range_start_char, range_end_line, range_end_char, signature, visibility, metadata, indexed_at, time_created, time_updated";

#[napi]
impl IndexStore {
  #[napi]
  pub fn insert_nodes(&self, json: String) -> napi::Result<()> {
    let rows: Vec<NodeRow> = serde_json::from_str(&json)
      .map_err(|e| napi::Error::from_reason(format!("invalid JSON: {e}")))?;

    if rows.is_empty() {
      return Ok(());
    }

    self.with_conn_mut(|conn| {
      let tx = conn.transaction()?;
      {
        let mut stmt = tx.prepare_cached(
          "INSERT INTO code_node (id, project_id, kind, name, qualified_name, file, range_start_line, range_start_char, range_end_line, range_end_char, signature, visibility, metadata) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)"
        )?;

        for row in &rows {
          stmt.execute(params![
            row.id,
            row.project_id,
            row.kind,
            row.name,
            row.qualified_name,
            row.file,
            row.range_start_line,
            row.range_start_char,
            row.range_end_line,
            row.range_end_char,
            row.signature,
            row.visibility,
            row.metadata,
          ])?;
        }
      }
      tx.commit()?;
      Ok(())
    })
  }

  #[napi]
  pub fn get_node(&self, project_id: String, id: String) -> napi::Result<Option<String>> {
    self.with_conn(|conn| {
      let mut stmt = conn.prepare_cached(&format!(
        "SELECT {SELECT_COLS} FROM code_node WHERE project_id = ?1 AND id = ?2"
      ))?;
      let result = stmt.query_row(params![project_id, id], row_to_node).optional()?;
      match result {
        Some(r) => Ok(Some(json_str(&r)?)),
        None => Ok(None),
      }
    })
  }

  #[napi]
  pub fn find_nodes_by_name(&self, project_id: String, name: String, opts_json: String) -> napi::Result<String> {
    let opts: FindOpts = serde_json::from_str(&opts_json).unwrap_or(FindOpts { kind: None, file: None, limit: None });

    self.with_conn(|conn| {
      let mut sql = format!("SELECT {SELECT_COLS} FROM code_node WHERE project_id = ?1 AND name = ?2");
      let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![
        Box::new(project_id.clone()),
        Box::new(name.clone()),
      ];

      if let Some(ref kind) = opts.kind {
        sql.push_str(" AND kind = ?3");
        param_values.push(Box::new(kind.clone()));
      }
      if let Some(ref file) = opts.file {
        sql.push_str(&format!(" AND file = ?{}", param_values.len() + 1));
        param_values.push(Box::new(file.clone()));
      }

      sql.push_str(" ORDER BY file, range_start_line");

      if let Some(limit) = opts.limit {
        sql.push_str(&format!(" LIMIT {limit}"));
      }

      let mut stmt = conn.prepare(&sql)?;
      let params_ref: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();
      let rows: Vec<NodeRow> = stmt.query_map(params_ref.as_slice(), row_to_node)?
        .filter_map(|r| r.ok())
        .collect();

      json_str(&rows)
    })
  }

  #[napi]
  pub fn find_nodes_by_prefix(&self, project_id: String, prefix: String, opts_json: String) -> napi::Result<String> {
    let opts: FindOpts = serde_json::from_str(&opts_json).unwrap_or(FindOpts { kind: None, file: None, limit: None });

    self.with_conn(|conn| {
      // Range query: name >= prefix AND name < prefix+\uFFFF (avoids LIKE)
      let upper = format!("{prefix}\u{FFFF}");
      let mut sql = format!(
        "SELECT {SELECT_COLS} FROM code_node WHERE project_id = ?1 AND name >= ?2 AND name < ?3"
      );
      let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![
        Box::new(project_id.clone()),
        Box::new(prefix.clone()),
        Box::new(upper),
      ];

      if let Some(ref kind) = opts.kind {
        sql.push_str(&format!(" AND kind = ?{}", param_values.len() + 1));
        param_values.push(Box::new(kind.clone()));
      }

      sql.push_str(" ORDER BY name, file, range_start_line");

      if let Some(limit) = opts.limit {
        sql.push_str(&format!(" LIMIT {limit}"));
      }

      let mut stmt = conn.prepare(&sql)?;
      let params_ref: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();
      let rows: Vec<NodeRow> = stmt.query_map(params_ref.as_slice(), row_to_node)?
        .filter_map(|r| r.ok())
        .collect();

      json_str(&rows)
    })
  }

  #[napi]
  pub fn nodes_in_file(&self, project_id: String, file: String) -> napi::Result<String> {
    self.with_conn(|conn| {
      let mut stmt = conn.prepare_cached(&format!(
        "SELECT {SELECT_COLS} FROM code_node WHERE project_id = ?1 AND file = ?2 ORDER BY range_start_line"
      ))?;
      let rows: Vec<NodeRow> = stmt.query_map(params![project_id, file], row_to_node)?
        .filter_map(|r| r.ok())
        .collect();

      json_str(&rows)
    })
  }

  #[napi]
  pub fn count_nodes(&self, project_id: String) -> napi::Result<u32> {
    self.with_conn(|conn| {
      let mut stmt = conn.prepare_cached(
        "SELECT count(*) FROM code_node WHERE project_id = ?1"
      )?;
      let count: u32 = stmt.query_row(params![project_id], |row| row.get(0))?;
      Ok(count)
    })
  }

  #[napi]
  pub fn delete_nodes_in_file(&self, project_id: String, file: String) -> napi::Result<()> {
    self.with_conn(|conn| {
      conn.execute(
        "DELETE FROM code_node WHERE project_id = ?1 AND file = ?2",
        params![project_id, file],
      )?;
      Ok(())
    })
  }

  #[napi]
  pub fn recent_nodes(&self, project_id: String, limit: u32) -> napi::Result<String> {
    self.with_conn(|conn| {
      let mut stmt = conn.prepare_cached(&format!(
        "SELECT {SELECT_COLS} FROM code_node WHERE project_id = ?1 ORDER BY time_updated DESC LIMIT ?2"
      ))?;
      let rows: Vec<NodeRow> = stmt.query_map(params![project_id, limit], row_to_node)?
        .filter_map(|r| r.ok())
        .collect();

      json_str(&rows)
    })
  }
}

// Optional trait for rusqlite
use rusqlite::OptionalExtension;
