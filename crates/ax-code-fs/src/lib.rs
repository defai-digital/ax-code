#[macro_use]
extern crate napi_derive;

mod detect;
mod diagnostics;
mod embedding;
#[cfg(feature = "evidence-cache")]
mod evidence;
mod scan;
mod watcher;

pub use diagnostics::*;
pub use embedding::*;
pub use scan::{ScanCancellation, glob_files_async, search_content_async, walk_files_async};
pub use watcher::*;

use std::collections::{HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::UNIX_EPOCH;

use globset::{GlobBuilder, GlobMatcher};
use grep_matcher::Matcher;
use grep_regex::RegexMatcherBuilder;
use grep_searcher::{SearcherBuilder, Sink, SinkContext, SinkContextKind, SinkMatch};
use ignore::WalkBuilder;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};

/// Compile a glob with ripgrep `-g` semantics: `*` never crosses `/`, and a
/// pattern with no `/` matches the basename at any depth (it is `**/`-prefixed).
/// globset's default `literal_separator = false` let `*` match `/`, so a native
/// `sub/*.ts` also matched `sub/deep/c.ts` while the ripgrep fallback returned
/// only `sub/b.ts`. The hardcoded ignore patterns already carry `**/`.
pub(crate) fn compile_glob(pattern: &str) -> Result<GlobMatcher, globset::Error> {
    let normalized = if pattern.contains('/') {
        pattern.to_string()
    } else {
        format!("**/{pattern}")
    };
    GlobBuilder::new(&normalized)
        .literal_separator(true)
        .build()
        .map(|glob| glob.compile_matcher())
}

// ---------------------------------------------------------------------------
// Options structs (deserialized from JSON)
// ---------------------------------------------------------------------------

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct WalkOptions {
    glob: Option<Vec<String>>,
    hidden: Option<bool>,
    max_depth: Option<usize>,
    /// Stop after collecting this many files. `None` (or 0) walks the whole
    /// tree. Callers that only need a bounded sample (e.g. LSP prewarm probing
    /// one file per language) pass a small limit so a huge directory does not
    /// force a full synchronous walk.
    limit: Option<usize>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SearchOptions {
    glob: Option<String>,
    limit: Option<usize>,
    context_lines: Option<usize>,
}

// ---------------------------------------------------------------------------
// Output structs (serialized to JSON)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct GlobEntry {
    path: String,
    mtime: u64,
    size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchMatch {
    path: String,
    line: u64,
    column: u64,
    match_text: String,
    context_before: Vec<String>,
    context_after: Vec<String>,
}

// ---------------------------------------------------------------------------
// Ignore patterns — loaded from ignore-patterns.json (shared with TS FileIgnore).
// Keep crates/ax-code-fs/ignore-patterns.json in sync with
// packages/ax-code/src/file/ignore-patterns.json (enforced by ignore-drift test).
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct IgnorePatternsFile {
    folders: Vec<String>,
    files: Vec<String>,
}

static IGNORE_PATTERNS: LazyLock<IgnorePatternsFile> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../ignore-patterns.json"))
        .expect("ignore-patterns.json must be valid JSON with folders + files arrays")
});

/// Folder basenames that should always be ignored during walks.
pub(crate) static IGNORE_FOLDERS: LazyLock<HashSet<String>> =
    LazyLock::new(|| IGNORE_PATTERNS.folders.iter().cloned().collect());

/// Whether the walker should yield (and descend into) `entry`. Dropping `.git`, and optionally the
/// hardcoded ignore folders, before descent is equivalent to filtering on the relative path
/// components afterwards, but never reads the pruned subtrees. The root itself is always kept.
pub(crate) fn walk_keeps(entry: &ignore::DirEntry, prune_ignore_folders: bool) -> bool {
    if entry.depth() == 0 {
        return true;
    }
    let name = entry.file_name();
    if name == ".git" {
        return false;
    }
    !(prune_ignore_folders && name.to_str().is_some_and(|n| IGNORE_FOLDERS.contains(n)))
}

/// Precompiled matchers for hardcoded ignore file patterns. Rebuilding these
/// on every `is_ignored` call was a measurable CPU cost during directory walks
/// (PERF-07 / NAT-03). Extra patterns passed by the caller are still compiled
/// per call because they vary.
static IGNORE_FILE_MATCHERS: LazyLock<Vec<GlobMatcher>> = LazyLock::new(|| {
    IGNORE_PATTERNS
        .files
        .iter()
        .filter_map(|pat| compile_glob(pat).ok())
        .collect()
});

// ---------------------------------------------------------------------------
// 1. walk_files
// ---------------------------------------------------------------------------

#[napi]
pub fn walk_files(cwd: String, options_json: String) -> napi::Result<Vec<String>> {
    walk_files_impl(&cwd, &options_json, &AtomicBool::new(false))
}

fn compile_include_globs(patterns: &[String]) -> napi::Result<Vec<GlobMatcher>> {
    patterns
        .iter()
        .map(|p| {
            compile_glob(p)
                .map_err(|e| napi::Error::from_reason(format!("invalid include glob: {e}")))
        })
        .collect()
}

fn walk_files_impl(
    cwd: &str,
    options_json: &str,
    cancelled: &AtomicBool,
) -> napi::Result<Vec<String>> {
    scan::check(cancelled)?;
    let opts: WalkOptions =
        serde_json::from_str(&options_json).map_err(|e| napi::Error::from_reason(e.to_string()))?;

    let root = PathBuf::from(&cwd);
    let mut builder = WalkBuilder::new(&root);

    // Default to include hidden files (matches ripgrep's `--hidden` behavior
    // and the TS caller convention that only `hidden: false` suppresses them).
    // `builder.hidden(true)` in the `ignore` crate means *skip* hidden, so we
    // invert: pass `true` (skip hidden) only when the caller explicitly set
    // `hidden: false`.
    let include_hidden = opts.hidden.unwrap_or(true);
    builder.hidden(!include_hidden);
    builder.git_ignore(true);
    builder.git_global(true);
    builder.git_exclude(true);
    builder.filter_entry(|entry| walk_keeps(entry, true));

    if let Some(depth) = opts.max_depth {
        builder.max_depth(Some(depth));
    }

    // Build glob matchers from options
    // Reject a malformed glob like the ripgrep fallback does; dropping it would
    // silently widen the walk to every file.
    let globs = compile_include_globs(&opts.glob.unwrap_or_default())?;

    // A limit of 0 is treated as "no limit" so callers can pass through an
    // unbounded default without a sentinel.
    let limit = opts.limit.filter(|&n| n > 0);

    let mut results = Vec::new();

    for entry in builder.build().flatten() {
        scan::check(cancelled)?;
        // Only include files, skip directories
        if !entry.file_type().is_some_and(|ft| ft.is_file()) {
            continue;
        }

        let rel = match entry.path().strip_prefix(&root) {
            Ok(p) => p,
            Err(_) => continue,
        };

        let rel_str = match rel.to_str() {
            Some(s) => s,
            None => continue,
        };

        // Always exclude .git contents
        if rel.components().any(|c| c.as_os_str() == ".git") {
            continue;
        }

        // Exclude hardcoded ignore folders (node_modules, dist, build, etc.)
        if rel.components().any(|c| {
            let name = c.as_os_str().to_str().unwrap_or("");
            IGNORE_FOLDERS.contains(name)
        }) {
            continue;
        }

        // If globs are specified, the file must match at least one
        if !globs.is_empty() && !globs.iter().any(|g| g.is_match(rel_str)) {
            continue;
        }

        // Return the *relative* path. TS callers that want absolute can join with
        // `cwd` themselves; keeping it relative preserves existing test contracts
        // (e.g. `files.includes("visible.txt")`).
        results.push(rel_str.to_string());

        // Stop as soon as the requested number of files has been collected. This
        // is what lets a bounded caller avoid walking an entire (possibly huge)
        // tree — the `ignore` walker stops descending once we break.
        if let Some(max) = limit {
            if results.len() >= max {
                break;
            }
        }
    }

    scan::check(cancelled)?;
    Ok(results)
}

