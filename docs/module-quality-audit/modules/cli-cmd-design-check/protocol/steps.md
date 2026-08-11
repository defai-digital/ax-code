# Nine-step review protocol: cli-cmd-design-check

## Step 1 Scope and entry points

The reviewed unit is `packages/ax-code/src/cli/cmd/design-check.ts`: it exports the single yargs command at line 6, declares `design-check [paths..]` at line 7, and is registered in the executable command list by `packages/ax-code/src/cli/boot.ts:13` and `packages/ax-code/src/cli/boot.ts:104`. The handler delegates scanning and rendering to the design-check package imported at `packages/ax-code/src/cli/cmd/design-check.ts:3`. The audit inventory agrees on this resolved root and export at `docs/module-quality-audit/modules/cli-cmd-design-check/MODULE-AUDIT.md:5-7` and `:26-29`.

## Step 2 Inputs and trust boundaries

Two user-controlled inputs cross the CLI boundary: repeated paths are declared at `packages/ax-code/src/cli/cmd/design-check.ts:11-15`, and repeated rule overrides at `:16-20`. Paths flow into filesystem traversal at `packages/ax-code/src/design-check/index.ts:62-69`; no shell interpolation or network call is involved. Missing paths and unreadable directories/files are deliberately converted to an empty result by catches at `packages/ax-code/src/design-check/index.ts:37`, `:63`, and `:78`. This avoids code execution but can make a bad path indistinguishable from a clean scan unless the caller notices the zero-file summary.

## Step 3 Control-flow correctness

The default path is selected only when no positional paths were supplied (`packages/ax-code/src/cli/cmd/design-check.ts:25`), overrides are parsed at `:28-32`, and errors set a failing process status at `:50-53`. A correctness weakness remains at `:16-20` and `:38`: yargs accepts any string and the handler uses `as any` instead of validating the `Severity` union defined at `packages/ax-code/src/design-check/types.ts:5`. The engine then assigns that unchecked value at `packages/ax-code/src/design-check/index.ts:84-90`, while counting only `error` and `warn` at `:96-99`. Thus an override such as `missing-alt-text=info` can emit a WARN-looking line through `formatResult` (`:129-130`) without incrementing warnings or setting the error exit code. Also, zero scanned files are announced as “No design violations found” at `packages/ax-code/src/cli/cmd/design-check.ts:43-44`, which is a potentially misleading success state.

## Step 4 Resource and performance behavior

The command creates one spinner and awaits one scan (`packages/ax-code/src/cli/cmd/design-check.ts:34-41`), so it does not leak timers or launch unbounded subprocesses. The underlying traversal serially awaits each subdirectory at `packages/ax-code/src/design-check/index.ts:36-46`, and file contents are read and checked sequentially at `:77-92`. Memory grows with the complete path list (`:61-69`) plus violation results (`:73-100`). That is predictable for ordinary source trees, but large monorepos may see avoidable latency because neither traversal nor reads have bounded concurrency.

## Step 5 Ownership and coupling

The wrapper largely keeps CLI concerns local: yargs schema, Clack lifecycle, stdout, summary, and exit status live at `packages/ax-code/src/cli/cmd/design-check.ts:6-54`; rule discovery and file scanning stay in `packages/ax-code/src/design-check/index.ts:56-111`; rule registration is centralized at `packages/ax-code/src/design-check/rules/index.ts:5-12`. The generic `cmd` helper is only a typed identity function (`packages/ax-code/src/cli/cmd/cmd.ts:1-7`). One coupling wrinkle is that `formatResult` embeds ANSI presentation in the engine at `packages/ax-code/src/design-check/index.ts:116-139`, after which the command mixes that stdout output with Clack output at `packages/ax-code/src/cli/cmd/design-check.ts:43-51`.

## Step 6 Maintainability and dead code

Every import in the unit is used: `cmd` defines the export, `UI` adds spacing, the engine supplies scan/format functions, and Clack supplies prompts (`packages/ax-code/src/cli/cmd/design-check.ts:1-4`, `:6`, `:22-23`, `:34-46`). There are no catch blocks, TODO markers, or unreachable branches in this 55-line command. The main maintainability defect is the unchecked cast at `:38`; typed parsing against the five keys in `packages/ax-code/src/design-check/types.ts:7-13` and the three allowed severities at `:5` would remove a hidden contract violation. The parser also silently discards malformed overrides without `=` at `packages/ax-code/src/cli/cmd/design-check.ts:29-32`, offering no feedback to the user.

## Step 7 Test assessment

The module audit lists broad CLI tests at `docs/module-quality-audit/modules/cli-cmd-design-check/MODULE-AUDIT.md:31-46`, but repository search found no test referencing `DesignCheckCommand`, `runDesignCheck`, or the `design-check` command. The related boot test imports only timer/bootstrap helpers at `packages/ax-code/test/cli/boot.test.ts:7-11`; it does not exercise command registration, path defaults, override validation, rendering, or exit codes. Focused tests should cover a clean scan, violations, zero readable files, recognized `off`, invalid severity/key rejection, and `process.exitCode` when errors exist.

## Step 8 Findings and severity decision

The existing register states that no findings were accepted at `docs/module-quality-audit/modules/cli-cmd-design-check/MODULE-AUDIT.md:60-64`, and there are no files under this unit’s `findings/` path. This review found no Critical security or data-loss issue, so `reverify.md` is not required. The unchecked severity/count mismatch described in Step 3 is a non-Critical correctness observation suitable for a follow-up fix; the zero-file success message and absent focused coverage are lower-risk usability and assurance gaps. No separate finding artifact was created because this run was explicitly limited to the three named protocol outputs.

## Step 9 Verification and exit decision

`pnpm --dir packages/ax-code run typecheck` completed with exit code 0. From `packages/ax-code`, `AX_TEST_FILES=test/cli/boot.test.ts pnpm exec vitest run` completed with 1 file and 29 tests passing. Static evidence also confirms the command is wired into yargs through `packages/ax-code/src/cli/boot.ts:216`. The `cli-cmd-design-check` review is complete with no Critical blocker, while the invalid-severity behavior and missing focused tests remain explicitly documented as follow-up risks rather than silently treated as covered.
