//! Coarse call-edge projections; scope and explanation policy remain with the host.
use crate::{store::IndexStore, worker::IndexCancellation};
use napi::{Env, Result, Task, bindgen_prelude::AsyncTask};
use rusqlite::{Connection, OpenFlags, params};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
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
// ── Breadth-first call-graph walk ──────────────────────────────────────────
//
// The host's impact analysis visits up to `budget` nodes, one neighbor query
// per dequeued node. Over the bridge that serialized every edge row (the same
// node once per caller edge; ~360 rows per anchor around the hubs of a real
// index). Walking in here keeps the edges on this side of the bridge and emits
// each visited node once, in the host loop's exact order: per-anchor rowid
// order, first-arrival parents, the budget checked after every insertion, no
// expansion at `depth`. The edge scan reads only the neighbor id; the node and
// file columns are fetched once per node that is actually new, so a hub whose
// callers were all seen already costs one index scan and no joins.

fn edges_sql(callers: bool) -> String {
    let (anchor, neighbor) = if callers {
        ("to_node", "from_node")
    } else {
        ("from_node", "to_node")
    };
    // `+e.kind`: see neighbors_sql.
    format!(
        "SELECT e.{neighbor} FROM code_edge e WHERE e.project_id=?1 AND e.{anchor}=?2 AND +e.kind='calls' ORDER BY e.rowid"
    )
}

const NODE_SQL: &str = "SELECT n.id,n.project_id,n.kind,n.name,n.qualified_name,n.file,n.range_start_line,n.range_start_char,n.range_end_line,n.range_end_char,n.signature,n.visibility,f.indexed_at,f.completeness
      FROM code_node n LEFT JOIN code_file f ON f.project_id=n.project_id AND f.path=n.file
      WHERE n.project_id=?1 AND n.id=?2";

const MAX_WALK_SEEDS: usize = 10_000;
const MAX_WALK_BUDGET: usize = 50_000;
const MAX_WALK_DEPTH: usize = 64;

#[derive(Deserialize)]
struct WalkOptions {
    /// Already-visited seeds at distance 0, in visit order.
    seeds: Vec<String>,
    #[serde(default = "default_callers")]
    callers: bool,
    depth: usize,
    /// Total visit budget including the seeds.
    budget: usize,
    /// Scope roots (resolved absolute paths). A node whose file lies outside
    /// every root is neither emitted nor expanded. `None` disables the filter.
    #[serde(default)]
    roots: Option<Vec<String>>,
}

fn default_callers() -> bool {
    true
}

#[derive(Serialize)]
struct WalkNode {
    #[serde(flatten)]
    node: Neighbor,
    distance: usize,
    parent: String,
}

/// Collapse `.`, `..` and repeated separators like `path.resolve` does for
/// an absolute input. Windows paths compare with `/` separators and
/// case-insensitively, matching `path.win32.relative`. A relative file path
/// stays relative and therefore matches no root; the host resolves those
/// against the process cwd, but indexed files are stored absolute.
fn normalize_path(path: &str) -> String {
    let unified = if cfg!(windows) {
        path.replace('\\', "/").to_lowercase()
    } else {
        path.to_string()
    };
    let absolute = unified.starts_with('/');
    let mut parts: Vec<&str> = Vec::new();
    for segment in unified.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    let joined = parts.join("/");
    if absolute { format!("/{joined}") } else { joined }
}

fn in_roots(file: &str, roots: &[String]) -> bool {
    let normalized = normalize_path(file);
    roots.iter().any(|root| {
        if root == "/" {
            return normalized.starts_with('/');
        }
        normalized == *root || normalized.starts_with(&format!("{root}/"))
    })
}

fn read_neighbor(row: &rusqlite::Row<'_>) -> rusqlite::Result<Neighbor> {
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
}