// ---------------------------------------------------------------------------
// 2. glob_files
// ---------------------------------------------------------------------------

#[napi]
pub fn glob_files(cwd: String, pattern: String, limit: u32) -> napi::Result<String> {
    glob_files_impl(&cwd, &pattern, limit, &AtomicBool::new(false))
}

pub(crate) fn glob_files_impl(
    cwd: &str,
    pattern: &str,
    limit: u32,
    cancelled: &AtomicBool,
) -> napi::Result<String> {
    use std::cmp::Reverse;
    use std::collections::BinaryHeap;
    scan::check(cancelled)?;
    let root = PathBuf::from(cwd);
    let matcher = compile_glob(pattern).map_err(|e| napi::Error::from_reason(e.to_string()))?;
    if limit == 0 {
        return Ok("[]".into());
    }
    let mut builder = WalkBuilder::new(&root);
    builder
        .hidden(false)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .filter_entry(|entry| walk_keeps(entry, false));
    // The worst retained entry is at the root. Encounter order breaks mtime
    // ties exactly like the legacy stable sort; never stop after K matches.
    let mut entries = BinaryHeap::new();
    for (order, entry) in builder.build().enumerate() {
        scan::check(cancelled)?;
        let Ok(entry) = entry else { continue };
        if !entry.file_type().is_some_and(|ft| ft.is_file()) {
            continue;
        }
        let full = entry.path();
        let Ok(rel) = full.strip_prefix(&root) else {
            continue;
        };
        let Some(rel_str) = rel.to_str() else {
            continue;
        };
        if rel.components().any(|c| c.as_os_str() == ".git") || !matcher.is_match(rel_str) {
            continue;
        }
        let Ok(meta) = std::fs::metadata(full) else {
            continue;
        };
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_millis() as u64);
        let candidate = (Reverse(mtime), order, rel_str.to_owned(), meta.len());
        if entries.len() < limit as usize {
            entries.push(candidate);
        } else if entries.peek().is_some_and(|worst| &candidate < worst) {
            *entries.peek_mut().unwrap() = candidate;
        }
    }
    scan::check(cancelled)?;
    let output: Vec<_> = entries
        .into_sorted_vec()
        .into_iter()
        .map(|(Reverse(mtime), _, path, size)| GlobEntry { path, mtime, size })
        .collect();
    let json =
        serde_json::to_string(&output).map_err(|e| napi::Error::from_reason(e.to_string()))?;
    scan::check(cancelled)?;
    Ok(json)
}

// ---------------------------------------------------------------------------
// 3. search_content
// ---------------------------------------------------------------------------

/// Per-file search sink that collects matches with context lines.
struct ContentSink<'a> {
    cancelled: &'a AtomicBool,
    path: String,
    matcher: &'a grep_regex::RegexMatcher,
    results: &'a mut Vec<SearchMatch>,
    limit: usize,
    before_buf: VecDeque<String>,
    context_lines: usize,
    // Several adjacent matches can still need after-context at the same time.
    pending: VecDeque<SearchMatch>,
}

impl ContentSink<'_> {
    fn observe(&mut self, line: &str) {
        for pending in &mut self.pending {
            pending.context_after.push(line.to_owned());
        }
        while self
            .pending
            .front()
            .is_some_and(|p| p.context_after.len() >= self.context_lines)
        {
            self.results.push(self.pending.pop_front().unwrap());
        }
    }

    fn remember(&mut self, line: String) {
        if self.context_lines == 0 {
            return;
        }
        self.before_buf.push_back(line);
        while self.before_buf.len() > self.context_lines {
            self.before_buf.pop_front();
        }
    }
}

impl<'a> Sink for ContentSink<'a> {
    type Error = std::io::Error;

    fn matched(
        &mut self,
        _searcher: &grep_searcher::Searcher,
        mat: &SinkMatch<'_>,
    ) -> Result<bool, Self::Error> {
        if self.cancelled.load(Ordering::Relaxed) {
            return Ok(false);
        }
        let line_bytes = mat.bytes();
        let line_str = String::from_utf8_lossy(line_bytes);
        let line = cap_line(line_str.trim_end_matches('\n').trim_end_matches('\r'));
        // A matching line is also context for its neighboring matches.
        self.observe(&line);
        if self.results.len() >= self.limit {
            return Ok(false);
        }
        if self.results.len() + self.pending.len() < self.limit {
            let col = self
                .matcher
                .find(line_bytes)
                .ok()
                .flatten()
                .map_or(1, |m| m.start() as u64 + 1);
            let entry = SearchMatch {
                path: self.path.clone(),
                line: mat.line_number().unwrap_or(0),
                column: col,
                match_text: line.clone(),
                context_before: self.before_buf.iter().cloned().collect(),
                context_after: Vec::new(),
            };
            if self.context_lines > 0 {
                self.pending.push_back(entry);
            } else {
                self.results.push(entry);
            }
        }
        self.remember(line);
        Ok(self.results.len() < self.limit)
    }

    fn context(
        &mut self,
        _searcher: &grep_searcher::Searcher,
        ctx: &SinkContext<'_>,
    ) -> Result<bool, Self::Error> {
        if self.cancelled.load(Ordering::Relaxed) {
            return Ok(false);
        }
        let line = String::from_utf8_lossy(ctx.bytes());
        let line = cap_line(line.trim_end_matches('\n').trim_end_matches('\r'));
        self.observe(&line);
        self.remember(line);
        Ok(self.results.len() < self.limit)
    }

    fn context_break(&mut self, _: &grep_searcher::Searcher) -> Result<bool, Self::Error> {
        // The searcher skipped lines between disjoint context groups.
        self.before_buf.clear();
        Ok(true)
    }

    fn finish(
        &mut self,
        _searcher: &grep_searcher::Searcher,
        _: &grep_searcher::SinkFinish,
    ) -> Result<(), Self::Error> {
        self.results.extend(self.pending.drain(..));
        Ok(())
    }
}

#[napi]
pub fn search_content(cwd: String, pattern: String, options_json: String) -> napi::Result<String> {
    search_content_impl(&cwd, &pattern, &options_json, &AtomicBool::new(false))
}

/// Bound what one pathological line (minified bundles, data blobs) can add to
/// the result set. Well above the TS display clamp, so truncation stays visible.
const MAX_REPORTED_LINE_BYTES: usize = 16 * 1024;

fn cap_line(line: &str) -> String {
    if line.len() <= MAX_REPORTED_LINE_BYTES {
        return line.to_owned();
    }
    let mut end = MAX_REPORTED_LINE_BYTES;
    while !line.is_char_boundary(end) {
        end -= 1;
    }
    line[..end].to_owned()
}

const SEARCH_FIRST_BATCH: usize = 8;
const SEARCH_MAX_BATCH: usize = 64;
const SEARCH_MAX_THREADS: usize = 4;

/// A small dedicated pool: a search should finish sooner on a multi-core machine without taking
/// every core away from the TUI and the model stream. `None` falls back to rayon's global pool.
static SEARCH_POOL: LazyLock<Option<rayon::ThreadPool>> = LazyLock::new(|| {
    let threads = std::thread::available_parallelism()
        .map_or(1, |n| n.get())
        .min(SEARCH_MAX_THREADS);
    rayon::ThreadPoolBuilder::new()
        .num_threads(threads)
        .thread_name(|index| format!("ax-search-{index}"))
        .build()
        .ok()
});

fn in_search_pool<R: Send>(work: impl FnOnce() -> R + Send) -> R {
    match SEARCH_POOL.as_ref() {
        Some(pool) => pool.install(work),
        None => work(),
    }
}

