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

  // BUG-276: Use compare_exchange loop to atomically update timestamp+counter
  let (ts, cnt) = loop {
    let current = now_ms();
    let prev = LAST_TIMESTAMP.load(Ordering::SeqCst);
    if current != prev {
      // Try to claim this new timestamp
      if LAST_TIMESTAMP.compare_exchange(prev, current, Ordering::SeqCst, Ordering::SeqCst).is_ok() {
        COUNTER.store(1, Ordering::SeqCst);
        break (current, 1u32);
      }
      // Another thread beat us; retry
      continue;
    }
    // Same timestamp: just bump the counter
    let c = COUNTER.fetch_add(1, Ordering::SeqCst) + 1;
    if c > 255 {
      // Counter overflow — spin until the next millisecond so IDs stay unique.
      std::thread::yield_now();
      continue;
    }
    break (current, c);
  };

  // BUG-028: Reduced shift from 12 to 8 bits to prevent 48-bit overflow.
  // 40 bits for timestamp (~34,800 years of ms) + 8 bits for counter (256/ms).
  let now = (((ts as u64) << 8) | (cnt as u64)) & 0xFFFF_FFFF_FFFF;

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
  fn test_ascending_cross_millisecond() {
    let id1 = ascending("code_node").unwrap();
    std::thread::sleep(std::time::Duration::from_millis(2));
    let id2 = ascending("code_node").unwrap();
    let hex1 = &id1[4..16];
    let hex2 = &id2[4..16];
    assert!(hex2 > hex1, "Cross-ms IDs should sort ascending: {} vs {}", hex1, hex2);
  }

  #[test]
  fn test_unknown_prefix() {
    let result = ascending("unknown");
    assert!(result.is_err());
  }
}
