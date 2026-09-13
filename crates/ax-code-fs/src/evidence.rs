//! Optional, disposable evidence values. SQLite remains the durable authority.
use napi::{Env, Error, Result, Task, bindgen_prelude::AsyncTask};
use rocksdb::{BlockBasedOptions, Cache, DB, IteratorMode, Options, WriteBatch};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    path::Path,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

const MAX_VALUE: usize = 256 * 1024;
const MAX_ENTRIES: usize = 1024;
const MAX_BYTES: usize = 32 * 1024 * 1024;
const TTL: u64 = 24 * 60 * 60;

fn failure(e: impl std::fmt::Display) -> Error {
    Error::from_reason(e.to_string())
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn valid_key(key: &str) -> bool {
    key.len() == 64
        && key
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn checksum(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    version: u8,
    expires_at: u64,
    checksum: String,
    payload: String,
}
fn decode(bytes: &[u8], time: u64) -> Option<String> {
    if bytes.len() > MAX_VALUE * 6 + 256 {
        return None;
    }
    let value: Envelope = serde_json::from_slice(bytes).ok()?;
    (value.version == 1
        && value.expires_at > time
        && value.payload.len() <= MAX_VALUE
        && value.checksum == checksum(&value.payload))
    .then_some(value.payload)
}
fn private_directory(path: &Path) -> Result<()> {
    if !path.is_absolute() {
        return Err(failure("Evidence directory must be absolute"));
    }
    // Reject symlinks in existing ancestors before allowing RocksDB to open files.
    for ancestor in path.ancestors() {
        match std::fs::symlink_metadata(ancestor) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(failure("Evidence directory cannot contain symlinks"));
            }
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(failure(e)),
        }
    }
    if !path.exists() {
        let mut builder = std::fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(path).map_err(failure)?;
    }
    let metadata = std::fs::symlink_metadata(path).map_err(failure)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(failure("Invalid evidence directory"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.mode() & 0o077 != 0 {
            return Err(failure("Evidence directory must be private (0700)"));
        }
    }
    for (index, item) in std::fs::read_dir(path).map_err(failure)?.enumerate() {
        if index >= 4096 {
            return Err(failure("Evidence directory scan limit exceeded"));
        }
        if item
            .map_err(failure)?
            .file_type()
            .map_err(failure)?
            .is_symlink()
        {
            return Err(failure("Evidence directory contains a symlink"));
        }
    }
    Ok(())
}

pub struct EvidenceCore {
    db: Option<DB>,
    sizes: BTreeMap<String, usize>,
    bytes: usize,
}
impl EvidenceCore {
    pub fn new(path: String) -> Result<Self> {
        private_directory(Path::new(&path))?;
        let mut options = Options::default();
        options.create_if_missing(true);
        options.set_write_buffer_size(2 * 1024 * 1024);
        options.set_max_write_buffer_number(2);
        options.set_max_background_jobs(2);
        options.set_max_open_files(32);
        options.set_max_log_file_size(1024 * 1024);
        options.set_keep_log_file_num(2);
        options.set_max_total_wal_size(4 * 1024 * 1024);
        options.set_target_file_size_base(2 * 1024 * 1024);
        let mut blocks = BlockBasedOptions::default();
        blocks.set_block_cache(&Cache::new_lru_cache(4 * 1024 * 1024));
        options.set_block_based_table_factory(&blocks);
        let db = DB::open(&options, path).map_err(failure)?;
        let mut sizes = BTreeMap::new();
        let mut bytes = 0;
        let mut removals = WriteBatch::default();
        let mut scanned_bytes = 0usize;
        for (index, entry) in db.iterator(IteratorMode::Start).enumerate() {
            if index >= 4096 {
                return Err(failure("Evidence entry scan limit exceeded"));
            }
            let (key, value) = entry.map_err(failure)?;
            scanned_bytes = scanned_bytes
                .saturating_add(key.len())
                .saturating_add(value.len());
            if scanned_bytes > MAX_BYTES * 6 + MAX_ENTRIES * 512 {
                return Err(failure("Evidence byte scan limit exceeded"));
            }
            let admitted = std::str::from_utf8(&key)
                .ok()
                .filter(|k| valid_key(k))
                .and_then(|k| decode(&value, now()).map(|v| (k.to_owned(), v.len())));
            if let Some((key, size)) =
                admitted.filter(|(_, size)| sizes.len() < MAX_ENTRIES && bytes + size <= MAX_BYTES)
            {
                bytes += size;
                sizes.insert(key, size);
            } else {
                removals.delete(&key);
            }
        }
        db.write(removals).map_err(failure)?;
        Ok(Self {
            db: Some(db),
            sizes,
            bytes,
        })
    }
    pub fn get(&mut self, key: String) -> Result<Option<String>> {
        if !valid_key(&key) {
            return Err(failure("Evidence key must be lowercase SHA-256"));
        }
        let db = self
            .db
            .as_ref()
            .ok_or_else(|| failure("Evidence store closed"))?;
        let Some(value) = db.get(&key).map_err(failure)? else {
            return Ok(None);
        };
        let decoded = decode(&value, now());
        if decoded.is_none() {
            db.delete(&key).map_err(failure)?;
            self.bytes -= self.sizes.remove(&key).unwrap_or(0);
        }
        Ok(decoded)
    }
    pub fn put(&mut self, key: String, value: String) -> Result<()> {
        if !valid_key(&key) || value.len() > MAX_VALUE {
            return Err(failure("Evidence key or value exceeds admission bounds"));
        }
        let db = self
            .db
            .as_ref()
            .ok_or_else(|| failure("Evidence store closed"))?;
        let size = value.len();
        let envelope = Envelope {
            version: 1,
            expires_at: now() + TTL,
            checksum: checksum(&value),
            payload: value,
        };
        let encoded = serde_json::to_vec(&envelope).map_err(failure)?;
        let previous = self.sizes.get(&key).copied().unwrap_or(0);
        let reset = self.bytes - previous + size > MAX_BYTES
            || (!self.sizes.contains_key(&key) && self.sizes.len() >= MAX_ENTRIES);
        let mut batch = WriteBatch::default();
        if reset {
            for old in self.sizes.keys() {
                batch.delete(old);
            }
        }
        batch.put(&key, encoded);
        db.write(batch).map_err(failure)?;
        if reset {
            self.sizes.clear();
            self.bytes = 0;
        } else {
            self.bytes -= previous;
        }
        self.sizes.insert(key, size);
        self.bytes += size;
        Ok(())
    }
    pub fn close(&mut self) {
        self.db.take();
        self.sizes.clear();
        self.bytes = 0;
    }
}

// All database work, including opening and deterministic close, runs on libuv workers.
#[napi]
pub struct EvidenceStore {
    core: Arc<Mutex<EvidenceCore>>,
}

pub struct OpenTask {
    path: String,
}
impl Task for OpenTask {
    type Output = EvidenceCore;
    type JsValue = EvidenceStore;
    fn compute(&mut self) -> Result<Self::Output> {
        EvidenceCore::new(self.path.clone())
    }
    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(EvidenceStore {
            core: Arc::new(Mutex::new(output)),
        })
    }
}
#[napi(ts_return_type = "Promise<EvidenceStore>")]
pub fn open_evidence_store(path: String) -> AsyncTask<OpenTask> {
    AsyncTask::new(OpenTask { path })
}

