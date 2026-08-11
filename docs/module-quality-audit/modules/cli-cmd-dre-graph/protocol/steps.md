# Protocol Steps — cli-cmd-dre-graph

Reviewer: ax-code-glm (model `zai-coding-plan/glm-5.2[1m]`)
Independent verifier (other lane): codex-sol
Unit slug: `cli-cmd-dre-graph`
Resolved root: `packages/ax-code/src/cli/cmd/dre-graph.ts` (73 LOC, 1 export)
Date: 2026-08-11

## Step 1 Scope and map

The unit is a single yargs `CommandModule` exported as `DreGraphCommand` at `packages/ax-code/src/cli/cmd/dre-graph.ts:19` and registered globally in `packages/ax-code/src/cli/boot.ts:26,94`. It wires three local helpers plus one external npm import:

- `target()` helper at `packages/ax-code/src/cli/cmd/dre-graph.ts:7` wraps `Instance.provide({ directory: process.cwd(), ... })` (from `packages/ax-code/src/project/instance.ts:197`) and resolves a session via `resolveSession` / `printNoSessionFound` from `packages/ax-code/src/cli/cmd/session-latest.ts:4,11`.
- `DreGraphServer.listen` from `packages/ax-code/src/cli/cmd/dre-graph-server.ts:13` is the actual HTTP server starter; this CLI command only consumes its `.listen` member.
- The `open` npm package is imported at line 1 and used to launch the browser at line 58.

Static map: 1 file, 1 export (`DreGraphCommand`), 0 TODOs, 0 empty catches at the unit boundary. The `cmd<T,U>` wrapper at `packages/ax-code/src/cli/cmd/cmd.ts:5` is a passthrough that only adds the `--` passthrough type, so the public contract is exactly the yargs `command/builder/handler` triple.

## Step 2 Threat and failure model

This is a CLI entry point bound to a loopback HTTP server, so the threat surface is the bind address and the resource it exposes. Mitigations already present:

- `DreGraphServer.listen` hard-codes `hostname: "127.0.0.1"`, `mdns: false`, `cors: []` (`packages/ax-code/src/cli/cmd/dre-graph-server.ts:14-19`), and `Server.listen` re-validates via `assertAuthenticatedNetworkBind` / `normalizeLoopbackHostname` at `packages/ax-code/src/server/server.ts:354-355`. So the CLI never exposes the DRE graph on a non-loopback interface regardless of `--port`.
- `--port` is constrained by yargs `type: "number"` (line 30) and `Server.validateListenPort` at `packages/ax-code/src/server/server.ts:126-130` (integer 0–65535). Default `0` → ephemeral port.
- No secrets, env vars, or filesystem paths from user input flow into this command beyond `process.cwd()` and the resolved session directory, both of which are operator-controlled.

The one real failure mode worth noting: the browser launch at line 58 is fire-and-forget — `.catch(() => undefined)` — so if `open()` fails the user sees a "listening on …" message and then nothing (addressed in Step 8).

## Step 3 Correctness

I traced both branches of the handler:

- `--index` branch (line 44): `hit` is set to `undefined`, the early-return guard at lines 45-48 is skipped (`args.index` is truthy), and the URL is built with path `/dre-graph` and `directory=process.cwd()` (lines 52, 55). Correct.
- session branch: `target(args.sessionID)` returns `{ sid, dir } | undefined`. When `undefined`, `printNoSessionFound()` runs and the handler returns (lines 45-48). When defined, `hit!.sid` and `hit!.dir` are read at lines 52 and 55 — safe only because of the guard at line 45.

The non-null assertions `hit!.sid` / `hit!.dir` are correct today but couple correctness to an early return that is three statements away; a refactor that weakens the guard would silently produce `undefined` interpolations in the URL. Shutdown is idempotent via the `stopping` flag at lines 60-66. The terminal `await new Promise(() => {})` (line 70) is the intentional "block forever until signal" pattern for a server host — correct, not a bug.

## Step 4 Performance

No hot path: this command runs once and blocks. Two observations:

- `target()` always enters `Instance.provide` even when `--index` is requested — but the `args.index ? undefined : await target(...)` ternary at line 44 short-circuits and never calls `target()` in index mode, so no project instance is booted unnecessarily. Good.
- `DreGraphServer.listen` (line 50) bypasses the `ensure()`/`shared` cache in `packages/ax-code/src/cli/cmd/dre-graph-server.ts:29-37` and always starts a fresh server. That is the right choice for a standalone CLI invocation (the shared cache is for the long-lived TUI process at `packages/ax-code/src/cli/cmd/tui/routes/session/display-commands.ts:11`).

No N+1, no synchronous I/O on a hot loop, no unbounded buffers. Nothing to change.

## Step 5 Design and ownership

Layering is clean: this file is a thin CLI adapter that composes two siblings (`dre-graph-server.ts`, `session-latest.ts`) and one project-level helper (`Instance`). It does not reach into `server/routes/dre-graph.ts` or the `quality/dre-graph-*` renderers directly — those are reached through the HTTP routes the server owns, which is the correct boundary.

