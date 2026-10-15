//! Coarse call-edge projections; scope and explanation policy remain with the host.
use crate::{store::IndexStore, worker::IndexCancellation};
use napi::{Env, Result, Task, bindgen_prelude::AsyncTask};
use rusqlite::{Connection, OpenFlags, params};
use serde::Serialize;
use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicUsize, Ordering},
};

const MAX_ROWS: usize = 50_000;
const MAX_OUTPUT: usize = 16 * 1024 * 1024;
const MAX_STEPS: usize = 50_000_000;
fn check(cancel: &AtomicBool) -> Result<()> {
    if cancel.load(Ordering::Relaxed) {
        return Err(napi::Error::from_reason("Native graph query cancelled"));
    }
    Ok(())
}
#[derive(Serialize)]
struct Neighbor {
    id: String,
    project_id: String,
    kind: String,
    name: String,
    qualified_name: String,
    file: String,
    range_start_line: i64,
    range_start_char: i64,
    range_end_line: i64,
    range_end_char: i64,
    signature: Option<String>,
    visibility: Option<String>,
    indexed_at: Option<i64>,
    completeness: Option<String>,
}
// `+e.kind` (unary plus) disables index use for the kind term: without
// planner statistics (no sqlite_stat1 before the first ANALYZE) SQLite would
// otherwise pick code_edge_project_kind_idx and scan every edge of the
// project. The no-op `+` forces code_edge_to_idx / code_edge_from_idx
// regardless of statistics, with identical results.
fn neighbors_sql(callers: bool) -> String {
    let (anchor, neighbor) = if callers {
        ("to_node", "from_node")
    } else {
        ("from_node", "to_node")
    };
    format!("SELECT n.id,n.project_id,n.kind,n.name,n.qualified_name,n.file,n.range_start_line,n.range_start_char,n.range_end_line,n.range_end_char,n.signature,n.visibility,f.indexed_at,f.completeness
      FROM code_edge e JOIN code_node n ON n.id=e.{neighbor} AND n.project_id=e.project_id
      LEFT JOIN code_file f ON f.project_id=n.project_id AND f.path=n.file
      WHERE e.project_id=?1 AND e.{anchor}=?2 AND +e.kind='calls' ORDER BY e.rowid")
}
fn query(
    conn: &Connection,
    project: &str,
    symbol: &str,
    callers: bool,
    cancel: Arc<AtomicBool>,
) -> Result<String> {
    check(&cancel)?;
    if project.len() + symbol.len() > 16 * 1024 {
        return Err(napi::Error::from_reason("Graph query input limit exceeded"));
    }
    let steps = Arc::new(AtomicUsize::new(0));
    let progress_steps = steps.clone();
    let progress_cancel = cancel.clone();
    let _ = conn.progress_handler(
        1000,
        Some(move || {
            progress_cancel.load(Ordering::Relaxed)
                || progress_steps.fetch_add(1000, Ordering::Relaxed) >= MAX_STEPS
        }),
    );
    let result = (|| {
        // Both joins are project-scoped. A single SELECT observes one SQLite snapshot.
        // Preserve edge multiplicity and the existing indexed edge iteration order.
        let sql = neighbors_sql(callers);
        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;
        let mut rows = stmt
            .query(params![project, symbol])
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;
        let mut output = String::from("[");
        let mut count = 0;
        while let Some(row) = rows
            .next()
            .map_err(|e| napi::Error::from_reason(e.to_string()))?
        {
            check(&cancel)?;
            count += 1;
            if count > MAX_ROWS {
                return Err(napi::Error::from_reason("Graph query row limit exceeded"));
            }
            let data = (|| -> rusqlite::Result<Neighbor> {
                Ok(Neighbor {
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
                    indexed_at: row.get(12)?,
                    completeness: row.get(13)?,
                })
            })()
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;
            let json = serde_json::to_string(&data)
                .map_err(|e| napi::Error::from_reason(e.to_string()))?;
            if output.len() + json.len() + 2 > MAX_OUTPUT {
                return Err(napi::Error::from_reason(
                    "Graph query output limit exceeded",
                ));
            }
            if count > 1 {
                output.push(',');
            }
            output.push_str(&json);
        }
        output.push(']');
        Ok(output)
    })();
    let _ = conn.progress_handler(0, None::<fn() -> bool>);
    check(&cancel)?;
    if steps.load(Ordering::Relaxed) >= MAX_STEPS {
        return Err(napi::Error::from_reason("Graph query work limit exceeded"));
    }
    result
}
#[napi]
impl IndexStore {
    #[napi]
    pub fn call_neighbors(&self, project: String, symbol: String, callers: bool) -> Result<String> {
        // No asynchronous worker holds this mutex. Legacy synchronous consumers
        // perform one bounded projection rather than 1+2N bridge calls.
        let guard = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let conn = guard
            .as_ref()
            .ok_or_else(|| napi::Error::from_reason("index store is closed"))?;
        query(
            conn,
            &project,
            &symbol,
            callers,
            Arc::new(AtomicBool::new(false)),
        )
    }
}
pub struct NeighborsTask {
    path: String,
    project: String,
    symbol: String,
    callers: bool,
    cancel: Arc<AtomicBool>,
}
impl Task for NeighborsTask {
    type Output = String;
    type JsValue = String;
    fn compute(&mut self) -> Result<String> {
        check(&self.cancel)?;
        if self.path.len() + self.project.len() + self.symbol.len() > 16 * 1024 {
            return Err(napi::Error::from_reason("Graph query input limit exceeded"));
        }
        let conn = Connection::open_with_flags(
            &self.path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
        conn.busy_timeout(std::time::Duration::from_secs(1))
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;
        query(
            &conn,
            &self.project,
            &self.symbol,
            self.callers,
            self.cancel.clone(),
        )
    }
    fn resolve(&mut self, _: Env, output: String) -> Result<String> {
        check(&self.cancel)?;
        Ok(output)
    }
}
#[napi(ts_return_type = "Promise<string>")]
pub fn call_neighbors_async(
    db_path: String,
    project: String,
    symbol: String,
    callers: bool,
    cancellation: &IndexCancellation,
) -> AsyncTask<NeighborsTask> {
    AsyncTask::new(NeighborsTask {
        path: db_path,
        project,
        symbol,
        callers,
        cancel: cancellation.cancelled.clone(),
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn duplicates_project_isolation_missing_metadata_and_cancel() {
        let store = IndexStore::new(":memory:".into()).unwrap();
        store.with_conn(|conn| conn.execute_batch("INSERT INTO code_node(id,project_id,kind,name,qualified_name,file,range_start_line,range_start_char,range_end_line,range_end_char) VALUES ('a','p','function','a','a','/a',0,0,1,0),('b','p','function','b','b','/b',0,0,1,0),('foreign','q','function','foreign','foreign','/a',0,0,1,0); INSERT INTO code_edge(id,project_id,kind,from_node,to_node,file) VALUES ('e1','p','calls','a','b','/a'),('e2','p','calls','a','b','/a'),('e3','p','calls','foreign','b','/a'),('e4','p','calls','missing','b','/a');")).unwrap();
        let json = store.call_neighbors("p".into(), "b".into(), true).unwrap();
        let rows: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(rows.as_array().unwrap().len(), 2);
        assert_eq!(rows[0]["id"], "a");
        assert!(rows[0]["completeness"].is_null());
        let guard = store.conn.lock().unwrap();
        assert!(
            query(
                guard.as_ref().unwrap(),
                "p",
                "b",
                true,
                Arc::new(AtomicBool::new(true))
            )
            .unwrap_err()
            .reason
            .contains("cancelled")
        );
    }
    fn explain_plan(conn: &Connection, sql: &str, symbol: &str) -> String {
        let explain = format!("EXPLAIN QUERY PLAN {sql}");
        let mut stmt = conn.prepare(&explain).unwrap();
        let rows = stmt
            .query_map(params!["p", symbol], |row| row.get::<_, String>(3))
            .unwrap()
            .collect::<std::result::Result<Vec<_>, _>>()
            .unwrap();
        rows.join("\n")
    }
    #[test]
    fn plus_kind_uses_node_indexes_without_analyze() {
        let store = IndexStore::new(":memory:".into()).unwrap();
        store.with_conn(|conn| {
            conn.execute_batch("INSERT INTO code_node(id,project_id,kind,name,qualified_name,file,range_start_line,range_start_char,range_end_line,range_end_char) VALUES ('a','p','function','a','a','/a',0,0,1,0),('b','p','function','b','b','/b',0,0,1,0),('c','p','function','c','c','/c',0,0,1,0),('d','p','function','d','d','/d',0,0,1,0); INSERT INTO code_edge(id,project_id,kind,from_node,to_node,file) VALUES ('e1','p','calls','a','b','/a'),('e2','p','calls','c','b','/a'),('e3','p','references','a','b','/a'),('e4','p','calls','b','a','/a'),('e5','p','calls','b','c','/a');")?;
            for i in 0..40 {
                conn.execute(
                    "INSERT INTO code_edge(id,project_id,kind,from_node,to_node,file) VALUES (?1,'p','imports','a','d','/a')",
                    params![format!("f{i}")],
                )?;
            }
            Ok(())
        }).unwrap();
        {
            let guard = store.conn.lock().unwrap();
            let conn = guard.as_ref().unwrap();
            let stat1: i64 = conn
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE name='sqlite_stat1'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(stat1, 0, "test must run without ANALYZE / sqlite_stat1");
            let callers = explain_plan(conn, &neighbors_sql(true), "b");
            assert!(
                callers.contains("code_edge_to_idx"),
                "callers plan: {callers}"
            );
            assert!(
                !callers.contains("code_edge_project_kind_idx"),
                "callers plan: {callers}"
            );
            let callees = explain_plan(conn, &neighbors_sql(false), "b");
            assert!(
                callees.contains("code_edge_from_idx"),
                "callees plan: {callees}"
            );
            assert!(
                !callees.contains("code_edge_project_kind_idx"),
                "callees plan: {callees}"
            );
        }
        let callers: serde_json::Value =
            serde_json::from_str(&store.call_neighbors("p".into(), "b".into(), true).unwrap())
                .unwrap();
        assert_eq!(
            callers
                .as_array()
                .unwrap()
                .iter()
                .map(|row| row["id"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec!["a", "c"]
        );
        let callees: serde_json::Value =
            serde_json::from_str(&store.call_neighbors("p".into(), "b".into(), false).unwrap())
                .unwrap();
        assert_eq!(
            callees
                .as_array()
                .unwrap()
                .iter()
                .map(|row| row["id"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec!["a", "c"]
        );
    }
}
