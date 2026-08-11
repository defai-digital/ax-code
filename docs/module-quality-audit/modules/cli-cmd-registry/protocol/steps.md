# Nine-step review protocol — `cli-cmd-registry`

This review covers the type-level command adapter in `packages/ax-code/src/cli/cmd/cmd.ts` and follows its contract into the yargs bootstraps and the two consumers of the double-dash value.

## Step 1 Scope and interface map

The unit has one public function, `cmd`, and one private generic intersection, `WithDoubleDash` (`packages/ax-code/src/cli/cmd/cmd.ts:3-6`). The helper accepts a yargs `CommandModule` and returns that same module; it does not itself own the command array or command registration. The one-file boundary agrees with the inventory in `docs/module-quality-audit/modules/cli-cmd-registry/MODULE-AUDIT.md:20-29`. Actual registration occurs later when the main bootstrap iterates its command list (`packages/ax-code/src/cli/boot.ts:60-106`, `:216`).

## Step 2 Trust and failure boundaries

`cmd` performs no I/O, process mutation, credential access, execution, or validation: its only runtime statement returns `input` (`packages/ax-code/src/cli/cmd/cmd.ts:5-6`). The `"--"` tail is nevertheless user-controlled CLI input. It is populated by yargs in the bootstrap (`packages/ax-code/src/cli/boot.ts:164-168`) and later incorporated into the run prompt (`packages/ax-code/src/cli/cmd/run.ts:381-383`). Consequently this helper must describe parser output accurately, but escaping, authorization, and prompt handling remain consumer responsibilities.

## Step 3 Type and runtime correctness

The declared `"--"?: string[]` contract is unsound (`packages/ax-code/src/cli/cmd/cmd.ts:3`). With the configured `populate--` behavior (`packages/ax-code/src/cli/boot.ts:164-168`), the installed yargs also applies numeric coercion: parsing `run -- 123` produces `{"--":[123]}`. That value reaches `RunCommand`, whose mapper calls `arg.includes(...)` (`packages/ax-code/src/cli/cmd/run.ts:381-383`), causing `TypeError: arg.includes is not a function`. `HeadlessRunCommand` merely joins the same tail (`packages/ax-code/src/cli/cmd/headless-run.ts:126`), so its coercion is observable but does not crash at that line. This is a reproducible Medium correctness defect in the helper's advertised type.

## Step 4 Cost and resource behavior

At runtime the adapter is constant-time and allocation-free because it returns the supplied command object directly (`packages/ax-code/src/cli/cmd/cmd.ts:5-6`); the generic intersection on line 3 is erased. It creates no cache, timers, listeners, or retained collections. Command-list traversal belongs to the bootstrap (`packages/ax-code/src/cli/boot.ts:216`) and is outside the helper, so no performance or resource-bound finding is warranted for this unit.

## Step 5 Ownership and API design

Keeping the yargs typing workaround adjacent to command definitions is cohesive: command modules import `cmd` and receive contextual handler typing, as shown by `RunCommand` (`packages/ax-code/src/cli/cmd/run.ts:265-269`). The boundary is not end-to-end type-safe, however, because both bootstraps cast every module to `never` when registering it (`packages/ax-code/src/cli/boot.ts:216`; `packages/ax-code/src/cli/boot-node.ts:116`). The helper should model the parser's real tail element type, or the parser should disable numeric coercion, rather than grant every command a stronger string-only guarantee.

## Step 6 Maintenance and defensive behavior

The implementation has no branch, catch, suppression comment, or unused runtime state; its six substantive lines make the identity behavior evident (`packages/ax-code/src/cli/cmd/cmd.ts:1-6`). The private `WithDoubleDash` alias avoids exporting an implementation detail, but its name does not communicate yargs coercion and its element type masks that behavior (`packages/ax-code/src/cli/cmd/cmd.ts:3`). A focused type/runtime contract test would be more valuable than extra defensive code inside an identity function.

## Step 7 Test evidence and gaps

The smoke suite exercises strict handling for an unknown top-level option (`packages/ax-code/test/cli/smoke.test.ts:114-124`) and one `run` invocation containing `--` followed by an empty string (`packages/ax-code/test/cli/smoke.test.ts:136-153`). The latter stays a string and therefore does not cover yargs numeric coercion. No direct test of `cmd` or numeric post-separator input was found among the reviewed CLI tests; the existing boot tests concentrate on environment and lifecycle helpers (`packages/ax-code/test/cli/boot.test.ts:17-37`, `:146-165`). This gap explains why typecheck and the focused smoke case both pass despite Step 3's runtime failure.

## Step 8 Finding disposition

No `findings/` directory or finding file exists for `cli-cmd-registry`, and the current register says `_none accepted_` (`docs/module-quality-audit/modules/cli-cmd-registry/MODULE-AUDIT.md:60-64`). This review records one new Medium correctness finding: `WithDoubleDash` promises strings although yargs can return numbers, leading `RunCommand` to crash on numeric tail arguments (`packages/ax-code/src/cli/cmd/cmd.ts:3`; `packages/ax-code/src/cli/cmd/run.ts:381-383`). No Critical item exists, so the Critical-only secondary-confirmation artifact is not created.

## Step 9 Executed verification

`pnpm --dir packages/ax-code run typecheck` completed successfully, validating that the current annotation is accepted by the compiler. `AX_TEST_FILES=test/cli/smoke.test.ts pnpm exec vitest run -t 'run --file resolves relative paths from AX_CODE_ORIGINAL_CWD'` passed one test with twelve skipped, covering the case at `packages/ax-code/test/cli/smoke.test.ts:136-153`. A read-only Node/yargs probe using the same parser setting as `packages/ax-code/src/cli/boot.ts:164-168` produced `{"_":["run"],"--":[123],"$0":""}` and then reproduced the `TypeError` from the mapping operation corresponding to `packages/ax-code/src/cli/cmd/run.ts:381-383`. Reviewer is `codex-sol`; the assigned verifier is `ax-code-glm`.