pub struct GetTask {
    core: Arc<Mutex<EvidenceCore>>,
    key: String,
}
impl Task for GetTask {
    type Output = Option<String>;
    type JsValue = Option<String>;
    fn compute(&mut self) -> Result<Self::Output> {
        self.core
            .lock()
            .map_err(|_| failure("Evidence lock poisoned"))?
            .get(std::mem::take(&mut self.key))
    }
    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}
pub struct WriteTask {
    core: Arc<Mutex<EvidenceCore>>,
    value: Option<(String, String)>,
}
impl Task for WriteTask {
    type Output = ();
    type JsValue = ();
    fn compute(&mut self) -> Result<()> {
        let mut core = self
            .core
            .lock()
            .map_err(|_| failure("Evidence lock poisoned"))?;
        match self.value.take() {
            Some((key, value)) => core.put(key, value),
            None => {
                core.close();
                Ok(())
            }
        }
    }
    fn resolve(&mut self, _env: Env, _output: ()) -> Result<()> {
        Ok(())
    }
}
#[napi]
impl EvidenceStore {
    #[napi(ts_return_type = "Promise<string | null>")]
    pub fn get(&self, key: String) -> AsyncTask<GetTask> {
        AsyncTask::new(GetTask {
            core: Arc::clone(&self.core),
            key,
        })
    }
    #[napi(ts_return_type = "Promise<void>")]
    pub fn put(&self, key: String, value: String) -> AsyncTask<WriteTask> {
        AsyncTask::new(WriteTask {
            core: Arc::clone(&self.core),
            value: Some((key, value)),
        })
    }
    #[napi(ts_return_type = "Promise<void>")]
    pub fn close(&self) -> AsyncTask<WriteTask> {
        AsyncTask::new(WriteTask {
            core: Arc::clone(&self.core),
            value: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn directory() -> std::path::PathBuf {
        let base = std::fs::canonicalize(std::env::temp_dir()).unwrap();
        base.join(format!(
            "ax-evidence-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }
    #[test]
    fn persistence_lock_close_and_corruption() {
        let path = directory();
        let key = checksum("key");
        let mut store = EvidenceCore::new(path.to_string_lossy().into()).unwrap();
        store.put(key.clone(), "value".into()).unwrap();
        assert!(EvidenceCore::new(path.to_string_lossy().into()).is_err());
        store.close();
        assert!(store.get(key.clone()).is_err());
        let mut store = EvidenceCore::new(path.to_string_lossy().into()).unwrap();
        assert_eq!(store.get(key.clone()).unwrap().as_deref(), Some("value"));
        store.db.as_ref().unwrap().put(&key, b"corrupt").unwrap();
        assert_eq!(store.get(key).unwrap(), None);
        store.close();
        std::fs::remove_dir_all(path).unwrap();
    }
    #[test]
    fn expiration_checksum_and_bounds() {
        let envelope = Envelope {
            version: 1,
            expires_at: 100,
            checksum: checksum("value"),
            payload: "value".into(),
        };
        let data = serde_json::to_vec(&envelope).unwrap();
        assert_eq!(decode(&data, 99).as_deref(), Some("value"));
        assert_eq!(decode(&data, 100), None);
        assert!(
            decode(
                br#"{"version":1,"expires_at":999,"checksum":"bad","payload":"value"}"#,
                0
            )
            .is_none()
        );
        let path = directory();
        let mut store = EvidenceCore::new(path.to_string_lossy().into()).unwrap();
        assert!(store.put("invalid".into(), "value".into()).is_err());
        assert!(
            store
                .put(checksum("large"), "x".repeat(MAX_VALUE + 1))
                .is_err()
        );
        for i in 0..=MAX_ENTRIES {
            store.put(checksum(&i.to_string()), "x".into()).unwrap();
        }
        assert_eq!(store.sizes.len(), 1);
        assert_eq!(store.get(checksum("0")).unwrap(), None);
        for i in 0..130 {
            store
                .put(checksum(&i.to_string()), "x".repeat(MAX_VALUE))
                .unwrap();
        }
        assert!(store.bytes <= MAX_BYTES);
        store.close();
        std::fs::remove_dir_all(path).unwrap();
    }
    #[test]
    fn startup_discards_expired_values_and_accounts_existing_entries() {
        let path = directory();
        let mut store = EvidenceCore::new(path.to_string_lossy().into()).unwrap();
        store.put(checksum("valid"), "live".into()).unwrap();
        let expired = Envelope {
            version: 1,
            expires_at: 1,
            checksum: checksum("old"),
            payload: "old".into(),
        };
        store
            .db
            .as_ref()
            .unwrap()
            .put(checksum("expired"), serde_json::to_vec(&expired).unwrap())
            .unwrap();
        store
            .db
            .as_ref()
            .unwrap()
            .put(checksum("corrupt"), b"corrupt")
            .unwrap();
        store.close();
        let mut store = EvidenceCore::new(path.to_string_lossy().into()).unwrap();
        assert_eq!(store.bytes, 4);
        assert_eq!(store.sizes.len(), 1);
        assert_eq!(store.get(checksum("expired")).unwrap(), None);
        assert_eq!(store.get(checksum("corrupt")).unwrap(), None);
        store.close();
        std::fs::remove_dir_all(path).unwrap();
    }
    #[test]
    fn rejects_foreign_database_beyond_scan_budget() {
        let path = directory();
        let mut store = EvidenceCore::new(path.to_string_lossy().into()).unwrap();
        let mut batch = WriteBatch::default();
        for i in 0..4097 {
            batch.put(i.to_string(), "foreign");
        }
        store.db.as_ref().unwrap().write(batch).unwrap();
        store.close();
        assert!(EvidenceCore::new(path.to_string_lossy().into()).is_err());
        std::fs::remove_dir_all(path).unwrap();
    }
    #[test]
    fn worker_tasks_share_state_and_close() {
        let path = directory();
        let mut task = OpenTask {
            path: path.to_string_lossy().into(),
        };
        let core = Arc::new(Mutex::new(task.compute().unwrap()));
        WriteTask {
            core: core.clone(),
            value: Some((checksum("key"), "value".into())),
        }
        .compute()
        .unwrap();
        assert_eq!(
            GetTask {
                core: core.clone(),
                key: checksum("key")
            }
            .compute()
            .unwrap()
            .as_deref(),
            Some("value")
        );
        WriteTask {
            core: core.clone(),
            value: None,
        }
        .compute()
        .unwrap();
        assert!(
            GetTask {
                core,
                key: checksum("key")
            }
            .compute()
            .is_err()
        );
        std::fs::remove_dir_all(path).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn rejects_public_and_symlink_directory() {
        use std::os::unix::fs::{PermissionsExt, symlink};
        let path = directory();
        std::fs::create_dir(&path).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(EvidenceCore::new(path.to_string_lossy().into()).is_err());
        let link = directory();
        symlink(&path, &link).unwrap();
        assert!(EvidenceCore::new(link.to_string_lossy().into()).is_err());
        std::fs::remove_file(link).unwrap();
        std::fs::remove_dir(path).unwrap();
    }
}
