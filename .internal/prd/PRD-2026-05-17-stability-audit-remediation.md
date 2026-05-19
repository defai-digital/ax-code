# PRD: Stability Audit Remediation

**Date:** 2026-05-17 (last verified 2026-05-18)
**Status:** Draft — Phase 0 verification complete; no remediation phase has landed yet
**Author:** ax-code agent
**Related:** `.internal/archive/prd/PRD-2026-05-18-hotspot-boundary-hardening.md` (file-size hotspots), ADR-009 (package boundaries)

## Current Status (2026-05-18 re-verification)

Working tree is clean (72 commits ahead of origin/main since the audit). No finding from this PRD has been explicitly closed yet, but adjacent extraction work and unrelated hardening have moved the needle on three items:

- **H15 (wrapSSE reader lock) — FIXED.** `src/provider/provider.ts:121-141` now routes `signal.aborted` through `abortReader`, which calls `void reader.cancel(reason).catch(() => {})`. No further work needed; this finding is closed.
- **H9 (fallback model cache invalidation) — PARTIAL.** `cachedSystemPrompt` now carries `environmentModelKey` (`src/session/prompt.ts:627-631`), so the per-model invariant is at least represented in the cache shape. The explicit clear on `fallbackModelOverride` assignment (`prompt.ts:1514`) is still missing; needs a follow-up to either reset `environment`/`environmentModelKey` or to gate the cache reuse on a fresh model-key comparison.
- **H10 (compaction busy retry) — REFACTORED, NOT FIXED.** Commit `d1f5ec1e` extracted `pendingCompactionDecision` (`src/session/compaction.ts`). The loop now reads `decision.delayMs` instead of a hard-coded 250ms, but the retry sleep at `src/session/prompt.ts:894` is still a plain `setTimeout` with no abort check and no upper bound on iterations. Use this extraction as the natural seam to land the H10 fix.

Two scope adjustments to flag:

- **H2 footprint is larger than originally stated.** A fresh grep across `packages/ax-code/src` finds **34** files importing from `"effect"` outside the allowlist (`src/effect/`, `src/session/`, `src/file/watcher.ts`, `src/util/effect-zod.ts`). The original audit only named three. Affected modules now include `skill/`, `pty/`, `auth/`, `agent/agent.ts`, `installation/`, `filesystem/`, `provider/auth.ts`, `command/`, `account/`, `permission/index.ts`, `mcp/index.ts`, `project/project.ts`, `config/markdown.ts`, `flag/flag.ts`, plus many `*/schema.ts` and `*/id.ts` files that use `effect/Schema` for branded IDs. The branded-ID files are the documented bridge case and should stay; everything else is in scope for H2.
- **Hotspot M1 is progressing under PRD-2026-05-18, not this PRD.** Verified sizes today:
  - `src/cli/cmd/tui/routes/session/index.tsx`: 1,777 (was 2,961 at audit time) — large reduction from `63b54caf Harden session renderer boundaries` and earlier.
  - `src/lsp/index.ts`: 1,937 (was 2,021) — `84ddfad2 Extract LSP client selection policy` and `cbf895b9 Extract LSP cache orchestration`.
  - `src/session/compaction.ts`: 484 — decision helper extracted.
  - `src/session/prompt.ts`: 3,174 (was 3,179) — essentially unchanged.
  - `src/session/processor.ts`: 982 — unchanged.
  - `src/cli/cmd/tui/component/prompt/index.tsx`: 2,013 — unchanged.
  - `src/server/server.ts`: 1,394 — unchanged.
  - `src/server/routes/session.ts`: 1,389 — unchanged.

Everything else from the audit remains as originally documented. Status markers in the tables below have been updated.

---

## Executive Summary

A cross-domain stability audit of `packages/ax-code` (session, tool, permission, MCP, provider, storage, native, runtime, replay, TUI, CLI, server) surfaced 30 findings. This PRD captures the prioritized backlog and proposes a phased remediation. The work is grouped so each phase ships independently and can be reverted in isolation.

