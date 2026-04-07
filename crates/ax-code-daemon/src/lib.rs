#[macro_use]
extern crate napi_derive;

#[cfg(unix)]
mod daemon;

#[cfg(unix)]
pub use daemon::*;

#[cfg(not(unix))]
#[napi]
pub fn daemon_start(_project_dir: String, _db_path: String) -> napi::Result<String> {
  Err(napi::Error::from_reason("ax-code-daemon is only supported on Unix platforms"))
}

#[cfg(not(unix))]
#[napi]
pub fn daemon_stop(_socket_path: String) -> napi::Result<()> {
  Err(napi::Error::from_reason("ax-code-daemon is only supported on Unix platforms"))
}

#[cfg(not(unix))]
#[napi]
pub fn daemon_status(_socket_path: String) -> napi::Result<String> {
  Err(napi::Error::from_reason("ax-code-daemon is only supported on Unix platforms"))
}

#[cfg(not(unix))]
#[napi]
pub fn daemon_send(_socket_path: String, _command: String) -> napi::Result<String> {
  Err(napi::Error::from_reason("ax-code-daemon is only supported on Unix platforms"))
}
