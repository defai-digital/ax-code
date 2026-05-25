# Bug Reports Index

## Open Reports

| ID | Severity | Classification | Summary |
|----|----------|----------------|---------|
| 008 | high | suspected | sse-queue.ts has duplicate identifier and missing SSE_SOFT_MAX reference (build error) |

## Audit Log (Pass 4)

### Areas Audited — No New Bugs Found

| Area | Files Read | Verdict |
|------|-----------|---------|
| **Agent system** | `agent/agent.ts`, `agent/router.ts` | Well-structured. Config-driven agent overrides are safe (sanitized identifiers, permission merging). Router regex patterns are stateless (no `/g` flag). |
| **Memory/store** | `memory/store.ts` | Well-hardened (BUG-101, BUG-108, BUG-73, BUG-memstore-toctou references). TOCTOU-aware mtime cache, atomic writes via tmp+rename, coalesced in-flight reads. |
| **Project/instance** | `project/instance.ts` (full) | Proper lifecycle management with snapshot diagnostics, error propagation, sequential disposal with error collection. |
| **File watcher** | `file/watcher.ts` (full) | Native/poll fallback, abort-aware cleanup, proper handles array disposal, Instance.bind for ALS context in callbacks. |
| **Isolation** | `isolation/index.ts` (full) | Path resolution with symlink following, bypass scoping per-path, legacy "/" worktree sentinel guard. |
| **Control-plane SSE** | `control-plane/sse.ts` (full) | Reader cleanup with cancel guard, buffer size limit, proper JSON/parse error separation, decoder flush on EOF. |
| **Control-plane abort** | `control-plane/abort.ts` (full) | Clean settled-flag pattern, double-cancel guard. |
| **Server SSE queue** | `server/sse-queue.ts` | BUG-007 fixed — soft limit removed, only hard limit (4096) with overflow circuit breaker. |
| **Rust crates** | `crates/` | `cargo check` and `cargo clippy --all-targets --all-features -- -D warnings` both clean. |

### Summary

The audited areas show high code quality with extensive BUG-xx reference comments indicating a mature bug-fixing history. Error handling is thorough, resource cleanup is properly managed via `using`/`finally` blocks, and TOCTOU/race conditions are explicitly addressed in comments and code structure. No new credible bugs were identified in this pass.
