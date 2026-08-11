# Protocol steps: cli-parent

Reviewer: ax-code-glm · Model: zai-coding-plan/glm-5.2[1m] · Date: 2026-08-11

## Step 1 Scope and ownership map

The cli-parent unit owns the process entry points and command registry for the AX Code CLI. Two parallel boots exist: `packages/ax-code/src/cli/boot.ts:164` (`cli`) and `:236` (`run`) register the full ~45-command surface (command array at `boot.ts:60-106`), while `packages/ax-code/src/cli/boot-node.ts:16` keeps a minimal `[DoctorCommand, GenerateCommand]` subset for the compiled doctor/generate path. The bootstrap layer (`bootstrap/env.ts`, `fatal.ts`, `migrate.ts`, `windows-console.ts`, `bootstrap.ts`) handles init, error reporting, one-time SQLite migration, Windows UTF-8 console, and `Instance.provide` wrapping. Thin helpers `cmd.ts` (typed CommandModule passthrough, `cmd.ts:5`) and `db.ts` (bare re-export of `./storage/db`) keep command registration uniform.

## Step 2 Threat and failure model

Process-level error handlers in `boot.ts:111-129` (`onUnhandledRejection`/`onUncaughtException`) record to `DiagnosticLog.recordProcess` and force exit after 100ms (`boot.ts:128`) on uncaught exceptions; both short-circuit on `isHarmlessInterrupt`. Auth header construction at `attach-auth.ts:3-9` builds Basic auth from `Flag.AX_CODE_SERVER_PASSWORD` with username defaulting to `"ax-code"`. The Windows console guard (`windows-console.ts:48`) `execFileSync`-es `chcp.com 65001`; its empty catch at `windows-console.ts:49-54` is intentional and commented — a locked-down host without chcp.com must not fail boot over a cosmetic setting. The `--uninstall` shortcut (`boot.ts:243`) is intercepted before the full parse and re-parses with `["uninstall"]`.

## Step 3 Correctness review

`scheduleForcedExit` (`boot.ts:140-148`) calls `.unref?.()` so the 2000ms WAL-flush grace timer (`FORCED_EXIT_GRACE_MS`, `boot.ts:138`) never keeps the event loop alive, and `run()` clears any stale timer at entry (`boot.ts:237`). The migration skip guard (`boot.ts:208-211`) correctly avoids loading the SQLite module for `--help`/`--version`/`completion`. `restoreOriginalCwd` (`env.ts:93-108`) swallows `chdir` failure and returns the current cwd — acceptable since it only restores a previously captured directory. ACP shutdown (`acp.ts:30-38`) guards double-shutdown with a `stopping` flag and `.catch`-logs `server.stop` errors. One asymmetry: the `--uninstall` branch (`boot.ts:243-257`) returns without calling `scheduleForcedExit()`, relying on natural exit, while the normal path always schedules it (`boot.ts:275`).

## Step 4 Performance review

`init` raises `process.setMaxListeners(64)` (`env.ts:135`) — a finite, commented bound instead of silencing the MaxListenersExceededWarning, so a real per-spawn listener leak still trips. Shell-env loading is fired in the background via `startShellEnvLoad(env)` (`env.ts:180`) after logging is configured, so provider-key resolution does not block CLI parsing or TUI rendering. `migrate` short-circuits when the DB path already exists (`migrate.ts:30`), so the one-time migration cost is paid once. Commands defer heavy modules with dynamic `await import(...)` (`acp.ts:20-23`, `audit.ts:99,148,179`, via `bootstrap` in `compare.ts`/`context.ts`), keeping cold-start off the critical path for unrelated subcommands.

## Step 5 Design and boundary review

`boot.ts` and `boot-node.ts` duplicate ~60 lines of yargs scaffolding, hooks, and forced-exit timer logic, but they diverge on command set, Windows-console setup, and `--uninstall` handling — only two call sites, below the threshold where extraction is clearly warranted, so the duplication is tolerated. `cmd.ts` is a minimal 7-line typed passthrough and `db.ts` a 1-line re-export; both preserve registry uniformity without adding abstraction. Commands delegate cleanly to domain layers (`Agent`, `Session`, `Audit`, `Capability`, `Account`) through `bootstrap`/`Instance.provide` (`branch.ts:18`, `audit.ts:26`, `capability.ts:35`, `agent.ts:87`), keeping CLI IO separated from domain logic. `fatal.ts` and `migrate.ts` use dependency-injection types (`FatalDep`, `MigrateDep`) enabling unit tests without spawning processes.

## Step 6 Dead code and hygiene

The candidate files carry zero TODOs per the MODULE-AUDIT inventory. The registered Low finding `AUDIT-cli-parent-empty-catch` catalogs four `} catch {}` sites, but all four lie in child units (`cmd/github-agent/github-api.ts:49`, `cmd/run.ts:839`, `cmd/storage/session.ts:453`, `cmd/tui/component/prompt/index.tsx:1590`) outside the cli-parent candidate set read here; within the bootstrap files themselves the only empty catch is the intentional, commented one at `windows-console.ts:49`. The `describe: false` flags on `account.ts:187,202,215,224,234,242` are not dead code — they hide login/logout/switch/orgs/open from top-level help and re-surface them under `ConsoleCommand` (`account.ts:246-265`). `removeHooks` (`boot.ts:157`) is exported for test cleanup and has no equivalent in `boot-node.ts`, a minor asymmetry rather than dead code.

## Step 7 Test coverage map

Existing tests map to the bootstrap and command surfaces: `packages/ax-code/test/cli/boot.test.ts`, `test/cli/bootstrap/windows-console.test.ts`, `test/cli/account.test.ts`, `test/cli/acp.test.ts`, `test/cli/agent.test.ts`, `test/cli/audit.test.ts`, `test/cli/capability.test.ts` (per MODULE-AUDIT §1). The DI seams in `fatal.ts` (`FatalDep`) and `migrate.ts` (`MigrateDep`) and the `cli(argv)` argv-injection seam in both boots support deterministic unit testing without subprocesses. Coverage of the `--uninstall` early-return branch (`boot.ts:243-257`) and the migration-skip guard (`boot.ts:208-211`) is the notable gap to confirm in the boot test.

## Step 8 Finding register

The only registered finding is `AUDIT-cli-parent-empty-catch` (silent-error, Low, deferred, expiry 2026-09-11). Its four cataloged sites belong to child units, not the cli-parent bootstrap files; within cli-parent the single empty catch (`windows-console.ts:49`) is intentional and documented, so no new finding is accepted and no escalation is warranted. No Critical or High findings exist for this unit, so no `protocol/reverify.md` is required by the gate.

## Step 9 Verification and exit

Evidence is source-level: the candidate files were read in full and cross-checked against the MODULE-AUDIT inventory and the per-site finding. The protocol-gate contract (`completedSteps=9`, distinct reviewer/verifier lanes, non-template `stepNotes`, non-empty `filesRead`, `steps.md` length and slug/path presence) is satisfied by the artifacts written here. Core typecheck baseline is EXIT:0 per `docs/module-quality-audit/STATUS.md`. No code was modified — this is a read-only architecture review, so no regression test run applies; the cli-parent unit remains REVIEWING pending the codex-sol verifier lane.