fn walk(
    conn: &Connection,
    project: &str,
    options: &WalkOptions,
    cancel: Arc<AtomicBool>,
) -> Result<String> {
    check(&cancel)?;
    if options.seeds.len() > MAX_WALK_SEEDS
        || options.budget > MAX_WALK_BUDGET
        || options.depth > MAX_WALK_DEPTH
        || options
            .seeds
            .iter()
            .any(|seed| project.len() + seed.len() > 16 * 1024)
    {
        return Err(napi::Error::from_reason("Graph query input limit exceeded"));
    }
    let roots: Option<Vec<String>> = options
        .roots
        .as_ref()
        .map(|roots| roots.iter().map(|root| normalize_path(root)).collect());
    // The per-anchor step budget of `query` is kept: the counter resets for
    // every dequeued node, so one pathological anchor still fails the walk the
    // way it failed the single query.
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
        let mut edges = conn
            .prepare(&edges_sql(options.callers))
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;
        let mut node_stmt = conn
            .prepare(NODE_SQL)
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;
        let mut visited: HashSet<String> = HashSet::new();
        // Neighbors that resolved to no node (dangling or cross-project edge)
        // or to a file outside the roots: skipped without another lookup.
        let mut rejected: HashSet<String> = HashSet::new();
        let mut queue: Vec<(String, usize)> = Vec::new();
        for seed in &options.seeds {
            if visited.insert(seed.clone()) {
                queue.push((seed.clone(), 0));
            }
        }
        let mut count = visited.len();
        let mut output = String::from("{\"nodes\":[");
        let mut emitted = 0usize;
        let mut truncated = false;
        let mut head = 0usize;
        'walk: while head < queue.len() {
            let (id, distance) = {
                let entry = &queue[head];
                (entry.0.clone(), entry.1)
            };
            head += 1;
            if distance >= options.depth {
                continue;
            }
            steps.store(0, Ordering::Relaxed);
            let mut rows = edges
                .query(params![project, id.as_str()])
                .map_err(|e| napi::Error::from_reason(e.to_string()))?;
            let mut row_count = 0usize;
            while let Some(row) = rows
                .next()
                .map_err(|e| napi::Error::from_reason(e.to_string()))?
            {
                check(&cancel)?;
                row_count += 1;
                if row_count > MAX_ROWS {
                    return Err(napi::Error::from_reason("Graph query row limit exceeded"));
                }
                let next_id: String = row
                    .get(0)
                    .map_err(|e| napi::Error::from_reason(e.to_string()))?;
                if visited.contains(&next_id) || rejected.contains(&next_id) {
                    continue;
                }
                let data = match node_stmt
                    .query_row(params![project, next_id.as_str()], read_neighbor)
                {
                    Ok(data) => data,
                    Err(rusqlite::Error::QueryReturnedNoRows) => {
                        rejected.insert(next_id);
                        continue;
                    }
                    Err(e) => return Err(napi::Error::from_reason(e.to_string())),
                };
                if let Some(roots) = &roots
                    && !in_roots(&data.file, roots)
                {
                    rejected.insert(next_id);
                    continue;
                }
                visited.insert(next_id.clone());
                let node = WalkNode {
                    node: data,
                    distance: distance + 1,
                    parent: id.clone(),
                };
                let json = serde_json::to_string(&node)
                    .map_err(|e| napi::Error::from_reason(e.to_string()))?;
                if output.len() + json.len() + 32 > MAX_OUTPUT {
                    return Err(napi::Error::from_reason(
                        "Graph query output limit exceeded",
                    ));
                }
                if emitted > 0 {
                    output.push(',');
                }
                output.push_str(&json);
                emitted += 1;
                count += 1;
                if count >= options.budget {
                    truncated = true;
                    break 'walk;
                }
                queue.push((next_id, distance + 1));
            }
            if steps.load(Ordering::Relaxed) >= MAX_STEPS {
                return Err(napi::Error::from_reason("Graph query work limit exceeded"));
            }
        }
        output.push_str(&format!("],\"truncated\":{truncated}}}"));
        Ok(output)
    })();
    let _ = conn.progress_handler(0, None::<fn() -> bool>);
    check(&cancel)?;
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

    /// One breadth-first walk over call edges; see `walk`. `options_json` is
    /// `{ seeds, callers?, depth, budget, roots? }` and the result is
    /// `{ nodes: [neighbor + distance + parent, ...], truncated }`.
    #[napi]
    pub fn walk_call_graph(&self, project: String, options_json: String) -> Result<String> {
        let options: WalkOptions = serde_json::from_str(&options_json)
            .map_err(|e| napi::Error::from_reason(format!("invalid walk options: {e}")))?;
        let guard = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let conn = guard
            .as_ref()
            .ok_or_else(|| napi::Error::from_reason("index store is closed"))?;
        walk(conn, &project, &options, Arc::new(AtomicBool::new(false)))
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
    fn walk_ids(json: &str) -> (Vec<(String, u64, String)>, bool) {
        let value: serde_json::Value = serde_json::from_str(json).unwrap();
        let nodes = value["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|node| {
                (
                    node["id"].as_str().unwrap().to_string(),
                    node["distance"].as_u64().unwrap(),
                    node["parent"].as_str().unwrap().to_string(),
                )
            })
            .collect();
        (nodes, value["truncated"].as_bool().unwrap())
    }
    #[test]
    fn walk_matches_the_host_loop_order_scope_budget_and_depth() {
        let store = IndexStore::new(":memory:".into()).unwrap();
        store.with_conn(|conn| conn.execute_batch("INSERT INTO code_node(id,project_id,kind,name,qualified_name,file,range_start_line,range_start_char,range_end_line,range_end_char) VALUES ('s','p','function','s','s','/in/s.ts',0,0,1,0),('a','p','function','a','a','/in/a.ts',0,0,1,0),('b','p','function','b','b','/in/b.ts',0,0,1,0),('d','p','function','d','d','/in/d.ts',0,0,1,0),('x','p','function','x','x','/outside/x.ts',0,0,1,0),('y','p','function','y','y','/in/y.ts',0,0,1,0),('foreign','q','function','foreign','foreign','/in/f.ts',0,0,1,0); INSERT INTO code_edge(id,project_id,kind,from_node,to_node,file) VALUES ('e1','p','calls','a','s','/in/a.ts'),('e2','p','calls','x','s','/outside/x.ts'),('e3','p','calls','b','a','/in/b.ts'),('e4','p','calls','d','a','/in/d.ts'),('e5','p','calls','a','d','/in/a.ts'),('e6','p','calls','y','x','/in/y.ts'),('e7','p','calls','a','s','/in/a.ts'),('e8','p','calls','missing','s','/in/s.ts'),('e9','p','calls','foreign','s','/in/f.ts'),('e10','p','references','b','s','/in/b.ts');")).unwrap();
        let run = |options: &str| walk_ids(&store.walk_call_graph("p".into(), options.into()).unwrap());
        let s = |v: &str| v.to_string();
        // Rowid order per anchor, first-arrival parents, duplicates and the
        // cycle d <-> a visited once, dangling and cross-project edges dropped.
        let (nodes, truncated) = run(r#"{"seeds":["s","s"],"depth":6,"budget":100}"#);
        assert_eq!(
            nodes,
            vec![
                (s("a"), 1, s("s")),
                (s("x"), 1, s("s")),
                (s("b"), 2, s("a")),
                (s("d"), 2, s("a")),
                (s("y"), 2, s("x")),
            ]
        );
        assert!(!truncated);
        // Scope: an out-of-root node is neither emitted nor expanded, so `y`
        // (reachable only through `x`) disappears with it. Roots normalize.
        let (nodes, _) = run(r#"{"seeds":["s"],"depth":6,"budget":100,"roots":["/in/../in/"]}"#);
        assert_eq!(
            nodes.iter().map(|n| n.0.as_str()).collect::<Vec<_>>(),
            vec!["a", "b", "d"]
        );
        // Budget counts the seed and truncates right after the insertion
        // that reaches it, mid-level.
        let (nodes, truncated) = run(r#"{"seeds":["s"],"depth":6,"budget":3}"#);
        assert_eq!(nodes.iter().map(|n| n.0.as_str()).collect::<Vec<_>>(), vec!["a", "x"]);
        assert!(truncated);
        // Depth: nodes at `depth` are emitted but not expanded.
        let (nodes, truncated) = run(r#"{"seeds":["s"],"depth":1,"budget":100}"#);
        assert_eq!(nodes.iter().map(|n| n.0.as_str()).collect::<Vec<_>>(), vec!["a", "x"]);
        assert!(!truncated);
        // Callees direction and a seed with no edges.
        let (nodes, _) = run(r#"{"seeds":["b"],"callers":false,"depth":6,"budget":100}"#);
        assert_eq!(nodes.iter().map(|n| n.0.as_str()).collect::<Vec<_>>(), vec!["a", "s", "d"]);
        let (nodes, _) = run(r#"{"seeds":["y"],"callers":true,"depth":6,"budget":100}"#);
        assert!(nodes.is_empty());
        assert!(
            store
                .walk_call_graph("p".into(), r#"{"seeds":["s"],"depth":65,"budget":100}"#.into())
                .unwrap_err()
                .reason
                .contains("input limit")
        );
        assert!(
            store
                .walk_call_graph("p".into(), r#"{"seeds":"s"}"#.into())
                .unwrap_err()
                .reason
                .contains("invalid walk options")
        );
        assert_eq!(normalize_path("/a//b/./c/../d/"), "/a/b/d");
        assert!(in_roots("/a/b", &["/a/b".to_string()]));
        assert!(!in_roots("/a/bc", &["/a/b".to_string()]));
        assert!(in_roots("/a", &["/".to_string()]));
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