The audit found that **autonomous mode, package boundaries, and TUI worker shutdown are intact**. The most acute risks are concentrated in:

1. The Node runtime path for storage (broken on first run; CLI db subcommands unloadable under Node).
2. Cancellation / signal propagation gaps that leak resources, terminal state, or child processes.
3. A too-narrow Effect guard that lets new Effect usage land outside the documented allowlist.
4. A handful of silent-failure code paths (Replay truncation, MCP cache TTL, native flag freeze, CLI subprocess stdout parsing) that mask real defects.

## Problem Statement

Several classes of defect have accumulated across domains:

- **Environment drift between bun and node variants.** The `#db` import map abstracts SQLite per runtime, but two modules bypass it (`storage/json-migration.ts`, `cli/cmd/storage/db.ts`), and the Node variant of the adapter itself is missing the file-creation step. The net effect: `ax-code` ships with a documented Node path that does not work on first run.
- **Cancellation does not reach every awaitable.** The session loop cancel propagates `AbortSignal` through tool calls, but stops at the `Permission.ask` boundary; the exported wrapper omits the signal entirely. Other paths (compaction busy-retry sleep, `BunProc.install` model warmup, SSE reader lock on early abort) similarly hold resources past cancel.
- **Signal handling is uneven.** The TUI main thread only registers SIGHUP via the renderer context; SIGINT/SIGTERM are not wired, so external kill leaves the terminal in raw mode + alt-screen + mouse-tracking. Long-running server entries do not handle SIGHUP, leaving children orphaned on SSH disconnect.
- **Effect guard is too narrow.** `script/check-no-effect-solid-in-v4.ts` only scans `src/runtime`, `src/cli/cmd/tui-v4`, and three `src/cli/cmd/tui/{state,input,native}` paths. New Effect usage already exists outside the allowlist (`src/provider/auth.ts`, `src/cli/effect/prompt.ts`, `src/cli/cmd/account.ts`) without CI catching it.
- **Silent failure modes mask real bugs.** Replay returns truncated `bySession` slices and flags every truncated step as divergence. The MCP `cachedTools` TTL suppresses server-emitted `tools/list_changed` notifications inside 10s windows. Native `AX_CODE_NATIVE_*` flags are captured once at module-load and cannot be flipped at runtime. The CLI provider streams stdout through `parser.parseStreamLine` with no try/catch, so a single malformed line can crash the host.
- **Hotspot files exceed the soft and hard split thresholds.** `src/session/prompt.ts` (3,179 lines), `src/cli/cmd/tui/routes/session/index.tsx` (2,961), and several others continue to absorb new logic. PRD-2026-05-18 already targets the TUI session route slice; this PRD adds session-engine and CLI command file slices to the same direction.

## Goals

- Make the Node runtime path of `ax-code` work end-to-end (storage init, `db` subcommands, migration).
- Close every cancellation / signal propagation gap surfaced by the audit so that abort and external kill release resources deterministically.
- Invert the Effect guard to allowlist-by-path so the policy in `ARCHITECTURE.md` is mechanically enforced.
- Eliminate the silent-failure code paths called out below (replace with explicit errors, bounded retries, or runtime-refreshable state).
- Continue the hotspot-file reduction direction from PRD-2026-05-18 into session-engine and CLI-command files.
- Add tests for the behaviors changed by this PRD, using the existing `tmpdir()` fixture and real-integration patterns.

## Non-Goals

- Not a rewrite of any subsystem. Each phase is a targeted patch, not a redesign.
- No new product features. This is correctness, hygiene, and observability only.
- No ratatui revival, no autonomous-mode weakening, no Effect re-introduction.
- No changes to public SDK shape (`packages/sdk/js`) in this PRD. The internal `programmatic.ts` parity question is tracked but deferred.
- No bundler / packaging changes beyond what is required to land the storage fixes.
- No changes to migration shape on disk; only the marker and retry semantics.

