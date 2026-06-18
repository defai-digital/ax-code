//! TUI rendering module using Ratatui.

pub mod app;
pub mod input;
pub mod render;

pub use app::{App, AppMode, Message, PermissionRequest, QuestionRequest, SessionStatus, SessionSummary, ToolCall, ToolCallStatus};
pub use input::{handle_input, InputAction};
pub use render::render;
