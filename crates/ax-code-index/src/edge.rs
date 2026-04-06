use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::store::{json_str, IndexStore};

#[derive(Debug, Serialize, Deserialize)]
pub struct EdgeRow {
  pub id: String,
  pub project_id: String,
  pub kind: String,
  pub from_node: String,
  pub to_node: String,
  pub file: String,
  pub range_start_line: i64,
  pub range_start_char: i64,
  pub range_end_line: i64,
  pub range_end_char: i64,
  pub time_created: Option<i64>,
  pub time_updated: Option<i64>,
}

fn row_to_edge(row: &rusqlite::Row) -> rusqlite::Result<EdgeRow> {
  Ok(EdgeRow {
    id: row.get(0)?,
    project_id: row.get(1)?,
    kind: row.get(2)?,
    from_node: row.get(3)?,
    to_node: row.get(4)?,
    file: row.get(5)?,
    range_start_line: row.get(6)?,
    range_start_char: row.get(7)?,
    range_end_line: row.get(8)?,
    range_end_char: row.get(9)?,
    time_created: row.get(10)?,
    time_updated: row.get(11)?,
  })
}

const SELECT_COLS: &str = "id, project_id, kind, from_node, to_node, file, range_start_line, range_start_char, range_end_line, range_end_char, time_created, time_updated";

fn query_edges(conn: &rusqlite::Connection, sql: &str, p: &[&dyn rusqlite::types::ToSql]) -> rusqlite::Result<Vec<EdgeRow>> {
  let mut stmt = conn.prepare(sql)?;
  let rows = stmt.query_map(p, row_to_edge)?
    .filter_map(|r| r.ok())
    .collect();
  Ok(rows)
}

#[napi]
impl IndexStore {
  #[napi]
  pub fn insert_edges(&self, json: String) -> napi::Result<()> {
    let rows: Vec<EdgeRow> = serde_json::from_str(&json)
      .map_err(|e| napi::Error::from_reason(format!("invalid JSON: {e}")))?;

    if rows.is_empty() {
      return Ok(());
    }

    self.with_conn_mut(|conn| {
      let tx = conn.transaction()?;
      {
        let mut stmt = tx.prepare_cached(
          "INSERT INTO code_edge (id, project_id, kind, from_node, to_node, file, range_start_line, range_start_char, range_end_line, range_end_char) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"
        )?;

        for row in &rows {
          stmt.execute(params![
            row.id,
            row.project_id,
            row.kind,
            row.from_node,
            row.to_node,
            row.file,
            row.range_start_line,
            row.range_start_char,
            row.range_end_line,
            row.range_end_char,
          ])?;
        }
      }
      tx.commit()?;
      Ok(())
    })
  }

  #[napi]
  pub fn edges_from(&self, project_id: String, from_node: String, kind: Option<String>) -> napi::Result<String> {
    self.with_conn(|conn| {
      let rows = if let Some(ref kind) = kind {
        let sql = format!(
          "SELECT {SELECT_COLS} FROM code_edge WHERE project_id = ?1 AND from_node = ?2 AND kind = ?3"
        );
        query_edges(conn, &sql, &[&project_id as &dyn rusqlite::types::ToSql, &from_node, kind])?
      } else {
        let sql = format!(
          "SELECT {SELECT_COLS} FROM code_edge WHERE project_id = ?1 AND from_node = ?2"
        );
        query_edges(conn, &sql, &[&project_id as &dyn rusqlite::types::ToSql, &from_node])?
      };

      json_str(&rows)
    })
  }

  #[napi]
  pub fn edges_to(&self, project_id: String, to_node: String, kind: Option<String>) -> napi::Result<String> {
    self.with_conn(|conn| {
      let rows = if let Some(ref kind) = kind {
        let sql = format!(
          "SELECT {SELECT_COLS} FROM code_edge WHERE project_id = ?1 AND to_node = ?2 AND kind = ?3"
        );
        query_edges(conn, &sql, &[&project_id as &dyn rusqlite::types::ToSql, &to_node, kind])?
      } else {
        let sql = format!(
          "SELECT {SELECT_COLS} FROM code_edge WHERE project_id = ?1 AND to_node = ?2"
        );
        query_edges(conn, &sql, &[&project_id as &dyn rusqlite::types::ToSql, &to_node])?
      };

      json_str(&rows)
    })
  }

  #[napi]
  pub fn edges_in_file(&self, project_id: String, file: String) -> napi::Result<String> {
    self.with_conn(|conn| {
      let sql = format!(
        "SELECT {SELECT_COLS} FROM code_edge WHERE project_id = ?1 AND file = ?2"
      );
      let rows = query_edges(conn, &sql, &[&project_id as &dyn rusqlite::types::ToSql, &file])?;
      json_str(&rows)
    })
  }

  #[napi]
  pub fn delete_edges_in_file(&self, project_id: String, file: String) -> napi::Result<()> {
    self.with_conn(|conn| {
      conn.execute(
        "DELETE FROM code_edge WHERE project_id = ?1 AND file = ?2",
        params![project_id, file],
      )?;
      Ok(())
    })
  }

  #[napi]
  pub fn delete_edges_touching_file(&self, project_id: String, file: String) -> napi::Result<()> {
    self.with_conn_mut(|conn| {
      let tx = conn.transaction()?;

      let node_ids: Vec<String> = {
        let mut stmt = tx.prepare("SELECT id FROM code_node WHERE project_id = ?1 AND file = ?2")?;
        let ids: Vec<String> = stmt.query_map(params![project_id, file], |row| row.get(0))?
          .filter_map(|r| r.ok())
          .collect();
        ids
      };

      if node_ids.is_empty() {
        tx.commit()?;
        return Ok(());
      }

      for chunk in node_ids.chunks(500) {
        let placeholders: String = chunk.iter().enumerate()
          .map(|(i, _)| format!("?{}", i + 2))
          .collect::<Vec<_>>()
          .join(", ");

        let sql = format!(
          "DELETE FROM code_edge WHERE project_id = ?1 AND (from_node IN ({placeholders}) OR to_node IN ({placeholders}))"
        );

        let mut params_vec: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(project_id.clone())];
        for id in chunk {
          params_vec.push(Box::new(id.clone()));
        }
        let params_ref: Vec<&dyn rusqlite::types::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();

        tx.execute(&sql, params_ref.as_slice())?;
      }

      tx.commit()?;
      Ok(())
    })
  }

  #[napi]
  pub fn count_edges(&self, project_id: String) -> napi::Result<u32> {
    self.with_conn(|conn| {
      let count: u32 = conn.query_row(
        "SELECT count(*) FROM code_edge WHERE project_id = ?1",
        params![project_id],
        |row| row.get(0),
      )?;
      Ok(count)
    })
  }
}