## Findings Backlog

The audit is preserved in conversation context. The summary below is the canonical work list. Severity ordering follows the audit; each item lists the concrete remediation that the implementation phases will deliver.

### Critical

| # | Status | Title | Location | Remediation |
|---|---|---|---|---|
| C1 | Open | `node:sqlite` adapter missing file creation | `src/storage/db.node.ts:1-8` (confirmed: `new DatabaseSync(path, { open: true, readOnly: false })`, no create) | Create the SQLite file before `new DatabaseSync(...)` (or use `{ open: false }` + `db.open()` after mkdir). Mirror bun variant (`src/storage/db.bun.ts:5` uses `{ create: true }`). |
| C2 | Open | `bun:sqlite` hard-imported in CLI / migration modules | `src/storage/json-migration.ts:1-2`, `src/cli/cmd/storage/db.ts:1-4` (both still import `bun:sqlite` at module top level) | Route through `#db` adapter. Expose `getRawClient()` from the adapter if direct `.query()` access is required. |
| C3 | Open | TUI main thread has no SIGTERM/SIGINT/SIGQUIT handler | `src/cli/cmd/tui/context/exit.tsx:57-58` (still only SIGHUP). Worker has SIGTERM/SIGINT (`src/cli/cmd/tui/worker.ts:284-285,317-318`) but no SIGHUP. | Centralize signal registration in `src/util/signals.ts` (file does not yet exist); register SIGINT/SIGTERM/SIGHUP/SIGQUIT and call `destroyTuiRenderer` + `disableTuiMouseTracking` + `flushTuiStdout`. |
| C4 | Open | `Permission.ask` exported wrapper drops `AbortSignal` | `src/permission/index.ts:548-550` (signature still `(input)` only); call sites `src/session/processor.ts:429`, `src/session/prompt.ts:268,1643` | Add `signal?: AbortSignal` to `Permission.ask`; pass `{ signal: abort }` at every call site. Internal `askPromise(input, { signal })` at `permission/index.ts:220` already supports abort. |

### High

