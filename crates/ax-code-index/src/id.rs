use rand::Rng;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static LAST_ID_STATE: AtomicU64 = AtomicU64::new(0);
const COUNTER_MASK: u64 = 0xFF;
const MAX_COUNTER: u64 = COUNTER_MASK;

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

fn next_state_parts(prev: u64, current: u64) -> Option<(u64, u64, u64)> {
    let prev_ts = prev >> 8;
    let prev_counter = prev & COUNTER_MASK;
    let next_ts = current.max(prev_ts);
    let next_counter = if next_ts == prev_ts {
        if prev_counter >= MAX_COUNTER {
            return None;
        }
        prev_counter + 1
    } else {
        0
    };
    let next = (next_ts << 8) | next_counter;
    Some((next_ts, next_counter, next))
}

fn reserve_timestamp_counter(current: u64) -> (u64, u64) {
    // Keep timestamp and counter in one atomic word. Updating them as separate
    // atomics can reset the counter after another caller has already incremented
    // it, which makes IDs generated in the same millisecond sort backwards.
    loop {
        let prev = LAST_ID_STATE.load(Ordering::SeqCst);
        let Some((next_ts, next_counter, next)) = next_state_parts(prev, current) else {
            std::thread::yield_now();
            continue;
        };
        if LAST_ID_STATE
            .compare_exchange(prev, next, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
        {
            break (next_ts, next_counter);
        }
    }
}

pub fn ascending(prefix_name: &str) -> Result<String, String> {
    let pfx = get_prefix(prefix_name).ok_or_else(|| format!("unknown prefix: {prefix_name}"))?;
    let (ts, cnt) = reserve_timestamp_counter(now_ms().max(0) as u64);
    let hex = encode_sort_key(ts, cnt);
    let random = random_base62(14);

    Ok(format!("{pfx}_{hex}{random}"))
}

fn encode_sort_key(ts: u64, cnt: u64) -> String {
    let sortable = ((ts << 8) | cnt) & 0xFFFF_FFFF_FFFF;

    let mut time_bytes = [0u8; 6];
    for (i, byte) in time_bytes.iter_mut().enumerate() {
        *byte = ((sortable >> (40 - 8 * i)) & 0xFF) as u8;
    }

    hex_encode(&time_bytes)
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
    fn test_next_state_same_timestamp_increments_counter() {
        let prev = (1000u64 << 8) | 4;
        let (ts, counter, next) = next_state_parts(prev, 1000).unwrap();
        assert_eq!(ts, 1000);
        assert_eq!(counter, 5);
        assert_eq!(next, (1000u64 << 8) | 5);
        assert!(encode_sort_key(ts, counter) > encode_sort_key(1000, 4));
    }

    #[test]
    fn test_next_state_clock_rollback_keeps_logical_timestamp() {
        let prev = (1000u64 << 8) | 7;
        let (ts, counter, next) = next_state_parts(prev, 999).unwrap();
        assert_eq!(ts, 1000);
        assert_eq!(counter, 8);
        assert_eq!(next, (1000u64 << 8) | 8);
        assert!(encode_sort_key(ts, counter) > encode_sort_key(1000, 7));
    }

    #[test]
    fn test_next_state_counter_overflow_waits_for_later_timestamp() {
        let prev = (1000u64 << 8) | MAX_COUNTER;
        assert!(next_state_parts(prev, 1000).is_none());
        let (ts, counter, next) = next_state_parts(prev, 1001).unwrap();
        assert_eq!(ts, 1001);
        assert_eq!(counter, 0);
        assert_eq!(next, 1001u64 << 8);
    }

    #[test]
    fn test_ascending_cross_millisecond() {
        let id1 = ascending("code_node").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
        let id2 = ascending("code_node").unwrap();
        let hex1 = &id1[4..16];
        let hex2 = &id2[4..16];
        assert!(
            hex2 > hex1,
            "Cross-ms IDs should sort ascending: {} vs {}",
            hex1,
            hex2
        );
    }

    #[test]
    fn test_unknown_prefix() {
        let result = ascending("unknown");
        assert!(result.is_err());
    }
}
