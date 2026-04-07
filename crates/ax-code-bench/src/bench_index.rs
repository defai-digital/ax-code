use std::time::Instant;

use rand::Rng;
use rusqlite::Connection;
use sha2::{Digest, Sha256};

fn fmt_ns(ns: u128) -> String {
  if ns >= 1_000_000 { format!("{:.2} ms", ns as f64 / 1_000_000.0) }
  else if ns >= 1_000 { format!("{:.2} us", ns as f64 / 1_000.0) }
  else { format!("{} ns", ns) }
}

fn report(name: &str, ops: u64, elapsed: std::time::Duration) {
  let ns_op = elapsed.as_nanos() / ops as u128;
  println!("  {:<40} {:>8} ops in {:.3}s ({}/op)", name, ops, elapsed.as_secs_f64(), fmt_ns(ns_op));
}

// ── ID generation (mirrors id.rs) ───────────────────────────────────────────

const BASE62: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

fn gen_id() -> String {
  let mut rng = rand::rng();
  let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64;
  let hex: String = (0..6).map(|i| format!("{:02x}", ((ts >> (40 - 8 * i)) & 0xFF) as u8)).collect();
  let rand_part: String = (0..14).map(|_| BASE62[(rng.random::<u8>() % 62) as usize] as char).collect();
  format!("cnd_{}{}", hex, rand_part)
}

// ── SHA-256 (mirrors hasher.rs) ─────────────────────────────────────────────

fn sha256(data: &[u8]) -> String {
  let mut h = Sha256::new();
  h.update(data);
  h.finalize().iter().map(|b| format!("{:02x}", b)).collect()
}

// ── SQLite setup (mirrors schema.rs + store.rs) ─────────────────────────────

fn open_db() -> Connection {
  let conn = Connection::open_in_memory().unwrap();
  conn.execute_batch("
    PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000; PRAGMA cache_size = -64000;
  ").unwrap();
  conn.execute_batch("
    CREATE TABLE IF NOT EXISTS code_node (
      id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL,
      kind TEXT NOT NULL, name TEXT NOT NULL, qualified_name TEXT NOT NULL,
      file TEXT NOT NULL, range_start_line INTEGER NOT NULL,
      range_start_char INTEGER NOT NULL, range_end_line INTEGER NOT NULL,
      range_end_char INTEGER NOT NULL, signature TEXT, visibility TEXT, metadata TEXT,
      indexed_at INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000),
      time_created INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000),
      time_updated INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_proj ON code_node (project_id);
    CREATE INDEX IF NOT EXISTS idx_name ON code_node (project_id, name);
    CREATE INDEX IF NOT EXISTS idx_file ON code_node (project_id, file);
  ").unwrap();
  conn
}

fn insert_node(conn: &Connection, id: &str, name: &str, file: &str) {
  conn.execute(
    "INSERT INTO code_node (id,project_id,kind,name,qualified_name,file,
     range_start_line,range_start_char,range_end_line,range_end_char)
     VALUES (?1,'proj1','function',?2,?2,?3,1,0,10,0)",
    rusqlite::params![id, name, file],
  ).unwrap();
}

// ── Interval tree simulation ────────────────────────────────────────────────

#[derive(Clone)]
struct Interval { start: u32, end: u32, id: u32 }

fn linear_scan(ivs: &[Interval], line: u32) -> Option<u32> {
  let mut best = None;
  let mut best_sz = u32::MAX;
  for iv in ivs {
    if line >= iv.start && line <= iv.end {
      let sz = iv.end - iv.start;
      if sz < best_sz { best_sz = sz; best = Some(iv.id); }
    }
  }
  best
}

fn sorted_scan(ivs: &[Interval], line: u32) -> Option<u32> {
  let idx = ivs.partition_point(|iv| iv.start <= line);
  let mut best = None;
  let mut best_sz = u32::MAX;
  for iv in &ivs[..idx] {
    if line <= iv.end {
      let sz = iv.end - iv.start;
      if sz < best_sz { best_sz = sz; best = Some(iv.id); }
    }
  }
  best
}

// ── Benchmarks ──────────────────────────────────────────────────────────────