/// Search one file and return its matches (at most `limit`). The caller merges files in walk order
/// and applies the overall limit, so this matches what the sequential loop produced for the file.
fn search_one_file(
    full: &Path,
    matcher: &grep_regex::RegexMatcher,
    cancelled: &AtomicBool,
    limit: usize,
    context_lines: usize,
) -> Vec<SearchMatch> {
    let mut results: Vec<SearchMatch> = Vec::new();
    let mut searcher = SearcherBuilder::new()
        .line_number(true)
        .before_context(context_lines)
        .after_context(context_lines)
        .build();

    // Report absolute paths. The TS caller filters matches against
    // `Instance.directory` (absolute) via `Filesystem.contains`, which only
    // works when the reported path is absolute — returning a relative string
    // silently dropped every match when `searchPath != Instance.directory`.
    let mut sink = ContentSink {
        cancelled,
        path: full.to_string_lossy().into_owned(),
        matcher,
        results: &mut results,
        limit,
        before_buf: VecDeque::new(),
        context_lines,
        pending: VecDeque::new(),
    };

    // Ignore errors on individual files (binary files, permission errors, etc.)
    if let Ok(file) = std::fs::File::open(full) {
        let reader = scan::CancellableReader {
            inner: file,
            cancelled,
        };
        let _ = searcher.search_reader(matcher, reader, &mut sink);
    }
    results.truncate(limit);
    results
}

fn search_content_impl(
    cwd: &str,
    pattern: &str,
    options_json: &str,
    cancelled: &AtomicBool,
) -> napi::Result<String> {
    scan::check(cancelled)?;
    let opts: SearchOptions =
        serde_json::from_str(&options_json).map_err(|e| napi::Error::from_reason(e.to_string()))?;

    let limit = opts.limit.unwrap_or(250);
    let context_lines = opts.context_lines.unwrap_or(0);

    // Case-sensitive like plain `rg`, the ripgrep fallback, and the context
    // search path; callers opt in with an inline `(?i)`.
    let matcher = RegexMatcherBuilder::new()
        .build(&pattern)
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    // Reject a malformed include glob like the ripgrep fallback does; dropping
    // it would silently widen the search to every file.
    let glob_matcher: Option<GlobMatcher> = match opts.glob.as_ref() {
        Some(g) => Some(
            compile_glob(g).map_err(|e| napi::Error::from_reason(format!("invalid include glob: {e}")))?,
        ),
        None => None,
    };

    let root = PathBuf::from(&cwd);
    let mut builder = WalkBuilder::new(&root);
    // Include hidden files like the ripgrep fallback (`--hidden`) and `walk_files`;
    // `.git` is still skipped below.
    builder.hidden(false);
    builder.git_ignore(true);
    builder.git_global(true);
    builder.git_exclude(true);
    builder.filter_entry(|entry| walk_keeps(entry, true));

    let mut results: Vec<SearchMatch> = Vec::new();
    let mut walker = builder.build().flatten();

    // Candidate files come from the serial walker in growing batches. Each batch is searched in
    // parallel and merged in walk order, so the output is exactly what a one-file-at-a-time search
    // would return, and a query with early matches only ever pays for a small first batch.
    let mut batch_size = SEARCH_FIRST_BATCH;
    let mut exhausted = false;
    'batches: while limit > 0 && !exhausted {
        let mut batch: Vec<PathBuf> = Vec::with_capacity(batch_size);
        while batch.len() < batch_size {
            scan::check(cancelled)?;
            let Some(entry) = walker.next() else {
                exhausted = true;
                break;
            };

            if !entry.file_type().is_some_and(|ft| ft.is_file()) {
                continue;
            }

            let full = entry.path().to_path_buf();
            let rel = match full.strip_prefix(&root) {
                Ok(p) => p,
                Err(_) => continue,
            };

            let rel_str = match rel.to_str() {
                Some(s) => s,
                None => continue,
            };

            // `.git` and the hardcoded ignore folders (node_modules, dist, build, etc.) are pruned
            // by the walker before descent, see `walk_keeps`.

            // Apply glob filter
            if let Some(ref gm) = glob_matcher {
                if !gm.is_match(rel_str) {
                    continue;
                }
            }

            batch.push(full);
        }
        if batch.is_empty() {
            break;
        }

        let per_file: Vec<Vec<SearchMatch>> = in_search_pool(|| {
            batch
                .par_iter()
                .map(|full| search_one_file(full, &matcher, cancelled, limit, context_lines))
                .collect()
        });
        scan::check(cancelled)?;

        for mut matches in per_file {
            results.append(&mut matches);
            if results.len() >= limit {
                break 'batches;
            }
        }
        batch_size = (batch_size * 2).min(SEARCH_MAX_BATCH);
    }

    // Truncate to limit in case finish() pushed one more
    results.truncate(limit);

    scan::check(cancelled)?;
    serde_json::to_string(&results).map_err(|e| napi::Error::from_reason(e.to_string()))
}

// ---------------------------------------------------------------------------
// 4. is_ignored
// ---------------------------------------------------------------------------

#[napi]
pub fn is_ignored(path: String, extra_patterns_json: String) -> napi::Result<bool> {
    let extra: Vec<String> = serde_json::from_str(&extra_patterns_json)
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    let filepath = Path::new(&path);

    // Check folder components against hardcoded ignore list
    for component in filepath.components() {
        let name = component.as_os_str().to_str().unwrap_or("");
        if IGNORE_FOLDERS.contains(name) {
            return Ok(true);
        }
    }

    // Hardcoded file patterns use the process-wide compiled matchers.
    for matcher in IGNORE_FILE_MATCHERS.iter() {
        if matcher.is_match(&path) {
            return Ok(true);
        }
    }

    // Caller-supplied patterns still compile per call (they vary).
    for pat in extra {
        if let Ok(g) = compile_glob(&pat) {
            if g.is_match(&path) {
                return Ok(true);
            }
        }
    }

    Ok(false)
}

// ---------------------------------------------------------------------------
// 5. scan_files — Parallel multi-pattern batch scanner
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScanConfig {
    include: Vec<String>,
    patterns: Vec<ScanPattern>,
    #[serde(default = "default_max_files")]
    max_files: usize,
    #[serde(default = "default_max_per_file")]
    max_per_file: usize,
    #[serde(default)]
    context_lines: usize,
}

fn default_max_files() -> usize {
    500
}
fn default_max_per_file() -> usize {
    20
}

#[derive(Deserialize, Clone)]
struct ScanPattern {
    label: String,
    regex: String,
    id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanFileMatch {
    file: String,
    line: u64,
    column: u64,
    text: String,
    label: String,
    id: String,
    context_before: Vec<String>,
    context_after: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanResult {
    matches: Vec<ScanFileMatch>,
    files_scanned: usize,
    elapsed_ms: u64,
}

/// Per-file scanner sink that collects matches for a single compiled pattern.
struct ScanSink<'a> {
    file: String,
    label: String,
    id: String,
    matcher: &'a grep_regex::RegexMatcher,
    results: Vec<ScanFileMatch>,
    max_per_file: usize,
    before_buf: VecDeque<String>,
    context_lines: usize,
    pending: Option<ScanFileMatch>,
    after_remaining: usize,
}

impl<'a> Sink for ScanSink<'a> {
    type Error = std::io::Error;

    fn matched(
        &mut self,
        _searcher: &grep_searcher::Searcher,
        mat: &SinkMatch<'_>,
    ) -> Result<bool, Self::Error> {
        if let Some(pending) = self.pending.take() {
            self.results.push(pending);
            if self.results.len() >= self.max_per_file {
                return Ok(false);
            }
        }

        let line_bytes = mat.bytes();
        let line_str = String::from_utf8_lossy(line_bytes);
        let line_trimmed = line_str.trim_end_matches('\n').trim_end_matches('\r');
        let line_num = mat.line_number().unwrap_or(0);

        let col = self
            .matcher
            .find(line_bytes)
            .ok()
            .flatten()
            .map(|m| m.start() as u64 + 1)
            .unwrap_or(1);

        let entry = ScanFileMatch {
            file: self.file.clone(),
            line: line_num,
            column: col,
            text: line_trimmed.to_string(),
            label: self.label.clone(),
            id: self.id.clone(),
            context_before: self.before_buf.drain(..).collect(),
            context_after: Vec::new(),
        };

        if self.context_lines > 0 {
            self.pending = Some(entry);
            self.after_remaining = self.context_lines;
        } else {
            self.results.push(entry);
            if self.results.len() >= self.max_per_file {
                return Ok(false);
            }
        }
        self.before_buf.clear();
        Ok(true)
    }