| # | Status | Title | Location | Remediation |
|---|---|---|---|---|
| H1 | Open | Effect guard scope too narrow | `script/check-no-effect-solid-in-v4.ts:33-39` (`Directories` list unchanged) | Invert: scan `src/**/*.{ts,tsx}`; allow only `src/effect/`, `src/session/`, `src/file/watcher.ts`, `src/util/effect-zod.ts`, and documented exceptions. |
| H2 | Open (scope expanded) | Effect usage outside allowlist | 34 files re-verified by grep. Confirmed targets include `src/provider/auth.ts:8`, `src/cli/effect/prompt.ts:2`, `src/cli/cmd/account.ts:2`, `src/skill/{discovery,index}.ts`, `src/pty/index.ts`, `src/auth/index.ts`, `src/agent/agent.ts:30`, `src/installation/index.ts:2`, `src/filesystem/index.ts:5`, `src/command/index.ts:5`, `src/account/{index,repo}.ts`, `src/permission/index.ts:15`, `src/mcp/index.ts`, `src/project/project.ts:14`, `src/config/markdown.ts:1`, `src/flag/flag.ts:1`, `src/util/{effect-http-client,schema}.ts`. The `*/schema.ts` and `*/id.ts` files using `effect/Schema` for branded IDs (e.g. `provider/schema.ts`, `code-intelligence/id.ts`, `replay/index.ts`, `audit/id.ts`, `permission/schema.ts`, `question/{index,schema}.ts`, `pty/schema.ts`, `debug-engine/id.ts`, `account/schema.ts`) are out of scope per the documented bridge exception. | Migrate to async/await + Zod + `Result<T, E>`. Land one file per PR; H1 guard must be in place first. The migration order in Phase 4 still applies but the backlog is materially longer than the original audit suggested. |
| H3 | Open | CLI subprocess `cancel()` only SIGTERM, no SIGKILL escalation | `src/provider/cli/cli-language-model.ts:333` (still single `proc.kill("SIGTERM")` with no follow-up timer) | Mirror SIGTERM → 5s → SIGKILL escalation from `doGenerate` (`:139-145`) into `cancel()` and `fail()`. |
| H4 | Open | File watcher uses bare `require()` instead of `createRequire` | `src/file/watcher.ts:53-58` (still bare `require` inside `lazy()`) | Match `native/addon.ts` pattern: `const _require = createRequire(import.meta.url); _require(...)`. |
| H5 | Open | Replay truncates `bySession` at 10k rows and silently flags divergence | `src/replay/query.ts:19,27-50` (`BY_SESSION_LIMIT = 10_000`; `warnIfTruncated` still only `log.warn`s and returns the truncated slice) | Either paginate via `allSince` cursor inside `reconstructStream`, or throw `ReplayTruncatedError` on truncation; never return a partial slice as "the events". |
| H6 | Open | CLI provider stdout parsing has no try/catch | `src/provider/cli/cli-language-model.ts:230-238,251-258` (no try around `parser.parseStreamLine(line)`) | Wrap each `parser.parseStreamLine(line)` call in try/catch; emit a raw `text-delta` or log+skip on throw. |
| H7 | Open | Native flag captured at module load; cannot toggle at runtime | `src/flag/flag.ts:96-99` (still `export const`) vs `:273-284` (other flags already use `Object.defineProperty`) | Convert `AX_CODE_NATIVE_*` to `Object.defineProperty` getters. Cache require result separately, re-check flag per accessor. |
| H8 | Open | `Database.transaction` accepts async effects that run outside the tx | `src/storage/db.ts:180,215-243` | Type-level brand to reject async effects, or detect-and-throw inside the transaction to force rollback. |
| H9 | Partial | Fallback model switch does not clear system-prompt cache | `src/session/prompt.ts:627-631` (cache now has `environmentModelKey` field), `:1514-1517` (fallback only clears `cachedModel`, not `cachedSystemPrompt.environment`/`environmentModelKey`) | If `prompt-helpers` already invalidates the cached environment when `environmentModelKey` differs from the current model key, this finding is closed by construction — needs a one-line audit of `prompt-helpers.ts`. Otherwise add an explicit reset on `fallbackModelOverride =` assignment. |
| H10 | Refactored, not fixed | Compaction `busy` retry ignores abort and has no upper bound | `src/session/prompt.ts:888-899` now branches on `pendingCompactionDecision(...)` (helper extracted by commit `d1f5ec1e`). Retry sleep is still `await new Promise((resolve) => setTimeout(resolve, decision.delayMs))` at `:894` — no abort propagation, no iteration cap. | Replace the bare `setTimeout` with `SessionRetry.sleep(decision.delayMs, abort)` and have `pendingCompactionDecision` return `{ type: "break", reason: "error" }` after N consecutive busy retries. The extracted helper is the right seam. |
| H11 | Open | `BunProc.install` has no timeout or signal | `src/provider/provider.ts:927` (install) vs `:956` (`withTimeout(import(installedPath), 15_000, ...)` only wraps the post-install `import`) | Wrap install in `withTimeout(..., 60_000, "ProviderInstallError")`; add short-lived (~5s) negative cache on install failure. |
| H12 | Open | `Permission.fromConfig` does not validate rule action | `src/permission/index.ts:461-473` (still pushes raw `{ permission, action, pattern }` without `Permission.Rule.parse`) | Parse each rule through `Permission.Rule.parse()`; reject typos with logged error or thrown config error. |
| H13 | Open | Isolation bash bypass can be evaded on multi-target commands | `src/isolation/index.ts:98-100,157,163` (still `isBypassed` short-circuits both the protect check and per-target validation) | Require explicit bypass for every resolved target; re-validate via `fs.realpathSync(existing prefix) + suffix` (the helper at `:34-38` already exists); refuse bypass for `DEFAULT_PROTECTED` entries (`:8`). |
| H14 | Open | MCP `cachedTools` TTL suppresses `tools/list_changed` notifications | `src/mcp/index.ts:792-799` (`TOOLS_CACHE_TTL_MS = 10_000` still short-circuits the `ToolsChanged` subscriber) | Always invalidate on `ToolsChanged`; if rate limiting is needed, debounce the bus callback. |
| H15 | **Fixed** | `wrapSSE` reader lock leaks on early abort | `src/provider/provider.ts:126-141` — `abortReader` now does `void reader.cancel(reason).catch(() => {})` and is called from the `if (signal.aborted)` branch at `:136-137`. | Closed. No further work. |
| H16 | Open | Long-running server commands miss SIGHUP | `src/cli/cmd/tui/worker.ts:284-285,317-318` (only SIGTERM/SIGINT), `src/cli/cmd/runtime/{serve,workspace-serve}.ts`, `src/cli/cmd/storage/session.ts:433-434`, `src/cli/cmd/github-agent/pr.ts:132-133` | Consume the shared `src/util/signals.ts` helper introduced for C3. |

