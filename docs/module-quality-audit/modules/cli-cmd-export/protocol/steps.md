# Protocol steps — `cli-cmd-export`

Reviewer: ax-code-glm (model `zai-coding-plan/glm-5.2[1m]`)
Unit root: `packages/ax-code/src/cli/cmd/export.ts` (16 LOC lazy proxy)
Verifier lane: codex-sol

## Step 1 Scope and map

The unit slug `cli-cmd-export` resolves to a single file: `packages/ax-code/src/cli/cmd/export.ts` (lines 1–16). It exports one symbol, `ExportCommand` (line 3), which is consumed by `packages/ax-code/src/cli/boot.ts:88` and merged into the yargs command list declared at `boot.ts:80–106`. The handler body (lines 12–15) is a single dynamic `import("./storage/export")` that re-exposes the real implementation at `packages/ax-code/src/cli/cmd/storage/export.ts:12`. The candidate file is therefore a pure indirection layer; all behavior lives in the storage-side command. The `cmd()` helper at `packages/ax-code/src/cli/cmd/cmd.ts:5` (an identity over `CommandModule<T, WithDoubleDash<U>>`) is used by the real command but is **not** used by this proxy — the proxy is an untyped object literal.

## Step 2 Threat and failure model

The proxy itself does not touch the filesystem, network, secrets, or subprocesses — it only forwards `args` to the resolved handler. The interesting risk surface is therefore forwarded risk: at `storage/export.ts:81` the resolved command writes session JSON to `process.stdout`, and at `storage/export.ts:85` it calls `process.exit(1)` inside a broad `catch (error)` (`storage/export.ts:83`) that discards the original error and prints a generic `Session not found` regardless of root cause. The proxy inherits this behaviour verbatim because it simply returns `real.handler(args)`. No try/catch exists at the proxy level, so an `import()` failure (e.g. a native addon load error) would propagate up through `boot.ts`'s yargs dispatcher as an unhandled rejection.

## Step 3 Correctness — control flow

`handler` at `export.ts:12` is `async`, returns the promise of `real.handler(args)`. Because yargs treats a returned promise as the command's completion, the proxy correctly preserves async semantics — there is no fire-and-forget bug here. The dynamic import is cached by the module system, so repeated invocations within one process pay the resolve cost once. `args` is passed through by reference without cloning or mutation, which is fine for yargs' plain object arguments. One subtlety: the proxy returns `real.handler(args)` rather than `await`ing it; this is observationally identical for promise resolution but means stack traces from the inner command retain the proxy frame, which is the desired behaviour for debugging.

## Step 4 Correctness — argument contract

The proxy's `builder` (lines 6–11) redeclares the `[sessionID]` positional with `type: "string"` and the same `describe` text as the real command's builder at `storage/export.ts:15–20`. They are byte-for-byte equivalent today. The drift risk is real: if the storage-side command adds a flag (e.g. `--out`, `--format`) and updates only its own builder, the proxy's `--help` output will silently omit the new option, yet the handler will still receive it because yargs passes through unknown args by default. There is no compile-time guard against this drift because the proxy is an untyped literal.

## Step 5 Performance — lazy loading rationale

The whole point of the indirection is to keep `@clack/prompts`, `../../../session`, `../../../replay/query`, and `../../bootstrap` (all imported at the top of `storage/export.ts:1–10`) off the critical path of CLI startup. This is the same pattern used by sibling commands under `packages/ax-code/src/cli/cmd/` and is the right call for a CLI with ~100 commands. The cost is one extra microtask per invocation of `ax export`, which is dominated by the SQLite session read inside `Session.list()` at `storage/export.ts:32`. No performance finding.

## Step 6 Design — abstraction ownership

The split between `cli/cmd/export.ts` (thin shell) and `cli/cmd/storage/export.ts` (real command) is consistent with neighbouring commands in the same directory (e.g. `db.ts`, `session.ts` likely follow the same shell/impl split). The proxy owns exactly one concern: deferring the import. It does not own argument validation, error formatting, or output. That said, exporting a bare object literal named `ExportCommand` while the real module _also_ exports `ExportCommand` is mildly confusing for grep — a reader landing in `boot.ts:88` sees the import path `./cmd/export` and may not realise the real body lives one directory deeper. A one-line `// lazy proxy — see ./storage/export.ts` comment would pay for itself.

## Step 7 Hygiene and dead code

No dead code, no TODOs, no empty catches in the file under review (confirmed by MODULE-AUDIT line 26: 17 LOC, 0 TODOs, 0 empty catches). The `args: any` annotation at line 12 is the only hygiene nit — sibling lazy proxies in the same folder should be checked for the same pattern; if they all use `any`, a shared `type LazyArgs = Record<string, unknown>` or a re-export of `CommandModule["handler"]`'s arg type would tighten the contract without changing runtime behaviour.

## Step 8 Tests

There is no test file that directly imports `packages/ax-code/src/cli/cmd/export.ts` or `packages/ax-code/src/cli/cmd/storage/export.ts` (grep for `cli/cmd/export`, `cmd/storage/export`, and `ExportCommand` under `packages/ax-code/test` returns zero hits). The MODULE-AUDIT inventory lists `test/cli/boot.test.ts` and `test/cli/audit.test.ts`, but these exercise the boot wiring and the unrelated `audit export` subcommand respectively — neither asserts that `ax export <sessionID>` produces the transfer JSON written at `storage/export.ts:81`. The export path is therefore unverified at the unit and integration level; this is a coverage gap worth flagging to the module owner, though it is not a defect in the proxy file itself.

## Step 9 Verification and exit

The proxy file has no runtime branches of its own beyond the dynamic `import()`, so the actionable verification is a typecheck of the package plus a smoke check that `boot.ts` still resolves the symbol. `pnpm --dir packages/ax-code run typecheck` (tsgo) covers the proxy and the storage-side command together; `pnpm run test:scripts` exercises `boot.ts`-adjacent scripts. No Critical findings were produced in this pass, the `findings/` directory is empty, and the verifier lane (codex-sol) is recorded in `agent-protocol.json` for the second-pass check. Exit checklist: proxy scope mapped, no Critical findings, no `reverify.md` required.
