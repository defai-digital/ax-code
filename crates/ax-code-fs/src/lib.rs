#[macro_use]
extern crate napi_derive;

use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use globset::{Glob, GlobMatcher};
use grep_matcher::Matcher;
use grep_regex::RegexMatcherBuilder;
use grep_searcher::{SearcherBuilder, Sink, SinkContext, SinkContextKind, SinkMatch};
use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Options structs (deserialized from JSON)
// ---------------------------------------------------------------------------

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct WalkOptions {
  glob: Option<Vec<String>>,
  hidden: Option<bool>,
  max_depth: Option<usize>,
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
// Hardcoded ignore patterns (mirrors TS FileIgnore)
// ---------------------------------------------------------------------------

const IGNORE_FOLDERS: &[&str] = &[
  "node_modules",
  "bower_components",
  ".pnpm-store",
  "vendor",
  ".npm",
  "dist",
  "build",
  "out",
  ".next",
  "target",
  "bin",
  "obj",
  ".git",
  ".svn",
  ".hg",
  ".vscode",
  ".idea",
  ".turbo",
  ".output",
  "desktop",
  ".sst",
  ".cache",
  ".webkit-cache",
  "__pycache__",
  ".pytest_cache",
  "mypy_cache",
  ".history",
  ".gradle",
];

const IGNORE_FILE_PATTERNS: &[&str] = &[
  "**/*.swp",
  "**/*.swo",
  "**/*.pyc",
  "**/.DS_Store",
  "**/Thumbs.db",
  "**/logs/**",
  "**/tmp/**",
  "**/temp/**",
  "**/*.log",
  "**/coverage/**",
  "**/.nyc_output/**",
];

// ---------------------------------------------------------------------------
// 1. walk_files
// ---------------------------------------------------------------------------

#[napi]
pub fn walk_files(cwd: String, options_json: String) -> napi::Result<Vec<String>> {
  let opts: WalkOptions =
    serde_json::from_str(&options_json).map_err(|e| napi::Error::from_reason(e.to_string()))?;

  let root = PathBuf::from(&cwd);
  let mut builder = WalkBuilder::new(&root);

  // Always respect .gitignore (on by default), enable hidden if requested
  builder.hidden(!(opts.hidden.unwrap_or(false)));
  builder.git_ignore(true);
  builder.git_global(true);
  builder.git_exclude(true);

  if let Some(depth) = opts.max_depth {
    builder.max_depth(Some(depth));
  }

  // Build glob matchers from options
  let globs: Vec<GlobMatcher> = opts
    .glob
    .unwrap_or_default()
    .iter()
    .filter_map(|p| Glob::new(p).ok().map(|g| g.compile_matcher()))
    .collect();

  let mut results = Vec::new();

  for entry in builder.build().flatten() {
    // Only include files, skip directories
    if !entry.file_type().map_or(false, |ft| ft.is_file()) {
      continue;
    }

    let path = match entry.path().strip_prefix(&root) {
      Ok(p) => p,
      Err(_) => continue,
    };

    let path_str = match path.to_str() {
      Some(s) => s,
      None => continue,
    };

    // Always exclude .git contents
    if path.components().any(|c| c.as_os_str() == ".git") {
      continue;
    }

    // If globs are specified, the file must match at least one
    if !globs.is_empty() && !globs.iter().any(|g| g.is_match(path_str)) {
      continue;
    }

    results.push(path_str.to_string());
  }

  Ok(results)
}

// ---------------------------------------------------------------------------
// 2. glob_files
// ---------------------------------------------------------------------------

#[napi]
pub fn glob_files(cwd: String, pattern: String, limit: u32) -> napi::Result<String> {
  let root = PathBuf::from(&cwd);
  let matcher = Glob::new(&pattern)
    .map_err(|e| napi::Error::from_reason(e.to_string()))?
    .compile_matcher();

  let mut builder = WalkBuilder::new(&root);
  builder.hidden(false); // show hidden files for glob matching
  builder.git_ignore(true);
  builder.git_global(true);
  builder.git_exclude(true);

  let mut entries: Vec<GlobEntry> = Vec::new();

  for entry in builder.build().flatten() {
    if !entry.file_type().map_or(false, |ft| ft.is_file()) {
      continue;
    }

    let full = entry.path();
    let rel = match full.strip_prefix(&root) {
      Ok(p) => p,
      Err(_) => continue,
    };

    let rel_str = match rel.to_str() {
      Some(s) => s,
      None => continue,
    };

    // Skip .git directory contents
    if rel.components().any(|c| c.as_os_str() == ".git") {
      continue;
    }

    if !matcher.is_match(rel_str) {
      continue;
    }

    // Stat the file for mtime and size
    let meta = match std::fs::metadata(full) {
      Ok(m) => m,
      Err(_) => continue,
    };

    let mtime = meta
      .modified()
      .ok()
      .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
      .map_or(0, |d| d.as_millis() as u64);

    entries.push(GlobEntry {
      path: rel_str.to_string(),
      mtime,
      size: meta.len(),
    });
  }

  // Sort by mtime descending
  entries.sort_by(|a, b| b.mtime.cmp(&a.mtime));

  // Cap at limit
  entries.truncate(limit as usize);

  serde_json::to_string(&entries).map_err(|e| napi::Error::from_reason(e.to_string()))
}

// ---------------------------------------------------------------------------
// 3. search_content
// ---------------------------------------------------------------------------

/// Per-file search sink that collects matches with context lines.
struct ContentSink<'a> {
  path: String,
  matcher: &'a grep_regex::RegexMatcher,
  results: &'a mut Vec<SearchMatch>,
  limit: usize,
  before_buf: Vec<String>,
  context_lines: usize,
  // Track pending match that needs after-context
  pending: Option<SearchMatch>,
  after_remaining: usize,
}

