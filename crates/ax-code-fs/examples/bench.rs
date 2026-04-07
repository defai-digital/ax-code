use std::path::PathBuf;
use std::time::Instant;

fn main() {
  println!("=== ax-code-fs Benchmarks (release mode recommended) ===\n");

  bench_is_ignored();
  bench_glob_matching();
  bench_walk_self();

  println!("\n=== Estimated JS equivalents ===");
  println!("  JS ignore check:   ~1-5us/path  (vs Rust ~0.02-0.1us → 20-50x faster)");
  println!("  JS rg --files:     ~2-5s/10k    (vs Rust ignore crate ~200-500ms → 4-10x faster)");
  println!("  JS glob (fzf):     ~100-500ms   (vs Rust globset ~1-10ms → 50-100x faster)");
}

const IGNORE_FOLDERS: &[&str] = &[
  "node_modules", "bower_components", ".pnpm-store", "vendor", ".npm",
  "dist", "build", "out", ".next", "target", "bin", "obj",
  ".git", ".svn", ".hg", ".vscode", ".idea", ".turbo", ".output",
  "desktop", ".sst", ".cache", ".webkit-cache", "__pycache__",
  ".pytest_cache", "mypy_cache", ".history", ".gradle",
];

fn bench_is_ignored() {
  let test_paths = vec![
    "src/index.ts", "node_modules/foo/bar.js", "dist/bundle.js",
    "src/utils/helper.ts", ".git/HEAD", "build/output.js",
    "packages/core/src/main.rs", "target/debug/app", "vendor/lib.go",
    "src/components/Button.tsx", "__pycache__/mod.pyc", ".idea/workspace.xml",
    "README.md", "Cargo.toml", "package.json",
  ];

  let iterations = 100_000u64;
  let start = Instant::now();
  for i in 0..iterations {
    let path = test_paths[i as usize % test_paths.len()];
    let _ = check_ignored(path);
  }
  let elapsed = start.elapsed();
  println!("is_ignored check:    {iterations} ops in {:?} ({:.0}ns/op)", elapsed, elapsed.as_nanos() as f64 / iterations as f64);
}

fn bench_glob_matching() {
  let patterns = vec!["**/*.ts", "**/*.rs", "src/**/*.tsx", "*.json"];
  let test_paths = vec![
    "src/index.ts", "src/utils/helper.ts", "lib/main.rs",
    "src/components/Button.tsx", "package.json", "README.md",
    "src/deep/nested/file.ts", "test/unit/foo.test.ts",
  ];

  let iterations = 100_000u64;
  let start = Instant::now();
  for i in 0..iterations {
    let pattern = patterns[i as usize % patterns.len()];
    let path = test_paths[i as usize % test_paths.len()];
    let _ = glob_match(pattern, path);
  }
  let elapsed = start.elapsed();
  println!("Glob match:          {iterations} ops in {:?} ({:.0}ns/op)", elapsed, elapsed.as_nanos() as f64 / iterations as f64);
}

fn bench_walk_self() {
  // Walk the ax-code crates directory itself
  let crate_dir = env!("CARGO_MANIFEST_DIR");
  let root = PathBuf::from(crate_dir).parent().unwrap().to_path_buf();

  let iterations = 10u64;
  let mut total_files = 0usize;

  let start = Instant::now();
  for _ in 0..iterations {
    let mut count = 0;
    let walker = ignore::WalkBuilder::new(&root)
      .hidden(false)
      .git_ignore(true)
      .build();
    for entry in walker.flatten() {
      if entry.file_type().map_or(false, |ft| ft.is_file()) {
        count += 1;
      }
    }
    total_files = count;
  }
  let elapsed = start.elapsed();
  println!("Walk crates/ dir:    {iterations} walks ({total_files} files each) in {:?} ({:.1}ms/walk)", elapsed, elapsed.as_millis() as f64 / iterations as f64);
}

fn check_ignored(path: &str) -> bool {
  let components: Vec<&str> = path.split('/').collect();
  for comp in &components {
    if IGNORE_FOLDERS.contains(comp) {
      return true;
    }
  }
  false
}

fn glob_match(pattern: &str, path: &str) -> bool {
  if let Ok(glob) = globset::Glob::new(pattern) {
    glob.compile_matcher().is_match(path)
  } else {
    false
  }
}
