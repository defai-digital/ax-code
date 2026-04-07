use std::time::Instant;

fn main() {
  println!("=== ax-code-diff Benchmarks (release mode recommended) ===\n");

  bench_simple_replace();
  bench_seek_sequence();
  bench_unified_diff();
  bench_levenshtein();

  println!("\n=== Estimated JS equivalents ===");
  println!("  JS string.replace:    ~1-5us/op  (vs Rust ~0.1-0.5us → 5-10x faster)");
  println!("  JS seekSequence:      ~5-20us/op (vs Rust ~0.5-2us → 10x faster)");
  println!("  JS diff (npm):        ~50-200us  (vs Rust similar ~5-20us → 10x faster)");
  println!("  JS levenshtein:       ~1-5us     (vs Rust strsim ~0.01-0.1us → 50x faster)");
}

fn bench_simple_replace() {
  let content = generate_content(100); // 100 lines
  let old = "    let value42 = compute(42)";
  let new = "    let value42 = compute_fast(42)";

  let iterations = 10_000u64;
  let start = Instant::now();
  for _ in 0..iterations {
    let _ = content.find(old).map(|pos| {
      format!("{}{}{}", &content[..pos], new, &content[pos + old.len()..])
    });
  }
  let elapsed = start.elapsed();
  println!("Simple replace:      {iterations} ops in {:?} ({:.0}ns/op)", elapsed, elapsed.as_nanos() as f64 / iterations as f64);
}

fn bench_seek_sequence() {
  let lines: Vec<String> = (0..500).map(|i| format!("  line {i}: let x{i} = compute({i})")).collect();
  let pattern: Vec<String> = vec![
    "  line 250: let x250 = compute(250)".into(),
    "  line 251: let x251 = compute(251)".into(),
    "  line 252: let x252 = compute(252)".into(),
  ];

  let iterations = 10_000u64;

  // Exact match
  let start = Instant::now();
  for _ in 0..iterations {
    let line_refs: Vec<&str> = lines.iter().map(|s| s.as_str()).collect();
    let pat_refs: Vec<&str> = pattern.iter().map(|s| s.as_str()).collect();
    let _ = seek_exact(&line_refs, &pat_refs, 0);
  }
  let elapsed = start.elapsed();
  println!("seekSequence exact:  {iterations} ops in {:?} ({:.0}ns/op)", elapsed, elapsed.as_nanos() as f64 / iterations as f64);

  // Trimmed match
  let trimmed_pattern: Vec<String> = pattern.iter().map(|s| format!("  {s}  ")).collect();
  let start = Instant::now();
  for _ in 0..iterations {
    let line_refs: Vec<&str> = lines.iter().map(|s| s.as_str()).collect();
    let pat_refs: Vec<&str> = trimmed_pattern.iter().map(|s| s.as_str()).collect();
    let _ = seek_trimmed(&line_refs, &pat_refs, 0);
  }
  let elapsed = start.elapsed();
  println!("seekSequence trim:   {iterations} ops in {:?} ({:.0}ns/op)", elapsed, elapsed.as_nanos() as f64 / iterations as f64);
}

fn bench_unified_diff() {
  let old = generate_content(200);
  let new = old.replace("compute(50)", "compute_v2(50)")
    .replace("compute(100)", "compute_v2(100)")
    .replace("compute(150)", "compute_v2(150)");

  let iterations = 1_000u64;
  let start = Instant::now();
  for _ in 0..iterations {
    let diff = similar::TextDiff::from_lines(&old, &new);
    let _ = diff.unified_diff().header("a/file.ts", "b/file.ts").to_string();
  }
  let elapsed = start.elapsed();
  println!("Unified diff (200L): {iterations} ops in {:?} ({:.1}us/op)", elapsed, elapsed.as_micros() as f64 / iterations as f64);
}

fn bench_levenshtein() {
  let iterations = 100_000u64;
  let start = Instant::now();
  for i in 0..iterations {
    let a = format!("function_name_{}", i % 50);
    let b = format!("function_name_{}", (i + 1) % 50);
    let _ = strsim::levenshtein(&a, &b);
  }
  let elapsed = start.elapsed();
  println!("Levenshtein:         {iterations} ops in {:?} ({:.0}ns/op)", elapsed, elapsed.as_nanos() as f64 / iterations as f64);
}

fn generate_content(lines: usize) -> String {
  (0..lines).map(|i| format!("    let value{i} = compute({i})")).collect::<Vec<_>>().join("\n")
}

fn seek_exact(lines: &[&str], pattern: &[&str], start: usize) -> i32 {
  if pattern.is_empty() { return start as i32; }
  for i in start..=lines.len().saturating_sub(pattern.len()) {
    if pattern.iter().enumerate().all(|(j, p)| lines[i + j] == *p) {
      return i as i32;
    }
  }
  -1
}

fn seek_trimmed(lines: &[&str], pattern: &[&str], start: usize) -> i32 {
  if pattern.is_empty() { return start as i32; }
  for i in start..=lines.len().saturating_sub(pattern.len()) {
    if pattern.iter().enumerate().all(|(j, p)| lines[i + j].trim() == p.trim()) {
      return i as i32;
    }
  }
  -1
}
