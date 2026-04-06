use rand::Rng;
use std::sync::atomic::{AtomicI64, AtomicU32, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static LAST_TIMESTAMP: AtomicI64 = AtomicI64::new(0);
static COUNTER: AtomicU32 = AtomicU32::new(0);

const PREFIXES: &[(&str, &str)] = &[
  ("session", "ses"),
  ("message", "msg"),
  ("permission", "per"),
  ("question", "que"),
  ("user", "usr"),
  ("part", "prt"),
  ("pty", "pty"),
  ("tool", "tool"),
  ("workspace", "wrk"),
  ("event", "evt"),
  ("code_node", "cnd"),
  ("code_edge", "ced"),
  ("code_file", "cfi"),
  ("refactor_plan", "rpl"),
  ("embedding_cache", "ebc"),
];

const BASE62_CHARS: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

fn get_prefix(name: &str) -> Option<&'static str> {
  PREFIXES.iter().find(|(k, _)| *k == name).map(|(_, v)| *v)
}

fn random_base62(len: usize) -> String {
  let mut rng = rand::rng();
  let limit: u8 = 248; // 62 * 4, avoids modulo bias
  let mut result = String::with_capacity(len);
  while result.len() < len {
    let byte: u8 = rng.random();
    if byte < limit {
      result.push(BASE62_CHARS[(byte % 62) as usize] as char);
    }
  }
  result
}

fn now_ms() -> i64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap()
    .as_millis() as i64
}

pub fn ascending(prefix_name: &str) -> Result<String, String> {
  let pfx = get_prefix(prefix_name).ok_or_else(|| format!("unknown prefix: {prefix_name}"))?;

  let current = now_ms();
  let prev = LAST_TIMESTAMP.load(Ordering::SeqCst);
  if current != prev {
    LAST_TIMESTAMP.store(current, Ordering::SeqCst);
    COUNTER.store(0, Ordering::SeqCst);
  }
  let cnt = COUNTER.fetch_add(1, Ordering::SeqCst) + 1;

  let now = (current as u64).wrapping_mul(0x1000) + (cnt as u64);

  let mut time_bytes = [0u8; 6];
  for i in 0..6 {
    time_bytes[i] = ((now >> (40 - 8 * i)) & 0xFF) as u8;
  }

  let hex = hex_encode(&time_bytes);
  let random = random_base62(14);

  Ok(format!("{pfx}_{hex}{random}"))
}

fn hex_encode(bytes: &[u8]) -> String {
  bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_ascending_code_node() {
    let id = ascending("code_node").unwrap();
    assert!(id.starts_with("cnd_"));
    assert!(id.len() > 16);
  }

  #[test]
  fn test_ascending_code_edge() {
    let id = ascending("code_edge").unwrap();
    assert!(id.starts_with("ced_"));
  }

  #[test]
  fn test_ascending_code_file() {
    let id = ascending("code_file").unwrap();
    assert!(id.starts_with("cfi_"));
  }

  #[test]
  fn test_ascending_monotonic() {
    let id1 = ascending("code_node").unwrap();
    let id2 = ascending("code_node").unwrap();
    assert!(id2 > id1, "IDs should be ascending: {} vs {}", id1, id2);
  }

  #[test]
  fn test_unknown_prefix() {
    let result = ascending("unknown");
    assert!(result.is_err());
  }
}
