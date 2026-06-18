//! AX Code TUI - Ratatui thin client for terminal session interaction.
//!
//! This crate implements a session-first terminal UI that attaches to
//! a headless ax-code server. It does not own dashboards, provider logic,
//! session execution, or storage — those remain in the headless runtime.
//!
//! # Architecture
//!
//! ```text
//! ax-code-tui
//!   |
//!   +-- client (HTTP/SSE to headless server)
//!   +-- events (typed event stream)
//!   +-- tui (Ratatui rendering)
//!       +-- app (application state)
//!       +-- render (UI rendering)
//!       +-- input (keyboard/mouse handling)
//! ```

pub mod client;
pub mod diagnostics;
pub mod events;
pub mod launch_policy;
pub mod runner;
pub mod tui;

// Re-export main types for convenience
pub use client::HeadlessClient;
pub use events::RuntimeEvent;
pub use launch_policy::{LaunchInput, LaunchRoute};
pub use runner::{CliArgs, Runner};
pub use tui::app::App;