    fn context(
        &mut self,
        _searcher: &grep_searcher::Searcher,
        ctx: &SinkContext<'_>,
    ) -> Result<bool, Self::Error> {
        let line = String::from_utf8_lossy(ctx.bytes());
        let trimmed = line
            .trim_end_matches('\n')
            .trim_end_matches('\r')
            .to_string();
        match ctx.kind() {
            SinkContextKind::Before => {
                self.before_buf.push_back(trimmed);
                while self.before_buf.len() > self.context_lines {
                    self.before_buf.pop_front();
                }
            }
            SinkContextKind::After => {
                if let Some(ref mut pending) = self.pending {
                    pending.context_after.push(trimmed);
                    self.after_remaining = self.after_remaining.saturating_sub(1);
                    if self.after_remaining == 0 {
                        let done = self.pending.take().unwrap();
                        self.results.push(done);
                        if self.results.len() >= self.max_per_file {
                            return Ok(false);
                        }
                    }
                }
            }
            SinkContextKind::Other => {}
        }
        Ok(true)
    }

    fn finish(
        &mut self,
        _searcher: &grep_searcher::Searcher,
        _: &grep_searcher::SinkFinish,
    ) -> Result<(), Self::Error> {
        if let Some(pending) = self.pending.take() {
            self.results.push(pending);
        }
        Ok(())
    }
}

/// Batch file scanner: walks once, reads each file once, runs all regex
/// patterns in parallel using rayon. Returns all matches grouped by file.
#[napi]
pub fn scan_files(cwd: String, config_json: String) -> napi::Result<String> {
    let start = std::time::Instant::now();
    let config: ScanConfig = serde_json::from_str(&config_json)
        .map_err(|e| napi::Error::from_reason(format!("invalid scan config: {e}")))?;

    // Pre-compile all regex patterns. Reject a malformed pattern like
    // search_content does; dropping it would silently disable that detection
    // and report a false-clean scan.
    let compiled: Vec<(String, String, grep_regex::RegexMatcher)> = config
        .patterns
        .iter()
        .map(|p| {
            RegexMatcherBuilder::new()
                .case_smart(true)
                .build(&p.regex)
                .map(|m| (p.label.clone(), p.id.clone(), m))
                .map_err(|e| {
                    napi::Error::from_reason(format!("invalid scan pattern {:?}: {e}", p.id))
                })
        })
        .collect::<napi::Result<Vec<_>>>()?;

    if compiled.is_empty() {
        let result = ScanResult {
            matches: Vec::new(),
            files_scanned: 0,
            elapsed_ms: 0,
        };
        return serde_json::to_string(&result).map_err(|e| napi::Error::from_reason(e.to_string()));
    }

    // Build include glob matchers
    let include_matchers = compile_include_globs(&config.include)?;

    // Walk and collect files
    let root = PathBuf::from(&cwd);
    let mut builder = WalkBuilder::new(&root);
    builder.hidden(true);
    builder.git_ignore(true);
    builder.git_global(true);
    builder.git_exclude(true);
    builder.filter_entry(|entry| walk_keeps(entry, true));

    let mut files: Vec<(String, PathBuf)> = Vec::new();
    for entry in builder.build().flatten() {
        if !entry.file_type().is_some_and(|ft| ft.is_file()) {
            continue;
        }
        let full = entry.path().to_path_buf();
        let rel = match full.strip_prefix(&root) {
            Ok(p) => p,
            Err(_) => continue,
        };
        let rel_str = match rel.to_str() {
            Some(s) => s,
            None => continue,
        };
        if rel.components().any(|c| c.as_os_str() == ".git") {
            continue;
        }
        if rel.components().any(|c| {
            let name = c.as_os_str().to_str().unwrap_or("");
            IGNORE_FOLDERS.contains(name)
        }) {
            continue;
        }
        if !include_matchers.is_empty() && !include_matchers.iter().any(|g| g.is_match(rel_str)) {
            continue;
        }
        files.push((rel_str.to_string(), full));
        if files.len() >= config.max_files {
            break;
        }
    }

    let files_scanned = AtomicUsize::new(0);

    // Process files in parallel with rayon
    let all_matches: Vec<ScanFileMatch> = files
        .par_iter()
        .flat_map(|(rel_str, full)| {
            let mut file_matches: Vec<ScanFileMatch> = Vec::new();
            files_scanned.fetch_add(1, Ordering::Relaxed);

            for (label, id, matcher) in &compiled {
                let mut searcher = SearcherBuilder::new()
                    .line_number(true)
                    .before_context(config.context_lines)
                    .after_context(config.context_lines)
                    .build();

                let mut sink = ScanSink {
                    file: rel_str.clone(),
                    label: label.clone(),
                    id: id.clone(),
                    matcher,
                    results: Vec::new(),
                    max_per_file: config.max_per_file,
                    before_buf: VecDeque::new(),
                    context_lines: config.context_lines,
                    pending: None,
                    after_remaining: 0,
                };

                let _ = searcher.search_path(matcher, full, &mut sink);
                file_matches.extend(sink.results);
            }
            file_matches
        })
        .collect();

    let elapsed = start.elapsed().as_millis() as u64;
    let result = ScanResult {
        matches: all_matches,
        files_scanned: files_scanned.load(Ordering::Relaxed),
        elapsed_ms: elapsed,
    };

    serde_json::to_string(&result).map_err(|e| napi::Error::from_reason(e.to_string()))
}

const MAX_READ_BATCH_FILES: usize = 10_000;
const MAX_READ_BATCH_BYTES: usize = 64 * 1024 * 1024;

/// Batch file reader: reads multiple files in parallel using rayon.
/// Returns a JSON object mapping file paths to their UTF-8 contents.
/// If any file cannot be read as UTF-8, return an error so the JavaScript
/// caller can fall back to its per-file reader without silently losing input.
#[napi]
pub fn read_files_batch(files_json: String) -> napi::Result<String> {
    let files: Vec<String> = serde_json::from_str(&files_json)
        .map_err(|e| napi::Error::from_reason(format!("invalid JSON: {e}")))?;

    if files.len() > MAX_READ_BATCH_FILES {
        return Err(napi::Error::from_reason(
            "Native read batch limit exceeded",
        ));
    }
    // Fail fast on declared sizes before allocating the contents.
    let mut declared_total = 0usize;
    for path in &files {
        if let Ok(meta) = std::fs::metadata(path) {
            declared_total = declared_total.saturating_add(meta.len() as usize);
            if declared_total > MAX_READ_BATCH_BYTES {
                return Err(napi::Error::from_reason(
                    "Native read batch limit exceeded",
                ));
            }
        }
    }
    let accumulated = AtomicUsize::new(0);
    let results: Result<Vec<(String, String)>, String> = files
        .par_iter()
        .map(|path| {
            let content = std::fs::read_to_string(path)
                .map_err(|error| format!("failed to read {path}: {error}"))?;
            if accumulated.fetch_add(content.len(), Ordering::Relaxed) + content.len()
                > MAX_READ_BATCH_BYTES
            {
                return Err("Native read batch limit exceeded".to_string());
            }
            Ok((path.clone(), content))
        })
        .collect();
    let results = results.map_err(napi::Error::from_reason)?;

    // Serialize as array of [path, content] pairs for efficient JS parsing
    serde_json::to_string(&results).map_err(|e| napi::Error::from_reason(e.to_string()))
}

// ---------------------------------------------------------------------------
// 7. FileTree — Persistent in-memory file tree with mtime-sorted index
// ---------------------------------------------------------------------------

use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileMeta {
    path: String,
    size: u64,
    mtime: u64,
    is_dir: bool,
}

struct FileTreeInner {
    root: PathBuf,
    files: BTreeMap<String, FileMeta>,
    mtime_index: BTreeSet<(u64, String)>,
    populated: bool,
}

impl FileTreeInner {
    fn new(root: PathBuf) -> Self {
        Self {
            root,
            files: BTreeMap::new(),
            mtime_index: BTreeSet::new(),
            populated: false,
        }
    }

