# AX Code native TUI

`ax-code-tui` is AX Code's experimental native Rust interface. It uses
Ratatui/Crossterm for terminal ownership and talks to the existing Node runtime
over HTTP/SSE. Providers, agents, tools, storage, and session execution remain
in the shared runtime.

The supported default remains the Zig/OpenTUI interface. Native mode is a
separate UI with a compact, Grok-inspired presentation; it does not load
OpenTUI and does not target pixel parity with it.

From the repository root:

```sh
cargo build --manifest-path crates/Cargo.toml -p ax-code-tui
AX_CODE_TUI_ENGINE=native pnpm --dir packages/ax-code dev
```

The normal Node launcher starts an authenticated loopback server and then
spawns the Rust binary. Set `AX_CODE_NATIVE_TUI_BIN` only when testing a binary
outside `crates/target/{debug,release}` or the packaged `libexec` directory.

Native terminal behavior includes bracketed paste, focus and mouse events,
grapheme-safe multi-line editing, event-driven redraws, full transcript
scrolling, and best-effort terminal restoration on normal exit or panic.

Verification:

```sh
cargo fmt --manifest-path crates/Cargo.toml -p ax-code-tui -- --check
cargo test --manifest-path crates/Cargo.toml -p ax-code-tui
cargo clippy --manifest-path crates/Cargo.toml -p ax-code-tui --all-targets -- -D warnings
```
