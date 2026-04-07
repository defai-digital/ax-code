use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use globset::Glob;
use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Deserialize)]
struct Command {
  cmd: String,
  #[serde(default)]
  pattern: Option<String>,
  #[allow(dead_code)]
  #[serde(default)]
  path: Option<String>,
}

#[derive(Serialize)]
struct StatusResponse { running: bool, files: u32, uptime_ms: u64 }

#[derive(Serialize)]
struct ScanResponse { files: u32, elapsed_ms: u64 }

#[derive(Serialize)]
struct ErrorResponse { error: String }

struct DaemonState {
  project_dir: PathBuf,
  #[allow(dead_code)]
  db_path: String,
  file_paths: Vec<String>,
  started_at: Instant,
  running: Arc<AtomicBool>,
}

impl DaemonState {
  fn new(project_dir: String, db_path: String, running: Arc<AtomicBool>) -> Self {
    Self {
      project_dir: PathBuf::from(&project_dir),
      db_path,
      file_paths: Vec::new(),
      started_at: Instant::now(),
      running,
    }
  }

  fn scan(&mut self) -> ScanResponse {
    let start = Instant::now();
    let mut builder = WalkBuilder::new(&self.project_dir);
    builder.hidden(true).git_ignore(true).git_global(true).git_exclude(true);

    let mut paths = Vec::new();
    for entry in builder.build().flatten() {
      if !entry.file_type().map_or(false, |ft| ft.is_file()) {
        continue;
      }
      if let Ok(rel) = entry.path().strip_prefix(&self.project_dir) {
        if rel.components().any(|c| c.as_os_str() == ".git") {
          continue;
        }
        if let Some(s) = rel.to_str() {
          paths.push(s.to_string());
        }
      }
    }

    let count = paths.len() as u32;
    self.file_paths = paths;
    ScanResponse { files: count, elapsed_ms: start.elapsed().as_millis() as u64 }
  }

  fn glob(&self, pattern: &str) -> Result<Vec<String>, String> {
    let matcher = Glob::new(pattern).map_err(|e| e.to_string())?.compile_matcher();
    Ok(self.file_paths.iter().filter(|p| matcher.is_match(p.as_str())).cloned().collect())
  }

  fn status(&self) -> StatusResponse {
    StatusResponse {
      running: self.running.load(Ordering::Relaxed),
      files: self.file_paths.len() as u32,
      uptime_ms: self.started_at.elapsed().as_millis() as u64,
    }
  }
}

fn socket_dir() -> PathBuf {
  let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
  PathBuf::from(home).join(".local/share/ax-code/daemon")
}

fn socket_path_for(project_dir: &str) -> PathBuf {
  let mut hasher = Sha256::new();
  hasher.update(project_dir.as_bytes());
  let hash = format!("{:x}", hasher.finalize());
  socket_dir().join(format!("{}.sock", &hash[..16]))
}

fn handle_client(stream: &UnixStream, state: &Arc<Mutex<DaemonState>>) {
  let mut reader = BufReader::new(stream);
  let mut line = String::new();
  if reader.read_line(&mut line).unwrap_or(0) == 0 {
    return;
  }
  let response = match serde_json::from_str::<Command>(line.trim()) {
    Ok(cmd) => dispatch(cmd, state),
    Err(e) => serde_json::to_string(&ErrorResponse { error: e.to_string() }).unwrap(),
  };
  if let Ok(mut writer) = stream.try_clone() {
    let _ = writer.write_all(response.as_bytes());
    let _ = writer.write_all(b"\n");
    let _ = writer.flush();
  }
}

fn dispatch(cmd: Command, state: &Arc<Mutex<DaemonState>>) -> String {
  let mut st = state.lock().unwrap();
  match cmd.cmd.as_str() {
    "status" => serde_json::to_string(&st.status()).unwrap(),
    "scan" => serde_json::to_string(&st.scan()).unwrap(),
    "glob" => {
      let pattern = cmd.pattern.unwrap_or_else(|| "**/*".into());
      match st.glob(&pattern) {
        Ok(files) => serde_json::to_string(&files).unwrap(),
        Err(e) => serde_json::to_string(&ErrorResponse { error: e }).unwrap(),
      }
    }
    "stop" => {
      st.running.store(false, Ordering::Relaxed);
      r#"{"stopped":true}"#.into()
    }
    other => serde_json::to_string(&ErrorResponse {
      error: format!("unknown command: {}", other),
    }).unwrap(),
  }
}