One naming smell: the yargs option declared at `packages/ax-code/src/cli/cmd/dre-graph.ts:38` as `.option("open", ...)` shares its name with the `open` import at line 1. Inside `handler`, `open` is the function and `args.open` is the boolean; TypeScript keeps them distinct (one is a free identifier, the other a property access), but a future maintainer reading `if (args.open) await open(...)` at line 58 has to parse the distinction carefully. Renaming the flag (e.g. `launch`) or inverting to `--no-open` would remove the ambiguity. This is style, not a defect.

## Step 6 Dead code and hygiene

No dead exports, no unused imports, no TODO/FIXME. `DreGraphServer.clear()` (`packages/ax-code/src/cli/cmd/dre-graph-server.ts:9`) is not called by this command, but it is legitimately used by the TUI's session display layer to reset the shared cache, so it is not dead.

`process.on("SIGINT", shutdown)` / `process.on("SIGTERM", shutdown)` at lines 67-68 register listeners that are never removed. This is acceptable because the command's lifecycle ends with `process.exit(0)` at line 65 inside the shutdown closure — there is no path where the process keeps running with stale listeners. Lint/leak scanners may flag it; the fix (using `process.once` or a `beforeExit` cleanup) is cosmetic and would not change behavior.

## Step 7 Tests

Direct coverage of this command is **absent**. I grepped `packages/ax-code/test/cli` for `dre-graph` / `DreGraph` and got zero matches. The neighbouring surface is well covered — `packages/ax-code/test/server/dre-graph.test.ts:36-275` exercises the `/dre-graph` and `/dre-graph/session/:sid` routes that this CLI starts, and `packages/ax-code/test/quality/dre-graph-*.test.ts` covers every renderer the routes call — but nothing exercises:

- the `--index` vs `[sessionID]` branch decision at line 44,
- the `!hit` → `printNoSessionFound()` early return at lines 45-48,
- the URL construction (port, `directory` query param) at lines 51-55,
- the `args.open === false` opt-out at line 58,
- the SIGINT/SIGTERM shutdown path at lines 60-70.

A focused test would spawn the CLI binary (the pattern already used by `packages/ax-code/test/cli/boot.test.ts`) with `--no-open` and assert that the printed `DRE Graph listening on …` URL resolves and that SIGINT exits 0. This is the single highest-value follow-up for the unit.

## Step 8 Finding register

Dispositions from this review (no Critical, no High):

| #   | Severity | Finding                                                                                                                                              | Disposition                                                                        |
| --- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1   | MEDIUM   | CLI command handler has no direct test coverage; the `--index`/session branch, URL build, `--open` toggle, and shutdown are all unverified (Step 7). | Accept as tech-debt follow-up; recommend a spawn-based CLI test.                   |
| 2   | LOW      | Browser-launch failure swallowed silently at `packages/ax-code/src/cli/cmd/dre-graph.ts:58` (`.catch(() => undefined)`).                             | Recommend `console.warn` on the caught error so "nothing happened" is diagnosable. |
| 3   | LOW      | `open` option name (line 38) shadows the `open` npm import (line 1); readability hazard.                                                             | Recommend renaming the flag or inverting to `--no-open`.                           |
| 4   | LOW      | `hit!.sid` / `hit!.dir` non-null assertions (lines 52, 55) rely on an early return three statements away.                                            | Recommend a narrow `const { sid, dir } = hit` after the guard for explicitness.    |
| 5   | INFO     | Signal listeners at lines 67-68 and infinite `new Promise(() => {})` at line 70 are intentional for a blocking server host.                          | No action; document if a scanner flags it.                                         |

No `findings/*.md` files exist in the unit yet; the table above is the authoritative register for this lane.

## Step 9 Verification and exit

- Static map matches `MODULE-AUDIT.md` §1 (1 file, 73 LOC, 1 export, 0 empty catches, 0 TODOs).
- No Critical findings → no `protocol/reverify.md` is required by the dual-agent protocol, and none was written by this lane.
- Verifier handshake: this unit's primary reviewer for this run is `ax-code-glm`; the other lane (`codex-sol`) is the named verifier. The `agent-protocol.json` written at the unit root records `completedSteps=9`, `reviewer="ax-code-glm"`, `verifier="codex-sol"`, and per-step notes 1–9.
- Files actually read for this review: `packages/ax-code/src/cli/cmd/dre-graph.ts`, `packages/ax-code/src/cli/cmd/dre-graph-server.ts`, `packages/ax-code/src/cli/cmd/session-latest.ts`, `packages/ax-code/src/cli/cmd/cmd.ts`, `packages/ax-code/src/project/instance.ts` (lines 190-219), `packages/ax-code/src/server/server.ts` (lines 345-396), `packages/ax-code/src/cli/boot.ts` (grep), and the `packages/ax-code/test/cli` and `packages/ax-code/test/server` directories (grep for `dre-graph`).

Exit status for the unit: PASS with four non-blocking follow-ups (one MEDIUM test gap, three LOW readability/robustness nits). No blocking issues for the `cli-cmd-dre-graph` gate.