fn main() {
  println!("ax-code-index Benchmarks (Rust Native)");
  println!("=======================================\n");

  // ID generation
  println!("[ID Generation]");
  let ops = 10_000u64;
  let t = Instant::now();
  for _ in 0..ops { std::hint::black_box(gen_id()); }
  report("ascending ID", ops, t.elapsed());

  // SHA-256
  println!("\n[SHA-256 Hashing]");
  let (d10, d100) = (vec![0xABu8; 10_240], vec![0xCDu8; 102_400]);
  let t = Instant::now();
  for _ in 0..ops { std::hint::black_box(sha256(&d10)); }
  report("sha256 10 KB", ops, t.elapsed());
  let t = Instant::now();
  for _ in 0..ops { std::hint::black_box(sha256(&d100)); }
  report("sha256 100 KB", ops, t.elapsed());

  // SQLite bulk insert
  println!("\n[SQLite Operations]");
  let conn = open_db();
  let (batches, per) = (100u64, 200u64);
  let t = Instant::now();
  for b in 0..batches {
    conn.execute("BEGIN", []).ok();
    for i in 0..per {
      insert_node(&conn, &format!("n_{}_{}", b, i), &format!("func_{}", i % 50), &format!("/src/f_{}.ts", b));
    }
    conn.execute("COMMIT", []).unwrap();
  }
  report("bulk insert (200/batch)", batches * per, t.elapsed());

  // findByName
  let t = Instant::now();
  let mut stmt = conn.prepare("SELECT id FROM code_node WHERE project_id=?1 AND name=?2").unwrap();
  for i in 0..ops {
    let r: Vec<String> = stmt.query_map(rusqlite::params!["proj1", format!("func_{}", i % 50)], |r| r.get(0))
      .unwrap().filter_map(|r| r.ok()).collect();
    std::hint::black_box(r);
  }
  report("findByName query", ops, t.elapsed());

  // count
  let t = Instant::now();
  let mut stmt = conn.prepare("SELECT COUNT(*) FROM code_node WHERE project_id=?1").unwrap();
  for _ in 0..ops {
    std::hint::black_box(stmt.query_row(rusqlite::params!["proj1"], |r| r.get::<_, i64>(0)).unwrap());
  }
  report("count query", ops, t.elapsed());

  // ingest_file atomic
  let iters = 100u64;
  let t = Instant::now();
  for i in 0..iters {
    conn.execute("BEGIN", []).unwrap();
    conn.execute("DELETE FROM code_node WHERE project_id='proj1' AND file='/src/f_0.ts'", []).unwrap();
    for j in 0..200u64 { insert_node(&conn, &format!("r_{}_{}", i, j), &format!("rf_{}", j), "/src/f_0.ts"); }
    conn.execute("COMMIT", []).unwrap();
  }
  report("ingest_file atomic (del+200 ins)", iters, t.elapsed());

  // Interval tree
  println!("\n[Interval Tree]");
  let mut rng = rand::rng();
  let mut ivs: Vec<Interval> = (0..5_000u32).map(|i| {
    let s: u32 = rng.random_range(0..10_000);
    Interval { start: s, end: s + rng.random_range(1..200u32), id: i }
  }).collect();
  ivs.sort_by_key(|iv| iv.start);
  let qs: Vec<u32> = (0..100_000u64).map(|_| rng.random_range(0..10_000u32)).collect();

  let t = Instant::now();
  for &q in &qs { std::hint::black_box(linear_scan(&ivs, q)); }
  let lin = t.elapsed();
  report("linear scan (5k intervals)", 100_000, lin);

  let t = Instant::now();
  for &q in &qs { std::hint::black_box(sorted_scan(&ivs, q)); }
  let srt = t.elapsed();
  report("sorted scan (5k intervals)", 100_000, srt);
  println!("  Sorted scan speedup: {:.1}x vs linear", lin.as_nanos() as f64 / srt.as_nanos() as f64);

  println!("\n--- JS Comparison Estimates ---");
  println!("  ID gen:       ~5-10x slower in JS (crypto.randomBytes overhead)");
  println!("  SHA-256:      ~3-8x slower in JS (node:crypto is C but has binding cost)");
  println!("  SQLite:       ~2-4x slower via better-sqlite3 (N-API crossing per call)");
  println!("  IntervalTree: ~10-30x slower in JS (no partition_point, GC pressure)");
}