### Medium

| # | Status | Title | Location | Remediation |
|---|---|---|---|---|
| M1 | Progressing under PRD-2026-05-18 | Hotspot files exceed split thresholds | Current sizes (2026-05-18): `src/session/prompt.ts` 3,174 (was 3,179), `src/cli/cmd/tui/routes/session/index.tsx` **1,777** (was 2,961, −40%), `src/cli/cmd/tui/component/prompt/index.tsx` 2,013 (unchanged), `src/lsp/index.ts` **1,937** (was 2,021), `src/server/server.ts` 1,394, `src/server/routes/session.ts` 1,389, `src/session/processor.ts` 982, `src/session/compaction.ts` 484 (decision extracted), `src/cli/cmd/{mcp,run,index-graph,memory,providers}.ts` unchanged | Continue PRD-2026-05-18 direction. Outstanding slices owned by this PRD's Phase 6: per-event handlers from `processor.ts`; async-task plumbing out of `routes/session.ts`; `wrapSSE`/`fromModelsDev*`/`getSDK` out of `provider.ts`. |
| M2 | Open | `ToolRegistry` cacheKey is hand-rolled per flag | `src/tool/registry.ts:163-181,246-248` | Hash `JSON.stringify(cfg.experimental ?? {})` into cache key; move `Config.get()` into cache-miss branch. |
| M3 | Open | `MessageV2.fromError` pass-through returns class instance, not serialized form | `src/session/message-v2.ts:1018-1027` | Detect class instances in pass-through branches and call `.toObject()`. |
| M4 | Open (related commit) | `SessionCompaction.prune` aborts entire loop on first failure | `src/session/compaction.ts:168-175` (single try/catch around whole loop). Recent `b1991342 Avoid mutating compacted prune inputs` addressed a different defect in the same area. | Per-iteration try/catch; report succeeded/failed counts. |
| M5 | Open | `Recorder.flush()` may lose events on shutdown | `src/replay/recorder.ts:25-89` (no `flushAll` export; `Database.close()` not coordinated) | Add `Recorder.flushAll()` and have `Database.close()` `await` it before closing the SQLite handle. |
| M6 | Open | `runtime/service-manager` FIFO eviction can drop active services | `src/runtime/service-manager.ts:26-31` | Skip eviction for entries with non-terminal tasks; emit a metric when the cap forces eviction of an active entry. |
| M7 | Open | Migration marker advances even on partial application | `src/storage/storage.ts:171-191` | Per-migration checkpoint files (`.migration.<n>.partial`) so retries can resume; or temp-dir + rename. |
| M8 | Open | CLI stdin write does not await drain | `src/provider/cli/cli-language-model.ts:115-119` | `if (!proc.stdin.write(text)) await once(proc.stdin, "drain"); proc.stdin.end()`. |
| M9 | Open | OAuth/telemetry tests rely on `mock.module` and leak across files | `test/mcp/oauth-*.test.ts`, `test/telemetry/index.test.ts` | Replace with in-process fake OAuth/OTLP servers over real HTTP; use existing `tmpdir()` fixture. |
| M10 | Open | TUI test mirroring is inconsistent | `test/cli/tui-*.test.ts` flat (~17 files) vs `test/cli/tui/` subdir | Move flat `tui-*.test.ts` files under `test/cli/tui/` to mirror `src/cli/cmd/tui/...`. |
| M11 | Open | Control-plane core paths lack tests | `src/control-plane/{workspace,workspace-context,workspace-router-middleware,reasoning-policy,adaptors}.ts` | Add integration tests using `tmpdir({ git: true })` for live multi-workspace routing. |

