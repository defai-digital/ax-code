# Stability

Status: Active  
Scope: current-state  
Last reviewed: 2026-07-18  
Owner: ax-code runtime

How AX Code stays reliable for long interactive sessions and headless runs.

## Layers

| Layer              | What is hardened                                                                       | Key modules                                                  |
| ------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **TUI lifecycle**  | Suspend/resume, crash terminal restore, session leave memory prune                     | ADR-047; `cli/cmd/tui/util/*`                                |
| **Process faults** | Abort/cancel/broken-pipe ignored; real crashes still exit                              | `util/harmless-interrupt`, TUI crash handler, CLI boot hooks |
| **Timeouts**       | Tool/LSP/MCP bounds without unhandledRejection                                         | `util/timeout.withTimeout`                                   |
| **Streams**        | Idle watchdog, resilient reconnect                                                     | `session/llm-impl` idle watchdog; `resilient-stream`         |
| **Permissions**    | Double-submit latch + reply timeout                                                    | `permission-submit-latch`, permission prompt                 |
| **Repo wiki**      | Path containment, atomic manifest-last writes, protected content, pre-write validation | `packages/ax-wiki`; `src/wiki/*`                             |

## Blessed TUI path

The supported runtime stack is:

- Runtime: Node bundled
- UI: OpenTUI + Solid
- Render: Zig (production)
- The experimental Rust/Ratatui UI was removed; Zig/OpenTUI is the only engine
- Yoga is not a selectable mode; Zig/OpenTUI remains the default

## Cancellations vs crashes

| Signal                                        | Expected behavior                                  |
| --------------------------------------------- | -------------------------------------------------- |
| User abort / Esc / tool cancel (`AbortError`) | Log at warn if unhandled; **do not** exit TUI      |
| Broken pipe (`EPIPE`) when shell closes       | Ignore as harmless                                 |
| Uncaught application exception                | Reset terminal, exit non-zero                      |
| Stream idle too long                          | Abort turn via stream idle watchdog (configurable) |

Override stream idle timeout with `AX_CODE_STREAM_IDLE_TIMEOUT_MS` (`0` disables).

## Permission prompts

Permission replies are:

1. **Latched** — only one in-flight reply per request id
2. **Re-armed** when the next queued request becomes active
3. **Timed out** after 20s so a hung server cannot wedge “Allow” forever

## Related docs

- [Sandbox](../guides/sandbox.md) — execution isolation
- [Autonomous](../guides/autonomous.md) — unattended runs
- [AX Wiki](../integrations/wiki.md) — source-backed semantic layer (not a graph substitute)
