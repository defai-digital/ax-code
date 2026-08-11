# Nine-step review: cli-cmd-github-agent

## Step 1 Scope and entry surfaces

The review covered the command aggregator, installer, action runner, PR checkout command, Git helpers, GitHub client helpers, prompt construction, and shared data contracts. The public CLI wiring is visible in `packages/ax-code/src/cli/cmd/github-agent/index.ts:15`, while the three operational surfaces begin at `packages/ax-code/src/cli/cmd/github-agent/install.ts:27`, `packages/ax-code/src/cli/cmd/github-agent/run.ts:122`, and `packages/ax-code/src/cli/cmd/github-agent/pr.ts:50`. This establishes the actual `cli-cmd-github-agent` boundary rather than treating nearby generic CLI modules as part of the unit.

## Step 2 Trust boundaries and credentials

Mock event JSON and an optional PAT enter through `packages/ax-code/src/cli/cmd/github-agent/run.ts:127`, and production identity is exchanged for an installation token at `packages/ax-code/src/cli/cmd/github-agent/run.ts:206`. The exchange uses bearer authorization in `packages/ax-code/src/cli/cmd/github-agent/github-api.ts:33`, collaborator authorization is limited to `admin` or `write` at `packages/ax-code/src/cli/cmd/github-agent/github-api.ts:78`, and attachment URLs require HTTPS plus the exact `github.com` host at `packages/ax-code/src/cli/cmd/github-agent/prompts.ts:32`. The subsequent pinned fetch at `packages/ax-code/src/cli/cmd/github-agent/prompts.ts:140` is an appropriate SSRF control.

## Step 3 Event routing and preconditions

Supported event names are rejected before payload routing at `packages/ax-code/src/cli/cmd/github-agent/run.ts:150`; issue numbers are then derived separately for repository, issue, PR, and review-comment events at `packages/ax-code/src/cli/cmd/github-agent/run.ts:177`. Repository events create a branch and optionally a PR at `packages/ax-code/src/cli/cmd/github-agent/run.ts:252`, same-repository and fork PRs split at `packages/ax-code/src/cli/cmd/github-agent/run.ts:280`, and issue work starts at `packages/ax-code/src/cli/cmd/github-agent/run.ts:312`. The branch-switch checks prevent infrastructure pushes after the agent moves itself to another branch.

## Step 4 Git mutation and cleanup

All Git execution is cwd-scoped and nonzero exits become `RunFailedError` in `packages/ax-code/src/cli/cmd/github-agent/git-ops.ts:10`; dirty-state detection distinguishes branch switches, worktree changes, and new commits at `packages/ax-code/src/cli/cmd/github-agent/git-ops.ts:119`. A material cleanup gap remains: `packages/ax-code/src/cli/cmd/github-agent/run.ts:349` calls restoration whenever the GitHub token mode is off, even if configuration was never captured, and `packages/ax-code/src/cli/cmd/github-agent/git-ops.ts:213` restores the HTTP extraheader only when an old value existed but does not unset the temporary header otherwise. This can overwrite the primary failure and leave invalid credential configuration on a persistent worktree.

## Step 5 GitHub API failure semantics

Token exchange validates HTTP status, JSON decoding, and the returned token shape at `packages/ax-code/src/cli/cmd/github-agent/github-api.ts:44`. The empty catch at `packages/ax-code/src/cli/cmd/github-agent/github-api.ts:49` suppresses only failure to decode optional server error detail; the enclosing path still throws with status information at line 50, so the existing Low disposition is defensible. In contrast, revocation at `packages/ax-code/src/cli/cmd/github-agent/github-api.ts:65` does not inspect `response.ok`, so unsuccessful cleanup is silent and compounds the Git restoration concern.

## Step 6 Prompt integrity and resource use

Comment prompts require a configured mention and preserve review-line context at `packages/ax-code/src/cli/cmd/github-agent/prompts.ts:94`. Issue and PR content is explicitly framed as context at `packages/ax-code/src/cli/cmd/github-agent/prompts.ts:172` and `packages/ax-code/src/cli/cmd/github-agent/prompts.ts:190`, while GraphQL pagination truncation is surfaced through warnings at `packages/ax-code/src/cli/cmd/github-agent/prompts.ts:352`. Attachment downloads convert the entire response with `arrayBuffer()` at `packages/ax-code/src/cli/cmd/github-agent/prompts.ts:162` without a byte limit; because prompt construction precedes the permission check (`packages/ax-code/src/cli/cmd/github-agent/run.ts:224` versus line 240), oversized attachments remain a resource-exhaustion risk.

## Step 7 Structure and maintainability

The unit has useful separation between Git state, GitHub transport, prompt assembly, and shared types, and the command facade deliberately re-exports only selected helpers at `packages/ax-code/src/cli/cmd/github-agent/index.ts:5`. The main runner still owns authentication, event classification, checkout, chat, push, commenting, cleanup, and process exit across `packages/ax-code/src/cli/cmd/github-agent/run.ts:135` through line 355. Its repeated PR response blocks at lines 284-310 are close enough to invite a shared workflow helper, especially so cleanup state can be represented explicitly instead of inferred from undefined saved values.

## Step 8 Tests and finding review

Direct tests cover malformed PR JSON at `packages/ax-code/test/cli/github-agent-pr.test.ts:38`, attachment host validation and secret-safe logging at `packages/ax-code/test/cli/github-agent-prompts.test.ts:22`, local rather than global Git identity at `packages/ax-code/test/cli/github-agent-git-config.test.ts:5`, and resilient event/error formatting at `packages/ax-code/test/cli/github-agent-run-context.test.ts:11`. Remote parsing cases are exercised from `packages/ax-code/test/cli/github-remote.test.ts:4`. The registered finding is Low at `docs/module-quality-audit/modules/cli-cmd-github-agent/findings/AUDIT-cli-cmd-github-agent-empty-catch.md:7`; the restoration and attachment-size concerns above are not represented in that ledger and should be tracked before a clean module sign-off.

## Step 9 Verification and exit decision

The focused command using `AX_TEST_FILES` completed with 5 test files and 30 tests passing. This validates the currently covered parsing, prompt URL, Git configuration locality, and formatting behavior, but it does not exercise the finally-path state machine in `packages/ax-code/src/cli/cmd/github-agent/run.ts:340` or the restoration branches in `packages/ax-code/src/cli/cmd/github-agent/git-ops.ts:195`. No Critical-severity file exists under this unit's findings directory, so no `reverify.md` is required. The nine review steps are complete, with exit qualification retained for the cleanup and resource-boundary gaps documented above.
