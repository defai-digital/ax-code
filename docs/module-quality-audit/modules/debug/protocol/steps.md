# debug — 9-step module review

Reviewer: `codex-sol`  
Verifier lane: `ax-code-glm`  
Model: `gpt-5.6-sol-xhigh`

## Step 1 Scope and public surface

The `debug` unit consists of `packages/ax-code/src/debug/diagnostic-log.ts`, matching the resolved root and one-file inventory in `docs/module-quality-audit/modules/debug/MODULE-AUDIT.md:5-17`. The namespace begins at `packages/ax-code/src/debug/diagnostic-log.ts:65`; its callable surface is `enabled`, `dir`, `configure`, `record`, `flush`, `recordProcess`, `installProcessDiagnostics`, `redactReplayEvent`, and `redactForLog` at lines 66-258. Private state at lines 53-57 owns configuration, event-write serialization, listener installation, and write-warning suppression.

## Step 2 Activation and trust boundaries

Diagnostics are opt-in: `packages/ax-code/src/cli/bootstrap/env.ts:73-81` enables them only for `opts.debug === true`, with content capture separately gated by `debugIncludeContent === true`. Startup resolves a per-run directory and supplies process metadata at `packages/ax-code/src/cli/bootstrap/env.ts:147-164`; the TUI worker repeats configuration from propagated flags at `packages/ax-code/src/cli/cmd/tui/worker.ts:34-51`. The boundary is therefore local filesystem output containing process and replay telemetry. When content capture is on, raw `cwd`, arguments, events, and process data are deliberately written (`packages/ax-code/src/debug/diagnostic-log.ts:105-107,140-141,171-172`); callers must treat the directory as sensitive.

## Step 3 Configuration and write correctness

`configure` disables logging when either the feature or directory is absent, resolves and recursively creates the target, then builds three fixed output paths (`packages/ax-code/src/debug/diagnostic-log.ts:74-96`). Manifest writes are attempted together and failures are warned without aborting startup (`diagnostic-log.ts:115-124`). Replay records capture the current state, serialize one JSONL line, and append through a promise chain (`diagnostic-log.ts:127-155`); `flush` waits for that chain at lines 157-159. Invalid or out-of-range timestamps fall back to a valid current timestamp at lines 59-63, exercised by `packages/ax-code/test/debug/diagnostic-log.test.ts:151-203`. No control-flow defect was found in these paths.

## Step 4 Privacy and redaction behavior

The explicit replay cases redact session directories, LLM text/reasoning, tool inputs/results, permission patterns, and error messages (`packages/ax-code/src/debug/diagnostic-log.ts:199-250`). However, the default branch returns the copied event unchanged at lines 251-253. That leaves content-bearing variants such as `skill.recommended.filePaths` (`packages/ax-code/src/replay/event.ts:109-123`) and `agent.safety.decided.path` (`event.ts:283-294`) visible even when `includeContent` is false. Separately, generic `Error` handling preserves `message` verbatim and only path-redacts `stack` (`diagnostic-log.ts:269-283,391-393`). These are two Medium privacy findings: make replay redaction exhaustive and redact or safely summarize error messages. Neither is Critical because collection is explicitly debug-only and locally directed.

## Step 5 Concurrency and performance

Replay-event appends are ordered by the module-wide `writeQueue` (`packages/ax-code/src/debug/diagnostic-log.ts:54,143-154`), and each `record` captures its configured paths before queuing, so a later reconfiguration does not redirect an already-created record. Process events instead call `appendFileSync` for every event (`diagnostic-log.ts:161-178`), which favors crash-time durability but can block the event loop during verbose debug sessions; the many worker event sites beginning at `packages/ax-code/src/cli/cmd/tui/worker.ts:70-88` make this a plausible low-severity performance cost. Arrays and recursive redaction are bounded to 20 items and depth 8 (`diagnostic-log.ts:261-289`), limiting traversal work.

## Step 6 Lifecycle and ownership

The module owns process diagnostic listeners and protects installation with the one-way `processDiagnosticsInstalled` guard (`packages/ax-code/src/debug/diagnostic-log.ts:55,181-197`). Handlers consult current state through `recordProcess`, so disabling configuration at lines 74-78 makes installed listeners inert rather than duplicating or removing them. Replay persistence remains owned by `packages/ax-code/src/replay/recorder.ts:105-120`, which assigns IDs/sequences and mirrors each active-session event to `DiagnosticLog.record`; CLI bootstrap owns activation at `packages/ax-code/src/cli/bootstrap/env.ts:147-164`. The division is cohesive: this unit formats and writes diagnostics but does not decide when replay sessions begin.

## Step 7 Error handling and code hygiene

Serialization handles bigint and cycles through a replacer (`packages/ax-code/src/debug/diagnostic-log.ts:344-373`), while a serialization failure still emits a valid diagnostic marker at lines 352-361. Filesystem failures are intentionally best-effort: directory creation disables logging (`diagnostic-log.ts:81-88`), manifest failure warns (`:117-123`), replay append failure warns once (`:146-153`), and synchronous process writes cannot crash the application (`:174-178`). A Low observability issue remains because `writeFailureReported` is initialized once at line 56 and never reset during `configure`; after one failed append, later failures in a newly configured directory are silent. No TODO/FIXME or unsafe `any` appears in the candidate file.

## Step 8 Tests and finding decisions

The focused tests verify manifest naming and argument/path redaction (`packages/ax-code/test/debug/diagnostic-log.test.ts:29-61`), replay/process content redaction (`:63-109`), structured tool errors (`:111-149`), invalid timestamps (`:151-203`), bigint handling in both content modes (`:205-305`), and provider-error shaping (`:307-328`). Missing cases correspond to this review's findings: no test uses a pass-through replay event carrying `filePaths` or `path`, no test checks a secret-bearing `Error.message`, and no test reconfigures after a failed append. The prior register contains no accepted item (`docs/module-quality-audit/modules/debug/MODULE-AUDIT.md:69-73`), and no file exists under this unit's `findings/`; the two Medium and one Low observations above are reviewer recommendations, not Critical gate items.

## Step 9 Verification and exit

The exact focused command `AX_TEST_FILES=test/debug/diagnostic-log.test.ts pnpm --dir packages/ax-code exec vitest run` completed with one file and all eight tests passing on 2026-08-11. This validates the behaviors asserted in `packages/ax-code/test/debug/diagnostic-log.test.ts:23-328`; the broader inventory remains the single `debug` source identified at `docs/module-quality-audit/modules/debug/MODULE-AUDIT.md:20-38`. The static review re-read the implementation, activation sites, replay schema/recorder, logging consumers, and focused tests. No source code was changed, no Critical finding exists, and the Critical-only `reverify.md` condition is therefore not met.
