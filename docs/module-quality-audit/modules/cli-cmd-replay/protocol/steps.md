# Protocol Steps — cli-cmd-replay

Reviewer: ax-code-glm (model `zai-coding-plan/glm-5.2[1m]`)
Unit slug: `cli-cmd-replay`
Resolved root: `packages/ax-code/src/cli/cmd/replay.ts` (149 LOC, single export `ReplayCommand`)
Started: 2026-08-11T20:12:15Z

## Step 1 Scope and Map

`cli-cmd-replay` resolves to one file: `packages/ax-code/src/cli/cmd/replay.ts`. The single export `ReplayCommand` (replay.ts:10) is registered in `packages/ax-code/src/cli/boot.ts:63`. Direct dependencies confirmed by reading the imports: `SessionID.make` (session/schema.ts:4), `cmd` helper (cli/cmd/cmd.ts:5 — a one-line identity wrapper around `CommandModule`), `bootstrap` (cli/bootstrap.ts:4 — wraps `Instance.provide` with a `try/finally` that calls `Instance.dispose()`), `Session.get` (../../session), `Replay` namespace (replay/replay.ts:36), and `EventQuery` (replay/query.ts:10). No tests in `packages/ax-code/test/` exercise this command — `rg "ReplayCommand"` against the test tree returns zero matches (the matches in `risk.test.ts` and `tui/session-quality.test.ts` are unrelated `source: "replay"` data markers).

## Step 2 Threat and Failure Model

Read-only inspection tool. Inputs: `<sessionID>` positional, `--mode` (yargs-restricted to a choice set at replay.ts:22), `--from-step` (number, no range check). The sessionID is validated through `SessionID.make(args.sessionID)` at replay.ts:32 via the branded-identifier parser (session/schema.ts:4 → `defineBrandedIdentifier`), so malformed IDs throw before any DB access. No file writes; the command only reads SQLite via Drizzle. `export` mode (replay.ts:63–80) writes the full event log to stdout, including tool inputs/outputs — the operator already has access to the workspace, so this is not a privilege boundary change, but it is worth noting that piping `replay <sid> --mode export` to an untrusted sink is a content-disclosure surface.

## Step 3 Correctness — Control Flow

Three issues in the public handler path:

1. **`TruncatedError` is uncaught.** The default verify path (replay.ts:130) calls `Replay.run`, which calls `EventQuery.bySessionStrict` (replay/replay.ts:62). The `execute` (replay.ts:45 → `prepareExecution`), `compare` (replay.ts:54 → `Replay.compare`), and `reconstruct` (replay.ts:99 → `reconstructStream`) modes all funnel through `bySessionStrict` (replay/replay.ts:175, 345). `bySessionStrict` throws `ReplayTruncatedError` when a session exceeds `BY_SESSION_LIMIT = 10_000` events (query.ts:20, 50–60). The handler at replay.ts:30–148 has **no try/catch**, and `bootstrap` (cli/bootstrap.ts:4–17) does not translate errors either. A pathologically long session will surface a raw `NamedError` stack to the operator with no actionable hint to use `allSince` pagination.

2. **`check` is a silent alias for `verify`.** Line 40: `const mode = args.mode === "check" ? ("verify" as const) : args.mode`. Both `"check"` and `"verify"` are listed as choices (replay.ts:22). Users see two modes that produce byte-identical output, and `--help` does not document the alias.

3. **`args["from-step"] ?? args.fromStep` is a redundant fallback.** Lines 43 and 95 both write this. Yargs populates both the kebab-case and camelCase keys for kebab-named options, so the two keys always hold the same value. Sibling `run.ts:717` uses only `args["replay-limit"]` for the same kind of option — confirming the fallback here is dead defensive code, not a real yargs compatibility shim.

## Step 4 Performance

`EventQuery.count(sid)` at replay.ts:33 issues a `COUNT(*)` query (query.ts:227–238) — O(1) memory, good. The default verify path (replay.ts:130 → `Replay.run`) does a single `bySessionStrict` round-trip plus an in-memory `ToolCallReplayQuery.summaryFromEvents` (replay/replay.ts:78) — one DB scan, acceptable. The `export` mode (replay.ts:63–80) is the hotspot: it calls `EventQuery.bySession(sid)` (line 65), `Session.get(sid)` (line 66), and `Replay.reconstructStream(sid)` (line 67), and `reconstructStream` internally calls `bySessionStrict` again (replay/replay.ts:175). That is **two full per-session table scans** of the same event log in a single command. For a 9k-event session (under the 10k cap) where each `tool.result` row can carry megabytes of stdout (query.ts:14–19 comment), this doubles peak resident memory. The fix is mechanical: read once via `bySession`, then call the existing `reconstructStreamFromEvents` (replay/replay.ts:179 — already factored out) instead of going back through the strict loader.

## Step 5 Design

Six modes dispatch through an if/else chain (replay.ts:42, 63, 82, 94, 119, then the implicit verify/check fallthrough at line 128). At six branches this is still readable; a mode→handler map would not clear the rule-of-three bar for extraction. The stdout/stderr split is correct and consistent with siblings: progress and diagnostics to stderr (`process.stderr.write` at lines 36, 44, 64, 83, 96, 120, 128, 134), data to stdout (lines 51, 77, 85–89, 101–115, 121–124, 139–142). `compare.ts` and `trace.ts` follow the same convention. `replay.ts` routes through `bootstrap()` (cli/bootstrap.ts), which is the cleaner pattern vs. `compare.ts:25` and `trace.ts:151` calling `Instance.provide` directly — `bootstrap` guarantees `Instance.dispose()` runs in the `finally` (cli/bootstrap.ts:13).

