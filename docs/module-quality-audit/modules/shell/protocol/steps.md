# shell — 9-Step Review (ax-code-glm)

Unit slug: `shell`
Source root: `packages/ax-code/src/shell/shell.ts` (110 lines, single file)
Reviewer: ax-code-glm · Model: zai-coding-plan/glm-5.2[1m]

---

## Step 1 Scope and Map

The `shell` unit is a single-file namespace (`packages/ax-code/src/shell/shell.ts:15` `export namespace Shell`) exposing five members: `killTree` (`:16`), `isAcceptable` (`:63`), `preferred` (`:93`), `acceptable` (`:98`), and the private helpers `shellName`/`fallback`/`resolveShellFromEnv`. Dependencies are tight and local: `@/flag/flag` (Flag.AX_CODE_GIT_BASH_PATH, read once at module load via `flag.ts:54`), `@/util/lazy`, `@/util/filesystem` (only `stat`), `@/util/which`, plus node `child_process.spawn` and `path`. No transitive subsystem coupling — this is a leaf utility consumed by 17 call sites across `pty/`, `tool/bash-impl.ts`, `tool/bash-background.ts`, `provider/cli/cli-language-model.ts`, `session/prompt-shell-command.ts`, `lsp/*`, `mcp/impl.ts`, `util/process.ts`, and `cli/cmd/tui/thread.ts`. Tests covering the unit directly: `test/shell/shell.test.ts` (blacklist + extension casing), plus indirect coverage in `test/runtime/shell-env.test.ts`, `test/session/prompt-shell-command.test.ts`, `test/util/shell-args.test.ts`.

## Step 2 Threat and Failure Model

The unit's risk surface is process lifecycle, not data. `killTree` (`shell.ts:16-55`) manipulates process groups via `process.kill(-pid, signal)` (`:37`) and escalates to SIGKILL after `SIGKILL_TIMEOUT_MS = 200` (`:9`, `:38-41`). Failures modes I traced: (a) `ESRCH` when the pid already exited — handled by the catch at `:42` then the inner catch at `:51`; (b) `EPERM` when `-pid` is not a group leader (child not spawned detached) — same catch falls back to `proc.kill(signal)` at `:46`, which only reaches the direct child; (c) win32 path uses `taskkill /f /t` (`:26`) and resolves on exit/error so a missing taskkill cannot hang. Secrets handling is not this unit's responsibility — `session/prompt-shell-command.ts:78-82` documents the env sanitization that happens at the spawn boundary, not here.

## Step 3 Correctness of Public Surfaces

`killTree` correctness depends on a contract that is enforced by callers, not by the unit. The negative-pid group kill at `shell.ts:37` only kills the whole tree if the child was spawned as a session/group leader. I confirmed the spawn contract is honored at the major call sites: `tool/bash-impl.ts:756` and `:776` set `detached: process.platform !== "win32"`; `session/prompt-shell-command.ts:84` does the same; `tool/bash-impl.ts:760-766` instead uses `setsid` (which creates its own session) with `detached: false`, so the negative-pid kill still targets the right group. The one asymmetric caller is `mcp/impl.ts:64-76` `killProcessTree`, whose custom `kill` closure calls `process.kill(pid, signal)` (positive pid) — so on the fallback branch (`shell.ts:46`) MCP degrades to direct-only kill and could orphan MCP server children. `preferred`/`acceptable` are correct: `preferred` (`:93`) honours a non-empty `configShell` verbatim, while `acceptable` (`:98-103`) routes blacklisted config through the env-resolved fallback. `isAcceptable` (`:63`) delegates to `shellName` (`:58-61`) which correctly strips `.exe/.cmd/.bat/.com` case-insensitively on win32 and lowercases — matching the assertions in `test/shell/shell.test.ts:6-16`.

## Step 4 Performance and Resource Use

No hot loops; the unit is invoked at most a handful of times per session. `killTree` introduces two fixed 200ms `sleep` windows (`SIGKILL_TIMEOUT_MS`, `:9`) per escalation, so worst-case teardown of a stubborn tree is ~400ms (SIGTERM → sleep → SIGKILL) plus another ~200ms if it falls into the inner fallback at `:47-50`. `_preferred` and `_acceptable` (`:85-91`) are wrapped in `lazy()` so `which()` / `process.env.SHELL` lookups happen exactly once per process — appropriate because shell resolution is process-stable. One nit: `lazy` exposes a `.reset()` (`util/lazy.ts:24-27`) that `shell.ts` never calls, so tests that mutate `process.env.SHELL` after first resolution cannot invalidate the cache without touching internals.

## Step 5 Design and Cohesion