fn run_daemon(listener: UnixListener, state: Arc<Mutex<DaemonState>>, running: Arc<AtomicBool>) {
  // Initial scan
  state.lock().unwrap().scan();

  while running.load(Ordering::Relaxed) {
    match listener.accept() {
      Ok((stream, _)) => {
        stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
        stream.set_write_timeout(Some(Duration::from_secs(5))).ok();
        handle_client(&stream, &state);
      }
      Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
        std::thread::sleep(Duration::from_millis(100));
      }
      Err(_) => std::thread::sleep(Duration::from_millis(50)),
    }
  }

  // Cleanup socket file
  if let Ok(addr) = listener.local_addr() {
    if let Some(path) = addr.as_pathname() {
      let _ = std::fs::remove_file(path);
    }
  }
}

// -- NAPI exports --

/// Start the daemon for a project directory.
/// Returns the socket path for IPC communication.
#[napi]
pub fn daemon_start(project_dir: String, db_path: String) -> napi::Result<String> {
  let sock = socket_path_for(&project_dir);

  if let Some(parent) = sock.parent() {
    std::fs::create_dir_all(parent)
      .map_err(|e| napi::Error::from_reason(format!("failed to create socket dir: {}", e)))?;
  }

  // Remove stale socket if present; error if daemon is already running
  if sock.exists() {
    if UnixStream::connect(&sock).is_ok() {
      return Err(napi::Error::from_reason("daemon already running for this project"));
    }
    let _ = std::fs::remove_file(&sock);
  }

  let listener = UnixListener::bind(&sock)
    .map_err(|e| napi::Error::from_reason(format!("failed to bind socket: {}", e)))?;
  listener.set_nonblocking(true)
    .map_err(|e| napi::Error::from_reason(format!("failed to set non-blocking: {}", e)))?;

  let running = Arc::new(AtomicBool::new(true));
  let state = Arc::new(Mutex::new(DaemonState::new(project_dir, db_path, Arc::clone(&running))));
  let r = Arc::clone(&running);
  std::thread::spawn(move || run_daemon(listener, state, r));

  Ok(sock.to_string_lossy().into())
}

/// Stop a running daemon.
#[napi]
pub fn daemon_stop(socket_path: String) -> napi::Result<()> {
  let resp = send_command(&socket_path, r#"{"cmd":"stop"}"#)?;
  if resp.contains("stopped") {
    std::thread::sleep(Duration::from_millis(100));
    let _ = std::fs::remove_file(&socket_path);
    Ok(())
  } else {
    Err(napi::Error::from_reason(format!("unexpected response: {}", resp)))
  }
}

/// Check if daemon is running and healthy.
#[napi]
pub fn daemon_status(socket_path: String) -> napi::Result<String> {
  send_command(&socket_path, r#"{"cmd":"status"}"#)
}

/// Send a command to the daemon via IPC.
/// Commands: "scan", "glob <pattern>", "status", "stop"
#[napi]
pub fn daemon_send(socket_path: String, command: String) -> napi::Result<String> {
  let json = if command.starts_with('{') {
    command
  } else {
    let parts: Vec<&str> = command.splitn(2, ' ').collect();
    match parts[0] {
      "scan" | "status" | "stop" => format!(r#"{{"cmd":"{}"}}"#, parts[0]),
      "glob" => format!(r#"{{"cmd":"glob","pattern":"{}"}}"#, parts.get(1).unwrap_or(&"**/*")),
      "reindex" => format!(r#"{{"cmd":"scan","path":"{}"}}"#, parts.get(1).unwrap_or(&"")),
      cmd => format!(r#"{{"cmd":"{}"}}"#, cmd),
    }
  };
  send_command(&socket_path, &json)
}

fn send_command(socket_path: &str, json: &str) -> napi::Result<String> {
  let path = Path::new(socket_path);
  if !path.exists() {
    return Err(napi::Error::from_reason("daemon not running (socket not found)"));
  }
  let mut stream = UnixStream::connect(path)
    .map_err(|e| napi::Error::from_reason(format!("failed to connect to daemon: {}", e)))?;
  stream.set_read_timeout(Some(Duration::from_secs(30))).ok();
  stream.set_write_timeout(Some(Duration::from_secs(5))).ok();

  stream.write_all(json.as_bytes())
    .map_err(|e| napi::Error::from_reason(format!("failed to send command: {}", e)))?;
  stream.write_all(b"\n")
    .map_err(|e| napi::Error::from_reason(format!("failed to send newline: {}", e)))?;
  stream.flush()
    .map_err(|e| napi::Error::from_reason(format!("failed to flush: {}", e)))?;

  let mut reader = BufReader::new(stream);
  let mut response = String::new();
  reader.read_line(&mut response)
    .map_err(|e| napi::Error::from_reason(format!("failed to read response: {}", e)))?;
  Ok(response.trim().to_string())
}
