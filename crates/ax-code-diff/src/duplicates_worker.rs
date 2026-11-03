//! Native worker binding over the shared portable comparison kernel.
use crate::preview_worker::DiffCancellation;
use ax_code_diff_core::duplicates;
use napi::{Env, Result, Task, bindgen_prelude::AsyncTask};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

pub struct DuplicatesTask {
    tokens: String,
    threshold: f64,
    cancel: Arc<AtomicBool>,
}
impl Task for DuplicatesTask {
    type Output = String;
    type JsValue = String;
    fn compute(&mut self) -> Result<String> {
        duplicates::groups(&self.tokens, self.threshold, &|| {
            self.cancel.load(Ordering::Relaxed)
        })
        .map_err(|error| napi::Error::from_reason(error.reason))
    }
    fn resolve(&mut self, _: Env, output: String) -> Result<String> {
        if self.cancel.load(Ordering::Relaxed) {
            return Err(napi::Error::from_reason(
                "Native duplicate comparison cancelled",
            ));
        }
        Ok(output)
    }
}
#[napi(ts_return_type = "Promise<string>")]
pub fn duplicate_groups_async(
    tokens_json: String,
    threshold: f64,
    cancellation: &DiffCancellation,
) -> AsyncTask<DuplicatesTask> {
    AsyncTask::new(DuplicatesTask {
        tokens: tokens_json,
        threshold,
        cancel: cancellation.cancelled.clone(),
    })
}