### Low

| # | Status | Title | Location | Remediation |
|---|---|---|---|---|
| L1 | Open | `recentToolRing` cleared across all tools on doom-loop fire | `src/session/processor.ts:415` | Filter the ring by the offending tool name instead of clearing entirely. |
| L2 | Open | Compaction `busy` path has no test | `src/session/compaction.ts:187-194`, `src/session/prompt.ts:888-899` | Add integration test that drives two concurrent `process()` calls and asserts second returns `"busy"` then succeeds after first completes. The newly extracted `pendingCompactionDecision` makes this easier to test directly. |
| L3 | Open | `cancel()` race window between zeroing callbacks and deleting state | `src/session/prompt.ts:500-505` | Snapshot the callbacks array first; delete state entry before iterating. |
| L4 | Open | `Config.get()` mock in registry test casts as `never` | `test/tool/registry.test.ts:18-23` | Cast as `Awaited<ReturnType<typeof Config.get>>` or use a real `Config.Info` fixture. |
| L5 | Open | `util/effect-http-client.ts`, `util/schema.ts` are gateways for new Effect | `src/util/{effect-http-client,schema,effect-zod}.ts` | Move to `src/effect/` or rename to `util/legacy-effect-*.ts` with JSDoc warning. |
| L6 | Open | `destroyTuiRenderer` swallows `renderer.destroy()` errors | `src/cli/cmd/tui/renderer.ts:124-135` | Wrap `renderer.destroy()` in its own try/catch, log via `Log.create({ service: "tui.renderer" })`, run cleanup regardless, rethrow only after teardown. |

## Implementation Plan

Each phase ships as an independent PR. Phases are ordered so that earlier phases unblock later ones (signals helper used by both TUI and server fixes; Effect guard inversion must land before migrating Effect-using files so violations are visible in CI).

### Phase 1 — Node Runtime Path Repair

Closes: **C1, C2**

- Fix `src/storage/db.node.ts` to create the SQLite file (mirror bun variant behavior).
- Route `src/storage/json-migration.ts` and `src/cli/cmd/storage/db.ts` through the `#db` adapter. Expose `getRawClient()` if needed for direct `.query()` access.
- Add tests:
  - `test/storage/db.node.test.ts` — fresh `tmpdir`, expect `Database.Client()` to succeed on first call.
  - `test/cli/cmd/storage/db.test.ts` — `db query` / `db path` succeed under both bun and node entrypoints.

### Phase 2 — Shared Signal Helper + TUI / Server Shutdown

Closes: **C3, H16, L6**