## Step 6 Hygiene and Dead Code

- **Internal roadmap leak in user-facing describe.** replay.ts:26 `describe: "start reconstruction from this step index (R7: partial replay)"`. The "R7:" prefix references an internal milestone (the same prefix appears in replay/replay.ts:166 and replay/replay.ts:91 comments) and means nothing to a CLI user. Stripping "R7: " from the user-visible string costs nothing.
- **`.catch(() => undefined)` swallows all Session.get failures.** replay.ts:66: `const session = await Session.get(sid).catch(() => undefined)`. The export package then conditionally embeds session metadata at line 71 (`session ? { directory, title } : undefined`). Any error — corrupt DB, schema mismatch, lock contention — silently produces an export with `session: undefined` and no warning on stderr. The audit's "empty catches = 0" count (MODULE-AUDIT.md:26) misses this because it counts `catch {}` blocks, not `.catch(() => undefined)` promise handlers. Sibling `session-required.ts:5–13` shows the right pattern: catch, narrow on `NotFoundError.isInstance`, re-throw the rest.
- **`execute` mode exposes a developer affordance through the user CLI.** replay.ts:47 prints `Stream prepared (use programmatically with LLM.stream mock)`. That instruction is for in-tree test authors (see replay/replay.ts:325), not operators. Either hide `execute` behind an `--internal` flag or move the wiring hint out of the CLI output.
- **Redundant `args["from-step"] ?? args.fromStep`** — see Step 3.

## Step 7 Tests

No CLI test exercises `ax-code replay <sid>`. `rg "ReplayCommand"` against `packages/ax-code/test/` returns zero matches. `rg "ax-code replay"` and `rg "cli/cmd/replay"` also return zero. The MODULE-AUDIT.md test list (lines 32–46) is the generic Wave-6 inventory (account.test.ts, acp.test.ts, agent.test.ts, audit.test.ts, etc.) — none target the replay command. The underlying engine has coverage: `Replay.reconstructStream` / `prepareExecution` are exercised by `test/replay/reconstruct.test.ts` (referenced in replay/replay.ts:325). The CLI surface itself — argument parsing, mode dispatch, exit-code semantics (`process.exit(1)` on divergences at lines 58, 90, 145) — has no coverage. A smoke test invoking the handler for `summary` and `compare` modes against a seeded session would close the highest-value gap.

## Step 8 Findings Register

- **MEDIUM — TruncatedError uncaught.** Sessions over 10k events produce a raw `NamedError` stack at the operator. Location: replay.ts:30–148 handler has no try/catch; throw site is query.ts:54. Suggested fix: catch `EventQuery.TruncatedError` in the handler and emit a stderr message pointing at `allSince` pagination, then `process.exit(1)`.
- **LOW — `.catch(() => undefined)` swallows non-NotFound errors during export.** replay.ts:66. Narrow on `NotFoundError.isInstance` (mirroring session-required.ts:9) and re-throw everything else; or at minimum emit a stderr warning when the session record is missing.
- **LOW — Double scan in export mode.** replay.ts:65 + replay.ts:67 both load the full event log. Use `reconstructStreamFromEvents` directly to avoid the second `bySessionStrict` round-trip.
- **INFO — Redundant `args["from-step"] ?? args.fromStep`.** replay.ts:43, 95. Drop the `?? args.fromStep` fallback.
- **INFO — Internal "R7:" prefix in user-facing describe.** replay.ts:26. Strip the prefix from the option help text.
- **INFO — No CLI tests.** See Step 7.
- **No Critical findings** in this pass — no reverify.md gate triggered.

## Step 9 Verification and Exit

This is a documentation-only artifact write; no source under `cli-cmd-replay` or any other unit was mutated, so no `pnpm run typecheck` / `pnpm run test:scripts` re-run is required by the verification protocol for docs-only output. The evidence above is grounded in file:line references actually read during this pass: `packages/ax-code/src/cli/cmd/replay.ts`, `packages/ax-code/src/replay/replay.ts`, `packages/ax-code/src/replay/query.ts`, `packages/ax-code/src/cli/cmd/cmd.ts`, `packages/ax-code/src/cli/bootstrap.ts`, `packages/ax-code/src/cli/cmd/compare.ts`, `packages/ax-code/src/cli/cmd/trace.ts`, `packages/ax-code/src/cli/cmd/session-required.ts`, `packages/ax-code/src/session/schema.ts`, and `docs/module-quality-audit/modules/cli-cmd-replay/MODULE-AUDIT.md`. Scope stayed within the `cli-cmd-replay` slug; no other unit's audit artifacts were touched. Because no Critical findings were identified (Step 8), the independent-verifier gate is not triggered for this pass; if the verifier lane (codex-sol) elects to re-read the MEDIUM finding's evidence path (query.ts:50–60 → replay/replay.ts:62,175,345 → replay.ts:30–148), this steps.md is the entry point.
