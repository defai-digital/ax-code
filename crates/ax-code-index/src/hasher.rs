use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;

/// SHA-256 hash of a byte slice, returned as hex string.
pub fn sha256_bytes(data: &[u8]) -> String {
  let mut hasher = Sha256::new();
  hasher.update(data);
  let result = hasher.finalize();
  hex_encode(&result)
}

/// SHA-256 hash of a file's contents, returned as hex string.
pub fn sha256_file(path: &str) -> Result<String, std::io::Error> {
  let mut file = fs::File::open(path)?;
  let mut hasher = Sha256::new();
  let mut buffer = [0u8; 8192];
  loop {
    let n = file.read(&mut buffer)?;
    if n == 0 {
      break;
    }
    hasher.update(&buffer[..n]);
  }
  let result = hasher.finalize();
  Ok(hex_encode(&result))
}

fn hex_encode(bytes: &[u8]) -> String {
  bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_sha256_bytes() {
    let hash = sha256_bytes(b"hello world");
    assert_eq!(hash, "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
  }

  #[test]
  fn test_sha256_empty() {
    let hash = sha256_bytes(b"");
    assert_eq!(hash, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  }

  #[test]
  fn test_sha256_file() {
    let dir = std::env::temp_dir().join("ax-code-test-hasher");
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("test.txt");
    std::fs::write(&path, b"hello world").unwrap();
    let hash = sha256_file(path.to_str().unwrap()).unwrap();
    assert_eq!(hash, "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
    let _ = std::fs::remove_dir_all(dir);
  }
}