- Add `src/util/signals.ts` exporting `registerShutdownSignals(callback, { signals?: NodeJS.Signals[] })` with default `["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"]` and idempotent cleanup.
- Wire into TUI: `ExitProvider` (or `app.tsx` lifecycle root) registers via the helper; the existing SIGHUP path is replaced.
- Wire into worker (`tui/worker.ts`) and long-running CLI servers (`cli/cmd/runtime/{serve,workspace-serve}.ts`, `cli/cmd/storage/session.ts`, `cli/cmd/github-agent/pr.ts`).
- Harden `cli/cmd/tui/renderer.ts:destroyTuiRenderer` to log destroy errors and always run cleanup.
- Add tests:
  - Spawn TUI subprocess, send SIGTERM, assert exit code + stdout reports clean teardown markers (mouse tracking off, alt-screen exited).
  - Worker integration test for SIGHUP.

### Phase 3 — Cancellation & Signal Propagation

Closes: **C4, H3, H10, H11**  (H15 already closed; H9 verification belongs here too)

- Add `signal?: AbortSignal` to `Permission.ask`; thread `{ signal: abort }` through every call site.
- `CliLanguageModel.cancel()` and `fail()`: SIGTERM → 5s timer → SIGKILL.
- `SessionCompaction` busy retry: replace `setTimeout(resolve, decision.delayMs)` at `prompt.ts:894` with `SessionRetry.sleep(decision.delayMs, abort)`; have `pendingCompactionDecision` return `break` after N consecutive busy retries (target N = 40 ≈ 10s).
- `BunProc.install`: wrap in `withTimeout(..., 60_000)`; add 5s negative cache.
- H9 verification: audit `prompt-helpers.ts:SystemCache` to confirm `environmentModelKey` mismatch invalidates the cached environment. If not, add explicit reset on `fallbackModelOverride =` at `prompt.ts:1514`.
- Tests: per-finding regression tests under `test/session/`, `test/provider/`, `test/permission/`.

### Phase 4 — Effect Guard Inversion + Migrations

Closes: **H1, then H2**

- Step 4a (single PR): Rewrite `script/check-no-effect-solid-in-v4.ts` (rename to `check-runtime-guardrails.ts`) to allowlist by path. The script must temporarily allowlist current violators by exact file path so the inversion is a no-op in CI.
- Step 4b–4d (one PR per file): migrate `cli/effect/prompt.ts`, `cli/cmd/account.ts`, `provider/auth.ts` off Effect; remove each from the temporary allowlist as its migration lands.

### Phase 5 — Silent Failure Surfacing

Closes: **H4, H5, H6, H7, H8, H12, H13, H14, M2, M3, M4, M5, M6, M7, M8, L1**

Grouped because each item is small and orthogonal. Ship as a series of one-finding PRs in any order:

- H4: `file/watcher.ts` `createRequire`.
- H5: `replay` truncation — choose pagination vs `ReplayTruncatedError` during implementation; decision recorded in an ADR if non-trivial.
- H6: CLI stdout parsing try/catch.
- H7: native flag getters.
- H8: `Database.transaction` async-effect rejection.
- H12: permission rule parse-on-load.
- H13: isolation bash multi-target bypass validation.
- H14: MCP `tools/list_changed` always-invalidate + debounce.
- M2: `ToolRegistry` cacheKey hash.
- M3–M8: as listed in the backlog.
- L1: per-tool ring filtering on doom-loop.

### Phase 6 — Hotspot File Reduction (continuation of PRD-2026-05-18)

Closes: **M1** (incrementally), **L3**

- `session/processor.ts`: extract per-event handlers (text, reasoning, tool-call, finish-step) onto a state object; separate `runStream()` from `finalize()` / `handleError()`.
- `server/routes/session.ts`: move async-task helpers (`startDetachedSessionTask`, `recordAsyncSessionTask`, `createAsyncSessionErrorHandler`, `startAsyncSessionTask`) into `src/session/async-task.ts`.
- `server/server.ts`: extract middleware composition (`server/middleware/{auth,cors,bootstrap,error}.ts`).
- `provider/provider.ts`: split out `wrapSSE`, `fromModelsDev*`, `getSDK`.
- `cli/cmd/run.ts`: extract tool renderers into `src/tool/render-cli.ts` shared with TUI's `routes/session/tools/*` (when PRD-2026-05-18 phase lands them).
- L3: snapshot callbacks before zeroing in `prompt.ts:cancel()`.

