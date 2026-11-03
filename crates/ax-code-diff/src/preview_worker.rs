//! Native worker binding over shared portable computation.
use ax_code_diff_core::preview as core;
use napi::{Env, Result, Task, bindgen_prelude::AsyncTask};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
#[napi]
pub struct DiffCancellation {
    pub(crate) cancelled: Arc<AtomicBool>,
}
#[napi]
impl DiffCancellation {
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

pub struct DiffTask {
    old: String,
    new: String,
    normalize: bool,
    cancel: Arc<AtomicBool>,
}
impl Task for DiffTask {
    type Output = String;
    type JsValue = String;
    fn compute(&mut self) -> Result<String> {
        core::preview(&self.old, &self.new, self.normalize, &|| {
            self.cancel.load(Ordering::Relaxed)
        })
        .map_err(|error| napi::Error::from_reason(error.reason))
    }
    fn resolve(&mut self, _: Env, output: String) -> Result<String> {
        if self.cancel.load(Ordering::Relaxed) {
            return Err(napi::Error::from_reason("Native diff cancelled"));
        }
        Ok(output)
    }
}
#[napi(ts_return_type = "Promise<string>")]
pub fn diff_preview_async(
    before: String,
    after: String,
    normalize: bool,
    cancellation: &DiffCancellation,
) -> AsyncTask<DiffTask> {
    AsyncTask::new(DiffTask {
        old: before,
        new: after,
        normalize,
        cancel: cancellation.cancelled.clone(),
    })
}
