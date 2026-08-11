# Protocol Steps: cli-cmd-capability

Reviewer: ax-code-glm (model `zai-coding-plan/glm-5.2[1m]`)
Unit root: `packages/ax-code/src/cli/cmd/capability.ts` (single source file, 54 LOC, 2 exports)
Baseline commit: `cab6c0089e3b7b3410f050bc9d824c06a3c3a814`

## Step 1 Scope and map

The unit `cli-cmd-capability` resolves to exactly one file:
`packages/ax-code/src/cli/cmd/capability.ts`. It exports two symbols:
`formatCapabilityList@packages/ax-code/src/cli/cmd/capability.ts:7` (a pure
formatter) and `CapabilityCommand@packages/ax-code/src/cli/cmd/capability.ts:48`
(the yargs parent command). The command is registered in the CLI root at
`packages/ax-code/src/cli/boot.ts:77` alongside sibling commands
(GenerateCommand, AgentCommand, etc.). The parent command exposes one
subcommand, `CapabilityListCommand@capability.ts:21` (`capability list`).
Dependencies pulled in: `os.EOL`, yargs `Argv`, `../../capability`
(`Capability.Info` / `Capability.list`), `../bootstrap` (Instance lifecycle),
and the local `./cmd` identity helper at `packages/ax-code/src/cli/cmd/cmd.ts:5`.

## Step 2 Threat and failure model

The handler writes to `process.stdout` (capability.ts:40 and :43). The payload
originates from `Capability.list` (`packages/ax-code/src/capability/index.ts:33`),
which embeds filesystem `location` strings (e.g. capability/index.ts:181 and
:158 `template.path`). These are repository paths, not secrets — no credential,
env, or token material is surfaced. Input trust: `process.cwd()` (capability.ts:35)
and the `--file` option (capability.ts:30-33 and :37) are both operator-supplied
CLI args; there is no network surface and no untrusted remote input. The
`bootstrap` wrapper (`packages/ax-code/src/cli/bootstrap.ts:9-14`) guarantees
`Instance.dispose()` runs in a `finally`, so a throw inside `Capability.list`
cannot leak an undisposed Instance.

## Step 3 Correctness of the execution path

Tracing `CapabilityListCommand.handler` (capability.ts:34-45): it awaits
`bootstrap(process.cwd(), cb)`, calls `Capability.list({ filePaths })`, then
branches on `args.json`. The JSON branch (capability.ts:39-42) serialises the
raw `capabilities` array and returns early; the text branch (capability.ts:43)
delegates to `formatCapabilityList`. The cast at capability.ts:37
`(args.file as string[] | undefined)?.map(String)` is defensive: yargs
`type: "array"` already yields `string[] | undefined`, so the cast is logically
a no-op, and `.map(String)` normalises any non-string element that yargs may
have produced. Empty-array input flows into `Capability.list` which treats it
as "no path filter" via `input.filePaths ?? []` (capability/index.ts:51), so
`--file` with zero values behaves identically to omitting the flag — correct.

## Step 4 Performance and resource use

The unit itself is trivially cheap (string format + one stdout write). The
real cost lives in `Capability.list`, which already parallelises its six
sub-queries with `Promise.all` (capability/index.ts:34-41), so the CLI does
not serialise disk reads. `formatCapabilityList` (capability.ts:7-19) is O(n)
with a single `.map`/`.join`/`.concat`; the fixed-width `.padEnd` calls are
O(cell-width) and do not scale with capability count. No N+1 pattern, no
unbounded buffering, no listener/timer allocation in this file.

## Step 5 Design and boundary clarity

The split is clean: `formatCapabilityList` is a pure function exported
separately (capability.ts:7) precisely so it can be unit-tested without
booting an Instance — and `test/cli/capability.test.ts:2` imports exactly
that export. The `cmd()` helper (`packages/ax-code/src/cli/cmd/cmd.ts:5`) is
a zero-cost identity wrapper used purely for `WithDoubleDash<U>` typing
consistency across all CLI subcommands. The parent `CapabilityCommand`
(capability.ts:48-52) uses an intentionally-empty `async handler() {}` plus
`.demandCommand()`, which is the correct yargs idiom for "delegate to
subcommand and error if none given". No layer violation: this CLI layer
imports the domain `Capability` namespace but never touches storage, DB, or
provider internals directly.

## Step 6 Dead code, duplication, and hygiene

No TODOs, no commented-out blocks, no unreachable branches. Both exports are
consumed (`CapabilityCommand` at boot.ts:77; `formatCapabilityList` at
test/cli/capability.test.ts:2). The `EOL` import (capability.ts:1) is used
three times (:8, :17, :18). The empty parent handler (capability.ts:52) is
idiomatic, not dead. The only stylistic nit is the redundant cast at
capability.ts:37 (already typed by yargs), but it is harmless and arguably
defensive against yargs' historically loose typing.

## Step 7 Test coverage and gaps

`packages/ax-code/test/cli/capability.test.ts` (35 lines) exercises
`formatCapabilityList` with two fixtures covering the `ok`/`warn` status
branches, the `sourceTool/scope` suffix assembly (capability.ts:12-13), and
the `padEnd` column widths. **Gap:** the `handler` body (capability.ts:34-45)
— including the JSON output branch (capability.ts:39-42), the `bootstrap`
wiring, and the `--file` mapping — has no direct unit test in this file; it
is exercised only indirectly by CLI smoke/integration tests. The JSON branch
in particular is a one-line `JSON.stringify(capabilities, null, 2)` that is
never asserted on, so a regression that dropped the `args.json` early-return
(:41) would not be caught here. Severity: LOW (the underlying `Capability.list`
is tested elsewhere; only the thin CLI adapter is untested).

## Step 8 Finding register

Only one LOW-severity item is accepted for this unit:

- LOW — `handler`/JSON-output branch in `capability.ts:34-45` has no direct
  unit test; `formatCapabilityList` is the only symbol covered by
  `test/cli/capability.test.ts`. Suggested action: add a test that invokes
  the handler (or extracts the output-decision logic) to lock in the
  `--json` early-return and the stdout payload.
  No Critical, High, or Medium findings. No security, correctness, or
  resource-leak defects identified. The redundant cast at capability.ts:37 is
  noted as INFO only — not promoted to a finding.

## Step 9 Verification and exit

Independent re-read of evidence performed against
`packages/ax-code/src/cli/cmd/capability.ts`, `packages/ax-code/src/cli/cmd/cmd.ts`,
`packages/ax-code/src/cli/bootstrap.ts`, `packages/ax-code/src/capability/index.ts`,
and `packages/ax-code/test/cli/capability.test.ts`. The unit is small, the
abstractions are appropriate to the problem size, and no over-engineering or
under-engineering is present. Recommended project verification before
sign-off: `pnpm --dir packages/ax-code run typecheck` and
`pnpm --dir packages/ax-code run test:unit` scoped to
`test/cli/capability.test.ts`. With the LOW finding recorded above, the unit
is acceptable for sign-off; the test-coverage gap is a follow-up, not a
blocker.
