//! Native worker binding over shared portable computation.
use ax_code_diff_core::patch as core;
pub(crate) use core::{MAX_BYTES, MAX_COMPARISONS, MAX_LINES};
use napi::{Env, Result, Task, bindgen_prelude::AsyncTask};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
pub(crate) fn limit() -> napi::Error {
    napi::Error::from_reason(core::limit().reason)
}
#[napi]
pub struct PatchCancellation {
    cancelled: Arc<AtomicBool>,
}
#[napi]
impl PatchCancellation {
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
pub struct PatchTask {
    file: String,
    original: String,
    chunks: String,
    cancel: Arc<AtomicBool>,
}
impl Task for PatchTask {
    type Output = String;
    type JsValue = String;
    fn compute(&mut self) -> Result<String> {
        core::content(&self.file, &self.original, &self.chunks, &|| {
            self.cancel.load(Ordering::Relaxed)
        })
        .map_err(|error| napi::Error::from_reason(error.reason))
    }
    fn resolve(&mut self, _: Env, output: String) -> Result<String> {
        if self.cancel.load(Ordering::Relaxed) {
            return Err(napi::Error::from_reason("Native patch cancelled"));
        }
        Ok(output)
    }
}
#[napi(ts_return_type = "Promise<string>")]
pub fn apply_patch_content_async(
    file: String,
    original: String,
    chunks: String,
    cancellation: &PatchCancellation,
) -> AsyncTask<PatchTask> {
    AsyncTask::new(PatchTask {
        file,
        original,
        chunks,
        cancel: cancellation.cancelled.clone(),
    })
}
