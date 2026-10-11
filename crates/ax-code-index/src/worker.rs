use crate::store::IndexStore;
use napi::{Env, Result, Task, bindgen_prelude::AsyncTask};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

#[napi]
pub struct IndexCancellation {
    cancelled: Arc<AtomicBool>,
}
#[napi]
impl IndexCancellation {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }
    #[napi]
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Relaxed);
    }
}

fn check(cancelled: &AtomicBool) -> Result<()> {
    if cancelled.load(Ordering::Relaxed) {
        return Err(napi::Error::from_reason("Native index work cancelled"));
    }
    Ok(())
}

pub struct IngestTask {
    path: String,
    project: String,
    file: String,
    nodes: String,
    edges: String,
    meta: String,
    cancelled: Arc<AtomicBool>,
}
impl Task for IngestTask {
    type Output = ();
    type JsValue = ();
    fn compute(&mut self) -> Result<()> {
        check(&self.cancelled)?;
        if self.nodes.len() + self.edges.len() + self.meta.len() > 32 * 1024 * 1024 {
            return Err(napi::Error::from_reason(
                "Graph ingest input limit exceeded",
            ));
        }
        // This worker owns a separate WAL connection. JS queries never wait
        // for a mutex held by this task, and the connection drops before the
        // task completes. Cancellation is checked before the transaction commits.
        let store = IndexStore::new(self.path.clone())?;
        let cancelled = self.cancelled.clone();
        store.with_conn(|conn| {
            conn.progress_handler(1000, Some(move || cancelled.load(Ordering::Relaxed)))?;
            Ok(())
        })?;
        check(&self.cancelled)?;
        store.ingest_file_cancellable(
            self.project.clone(),
            self.file.clone(),
            std::mem::take(&mut self.nodes),
            std::mem::take(&mut self.edges),
            std::mem::take(&mut self.meta),
            Some(&self.cancelled),
        )
    }
    // A late abort cannot retroactively undo a committed transaction. Report
    // its receipt without a post-commit cancellation check or hidden retry.
    fn resolve(&mut self, _: Env, _: ()) -> Result<()> {
        Ok(())
    }
}

#[napi(ts_return_type = "Promise<void>")]
pub fn ingest_file_async(
    db_path: String,
    project_id: String,
    file_path: String,
    nodes_json: String,
    edges_json: String,
    file_meta_json: String,
    cancellation: &IndexCancellation,
) -> AsyncTask<IngestTask> {
    AsyncTask::new(IngestTask {
        path: db_path,
        project: project_id,
        file: file_path,
        nodes: nodes_json,
        edges: edges_json,
        meta: file_meta_json,
        cancelled: cancellation.cancelled.clone(),
    })
}

pub struct OptimizeTask {
    path: String,
    cancelled: Arc<AtomicBool>,
}
impl Task for OptimizeTask {
    type Output = ();
    type JsValue = ();
    fn compute(&mut self) -> Result<()> {
        check(&self.cancelled)?;
        let conn = rusqlite::Connection::open(&self.path)
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;
        conn.busy_timeout(std::time::Duration::from_secs(1))
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;
        let cancelled = self.cancelled.clone();
        conn.progress_handler(1000, Some(move || cancelled.load(Ordering::Relaxed)))
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;
        // SQLite >=3.46 bounds the analysis internally. A fresh connection
        // needs 0x10000 to consider existing tables without query history.
        conn.execute_batch("PRAGMA optimize=0x10002;")
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;
        check(&self.cancelled)
    }
    fn resolve(&mut self, _: Env, _: ()) -> Result<()> {
        check(&self.cancelled)
    }
}

#[napi(ts_return_type = "Promise<void>")]
pub fn optimize_index_async(
    db_path: String,
    cancellation: &IndexCancellation,
) -> AsyncTask<OptimizeTask> {
    AsyncTask::new(OptimizeTask {
        path: db_path,
        cancelled: cancellation.cancelled.clone(),
    })
}