Cohesion is high — every member relates to "pick a shell or stop a process tree", which is a reasonable pairing for a small leaf utility. The `KillableProcess` structural type (`:10-13`) is the right minimal abstraction: `{ pid?, kill() }` matches both real `ChildProcess` and the MCP shim. The blacklist as a `Set` (`:56`) plus the win32/posix split inside `shellName`/`fallback` keeps platform branches localized rather than smeared across callers. The `preferred` vs `acceptable` asymmetry (the former does not apply the blacklist, the latter does) is deliberate — the interactive PTY at `pty/index.ts:403` uses `preferred()` so a fish user keeps their interactive shell, while the scripted bash tool at `tool/bash-impl.ts:211` uses `acceptable()` to avoid fish-incompat script execution — but this intent is not stated in the source and is a future trap for a reader who assumes the two are interchangeable.

## Step 6 Dead Code, Hygiene, and Duplication

No dead exports — all five public members have live callers (grep over `src/` returned 17 reference sites). The two `catch` blocks at `:42` and `:51` are intentionally silent and carry explanatory comments (`:43-44`, `:52`); they are not "empty" in the negligence sense — both ESRCH (already exited) and EPERM (not a group leader) are expected and the control flow falls through to the right behaviour. The magic constants are localized: `SIGKILL_TIMEOUT_MS = 200` (`:9`) and the Windows extension regex (`:60`). The git-bash relative path computation at `:74` (`path.join(git, "..", "..", "bin", "bash.exe")`) is the only fragile literal — it hard-codes the `Git\cmd\git.exe` ⇒ `Git\bin\bash.exe` install layout, but it is a best-effort heuristic with `process.env.COMSPEC || "cmd.exe"` as the safe final fallback (`:77`), so failure is graceful rather than dangerous.

## Step 7 Tests and Coverage

Direct coverage in `test/shell/shell.test.ts` exercises `isAcceptable` across win32/posix and confirms case-insensitive extension stripping (`shell.test.ts:5-17`) — this is the only test that imports the `Shell` namespace directly. `killTree` has no dedicated unit test; it is exercised indirectly through `test/session/prompt-shell-command.test.ts` (which mocks `spawn` and asserts signal-exit handling at `prompt-shell-command.test.ts:39-83`) and `test/runtime/shell-env.test.ts` (login-shell timeout release). The blacklist set is fully covered; the lazy reset path, the win32 `taskkill` branch, and the `EPERM`/`ESRCH` fallback at `shell.ts:42-54` have no test coverage — acceptable for a leaf utility but worth noting if process-tree leaks are ever reported in the field.

## Step 8 Findings Register

No Critical or High findings. Dispositions:

- **MEDIUM — killTree EPERM fallback degrades to direct-only kill.** `shell.ts:42-54`. When the spawned child is not a process-group leader, `process.kill(-pid)` throws EPERM and the fallback `proc.kill(signal)` (`:46`) only reaches the direct child, leaving grandchildren orphaned. The contract is met by every in-repo caller I audited (`tool/bash-impl.ts:756,760-776`, `session/prompt-shell-command.ts:84`), but `mcp/impl.ts:64-76`'s custom positive-pid `kill` closure is the one place where the fallback cannot reach descendants. Recommendation: document the "must be spawned detached or under setsid" precondition in the `killTree` docblock, and consider having the MCP shim pass `process.kill(-pid, …)` to preserve group semantics.
- **LOW — Windows git-bash heuristic hard-codes install layout.** `shell.ts:70-77`. Relative `../../bin/bash.exe` assumes the standard `Git\cmd\git.exe` layout; falls back to `COMSPEC`/`cmd.exe` gracefully, so impact is "wrong bash on non-standard installs" not a crash. Override already exists via `Flag.AX_CODE_GIT_BASH_PATH` (`:69`).
- **LOW — lazy caches never reset; no test seam.** `shell.ts:85-91`. `lazy.reset()` (`util/lazy.ts:24`) is unused here, so env-mutating tests cannot invalidate `_preferred`/`_acceptable`. Not a runtime bug; only a test ergonomics gap.
- **INFO — preferred/acceptable blacklist asymmetry is undocumented.** `shell.ts:93-103`. Intentional (interactive vs scripted), but a one-line comment at each call site or in the namespace header would prevent future misuse.

## Step 9 Verification and Exit

Findings ledger is consistent with the (empty) `findings/` directory and the `MODULE-AUDIT.md` register row ("_none accepted_"). No Critical findings ⇒ no `reverify.md` required by the dual-agent gate. Source read in full (`packages/ax-code/src/shell/shell.ts:1-110`); cross-referenced callers `tool/bash-impl.ts:200-240,750-850`, `session/prompt-shell-command.ts:55-90`, `mcp/impl.ts:55-80`, plus `util/lazy.ts`, `util/which.ts`, `flag/flag.ts:53-63`, and the four test files listed in Step 1. Independent verifier: codex-sol. Status: review complete, awaiting verifier confirmation.
