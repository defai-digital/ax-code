use std::fs::{self, File, OpenOptions};
use std::path::PathBuf;
use std::time::{Duration, Instant};

#[cfg(unix)]
use std::os::unix::io::AsRawFd;

#[cfg(windows)]
use std::os::windows::io::AsRawHandle;

/// Advisory file lock using flock() on Unix.
/// Auto-releases on process crash (kernel-level).
#[napi]
pub struct AdvisoryLock {
  path: PathBuf,
  file: Option<File>,
  acquired: bool,
}

#[napi]
impl AdvisoryLock {
  #[napi(constructor)]
  pub fn new(lock_path: String) -> napi::Result<Self> {
    let path = PathBuf::from(&lock_path);
    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
      fs::create_dir_all(parent)
        .map_err(|e| napi::Error::from_reason(format!("failed to create lock directory: {e}")))?;
    }
    Ok(Self {
      path,
      file: None,
      acquired: false,
    })
  }

  /// Non-blocking lock attempt. Returns true if acquired.
  #[napi]
  pub fn try_acquire(&mut self) -> napi::Result<bool> {
    if self.acquired {
      return Ok(true);
    }

    let file = OpenOptions::new()
      .create(true)
      .write(true)
      .truncate(false)
      .open(&self.path)
      .map_err(|e| napi::Error::from_reason(format!("failed to open lock file: {e}")))?;

    #[cfg(unix)]
    {
      let fd = file.as_raw_fd();
      let result = unsafe { libc::flock(fd, libc::LOCK_EX | libc::LOCK_NB) };
      if result == 0 {
        self.file = Some(file);
        self.acquired = true;
        Ok(true)
      } else {
        Ok(false)
      }
    }

    #[cfg(windows)]
    {
      use windows_sys::Win32::Storage::FileSystem::{LockFileEx, LOCKFILE_EXCLUSIVE_LOCK, LOCKFILE_FAIL_IMMEDIATELY};
      use windows_sys::Win32::Foundation::HANDLE;
      let handle = file.as_raw_handle() as HANDLE;
      let mut overlapped = unsafe { std::mem::zeroed::<windows_sys::Win32::System::IO::OVERLAPPED>() };
      let result = unsafe {
        LockFileEx(handle, LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, &mut overlapped)
      };
      if result != 0 {
        self.file = Some(file);
        self.acquired = true;
        Ok(true)
      } else {
        Ok(false)
      }
    }

    #[cfg(not(any(unix, windows)))]
    {
      // No locking support on this platform — return false so callers
      // fall back to application-level locking instead of silently
      // pretending exclusion holds.
      Ok(false)
    }
  }

  /// Blocking lock with timeout. Returns true if acquired within timeout.
  #[napi]
  pub fn acquire(&mut self, timeout_ms: u32) -> napi::Result<bool> {
    if self.acquired {
      return Ok(true);
    }

    let deadline = Instant::now() + Duration::from_millis(timeout_ms as u64);
    let poll_interval = Duration::from_millis(500);

    loop {
      match self.try_acquire()? {
        true => return Ok(true),
        false => {
          if Instant::now() >= deadline {
            return Ok(false);
          }
          std::thread::sleep(poll_interval.min(deadline - Instant::now()));
        }
      }
    }
  }

  /// Release the lock
  #[napi]
  pub fn release(&mut self) -> napi::Result<()> {
    if !self.acquired {
      return Ok(());
    }

    #[cfg(unix)]
    if let Some(ref file) = self.file {
      let fd = file.as_raw_fd();
      let result = unsafe { libc::flock(fd, libc::LOCK_UN) };
      if result != 0 {
        eprintln!("WARNING: flock(LOCK_UN) failed: {}", std::io::Error::last_os_error());
      }
    }

    #[cfg(windows)]
    if let Some(ref file) = self.file {
      use windows_sys::Win32::Storage::FileSystem::UnlockFileEx;
      use windows_sys::Win32::Foundation::HANDLE;
      let handle = file.as_raw_handle() as HANDLE;
      let mut overlapped = unsafe { std::mem::zeroed::<windows_sys::Win32::System::IO::OVERLAPPED>() };
      let result = unsafe { UnlockFileEx(handle, 0, 1, 0, &mut overlapped) };
      if result == 0 {
        eprintln!("WARNING: UnlockFileEx failed: {}", std::io::Error::last_os_error());
      }
    }

    self.file = None;
    self.acquired = false;

    // Try to remove the lock file (best-effort)
    let _ = fs::remove_file(&self.path);
    Ok(())
  }

  #[napi(getter)]
  pub fn is_acquired(&self) -> bool {
    self.acquired
  }
}

impl Drop for AdvisoryLock {
  fn drop(&mut self) {
    let _ = self.release();
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_acquire_release() {
    let dir = std::env::temp_dir().join("ax-code-test-lock");
    let _ = std::fs::create_dir_all(&dir);
    let lock_path = dir.join("test.lock");

    let mut lock = AdvisoryLock {
      path: lock_path.clone(),
      file: None,
      acquired: false,
    };

    assert!(lock.try_acquire().unwrap());
    assert!(lock.acquired);

    lock.release().unwrap();
    assert!(!lock.acquired);

    let _ = std::fs::remove_dir_all(dir);
  }

  #[test]
  fn test_contention() {
    let dir = std::env::temp_dir().join("ax-code-test-lock-contention");
    let _ = std::fs::create_dir_all(&dir);
    let lock_path = dir.join("test.lock");

    let mut lock1 = AdvisoryLock {
      path: lock_path.clone(),
      file: None,
      acquired: false,
    };

    let mut lock2 = AdvisoryLock {
      path: lock_path.clone(),
      file: None,
      acquired: false,
    };

    assert!(lock1.try_acquire().unwrap());
    // Second lock should fail (non-blocking)
    assert!(!lock2.try_acquire().unwrap());

    lock1.release().unwrap();
    // Now second lock should succeed
    assert!(lock2.try_acquire().unwrap());
    lock2.release().unwrap();

    let _ = std::fs::remove_dir_all(dir);
  }
}