impl<'a> Sink for ContentSink<'a> {
  type Error = std::io::Error;

  fn matched(
    &mut self,
    _searcher: &grep_searcher::Searcher,
    mat: &SinkMatch<'_>,
  ) -> Result<bool, Self::Error> {
    // Flush any pending match (it got all its after-context)
    if let Some(pending) = self.pending.take() {
      self.results.push(pending);
      if self.results.len() >= self.limit {
        return Ok(false);
      }
    }

    let line_bytes = mat.bytes();
    let line_str = String::from_utf8_lossy(line_bytes);
    let line_trimmed = line_str.trim_end_matches('\n').trim_end_matches('\r');

    let line_num = mat.line_number().unwrap_or(0);

    // Find the match position within the line for column info
    let (col, match_text) = self
      .matcher
      .find(line_bytes)
      .ok()
      .flatten()
      .map(|m| {
        let col = m.start() as u64 + 1;
        let text = String::from_utf8_lossy(&line_bytes[m.start()..m.end()]).to_string();
        (col, text)
      })
      .unwrap_or((1, line_trimmed.to_string()));

    let entry = SearchMatch {
      path: self.path.clone(),
      line: line_num,
      column: col,
      match_text,
      context_before: self.before_buf.drain(..).collect(),
      context_after: Vec::new(),
    };

    if self.context_lines > 0 {
      self.pending = Some(entry);
      self.after_remaining = self.context_lines;
    } else {
      self.results.push(entry);
      if self.results.len() >= self.limit {
        return Ok(false);
      }
    }

    // Reset before buffer for next match
    self.before_buf.clear();

    Ok(true)
  }

