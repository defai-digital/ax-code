# Review Protocol — cli-cmd-pr

Unit: `cli-cmd-pr`  
Reviewer: `codex-sol` (`gpt-5.6-sol-xhigh`)  
Independent verifier: `ax-code-glm`

## Step 1 Scope and entry-point reachability

The unit exports one yargs command object, `PrCommand`, from `packages/ax-code/src/cli/cmd/pr.ts:3-15`. The production CLI imports that object at `packages/ax-code/src/cli/boot.ts:34` and includes it in the registered command array at `packages/ax-code/src/cli/boot.ts:95`; the loop at `packages/ax-code/src/cli/boot.ts:216` passes it to yargs. The wrapper therefore has a live public route rather than being an orphaned compatibility file.

## Step 2 Inputs and trust boundaries

The wrapper accepts a required numeric positional named `number` at `packages/ax-code/src/cli/cmd/pr.ts:4-11` and forwards the parsed argv object at `packages/ax-code/src/cli/cmd/pr.ts:12-14`. The delegated handler places the value into argument arrays for `gh pr checkout` and `gh pr view` at `packages/ax-code/src/cli/cmd/github-agent/pr.ts:69-96`. `Process.spawn` passes the executable and argument slice separately to `cross-spawn` at `packages/ax-code/src/util/process.ts:108-119`, so the PR value is not evaluated as shell source.

## Step 3 Parsing and delegation correctness

The command spelling and positional shape in the wrapper (`packages/ax-code/src/cli/cmd/pr.ts:4-11`) match the real command (`packages/ax-code/src/cli/cmd/github-agent/pr.ts:50-58`), and the async handler returns the real handler's promise at `packages/ax-code/src/cli/cmd/pr.ts:12-14`, preserving rejection and exit behavior. A Low input-quality gap remains: neither builder checks that the number is a positive integer, even though the downstream branch name and GitHub request assume a PR identifier (`packages/ax-code/src/cli/cmd/github-agent/pr.ts:69-82`). Negative, zero, or fractional input therefore reaches `gh` and receives the generic installed/authenticated error.

## Step 4 Runtime cost and lifecycle

Static command discovery loads only the yargs type and the small object in `packages/ax-code/src/cli/cmd/pr.ts:1-15`; the GitHub, project, git, shell, and process dependencies are deferred until the dynamic import at line 13. Once invoked, the real handler waits for checkout before querying PR metadata (`packages/ax-code/src/cli/cmd/github-agent/pr.ts:73-102`), then waits for the child `ax-code` process and removes signal handlers in a `finally` block (`packages/ax-code/src/cli/cmd/github-agent/pr.ts:133-155`). No polling, unbounded collection, or wrapper-owned resource survives the call.

## Step 5 Ownership and API shape

The wrapper owns startup-friendly command metadata while `packages/ax-code/src/cli/cmd/github-agent/pr.ts:59-158` owns repository mutation and child-process lifecycle. That split follows the same lazy façade pattern used by `packages/ax-code/src/cli/cmd/export.ts:3-15` and `packages/ax-code/src/cli/cmd/serve.ts:4-15`. The tradeoff is duplicated metadata: the wrapper says “PR Branch” at `packages/ax-code/src/cli/cmd/pr.ts:5`, while the real command says “PR branch” at `packages/ax-code/src/cli/cmd/github-agent/pr.ts:52`. Keeping the façade intentionally minimal limits the consequence to help-text drift.

## Step 6 Maintainability and failure propagation

The candidate has no local catch, fallback, mutable state, or abandoned branch: import failure and delegated-handler failure both reject through the returned promise at `packages/ax-code/src/cli/cmd/pr.ts:12-14`. Its explicit `args: any` at line 12 is weaker than the `cmd` helper's `CommandModule` contract in `packages/ax-code/src/cli/cmd/cmd.ts:1-6`, leaving the duplicated façade unchecked against the implementation's inferred positional type. This is a maintainability note, alongside the capitalization drift, rather than an observed runtime defect.

## Step 7 Behavioral coverage

The focused test file exercises valid decoding, malformed optional fields, null/array rejection, valid JSON, and invalid JSON at `packages/ax-code/test/cli/github-agent-pr.test.ts:4-50`. Those tests cover helpers used after `gh pr view`, but they do not import `packages/ax-code/src/cli/cmd/pr.ts` or assert lazy delegation, yargs help metadata, positive-integer validation, checkout failure mapping, or signal cleanup. The wrapper is typechecked through the package build, but a small command-contract test would protect its duplicated metadata and forwarding behavior.

## Step 8 Register reconciliation and severity

The existing audit names `PrCommand` at `docs/module-quality-audit/modules/cli-cmd-pr/MODULE-AUDIT.md:20-29` and records no accepted finding at lines 60-64. There is no `findings/` file for this unit. This pass found no Critical, High, or Medium issue; it records the missing positive-integer constraint from `packages/ax-code/src/cli/cmd/pr.ts:7-11` as a Low advisory and treats the untested metadata duplication as a coverage note. Because there is no Critical evidence, the conditional secondary-confirmation artifact is not created.

## Step 9 Verification and reviewer outcome

From `packages/ax-code`, `AX_TEST_FILES=test/cli/github-agent-pr.test.ts pnpm exec vitest run` passed one file and all three tests; the exercised assertions are at `packages/ax-code/test/cli/github-agent-pr.test.ts:5-50`. From the repository root, `pnpm --dir packages/ax-code run typecheck` also passed, covering the wrapper imported by `packages/ax-code/src/cli/boot.ts:34`. The `cli-cmd-pr` primary review is complete with one Low validation advisory, no blocking issue, and independent verifier lane `ax-code-glm` still responsible for its separate sign-off.
