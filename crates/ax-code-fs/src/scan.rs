use napi::{Env, Result, Task, bindgen_prelude::AsyncTask};
use std::io::Read;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

#[napi]
pub struct ScanCancellation {
    cancelled: Arc<AtomicBool>,
}

#[napi]
impl ScanCancellation {
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

pub(crate) fn check(cancelled: &AtomicBool) -> Result<()> {
    if cancelled.load(Ordering::Relaxed) {
        return Err(napi::Error::from_reason("Native scan cancelled"));
    }
    Ok(())
}

pub(crate) struct CancellableReader<'a, R> {
    pub inner: R,
    pub cancelled: &'a AtomicBool,
}

impl<R: Read> Read for CancellableReader<'_, R> {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        if self.cancelled.load(Ordering::Relaxed) {
            return Err(std::io::Error::other("Native scan cancelled"));
        }
        // Bound work between cancellation checks even for a huge no-match file.
        let size = buffer.len().min(64 * 1024);
        self.inner.read(&mut buffer[..size])
    }
}

pub struct SearchTask {
    cwd: String,
    pattern: String,
    options: String,
    cancelled: Arc<AtomicBool>,
}

impl Task for SearchTask {
    type Output = String;
    type JsValue = String;
    fn compute(&mut self) -> Result<String> {
        crate::search_content_impl(&self.cwd, &self.pattern, &self.options, &self.cancelled)
    }
    fn resolve(&mut self, _: Env, output: String) -> Result<String> {
        check(&self.cancelled)?;
        Ok(output)
    }
}

#[napi(ts_return_type = "Promise<string>")]
pub fn search_content_async(
    cwd: String,
    pattern: String,
    options_json: String,
    cancellation: &ScanCancellation,
) -> AsyncTask<SearchTask> {
    AsyncTask::new(SearchTask {
        cwd,
        pattern,
        options: options_json,
        cancelled: cancellation.cancelled.clone(),
    })
}

pub struct WalkTask {
    cwd: String,
    options: String,
    cancelled: Arc<AtomicBool>,
}

impl Task for WalkTask {
    type Output = Vec<String>;
    type JsValue = Vec<String>;
    fn compute(&mut self) -> Result<Vec<String>> {
        crate::walk_files_impl(&self.cwd, &self.options, &self.cancelled)
    }
    fn resolve(&mut self, _: Env, output: Vec<String>) -> Result<Vec<String>> {
        check(&self.cancelled)?;
        Ok(output)
    }
}

#[napi(ts_return_type = "Promise<string[]>")]
pub fn walk_files_async(
    cwd: String,
    options_json: String,
    cancellation: &ScanCancellation,
) -> AsyncTask<WalkTask> {
    AsyncTask::new(WalkTask {
        cwd,
        options: options_json,
        cancelled: cancellation.cancelled.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancellation_interrupts_reader_and_scan_before_output() {
        let cancelled = AtomicBool::new(false);
        let mut reader = CancellableReader {
            inner: std::io::Cursor::new(vec![b'x'; 200_000]),
            cancelled: &cancelled,
        };
        let mut output = vec![0; 200_000];
        assert_eq!(reader.read(&mut output).unwrap(), 65_536);
        cancelled.store(true, Ordering::Relaxed);
        assert!(reader.read(&mut output).is_err());
        assert!(crate::walk_files_impl(".", "{}", &cancelled).is_err());
        assert!(crate::search_content_impl(".", "needle", "{}", &cancelled).is_err());
    }
}
