use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::sync::mpsc;

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;

use crate::IGNORE_FOLDERS;

// ---------------------------------------------------------------------------
// 7. Native filesystem watcher — replaces 100ms polling with OS events
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WatchEvent {
    pub(crate) event_type: String, // "add" | "change" | "unlink"
    pub(crate) path: String,
}

/// Native filesystem watcher using fsevents (macOS) or inotify (Linux).
/// Replaces the 100ms polling loop in TypeScript.
///
/// Usage from TypeScript:
///   const watcher = new NativeWatcher(root, ignorePatternsJson)
///   watcher.poll() // returns JSON array of events since last poll
///   watcher.stop()
#[napi]
pub struct NativeWatcher {
    receiver: Arc<Mutex<mpsc::Receiver<WatchEvent>>>,
    _watcher: Arc<Mutex<Option<RecommendedWatcher>>>,
    #[allow(dead_code)]
    root: PathBuf,
}

#[napi]
impl NativeWatcher {
    #[napi(constructor)]
    pub fn new(root: String, ignore_patterns_json: String) -> napi::Result<Self> {
        let root_path = PathBuf::from(&root);
        // BUG-285: Parse and compile custom ignore patterns so they are actually applied
        let extra: Vec<String> = serde_json::from_str(&ignore_patterns_json).unwrap_or_default();
        let extra_matchers: Vec<globset::GlobMatcher> = extra
            .iter()
            .filter_map(|p| globset::Glob::new(p).ok().map(|g| g.compile_matcher()))
            .collect();

        let (tx, rx) = mpsc::channel();
        let root_clone = root_path.clone();

        let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
            let event = match res {
                Ok(e) => e,
                Err(_) => return,
            };

            let event_type = match event.kind {
                EventKind::Create(_) => "add",
                EventKind::Modify(_) => "change",
                EventKind::Remove(_) => "unlink",
                _ => return,
            };

            for path in &event.paths {
                let rel = match path.strip_prefix(&root_clone) {
                    Ok(p) => p,
                    Err(_) => continue,
                };

                let rel_str = match rel.to_str() {
                    Some(s) => s,
                    None => continue,
                };

                // Skip .git internals
                if rel.components().any(|c| c.as_os_str() == ".git") {
                    continue;
                }

                // Skip ignored folders
                let should_skip = rel.components().any(|c| {
                    let name = c.as_os_str().to_str().unwrap_or("");
                    IGNORE_FOLDERS.contains(&name)
                });
                if should_skip {
                    continue;
                }

                // BUG-285: Check custom ignore patterns
                if extra_matchers.iter().any(|m| m.is_match(rel_str)) {
                    continue;
                }

                if tx
                    .send(WatchEvent {
                        event_type: event_type.to_string(),
                        path: rel_str.to_string(),
                    })
                    .is_err()
                {
                    break;
                }
            }
        })
        .map_err(|e| napi::Error::from_reason(format!("failed to create watcher: {e}")))?;

        watcher
            .watch(&root_path, RecursiveMode::Recursive)
            .map_err(|e| napi::Error::from_reason(format!("failed to watch directory: {e}")))?;

        Ok(Self {
            receiver: Arc::new(Mutex::new(rx)),
            _watcher: Arc::new(Mutex::new(Some(watcher))),
            root: root_path,
        })
    }

    /// Poll for events since last call. Returns JSON array of events.
    /// Non-blocking — returns empty array if no events pending.
    #[napi]
    pub fn poll(&self) -> napi::Result<String> {
        let rx = self
            .receiver
            .lock()
            .map_err(|e| napi::Error::from_reason(format!("lock poisoned: {e}")))?;

        let mut events = Vec::new();
        while let Ok(event) = rx.try_recv() {
            events.push(event);
        }

        serde_json::to_string(&events).map_err(|e| napi::Error::from_reason(e.to_string()))
    }

    /// Stop watching. Releases OS resources.
    #[napi]
    pub fn stop(&self) -> napi::Result<()> {
        let mut guard = self
            ._watcher
            .lock()
            .map_err(|e| napi::Error::from_reason(format!("lock poisoned: {e}")))?;
        *guard = None; // Drop the watcher, which stops watching
        Ok(())
    }

    /// Check if the watcher is still active.
    #[napi(getter)]
    pub fn is_active(&self) -> bool {
        self._watcher.lock().map(|g| g.is_some()).unwrap_or(false)
    }
}
