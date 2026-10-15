use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::store::{IndexStore, json_str};

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

// `+kind` (unary plus) disables index use for the kind term: without planner
// statistics (no sqlite_stat1 before the first ANALYZE) SQLite would otherwise
// pick code_edge_project_kind_idx and scan every edge of the project. The
// no-op `+` forces code_edge_from_idx / code_edge_to_idx regardless of
// statistics, with identical results.
fn edges_from_sql(kind: bool) -> String {
    if kind {
        format!(
            "SELECT {SELECT_COLS} FROM code_edge WHERE project_id = ?1 AND from_node = ?2 AND +kind = ?3"
        )
    } else {
        format!("SELECT {SELECT_COLS} FROM code_edge WHERE project_id = ?1 AND from_node = ?2")
    }
}

fn edges_to_sql(kind: bool) -> String {
    if kind {
        format!(
            "SELECT {SELECT_COLS} FROM code_edge WHERE project_id = ?1 AND to_node = ?2 AND +kind = ?3"
        )
    } else {
        format!("SELECT {SELECT_COLS} FROM code_edge WHERE project_id = ?1 AND to_node = ?2")
    }
}

fn query_edges(
    conn: &rusqlite::Connection,
    sql: &str,
    p: &[&dyn rusqlite::types::ToSql],
) -> rusqlite::Result<Vec<EdgeRow>> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt
        .query_map(p, row_to_edge)?
        .collect::<Result<Vec<_>, _>>()?;
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
    pub fn edges_from(
        &self,
        project_id: String,
        from_node: String,
        kind: Option<String>,
    ) -> napi::Result<String> {
        self.with_conn(|conn| {
      let rows = if let Some(ref kind) = kind {
        let sql = edges_from_sql(true);
        query_edges(conn, &sql, &[&project_id as &dyn rusqlite::types::ToSql, &from_node, kind])?
      } else {
        let sql = edges_from_sql(false);
        query_edges(conn, &sql, &[&project_id as &dyn rusqlite::types::ToSql, &from_node])?
      };

      json_str(&rows)
    })
    }

    #[napi]
    pub fn edges_to(
        &self,
        project_id: String,
        to_node: String,
        kind: Option<String>,
    ) -> napi::Result<String> {
        self.with_conn(|conn| {
      let rows = if let Some(ref kind) = kind {
        let sql = edges_to_sql(true);
        query_edges(conn, &sql, &[&project_id as &dyn rusqlite::types::ToSql, &to_node, kind])?
      } else {
        let sql = edges_to_sql(false);
        query_edges(conn, &sql, &[&project_id as &dyn rusqlite::types::ToSql, &to_node])?
      };

      json_str(&rows)
    })
    }

    #[napi]
    pub fn edges_in_file(&self, project_id: String, file: String) -> napi::Result<String> {
        self.with_conn(|conn| {
            let sql =
                format!("SELECT {SELECT_COLS} FROM code_edge WHERE project_id = ?1 AND file = ?2");
            let rows = query_edges(
                conn,
                &sql,
                &[&project_id as &dyn rusqlite::types::ToSql, &file],
            )?;
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

      // Single DELETE with subqueries avoids IN-clause chunking and
      // keeps from_node/to_node removal atomic (PERF-12).
      tx.execute(
        "DELETE FROM code_edge WHERE project_id = ?1 AND (
           from_node IN (SELECT id FROM code_node WHERE project_id = ?1 AND file = ?2)
           OR to_node IN (SELECT id FROM code_node WHERE project_id = ?1 AND file = ?2)
         )",
        params![project_id, file],
      )?;

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::IndexStore;

    fn explain_plan(conn: &rusqlite::Connection, sql: &str, node: &str) -> String {
        let explain = format!("EXPLAIN QUERY PLAN {sql}");
        let mut stmt = conn.prepare(&explain).unwrap();
        stmt.query_map(params!["p", node, "calls"], |row| row.get::<_, String>(3))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
            .join("\n")
    }

    #[test]
    fn plus_kind_uses_node_indexes_without_analyze() {
        let store = IndexStore::new(":memory:".into()).unwrap();
        store
            .with_conn(|conn| {
                conn.execute_batch("INSERT INTO code_edge(id,project_id,kind,from_node,to_node,file) VALUES ('e1','p','calls','a','b','/a'),('e2','p','references','a','b','/a'),('e3','p','calls','a','c','/a'),('e4','p','calls','c','b','/a');")?;
                for i in 0..40 {
                    conn.execute("INSERT INTO code_edge(id,project_id,kind,from_node,to_node,file) VALUES (?1,'p','imports','a','d','/a')", params![format!("f{i}")])?;
                }
                Ok(())
            })
            .unwrap();
        {
            let guard = store.conn.lock().unwrap();
            let conn = guard.as_ref().unwrap();
            let stat1: i64 = conn
                .query_row("SELECT count(*) FROM sqlite_master WHERE name='sqlite_stat1'", [], |row| row.get(0))
                .unwrap();
            assert_eq!(stat1, 0, "test must run without ANALYZE / sqlite_stat1");
            let from_plan = explain_plan(conn, &edges_from_sql(true), "a");
            assert!(from_plan.contains("code_edge_from_idx"), "edges_from plan: {from_plan}");
            assert!(!from_plan.contains("code_edge_project_kind_idx"), "edges_from plan: {from_plan}");
            let to_plan = explain_plan(conn, &edges_to_sql(true), "b");
            assert!(to_plan.contains("code_edge_to_idx"), "edges_to plan: {to_plan}");
            assert!(!to_plan.contains("code_edge_project_kind_idx"), "edges_to plan: {to_plan}");
        }
        let from: Vec<EdgeRow> =
            serde_json::from_str(&store.edges_from("p".into(), "a".into(), Some("calls".into())).unwrap()).unwrap();
        assert_eq!(from.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), vec!["e1", "e3"]);
        let to: Vec<EdgeRow> =
            serde_json::from_str(&store.edges_to("p".into(), "b".into(), Some("calls".into())).unwrap()).unwrap();
        assert_eq!(to.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), vec!["e1", "e4"]);
        let all_from: Vec<EdgeRow> =
            serde_json::from_str(&store.edges_from("p".into(), "a".into(), None).unwrap()).unwrap();
        assert_eq!(all_from.len(), 43);
    }
}