    fn scan(&mut self) -> (usize, usize) {
        self.files.clear();
        self.mtime_index.clear();

        let mut file_count = 0usize;
        let mut dir_count = 0usize;
        let mut builder = WalkBuilder::new(&self.root);
        builder.hidden(false);
        builder.git_ignore(true);
        builder.git_global(true);
        builder.git_exclude(true);
        builder.filter_entry(|entry| walk_keeps(entry, false));

        for entry in builder.build().flatten() {
            let ft = match entry.file_type() {
                Some(ft) => ft,
                None => continue,
            };

            let rel = match entry.path().strip_prefix(&self.root) {
                Ok(p) => p,
                Err(_) => continue,
            };

            let rel_str = match rel.to_str() {
                Some(s) => s.to_string(),
                None => continue,
            };

            if rel_str.is_empty() {
                continue;
            }

            // Skip .git internals
            if rel.components().any(|c| c.as_os_str() == ".git") {
                continue;
            }

            let meta = match std::fs::metadata(entry.path()) {
                Ok(m) => m,
                Err(_) => continue,
            };

            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_millis() as u64);

            let is_dir = ft.is_dir();
            if is_dir {
                dir_count += 1;
            } else {
                file_count += 1;
            }

            let fm = FileMeta {
                path: rel_str.clone(),
                size: meta.len(),
                mtime,
                is_dir,
            };

            if !is_dir {
                self.mtime_index.insert((u64::MAX - mtime, rel_str.clone()));
            }
            self.files.insert(rel_str, fm);
        }

        self.populated = true;
        (file_count, dir_count)
    }

    fn glob_cached(&self, pattern: &str, limit: usize) -> Vec<&FileMeta> {
        let matcher = match compile_glob(pattern) {
            Ok(g) => g,
            Err(_) => return Vec::new(),
        };

        let mut results = Vec::new();
        // Iterate by mtime (descending, stored as MAX-mtime)
        for (_, path) in &self.mtime_index {
            if results.len() >= limit {
                break;
            }
            if matcher.is_match(path.as_str()) {
                if let Some(fm) = self.files.get(path) {
                    results.push(fm);
                }
            }
        }
        results
    }

    fn update_file(&mut self, rel_path: String, abs_path: &Path) {
        // Remove old entry
        if let Some(old) = self.files.remove(&rel_path) {
            self.mtime_index
                .remove(&(u64::MAX - old.mtime, rel_path.clone()));
        }

        let meta = match std::fs::metadata(abs_path) {
            Ok(m) => m,
            Err(_) => return, // file removed
        };

        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_millis() as u64);

        let fm = FileMeta {
            path: rel_path.clone(),
            size: meta.len(),
            mtime,
            is_dir: meta.is_dir(),
        };

        if !fm.is_dir {
            self.mtime_index
                .insert((u64::MAX - mtime, rel_path.clone()));
        }
        self.files.insert(rel_path, fm);
    }

    fn remove_file(&mut self, rel_path: &str) {
        if let Some(old) = self.files.remove(rel_path) {
            self.mtime_index
                .remove(&(u64::MAX - old.mtime, rel_path.to_string()));
        }
    }
}

/// Persistent file tree with cached mtime-sorted index.
/// Reuse across multiple glob/search calls to avoid re-walking.
#[napi]
pub struct FileTree {
    inner: Arc<Mutex<FileTreeInner>>,
}

#[napi]
impl FileTree {
    #[napi(constructor)]
    pub fn new(root: String) -> Self {
        Self {
            inner: Arc::new(Mutex::new(FileTreeInner::new(PathBuf::from(root)))),
        }
    }

    /// Full scan of the directory tree. Returns { files, dirs, elapsedMs }.
    #[napi]
    pub fn scan(&self) -> napi::Result<String> {
        let start = std::time::Instant::now();
        let mut inner = self
            .inner
            .lock()
            .map_err(|e| napi::Error::from_reason(format!("lock poisoned: {e}")))?;
        let (files, dirs) = inner.scan();
        let elapsed = start.elapsed().as_millis() as u64;

        #[derive(Serialize)]
        struct ScanResult {
            files: usize,
            dirs: usize,
            elapsed_ms: u64,
        }
        serde_json::to_string(&ScanResult {
            files,
            dirs,
            elapsed_ms: elapsed,
        })
        .map_err(|e| napi::Error::from_reason(e.to_string()))
    }

    /// Glob query against cached file tree (no disk I/O after scan).
    #[napi]
    pub fn glob(&self, pattern: String, limit: u32) -> napi::Result<String> {
        let inner = self
            .inner
            .lock()
            .map_err(|e| napi::Error::from_reason(format!("lock poisoned: {e}")))?;

        if !inner.populated {
            return Err(napi::Error::from_reason(
                "FileTree not scanned yet — call scan() first",
            ));
        }

        let results = inner.glob_cached(&pattern, limit as usize);
        let entries: Vec<&FileMeta> = results;
        serde_json::to_string(&entries).map_err(|e| napi::Error::from_reason(e.to_string()))
    }

    /// Number of files in the tree.
    #[napi]
    pub fn file_count(&self) -> napi::Result<u32> {
        let inner = self
            .inner
            .lock()
            .map_err(|e| napi::Error::from_reason(format!("lock poisoned: {e}")))?;
        Ok(inner.files.values().filter(|f| !f.is_dir).count() as u32)
    }

    /// Update a single file entry (called from watcher callback).
    #[napi]
    pub fn update_file(&self, rel_path: String, abs_path: String) -> napi::Result<()> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|e| napi::Error::from_reason(format!("lock poisoned: {e}")))?;
        inner.update_file(rel_path, Path::new(&abs_path));
        Ok(())
    }

    /// Remove a file entry (called from watcher callback).
    #[napi]
    pub fn remove_file(&self, rel_path: String) -> napi::Result<()> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|e| napi::Error::from_reason(format!("lock poisoned: {e}")))?;
        inner.remove_file(&rel_path);
        Ok(())
    }

    /// Check if a file exists in the cached tree.
    #[napi]
    pub fn has_file(&self, rel_path: String) -> napi::Result<bool> {
        let inner = self
            .inner
            .lock()
            .map_err(|e| napi::Error::from_reason(format!("lock poisoned: {e}")))?;
        Ok(inner.files.contains_key(&rel_path))
    }

    /// Get file metadata from cache.
    #[napi]
    pub fn file_meta(&self, rel_path: String) -> napi::Result<Option<String>> {
        let inner = self
            .inner
            .lock()
            .map_err(|e| napi::Error::from_reason(format!("lock poisoned: {e}")))?;
        match inner.files.get(&rel_path) {
            Some(fm) => serde_json::to_string(fm)
                .map(Some)
                .map_err(|e| napi::Error::from_reason(e.to_string())),
            None => Ok(None),
        }
    }
}

// ---------------------------------------------------------------------------
// 8. Native detector NAPI exports
// ---------------------------------------------------------------------------

#[napi]
pub fn detect_security(input_json: String) -> napi::Result<String> {
    detect::detect_security_native(&input_json).map_err(napi::Error::from_reason)
}

#[napi]
pub fn detect_lifecycle(input_json: String) -> napi::Result<String> {
    detect::detect_lifecycle_native(&input_json).map_err(napi::Error::from_reason)
}

