use std::time::Instant;

use similar::TextDiff;

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

fn make_content(lines: usize) -> String {
  (0..lines).map(|i| format!("  const value_{} = computeResult({});", i, i)).collect::<Vec<_>>().join("\n")
}

// ── Inlined algorithms (match ax-code-diff/src/lib.rs) ─────────────────────

fn strategy_simple(content: &str, find: &str) -> bool {
  content.contains(find)
}

fn strategy_line_trimmed(content: &str, find: &str) -> Option<usize> {
  let original: Vec<&str> = content.split('\n').collect();
  let mut search: Vec<&str> = find.split('\n').collect();
  if search.last() == Some(&"") { search.pop(); }
  if search.is_empty() || original.len() < search.len() { return None; }
  for i in 0..=(original.len() - search.len()) {
    let mut ok = true;
    for j in 0..search.len() {
      if original[i + j].trim() != search[j].trim() { ok = false; break; }
    }
    if ok { return Some(i); }
  }
  None
}

fn seek_sequence_exact(lines: &[&str], pattern: &[&str], start: usize) -> i32 {
  if pattern.is_empty() || lines.len() < pattern.len() { return -1; }
  for i in start..=(lines.len() - pattern.len()) {
    let mut ok = true;
    for j in 0..pattern.len() {
      if lines[i + j] != pattern[j] { ok = false; break; }
    }
    if ok { return i as i32; }
  }
  -1
}

fn seek_sequence_trimmed(lines: &[&str], pattern: &[&str], start: usize) -> i32 {
  if pattern.is_empty() || lines.len() < pattern.len() { return -1; }
  for i in start..=(lines.len() - pattern.len()) {
    let mut ok = true;
    for j in 0..pattern.len() {
      if lines[i + j].trim() != pattern[j].trim() { ok = false; break; }
    }
    if ok { return i as i32; }
  }
  -1
}

fn generate_unified_diff(old: &str, new: &str) -> String {
  let diff = TextDiff::from_lines(old, new);
  let mut out = String::new();
  out.push_str("--- a/file\n+++ b/file\n");
  for hunk in diff.unified_diff().context_radius(3).iter_hunks() {
    out.push_str(&hunk.to_string());
  }
  out
}

// ── Benchmarks ──────────────────────────────────────────────────────────────

fn bench_simple_replace() {
  println!("[Simple Replace Strategy]");
  let content = make_content(50);
  let find = "  const value_25 = computeResult(25);";
  let ops = 10_000u64;
  let t = Instant::now();
  for _ in 0..ops {
    std::hint::black_box(strategy_simple(&content, find));
  }
  report("simple contains (1KB)", ops, t.elapsed());
}

fn bench_line_trimmed() {
  println!("\n[Line-Trimmed Strategy]");
  let content = make_content(50);
  let find = "const value_25 = computeResult(25);\nconst value_26 = computeResult(26);";
  let ops = 10_000u64;
  let t = Instant::now();
  for _ in 0..ops {
    std::hint::black_box(strategy_line_trimmed(&content, find));
  }
  report("line-trimmed match (1KB)", ops, t.elapsed());
}

fn bench_seek_sequence() {
  println!("\n[seekSequence]");
  let content = make_content(500);
  let lines: Vec<&str> = content.split('\n').collect();
  let pattern_start = 250;
  let pattern: Vec<&str> = lines[pattern_start..pattern_start + 5].to_vec();
  let ops = 10_000u64;

  let t = Instant::now();
  for _ in 0..ops {
    std::hint::black_box(seek_sequence_exact(&lines, &pattern, 0));
  }
  report("seekSequence exact (500 lines)", ops, t.elapsed());

  let t = Instant::now();
  for _ in 0..ops {
    std::hint::black_box(seek_sequence_trimmed(&lines, &pattern, 0));
  }
  report("seekSequence trimmed (500 lines)", ops, t.elapsed());
}

fn bench_unified_diff() {
  println!("\n[Unified Diff Generation (similar crate)]");
  let old = make_content(50);
  let mut new_lines: Vec<String> = old.split('\n').map(|s| s.to_string()).collect();
  for i in (0..new_lines.len()).step_by(10) {
    new_lines[i] = format!("  const changed_{} = newValue({});", i, i);
  }
  let new_content = new_lines.join("\n");
  let ops = 1_000u64;

  let t = Instant::now();
  for _ in 0..ops {
    std::hint::black_box(generate_unified_diff(&old, &new_content));
  }
  report("unified diff (1KB, 10% changed)", ops, t.elapsed());
}

fn bench_levenshtein() {
  println!("\n[Levenshtein Distance (strsim crate)]");
  let a = "const handleUserAuthentication = async (req, res) => {";
  let b = "const handleUserAuthorization = async (request, response) => {";
  let ops = 100_000u64;

  let t = Instant::now();
  for _ in 0..ops {
    std::hint::black_box(strsim::levenshtein(a, b));
  }
  report("levenshtein (~60 chars)", ops, t.elapsed());
}

// ── Main ────────────────────────────────────────────────────────────────────

fn main() {
  println!("ax-code-diff Benchmarks (Rust Native)");
  println!("======================================\n");

  bench_simple_replace();
  bench_line_trimmed();
  bench_seek_sequence();
  bench_unified_diff();
  bench_levenshtein();

  println!("\n--- JS Comparison Estimates ---");
  println!("  String.contains:  ~2-5x slower in JS (V8 string search is good but GC)");
  println!("  Line-trimmed:     ~5-15x slower in JS (trim() allocates, array iteration)");
  println!("  seekSequence:     ~5-10x slower in JS (tight loop with string ops)");
  println!("  Unified diff:     ~3-8x slower in JS (similar crate is Myers algorithm)");
  println!("  Levenshtein:      ~10-30x slower in JS (tight O(n*m) loop, no SIMD)");
}
