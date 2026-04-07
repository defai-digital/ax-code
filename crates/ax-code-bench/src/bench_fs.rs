use std::path::Path;
use std::time::Instant;

use globset::{Glob, GlobMatcher};
use ignore::WalkBuilder;

// ── Helpers ─────────────────────────────────────────────────────────────────

fn fmt_ns(ns: u128) -> String {
  if ns >= 1_000_000 { format!("{:.2} ms", ns as f64 / 1_000_000.0) }
  else if ns >= 1_000 { format!("{:.2} us", ns as f64 / 1_000.0) }
  else { format!("{} ns", ns) }
}

fn report(name: &str, ops: u64, elapsed: std::time::Duration) {
  let ns_op = elapsed.as_nanos() / ops as u128;
  println!("  {:<40} {:>8} ops in {:.3}s ({}/op)", name, ops, elapsed.as_secs_f64(), fmt_ns(ns_op));
}

// ── Hardcoded ignore lists (mirrors lib.rs) ─────────────────────────────────

const IGNORE_FOLDERS: &[&str] = &[
  "node_modules", "bower_components", ".pnpm-store", "vendor", ".npm",
  "dist", "build", "out", ".next", "target", "bin", "obj",
  ".git", ".svn", ".hg", ".vscode", ".idea", ".turbo", ".output",
  "desktop", ".sst", ".cache", ".webkit-cache", "__pycache__",
  ".pytest_cache", "mypy_cache", ".history", ".gradle",
];

const IGNORE_FILE_PATTERNS: &[&str] = &[
  "**/*.swp", "**/*.swo", "**/*.pyc", "**/.DS_Store", "**/Thumbs.db",
  "**/logs/**", "**/tmp/**", "**/temp/**", "**/*.log",
  "**/coverage/**", "**/.nyc_output/**",
];

// ── is_ignored check (folder name + glob pattern) ───────────────────────────

fn is_ignored_folder(component: &str) -> bool {
  IGNORE_FOLDERS.contains(&component)
}

fn is_ignored_path(path: &str, matchers: &[GlobMatcher]) -> bool {
  // Check folder components
  for part in path.split('/') {
    if is_ignored_folder(part) { return true; }
  }
  // Check glob patterns
  matchers.iter().any(|m| m.is_match(path))
}

// ── Benchmarks ──────────────────────────────────────────────────────────────

fn bench_is_ignored() {
  println!("[is_ignored Check]");
  let matchers: Vec<GlobMatcher> = IGNORE_FILE_PATTERNS.iter()
    .filter_map(|p| Glob::new(p).ok().map(|g| g.compile_matcher()))
    .collect();

  let paths = [
    "src/index.ts",
    "src/utils/helper.ts",
    "node_modules/lodash/index.js",
    "dist/bundle.js",
    ".git/HEAD",
    "packages/ax-code/src/tool/bash.ts",
    "coverage/lcov.info",
    "src/deep/nested/path/to/file.ts",
    "test/fixtures/sample.test.ts",
    "build/output/main.js",
  ];

  let ops = 100_000u64;
  let t = Instant::now();
  for _ in 0..ops {
    for p in &paths {
      std::hint::black_box(is_ignored_path(p, &matchers));
    }
  }
  report("is_ignored (10 paths/iter)", ops * paths.len() as u64, t.elapsed());

  // Folder-only check (fast path)
  let t = Instant::now();
  for _ in 0..ops {
    for p in &paths {
      for part in p.split('/') {
        std::hint::black_box(is_ignored_folder(part));
      }
    }
  }
  report("folder-only check (10 paths/iter)", ops * paths.len() as u64, t.elapsed());
}

fn bench_walk_files() {
  println!("\n[walk_files]");

  // Walk the ax-code repo itself (go up from crates/)
  let repo_root = std::env::current_dir()
    .ok()
    .and_then(|p| {
      // Try to find the repo root by looking for Cargo.toml in parent dirs
      let mut dir = p.as_path();
      loop {
        if dir.join("crates").join("Cargo.toml").exists() { return Some(dir.to_path_buf()); }
        dir = dir.parent()?;
      }
    })
    .unwrap_or_else(|| std::env::current_dir().unwrap());

  let root = repo_root.as_path();
  if !root.exists() {
    println!("  (skipped: repo root not found)");
    return;
  }

  // Single walk to count files
  let t = Instant::now();
  let mut builder = WalkBuilder::new(root);
  builder.hidden(true).git_ignore(true).git_global(true).git_exclude(true);
  let mut count = 0u64;
  for entry in builder.build().flatten() {
    if entry.file_type().map_or(false, |ft| ft.is_file()) { count += 1; }
  }
  let dur = t.elapsed();
  println!("  {:<40} {:>8} files in {:.3}s", "walk repo (ignore-aware)", count, dur.as_secs_f64());

  // Walk 3 more times for stable measurement
  let iters = 3u64;
  let t = Instant::now();
  for _ in 0..iters {
    let mut b = WalkBuilder::new(root);
    b.hidden(true).git_ignore(true).git_global(true).git_exclude(true);
    let c: u64 = b.build().flatten()
      .filter(|e| e.file_type().map_or(false, |ft| ft.is_file()))
      .count() as u64;
    std::hint::black_box(c);
  }
  report("walk repo (3 iterations avg)", iters, t.elapsed());
}

fn bench_glob_matching() {
  println!("\n[Glob Matching]");
  let patterns = ["**/*.ts", "**/*.rs", "src/**/*.js", "packages/*/src/**"];
  let matchers: Vec<GlobMatcher> = patterns.iter()
    .filter_map(|p| Glob::new(p).ok().map(|g| g.compile_matcher()))
    .collect();

  let test_paths = [
    "src/index.ts", "src/main.rs", "lib/utils.js", "packages/ax-code/src/tool.ts",
    "README.md", "Cargo.toml", "src/deep/nested/file.ts", "test/bench.rs",
    "packages/ui/src/button.tsx", "crates/ax-code-fs/src/lib.rs",
  ];

  let ops = 10_000u64;
  let t = Instant::now();
  for _ in 0..ops {
    for path in &test_paths {
      for m in &matchers {
        std::hint::black_box(m.is_match(Path::new(path)));
      }
    }
  }
  let total = ops * test_paths.len() as u64 * matchers.len() as u64;
  report("glob match (4 patterns x 10 paths)", total, t.elapsed());
}

// ── Main ────────────────────────────────────────────────────────────────────

fn main() {
  println!("ax-code-fs Benchmarks (Rust Native)");
  println!("====================================\n");

  bench_is_ignored();
  bench_walk_files();
  bench_glob_matching();

  println!("\n--- JS Comparison Estimates ---");
  println!("  is_ignored:    ~5-15x slower in JS (regex/minimatch overhead per path)");
  println!("  walk_files:    ~3-8x slower in JS (node:fs + ignore pkg, single-threaded)");
  println!("  glob matching: ~5-20x slower in JS (minimatch/picomatch vs compiled globset)");
}