#[napi]
pub fn detect_hardcodes(input_json: String) -> napi::Result<String> {
    detect::detect_hardcodes_native(&input_json).map_err(napi::Error::from_reason)
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn make_tmp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ax_code_fs_test_{}", name));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("failed to create temp dir");
        dir
    }

    fn cleanup(dir: &Path) {
        let _ = fs::remove_dir_all(dir);
    }

    // ── is_ignored: hardcoded folder names ──────────────────────────────────

    #[test]
    fn is_ignored_node_modules() {
        let result = is_ignored("node_modules/foo/bar.js".into(), "[]".into()).unwrap();
        assert!(result);
    }

    #[test]
    fn is_ignored_git_directory() {
        let result = is_ignored(".git/config".into(), "[]".into()).unwrap();
        assert!(result);
    }

    #[test]
    fn is_ignored_dist_directory() {
        let result = is_ignored("dist/bundle.js".into(), "[]".into()).unwrap();
        assert!(result);
    }

    #[test]
    fn is_ignored_nested_target() {
        let result = is_ignored("project/target/debug/binary".into(), "[]".into()).unwrap();
        assert!(result);
    }

    // ── is_ignored: file patterns ──────────────────────────────────────────

    #[test]
    fn is_ignored_swp_files() {
        let result = is_ignored("src/main.rs.swp".into(), "[]".into()).unwrap();
        assert!(result);
    }

    #[test]
    fn is_ignored_ds_store() {
        let result = is_ignored("some/dir/.DS_Store".into(), "[]".into()).unwrap();
        assert!(result);
    }

    #[test]
    fn is_ignored_log_files() {
        let result = is_ignored("app/debug.log".into(), "[]".into()).unwrap();
        assert!(result);
    }

    #[test]
    fn is_ignored_pyc_files() {
        let result = is_ignored("module/cache.pyc".into(), "[]".into()).unwrap();
        assert!(result);
    }

    // ── is_ignored: normal files return false ──────────────────────────────

    #[test]
    fn is_ignored_normal_rust_file() {
        let result = is_ignored("src/main.rs".into(), "[]".into()).unwrap();
        assert!(!result);
    }

    #[test]
    fn is_ignored_normal_js_file() {
        let result = is_ignored("lib/index.js".into(), "[]".into()).unwrap();
        assert!(!result);
    }

    #[test]
    fn is_ignored_readme() {
        let result = is_ignored("README.md".into(), "[]".into()).unwrap();
        assert!(!result);
    }

    #[test]
    fn is_ignored_with_extra_patterns() {
        let result = is_ignored("data/file.csv".into(), "[\"**/*.csv\"]".into()).unwrap();
        assert!(result);

        let result2 = is_ignored("data/file.txt".into(), "[\"**/*.csv\"]".into()).unwrap();
        assert!(!result2);
    }

    // ── walk_files ────────────────────────────────────────────────────────

    #[test]
    fn walk_files_basic() {
        let dir = make_tmp_dir("walk_basic");

        // Create a simple file structure
        fs::create_dir_all(dir.join("src")).unwrap();
        fs::write(dir.join("src/main.rs"), "fn main() {}").unwrap();
        fs::write(dir.join("README.md"), "# readme").unwrap();

        let results = walk_files(dir.to_str().unwrap().into(), "{}".into()).unwrap();

        assert!(
            results
                .iter()
                .any(|p| Path::new(p) == Path::new("src/main.rs"))
        );
        assert!(results.contains(&"README.md".to_string()));

        cleanup(&dir);
    }

    #[test]
    fn walk_files_respects_limit() {
        let dir = make_tmp_dir("walk_limit");

        for i in 0..20 {
            fs::write(dir.join(format!("file{i}.txt")), "x").unwrap();
        }

        let opts = serde_json::json!({ "limit": 5 }).to_string();
        let results = walk_files(dir.to_str().unwrap().into(), opts).unwrap();
        assert_eq!(results.len(), 5);

        // A limit of 0 means "no limit" — walk everything.
        let opts_zero = serde_json::json!({ "limit": 0 }).to_string();
        let all = walk_files(dir.to_str().unwrap().into(), opts_zero).unwrap();
        assert_eq!(all.len(), 20);

        // Absent limit also walks everything.
        let none = walk_files(dir.to_str().unwrap().into(), "{}".into()).unwrap();
        assert_eq!(none.len(), 20);

        cleanup(&dir);
    }

    #[test]
    fn walk_files_with_glob() {
        let dir = make_tmp_dir("walk_glob");

        fs::create_dir_all(dir.join("src")).unwrap();
        fs::write(dir.join("src/lib.rs"), "pub fn lib() {}").unwrap();
        fs::write(dir.join("src/notes.txt"), "notes").unwrap();
        fs::write(dir.join("README.md"), "# readme").unwrap();

        let opts = serde_json::json!({"glob": ["**/*.rs"]}).to_string();
        let results = walk_files(dir.to_str().unwrap().into(), opts).unwrap();

        assert!(
            results
                .iter()
                .any(|p| Path::new(p) == Path::new("src/lib.rs"))
        );
        assert!(
            !results
                .iter()
                .any(|p| Path::new(p) == Path::new("src/notes.txt"))
        );
        assert!(!results.contains(&"README.md".to_string()));

        cleanup(&dir);
    }

    #[test]
    fn walk_files_excludes_git_dir() {
        let dir = make_tmp_dir("walk_git");

        fs::create_dir_all(dir.join(".git/objects")).unwrap();
        fs::write(dir.join(".git/config"), "[core]").unwrap();
        fs::write(dir.join("file.txt"), "content").unwrap();

        let opts = serde_json::json!({"hidden": true}).to_string();
        let results = walk_files(dir.to_str().unwrap().into(), opts).unwrap();

        assert!(results.contains(&"file.txt".to_string()));
        assert!(!results.iter().any(|p| p.contains(".git")));

        cleanup(&dir);
    }

    #[test]
    fn walk_files_excludes_ignore_folders() {
        let dir = make_tmp_dir("walk_ignore");

        fs::create_dir_all(dir.join("src")).unwrap();
        fs::create_dir_all(dir.join("node_modules/foo")).unwrap();
        fs::create_dir_all(dir.join("dist")).unwrap();
        fs::create_dir_all(dir.join("build/out")).unwrap();
        fs::write(dir.join("src/main.rs"), "fn main() {}").unwrap();
        fs::write(dir.join("node_modules/foo/index.js"), "module.exports={}").unwrap();
        fs::write(dir.join("dist/bundle.js"), "// bundle").unwrap();
        fs::write(dir.join("build/out/app"), "binary").unwrap();

        // hidden: false should still exclude node_modules/dist/build
        let results = walk_files(dir.to_str().unwrap().into(), "{}".into()).unwrap();

        assert!(
            results
                .iter()
                .any(|p| Path::new(p) == Path::new("src/main.rs"))
        );
        assert!(!results.iter().any(|p| p.contains("node_modules")));
        assert!(
            !results
                .iter()
                .any(|p| Path::new(p).components().any(|c| c.as_os_str() == "dist"))
        );
        assert!(
            !results
                .iter()
                .any(|p| Path::new(p).components().any(|c| c.as_os_str() == "build"))
        );

        cleanup(&dir);
    }

    // ── glob_files ────────────────────────────────────────────────────────

    #[test]
    fn glob_files_basic() {
        let dir = make_tmp_dir("glob_basic");

        fs::create_dir_all(dir.join("src")).unwrap();
        fs::write(dir.join("src/main.rs"), "fn main() {}").unwrap();
        fs::write(dir.join("src/lib.rs"), "pub fn lib() {}").unwrap();
        fs::write(dir.join("data.json"), "{}").unwrap();

        let json = glob_files(dir.to_str().unwrap().into(), "**/*.rs".into(), 100).unwrap();
        let entries: Vec<serde_json::Value> = serde_json::from_str(&json).unwrap();

        let paths: Vec<&str> = entries
            .iter()
            .map(|e| e["path"].as_str().unwrap())
            .collect();
        assert!(
            paths
                .iter()
                .any(|p| Path::new(p) == Path::new("src/main.rs"))
        );
        assert!(
            paths
                .iter()
                .any(|p| Path::new(p) == Path::new("src/lib.rs"))
        );
        assert!(!paths.contains(&"data.json"));

        cleanup(&dir);
    }

    #[test]
    fn glob_files_respects_limit() {
        let dir = make_tmp_dir("glob_limit");

        for i in 0..10 {
            fs::write(dir.join(format!("file{}.txt", i)), "content").unwrap();
        }

        let json = glob_files(dir.to_str().unwrap().into(), "**/*.txt".into(), 3).unwrap();
        let entries: Vec<serde_json::Value> = serde_json::from_str(&json).unwrap();

        assert_eq!(entries.len(), 3);

        cleanup(&dir);
    }

    #[test]
    fn glob_files_sorted_by_mtime_desc() {
        let dir = make_tmp_dir("glob_mtime");

        fs::write(dir.join("older.txt"), "old").unwrap();
        // Brief pause to ensure distinct mtime
        std::thread::sleep(std::time::Duration::from_millis(50));
        fs::write(dir.join("newer.txt"), "new").unwrap();

        let json = glob_files(dir.to_str().unwrap().into(), "**/*.txt".into(), 10).unwrap();
        let entries: Vec<serde_json::Value> = serde_json::from_str(&json).unwrap();

        assert!(entries.len() >= 2);
        let first_mtime = entries[0]["mtime"].as_u64().unwrap();
        let second_mtime = entries[1]["mtime"].as_u64().unwrap();
        assert!(first_mtime >= second_mtime);

        cleanup(&dir);
    }

    #[test]
    fn search_content_includes_hidden_files_but_not_git() {
        let dir = make_tmp_dir("search_hidden");
        fs::create_dir_all(dir.join(".github")).unwrap();
        fs::create_dir_all(dir.join(".git")).unwrap();
        fs::write(dir.join(".github/ci.yml"), "needle: 1\n").unwrap();
        fs::write(dir.join(".git/config"), "needle = 2\n").unwrap();
        fs::write(dir.join("a.txt"), "needle\n").unwrap();

        let json =
            search_content(dir.to_str().unwrap().into(), "needle".into(), "{}".into()).unwrap();
        let rows: Vec<serde_json::Value> = serde_json::from_str(&json).unwrap();
        let paths: Vec<String> = rows
            .iter()
            .map(|r| r["path"].as_str().unwrap().to_owned())
            .collect();

        assert!(paths.iter().any(|p| p.ends_with("ci.yml")), "{paths:?}");
        assert!(paths.iter().any(|p| p.ends_with("a.txt")), "{paths:?}");
        assert!(
            !paths
                .iter()
                .any(|p| p.contains(".git/") || p.contains(".git\\")),
            "{paths:?}"
        );

        cleanup(&dir);
    }

    #[test]
    fn search_content_reports_the_whole_line_and_caps_huge_lines() {
        let dir = make_tmp_dir("search_line");
        fs::write(dir.join("a.txt"), "prefix needle suffix\n").unwrap();
        fs::write(dir.join("b.txt"), format!("needle{}\n", "é".repeat(40_000))).unwrap();

        let json =
            search_content(dir.to_str().unwrap().into(), "needle".into(), "{}".into()).unwrap();
        let rows: Vec<serde_json::Value> = serde_json::from_str(&json).unwrap();
        let text_of = |name: &str| {
            rows.iter()
                .find(|r| r["path"].as_str().unwrap().ends_with(name))
                .map(|r| r["matchText"].as_str().unwrap().to_owned())
                .unwrap()
        };
        assert_eq!(text_of("a.txt"), "prefix needle suffix");
        let long = text_of("b.txt");
        assert!(long.starts_with("needleé") && long.len() <= MAX_REPORTED_LINE_BYTES);
        let a = rows
            .iter()
            .find(|r| r["path"].as_str().unwrap().ends_with("a.txt"))
            .unwrap();
        assert_eq!(a["column"], 8);

        cleanup(&dir);
    }

    #[test]
    fn walk_files_rejects_an_invalid_glob() {
        let dir = make_tmp_dir("walk_bad_glob");
        fs::write(dir.join("a.txt"), "x\n").unwrap();

        let err = walk_files(dir.to_str().unwrap().into(), r#"{"glob":["["]}"#.into()).unwrap_err();
        assert!(
            err.reason.contains("invalid include glob"),
            "{}",
            err.reason
        );

        cleanup(&dir);
    }

    #[test]
    fn scan_files_rejects_an_invalid_pattern() {
        let dir = make_tmp_dir("scan_bad_pattern");
        fs::write(dir.join("a.txt"), "x\n").unwrap();

        let err = scan_files(
            dir.to_str().unwrap().into(),
            r#"{"include":[],"patterns":[{"id":"p1","label":"l","regex":"foo(?=bar)"}]}"#.into(),
        )
        .unwrap_err();
        assert!(
            err.reason.contains("invalid scan pattern"),
            "{}",
            err.reason
        );

        cleanup(&dir);
    }

    #[test]
    fn search_content_rejects_an_invalid_include_glob() {
        let dir = make_tmp_dir("search_bad_glob");
        fs::write(dir.join("a.txt"), "needle\n").unwrap();

        let err = search_content(
            dir.to_str().unwrap().into(),
            "needle".into(),
            r#"{"glob":"["}"#.into(),
        )
        .unwrap_err();
        assert!(
            err.reason.contains("invalid include glob"),
            "{}",
            err.reason
        );

        cleanup(&dir);
    }

    #[test]
    fn gate_read_files_batch_rejects_too_many_paths() {
        let files: Vec<String> = (0..=MAX_READ_BATCH_FILES).map(|i| format!("/nonexistent/{i}")).collect();
        let err = read_files_batch(serde_json::to_string(&files).unwrap()).unwrap_err();
        assert!(err.reason.contains("Native read batch limit exceeded"), "{}", err.reason);
    }

    #[test]
    fn gate_read_files_batch_rejects_oversized_content() {
        let dir = make_tmp_dir("read_batch_limit");
        // One file just over the limit via two ~33 MiB halves; declared-size
        // prefilter rejects before/while reading without exceeding ~100 MiB.
        let p1 = dir.join("a.bin");
        let p2 = dir.join("b.bin");
        fs::write(&p1, "x".repeat(33 * 1024 * 1024)).unwrap();
        fs::write(&p2, "y".repeat(33 * 1024 * 1024)).unwrap();
        let files = vec![p1.to_string_lossy().into_owned(), p2.to_string_lossy().into_owned()];
        let err = read_files_batch(serde_json::to_string(&files).unwrap()).unwrap_err();
        assert!(err.reason.contains("Native read batch limit exceeded"), "{}", err.reason);
        // Normal batch still works.
        let small = dir.join("small.txt");
        fs::write(&small, "hello").unwrap();
        let out = read_files_batch(serde_json::to_string(&vec![small.to_string_lossy().into_owned()]).unwrap()).unwrap();
        assert!(out.contains("hello"));
        cleanup(&dir);
    }

    #[test]
    fn search_content_is_case_sensitive_unless_the_pattern_opts_in() {
        let dir = make_tmp_dir("search_case");
        fs::write(dir.join("a.txt"), "Needle\nneedle\n").unwrap();
        let count = |pattern: &str| {
            let json =
                search_content(dir.to_str().unwrap().into(), pattern.into(), "{}".into()).unwrap();
            serde_json::from_str::<Vec<serde_json::Value>>(&json)
                .unwrap()
                .len()
        };

        assert_eq!(count("needle"), 1);
        assert_eq!(count("Needle"), 1);
        assert_eq!(count("(?i)needle"), 2);

        cleanup(&dir);
    }
    // ── pruning before descent ───────────────────────────────────────────────

    fn write(dir: &Path, rel: &str, body: &str) {
        let path = dir.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, body).unwrap();
    }

    #[test]
    fn walk_prunes_git_and_ignore_folders_at_any_depth() {
        let dir = make_tmp_dir("walk_prune");
        write(&dir, "src/ok.ts", "x");
        write(&dir, "pkg/keep.ts", "x");
        write(&dir, "node_modules/a/b.js", "x");
        write(&dir, "pkg/node_modules/y.js", "x");
        write(&dir, "dist/x.js", "x");
        write(&dir, ".git/HEAD", "x");
        write(&dir, "deep/a/b/target/z.rs", "x");
        // A plain file named like an ignored folder was excluded by the old path-component filter too.
        write(&dir, "src/build", "x");

        let mut files = walk_files(dir.to_str().unwrap().into(), "{}".into()).unwrap();
        files.sort();
        assert_eq!(
            files,
            vec!["pkg/keep.ts".to_string(), "src/ok.ts".to_string()]
        );

        cleanup(&dir);
    }

    #[test]
    fn walk_keeps_a_root_that_is_named_like_an_ignored_folder() {
        let parent = make_tmp_dir("walk_root_named");
        let root = parent.join("node_modules");
        write(&root, "lib/a.ts", "x");
        write(&root, "node_modules/inner.ts", "x");

        let mut files = walk_files(root.to_str().unwrap().into(), "{}".into()).unwrap();
        files.sort();
        assert_eq!(files, vec!["lib/a.ts".to_string()]);

        cleanup(&parent);
    }

    #[test]
    fn walk_skips_a_gitfile_like_a_git_directory() {
        let dir = make_tmp_dir("walk_gitfile");
        write(&dir, ".git", "gitdir: ../elsewhere\n");
        write(&dir, "a.txt", "x");

        let files = walk_files(dir.to_str().unwrap().into(), "{}".into()).unwrap();
        assert_eq!(files, vec!["a.txt".to_string()]);

        cleanup(&dir);
    }

    #[test]
    fn glob_files_never_reports_git_contents() {
        let dir = make_tmp_dir("glob_git");
        write(&dir, ".git/hooks/pre-commit.rs", "x");
        write(&dir, "src/a.rs", "x");

        let json = glob_files(dir.to_str().unwrap().into(), "**/*.rs".into(), 50).unwrap();
        let rows: Vec<serde_json::Value> = serde_json::from_str(&json).unwrap();
        let paths: Vec<&str> = rows.iter().map(|r| r["path"].as_str().unwrap()).collect();
        assert_eq!(paths, vec!["src/a.rs"]);

        cleanup(&dir);
    }

    // ── ordered parallel search ──────────────────────────────────────────────

    #[test]
    fn search_context_preserves_overlapping_match_windows() {
        let dir = make_tmp_dir("search_context_overlap");
        fs::write(
            dir.join("file.txt"),
            "before\nneedle one\nneedle two\nafter\nlast\n",
        )
        .unwrap();
        let rows = search_rows(&dir, "{\"contextLines\":2}");
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["contextBefore"], serde_json::json!(["before"]));
        assert_eq!(
            rows[0]["contextAfter"],
            serde_json::json!(["needle two", "after"])
        );
        assert_eq!(
            rows[1]["contextBefore"],
            serde_json::json!(["before", "needle one"])
        );
        assert_eq!(
            rows[1]["contextAfter"],
            serde_json::json!(["after", "last"])
        );
        let limited = search_rows(&dir, "{\"contextLines\":2,\"limit\":1}");
        assert_eq!(limited, rows[..1]);
        cleanup(&dir);
    }

    #[test]
    fn search_context_caps_each_reported_line() {
        let dir = make_tmp_dir("search_context_cap");
        let huge = "é".repeat(MAX_REPORTED_LINE_BYTES);
        fs::write(dir.join("file.txt"), format!("{huge}\nneedle\n{huge}\n")).unwrap();
        let rows = search_rows(&dir, "{\"contextLines\":1}");
        for side in ["contextBefore", "contextAfter"] {
            let line = rows[0][side][0].as_str().unwrap();
            assert_eq!(line.len(), MAX_REPORTED_LINE_BYTES);
        }
        cleanup(&dir);
    }

    #[test]
    fn search_context_matches_independent_line_windows() {
        let dir = make_tmp_dir("search_context_windows");
        for body in [
            "needle\nneedle\nneedle\n",
            "start\nneedle\none\nneedle\ntwo\nthree\nfour\nfive\nneedle\nend",
            "first\r\nneedle\r\n\r\nneedle\r\nlast\r\n",
            "before\nneedle",
        ] {
            fs::write(dir.join("file.txt"), body).unwrap();
            let lines: Vec<_> = body.lines().collect();
            for context in [0usize, 1, 2, 4] {
                for limit in [1usize, 2, 10] {
                    let rows = search_rows(
                        &dir,
                        &format!("{{\"contextLines\":{context},\"limit\":{limit}}}"),
                    );
                    let expected: Vec<_> = lines
                        .iter()
                        .enumerate()
                        .filter(|(_, line)| line.contains("needle"))
                        .take(limit)
                        .collect();
                    assert_eq!(rows.len(), expected.len());
                    for (row, (index, line)) in rows.iter().zip(expected) {
                        assert_eq!(row["matchText"], *line);
                        assert_eq!(
                            row["contextBefore"],
                            serde_json::json!(&lines[index.saturating_sub(context)..index])
                        );
                        assert_eq!(
                            row["contextAfter"],
                            serde_json::json!(
                                &lines[index + 1..(index + context + 1).min(lines.len())]
                            )
                        );
                    }
                }
            }
        }
        cleanup(&dir);
    }

    fn search_rows(dir: &Path, options: &str) -> Vec<serde_json::Value> {
        let json = search_content(
            dir.to_str().unwrap().into(),
            "needle".into(),
            options.into(),
        )
        .unwrap();
        serde_json::from_str(&json).unwrap()
    }

    fn seed_search_tree(dir: &Path) {
        for d in 0..12 {
            for f in 0..14 {
                let mut body = String::new();
                for line in 0..9 {
                    if (d + f + line) % 3 == 0 {
                        body.push_str(&format!("needle d{d} f{f} l{line}\n"));
                    } else {
                        body.push_str(&format!("filler {line}\n"));
                    }
                }
                write(dir, &format!("d{d}/f{f}.txt"), &body);
            }
        }
        write(dir, "node_modules/skip.txt", "needle\n");
    }

    #[test]
    fn parallel_search_matches_a_sequential_reference_in_walk_order() {
        let dir = make_tmp_dir("search_order");
        seed_search_tree(&dir);

        // Independent reference: walk order from `walk_files`, plain string scanning per file.
        let mut expected: Vec<(String, u64)> = Vec::new();
        for rel in walk_files(dir.to_str().unwrap().into(), "{}".into()).unwrap() {
            let full = dir.join(&rel);
            let text = fs::read_to_string(&full).unwrap();
            for (index, line) in text.lines().enumerate() {
                if line.contains("needle") {
                    expected.push((full.to_string_lossy().into_owned(), index as u64 + 1));
                }
            }
        }
        assert!(
            expected.len() > 200,
            "fixture should exceed the default limit"
        );

        for limit in [1usize, 7, 8, 9, 24, 63, 64, 65, 137, 250, 100_000] {
            let rows = search_rows(&dir, &format!("{{\"limit\":{limit}}}"));
            let got: Vec<(String, u64)> = rows
                .iter()
                .map(|r| {
                    (
                        r["path"].as_str().unwrap().to_owned(),
                        r["line"].as_u64().unwrap(),
                    )
                })
                .collect();
            let want: Vec<(String, u64)> = expected.iter().take(limit).cloned().collect();
            assert_eq!(got, want, "limit {limit}");
        }

        cleanup(&dir);
    }

    #[test]
    fn parallel_search_with_context_returns_a_prefix_of_the_unbounded_result() {
        let dir = make_tmp_dir("search_context_prefix");
        seed_search_tree(&dir);

        let full = search_rows(&dir, "{\"limit\":100000,\"contextLines\":2}");
        assert!(full.len() > 200);
        for limit in [1usize, 8, 65, 250] {
            let rows = search_rows(&dir, &format!("{{\"limit\":{limit},\"contextLines\":2}}"));
            assert_eq!(rows, full[..limit].to_vec(), "limit {limit}");
        }

        cleanup(&dir);
    }

    #[test]
    fn parallel_search_honours_zero_limit_glob_and_cancellation() {
        let dir = make_tmp_dir("search_misc");
        seed_search_tree(&dir);
        write(&dir, "d0/only.md", "needle in markdown\n");

        assert!(search_rows(&dir, "{\"limit\":0}").is_empty());

        let rows = search_rows(&dir, "{\"limit\":100000,\"glob\":\"**/*.md\"}");
        assert_eq!(rows.len(), 1);
        assert!(rows[0]["path"].as_str().unwrap().ends_with("only.md"));

        let cancelled = AtomicBool::new(true);
        let err = search_content_impl(dir.to_str().unwrap(), "needle", "{}", &cancelled);
        assert!(err.is_err());

        cleanup(&dir);
    }
}