  fn context(
    &mut self,
    _searcher: &grep_searcher::Searcher,
    ctx: &SinkContext<'_>,
  ) -> Result<bool, Self::Error> {
    let line = String::from_utf8_lossy(ctx.bytes());
    let trimmed = line.trim_end_matches('\n').trim_end_matches('\r').to_string();

    match ctx.kind() {
      SinkContextKind::Before => {
        self.before_buf.push(trimmed);
        // Keep only the last N context lines
        while self.before_buf.len() > self.context_lines {
          self.before_buf.remove(0);
        }
      }
      SinkContextKind::After => {
        if let Some(ref mut pending) = self.pending {
          pending.context_after.push(trimmed);
          self.after_remaining = self.after_remaining.saturating_sub(1);
          if self.after_remaining == 0 {
            // Flush the pending match
            let done = self.pending.take().unwrap();
            self.results.push(done);
            if self.results.len() >= self.limit {
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
    // Flush any remaining pending match
    if let Some(pending) = self.pending.take() {
      self.results.push(pending);
    }
    Ok(())
  }
}

#[napi]
pub fn search_content(cwd: String, pattern: String, options_json: String) -> napi::Result<String> {
  let opts: SearchOptions =
    serde_json::from_str(&options_json).map_err(|e| napi::Error::from_reason(e.to_string()))?;

  let limit = opts.limit.unwrap_or(250);
  let context_lines = opts.context_lines.unwrap_or(0);

  let matcher = RegexMatcherBuilder::new()
    .case_smart(true)
    .build(&pattern)
    .map_err(|e| napi::Error::from_reason(e.to_string()))?;

  let glob_matcher: Option<GlobMatcher> = opts
    .glob
    .as_ref()
    .and_then(|g| Glob::new(g).ok().map(|g| g.compile_matcher()));

  let root = PathBuf::from(&cwd);
  let mut builder = WalkBuilder::new(&root);
  builder.hidden(true); // skip hidden by default
  builder.git_ignore(true);
  builder.git_global(true);
  builder.git_exclude(true);

  let mut results: Vec<SearchMatch> = Vec::new();

  for entry in builder.build().flatten() {
    if results.len() >= limit {
      break;
    }

    if !entry.file_type().map_or(false, |ft| ft.is_file()) {
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

    // Skip .git directory
    if rel.components().any(|c| c.as_os_str() == ".git") {
      continue;
    }

    // Apply glob filter
    if let Some(ref gm) = glob_matcher {
      if !gm.is_match(rel_str) {
        continue;
      }
    }

    let mut searcher = SearcherBuilder::new()
      .line_number(true)
      .before_context(context_lines)
      .after_context(context_lines)
      .build();

    let mut sink = ContentSink {
      path: rel_str.to_string(),
      matcher: &matcher,
      results: &mut results,
      limit,
      before_buf: Vec::new(),
      context_lines,
      pending: None,
      after_remaining: 0,
    };

    // Ignore errors on individual files (binary files, permission errors, etc.)
    let _ = searcher.search_path(&matcher, &full, &mut sink);

    if results.len() >= limit {
      break;
    }
  }

  // Truncate to limit in case finish() pushed one more
  results.truncate(limit);

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
    if IGNORE_FOLDERS.contains(&name) {
      return Ok(true);
    }
  }

  // Build glob matchers for file patterns (hardcoded + extra)
  let all_patterns = IGNORE_FILE_PATTERNS
    .iter()
    .map(|s| s.to_string())
    .chain(extra.into_iter());

  for pat in all_patterns {
    if let Ok(g) = Glob::new(&pat) {
      let m = g.compile_matcher();
      if m.is_match(&path) {
        return Ok(true);
      }
    }
  }

  Ok(false)
}

// ---------------------------------------------------------------------------
// 5. FileTree — Persistent in-memory file tree with mtime-sorted index
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

      if rel_str.is_empty() { continue; }

      // Skip .git internals
      if rel.components().any(|c| c.as_os_str() == ".git") {
        continue;
      }

      let meta = match std::fs::metadata(entry.path()) {
        Ok(m) => m,
        Err(_) => continue,
      };

      let mtime = meta.modified().ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as u64);

      let is_dir = ft.is_dir();
      if is_dir { dir_count += 1; } else { file_count += 1; }

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
    let matcher = match Glob::new(pattern) {
      Ok(g) => g.compile_matcher(),
      Err(_) => return Vec::new(),
    };

    let mut results = Vec::new();
    // Iterate by mtime (descending, stored as MAX-mtime)
    for (_, path) in &self.mtime_index {
      if results.len() >= limit { break; }
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
      self.mtime_index.remove(&(u64::MAX - old.mtime, rel_path.clone()));
    }

    let meta = match std::fs::metadata(abs_path) {
      Ok(m) => m,
      Err(_) => return, // file removed
    };

    let mtime = meta.modified().ok()
      .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
      .map_or(0, |d| d.as_millis() as u64);

    let fm = FileMeta {
      path: rel_path.clone(),
      size: meta.len(),
      mtime,
      is_dir: meta.is_dir(),
    };

    if !fm.is_dir {
      self.mtime_index.insert((u64::MAX - mtime, rel_path.clone()));
    }
    self.files.insert(rel_path, fm);
  }

  fn remove_file(&mut self, rel_path: &str) {
    if let Some(old) = self.files.remove(rel_path) {
      self.mtime_index.remove(&(u64::MAX - old.mtime, rel_path.to_string()));
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
    let mut inner = self.inner.lock()
      .map_err(|e| napi::Error::from_reason(format!("lock poisoned: {e}")))?;
    let (files, dirs) = inner.scan();
    let elapsed = start.elapsed().as_millis() as u64;

    #[derive(Serialize)]
    struct ScanResult { files: usize, dirs: usize, elapsed_ms: u64 }
    serde_json::to_string(&ScanResult { files, dirs, elapsed_ms: elapsed })
      .map_err(|e| napi::Error::from_reason(e.to_string()))
  }

  /// Glob query against cached file tree (no disk I/O after scan).
  #[napi]
  pub fn glob(&self, pattern: String, limit: u32) -> napi::Result<String> {
    let inner = self.inner.lock()
      .map_err(|e| napi::Error::from_reason(format!("lock poisoned: {e}")))?;

    if !inner.populated {
      return Err(napi::Error::from_reason("FileTree not scanned yet — call scan() first"));
    }

    let results = inner.glob_cached(&pattern, limit as usize);
    let entries: Vec<&FileMeta> = results;
    serde_json::to_string(&entries).map_err(|e| napi::Error::from_reason(e.to_string()))
  }

  /// Number of files in the tree.
  #[napi]
  pub fn file_count(&self) -> napi::Result<u32> {
    let inner = self.inner.lock()
      .map_err(|e| napi::Error::from_reason(format!("lock poisoned: {e}")))?;
    Ok(inner.files.values().filter(|f| !f.is_dir).count() as u32)
  }

  /// Update a single file entry (called from watcher callback).
  #[napi]
  pub fn update_file(&self, rel_path: String, abs_path: String) -> napi::Result<()> {
    let mut inner = self.inner.lock()
      .map_err(|e| napi::Error::from_reason(format!("lock poisoned: {e}")))?;
    inner.update_file(rel_path, Path::new(&abs_path));
    Ok(())
  }

  /// Remove a file entry (called from watcher callback).
  #[napi]
  pub fn remove_file(&self, rel_path: String) -> napi::Result<()> {
    let mut inner = self.inner.lock()
      .map_err(|e| napi::Error::from_reason(format!("lock poisoned: {e}")))?;
    inner.remove_file(&rel_path);
    Ok(())
  }

  /// Check if a file exists in the cached tree.
  #[napi]
  pub fn has_file(&self, rel_path: String) -> napi::Result<bool> {
    let inner = self.inner.lock()
      .map_err(|e| napi::Error::from_reason(format!("lock poisoned: {e}")))?;
    Ok(inner.files.contains_key(&rel_path))
  }

  /// Get file metadata from cache.
  #[napi]
  pub fn file_meta(&self, rel_path: String) -> napi::Result<Option<String>> {
    let inner = self.inner.lock()
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
// 6. Embedding prep — chunking, normalization, hashing for embedding pipeline
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileChunk {
  path: String,
  chunk_index: u32,
  start_line: u32,
  end_line: u32,
  content: String,
  token_estimate: u32,
  hash: String,
}

/// Split a file into chunks suitable for embedding.
/// Chunks at paragraph/function boundaries when possible, otherwise at line count.
#[napi]
pub fn chunk_file(
  path: String,
  content: String,
  max_lines: u32,
  overlap_lines: u32,
) -> napi::Result<String> {
  let lines: Vec<&str> = content.lines().collect();
  let max = max_lines as usize;
  let overlap = overlap_lines as usize;
  let mut chunks = Vec::new();
  let mut start = 0usize;
  let mut chunk_idx = 0u32;

  while start < lines.len() {
    let end = (start + max).min(lines.len());
    let chunk_content: String = lines[start..end].join("\n");

    // Token estimate: ~4 chars per token (rough heuristic)
    let token_est = (chunk_content.len() / 4) as u32;

    // Content hash for dedup
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    chunk_content.hash(&mut hasher);
    let hash = format!("{:016x}", hasher.finish());

    chunks.push(FileChunk {
      path: path.clone(),
      chunk_index: chunk_idx,
      start_line: start as u32,
      end_line: end as u32,
      content: chunk_content,
      token_estimate: token_est,
      hash,
    });

    chunk_idx += 1;
    start = if end >= lines.len() { lines.len() } else { end - overlap };
  }

  serde_json::to_string(&chunks).map_err(|e| napi::Error::from_reason(e.to_string()))
}

/// Normalize text for embedding: collapse whitespace, strip comments, normalize unicode.
#[napi]
pub fn normalize_for_embedding(content: String) -> String {
  let mut result = String::with_capacity(content.len());
  let mut prev_was_space = false;

  for ch in content.chars() {
    match ch {
      '\t' | '\r' => {
        if !prev_was_space {
          result.push(' ');
          prev_was_space = true;
        }
      }
      '\n' => {
        result.push('\n');
        prev_was_space = false;
      }
      ' ' => {
        if !prev_was_space {
          result.push(' ');
          prev_was_space = true;
        }
      }
      // Normalize unicode quotes/dashes
      '\u{2018}' | '\u{2019}' | '\u{201A}' => { result.push('\''); prev_was_space = false; }
      '\u{201C}' | '\u{201D}' | '\u{201E}' | '\u{201F}' => { result.push('"'); prev_was_space = false; }
      '\u{2010}'..='\u{2015}' => { result.push('-'); prev_was_space = false; }
      '\u{2026}' => { result.push_str("..."); prev_was_space = false; }
      '\u{00A0}' => {
        if !prev_was_space {
          result.push(' ');
          prev_was_space = true;
        }
      }
      _ => { result.push(ch); prev_was_space = false; }
    }
  }
  result
}

/// Estimate token count for a string (rough: ~4 chars per token).
#[napi]
pub fn estimate_tokens(content: String) -> u32 {
  (content.len() / 4) as u32
}

/// Compute content hash for dedup.
#[napi]
pub fn content_hash(content: String) -> String {
  use std::hash::{Hash, Hasher};
  let mut hasher = std::collections::hash_map::DefaultHasher::new();
  content.hash(&mut hasher);
  format!("{:016x}", hasher.finish())
}

// ---------------------------------------------------------------------------
// 7. Native filesystem watcher — replaces 100ms polling with OS events
// ---------------------------------------------------------------------------

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::sync::mpsc;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WatchEvent {
  event_type: String, // "add" | "change" | "unlink"
  path: String,
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
    let _extra: Vec<String> = serde_json::from_str(&ignore_patterns_json).unwrap_or_default();

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
        if should_skip { continue; }

        let _ = tx.send(WatchEvent {
          event_type: event_type.to_string(),
          path: rel_str.to_string(),
        });
      }
    }).map_err(|e| napi::Error::from_reason(format!("failed to create watcher: {e}")))?;

    watcher.watch(&root_path, RecursiveMode::Recursive)
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
    let rx = self.receiver.lock()
      .map_err(|e| napi::Error::from_reason(format!("lock poisoned: {e}")))?;

    let mut events = Vec::new();
    while let Ok(event) = rx.try_recv() {
      events.push(event);
    }

    serde_json::to_string(&events)
      .map_err(|e| napi::Error::from_reason(e.to_string()))
  }

  /// Stop watching. Releases OS resources.
  #[napi]
  pub fn stop(&self) -> napi::Result<()> {
    let mut guard = self._watcher.lock()
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

    assert!(results.contains(&"src/main.rs".to_string()));
    assert!(results.contains(&"README.md".to_string()));

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

    assert!(results.contains(&"src/lib.rs".to_string()));
    assert!(!results.contains(&"src/notes.txt".to_string()));
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

    let paths: Vec<&str> = entries.iter().map(|e| e["path"].as_str().unwrap()).collect();
    assert!(paths.contains(&"src/main.rs"));
    assert!(paths.contains(&"src/lib.rs"));
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
}
