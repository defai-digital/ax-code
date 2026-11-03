//! Portable, bounded diff computation. No I/O, runtime bindings, or policy.
pub mod duplicates;
pub mod hunks;
pub mod patch;
pub mod preview;
pub mod text;

#[derive(Debug, thiserror::Error)]
#[error("{reason}")]
pub struct Error {
    pub reason: String,
}
impl Error {
    pub fn new(reason: impl Into<String>) -> Self {
        Self {
            reason: reason.into(),
        }
    }
}
pub type Result<T> = std::result::Result<T, Error>;
