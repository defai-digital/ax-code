# Stability

Status: Active  
Scope: current-state  
Last reviewed: 2026-07-18  
Owner: ax-code runtime

How AX Code stays reliable for long interactive sessions and headless runs.

## Layers

| Layer              | What is hardened                                                                       | Key modules                                                  |
| ------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **TUI lifecycle**  | Suspend/resume, crash terminal restore, session leave memory prune                     | ADR-047; `cli/tui/util/*`                                    |
| **Process faults** | Abort/cancel/broken-pipe ignored; real crashes still exit                              | `util/harmless-interrupt`, TUI crash handler, CLI boot hooks |
| **Timeouts**       | Tool/LSP/MCP bounds without unhandledRejection                                         | `util/timeout.withTimeout`                                   |
| **Streams**        | Idle watchdog, resilient reconnect                                                     | `session/llm-impl` idle watchdog; `resilient-stream`         |
| **Permissions**    | Double-submit latch + reply timeout                                                    | `permission-submit-latch`, permission prompt                 |
| **Repo wiki**      | Path containment, atomic manifest-last writes, protected content, pre-write validation | `packages/ax-wiki`; `src/wiki/*`                             |

## Verification evidence

`session/verifications.ts` derives verification evidence from existing completed tool results. Each envelope citation
belongs to its latest run, so re-emitted evidence uses the latest source fingerprint and counts once. Each owning run
also retains its original validated verification set. Debug tools classify outcomes using that original set, and
applying verification checks every member's freshness. Deduplicating citations must not turn a mixed result into a
passing run or replace an original sibling's stale fingerprint with a later one.
The loader owns citation resolution for debug application and repair. Envelope identities and recorded events stay
unchanged.

Diagnostic loading retains valid envelopes from a malformed run, and audit reports label those checks `INCOMPLETE`.
Debug confirmation, verification application, and review completion reject selected runs with malformed members.
Authoritative selection uses the strict replay query so a capped history cannot hide newer evidence or policy.
Diagnostic reports disclose capped history. Active hypotheses based only on captured debug evidence and reviews with
an explicitly empty verification selection do not require verification history; neither path confirms a fix or approves
a review.

## Blessed TUI path

The supported runtime stack is:

- Runtime: Node bundled
- UI: **AX Code TUI + Solid** (primary default)
- Render: Zig (production); the native libraries are fully vendored in-repo
  (vendored inside `packages/ax-tui`, hash-pinned by its `vendor/manifest.json`) —
  no upstream `@opentui/*` npm packages are involved at install or runtime
- Yoga is not a selectable mode; AX Code TUI's native renderer remains the default

## Cancellations vs crashes

| Signal                                        | Expected behavior                                  |
| --------------------------------------------- | -------------------------------------------------- |
| User abort / Esc / tool cancel (`AbortError`) | Log at warn if unhandled; **do not** exit TUI      |
| Broken pipe (`EPIPE`) when shell closes       | Ignore as harmless                                 |
| Uncaught application exception                | Reset terminal, exit non-zero                      |
| Stream idle too long                          | Abort turn via stream idle watchdog (configurable) |

Override stream idle timeout with `AX_CODE_STREAM_IDLE_TIMEOUT_MS` (`0` disables).
Before the first model data, hosted routes use a shorter window sized to the prompt (60s plus 0.5ms per prompt token,
at most the idle timeout), so a request stuck upstream is retried sooner. Override it with
`AX_CODE_STREAM_FIRST_DATA_TIMEOUT_MS`; an explicit `AX_CODE_STREAM_IDLE_TIMEOUT_MS` applies to both phases.

## Permission prompts

Permission replies are:

1. **Latched** — only one in-flight reply per request id
2. **Re-armed** when the next queued request becomes active
3. **Timed out** after 20s so a hung server cannot wedge “Allow” forever

## Related docs

- [Sandbox](../guides/sandbox.md) — execution isolation
- [Autonomous](../guides/autonomous.md) — unattended runs
- [AX Wiki](../integrations/wiki.md) — source-backed semantic layer (not a graph substitute)