Each extraction is its own PR. No single PR is required to hit a target file size; the goal is direction, not a hard line count.

### Phase 7 — Test Hygiene

Closes: **L2, L4, M9, M10, M11**

- L2: compaction busy concurrency test.
- L4: registry test fixture cast.
- M9: replace `mock.module`-based OAuth/telemetry tests with in-process fakes.
- M10: move flat `test/cli/tui-*.test.ts` files to mirror source tree.
- M11: control-plane workspace + routing tests.

## Risks and Mitigations

- **Storage adapter change (Phase 1) is a hot-path edit.** Mitigation: behavior is gated by runtime detection; bun path is untouched; tests cover both runtimes. Land behind one PR for easy revert.
- **Effect guard inversion may surface unknown violators.** Mitigation: Step 4a temporarily allowlists current violators by path so CI stays green; subsequent PRs remove each entry as the migration lands.
- **Signal helper rollout (Phase 2) touches many entry points.** Mitigation: helper has a single small surface; each entry-point migration is a one-line change reviewed independently.
- **Replay truncation fix (H5) changes observable behavior for long sessions.** Mitigation: ADR documents the chosen direction (pagination vs error); error path is the safer default if pagination is non-trivial.
- **Hotspot extraction is incremental.** Mitigation: continue the per-PR slice pattern from PRD-2026-05-18; do not gate this PRD on hitting a specific file size.

## Out of Scope (Tracked Elsewhere)

- Internal vs published SDK surface drift (`src/sdk/programmatic.ts` ~1,100 lines vs `packages/sdk/js`). Needs a separate decision on whether `programmatic.ts` is "internal embedder API" or whether the SDK should grow to match. Tracked but not blocked by this PRD.
- `lsp/index.ts` and `quality/*` oversized files. Covered by the existing hotspot direction; not in this PRD's plan.
- Native addon JS fallback divergence in `code-intelligence/native-store.ts` (returns empty results when addon missing while flag is set). Needs a separate audit pass to map fallback parity per query.

## Acceptance Criteria

Already closed at PRD time:

- H15 (SSE reader lock released on early abort) — verified at `provider/provider.ts:126-141`.

Remaining for completion:

- C1–C4 closed: Node entrypoint boots a fresh install end-to-end; `db` subcommands run under both bun and node; TUI exits cleanly on SIGINT/SIGTERM/SIGHUP/SIGQUIT with terminal state restored; cancel during a permission dialog releases the tool-call frame.
- H1–H14, H16 closed: Effect guard scans the full tree with explicit allowlist; no Effect imports outside the allowlist (~34 files to migrate); SIGKILL escalation present on all CLI subprocess cancel paths; file watcher uses `createRequire`; Replay never returns a silently-truncated slice; CLI provider stdout parsing tolerates malformed lines; native flags are runtime-refreshable; install timeout active; isolation bypass re-validates resolved paths; MCP cache invalidation always honored. H9 verified or fixed; H10 retry honors abort with bounded attempts.
- M1–M11 progressed: at least the per-event-handler extraction in `processor.ts`, the migration marker fix, the recorder shutdown flush, and the OAuth/telemetry test rewrite land; the rest are tracked in their own PRs. PRD-2026-05-18 owns the routes/session and LSP slices and is already shipping reductions.
- L1–L6 closed.
- `pnpm typecheck`, `bun run test:unit`, `bun run test:deterministic`, `pnpm run check:structure`, `bun run check:tui-layering`, and the renamed runtime-guardrails check all pass.
