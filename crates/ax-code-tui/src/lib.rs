//! AX Code Ratatui TUI presentation layer (ADR-054).
//!
//! Clean-room implementation (license strategy A). Pure `Action` → `dispatch` →
//! `Effect` state lives here so unit tests do not need a TTY.

pub mod action;
pub mod auth;
pub mod client;
pub mod dispatch;
pub mod effect;
pub mod event_loop;
pub mod state;
pub mod terminal_ui;

pub use action::Action;
pub use auth::{AuthConfig, AuthError};
pub use dispatch::dispatch;
pub use effect::Effect;
pub use state::{AppState, PermissionPrompt, SessionPhase};
