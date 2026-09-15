# Goal assurance

Status: Current
Scope: Goal acceptance checks and source freshness
Last reviewed: 2026-09-14
Owner: AX Code runtime maintainers

Code-change plans produced by the goal planner declare executable acceptance
checks. Each check names the outcome it covers, its exact command, its purpose,
and the intended environment. AX Code records execution evidence when the agent
runs `verify_project` with the check's `goalCheck` id.

```json
{ "goalCheck": "invoice-parity" }
```

The command comes from the frozen goal plan. The agent cannot replace it with a
different command through this call. Existing bash permissions still apply.
Completing the goal requires every declared check's latest attempt to pass with
matching goal, session, workspace, contract and source content. Acceptance prose
explains the result; it does not replace executed checks. Ordinary shell runs and
checks that were entirely skipped cannot supply this evidence.

Old goal plans without assurance retain their earlier completion rules. Clear and
recreate an old goal when you need the new contract; editing its frozen requirements
in place causes a contract mismatch. A fork preserves the contract but requires
fresh check runs in the new session.

## Preparing a migration project

Provide authoritative legacy source or exports with revision identifiers, a bounded
coverage inventory, and check scripts that fail when assertions cannot be verified.
Treat comments and earlier migration implementations as leads to investigate.
Record approved behavior changes separately from legacy parity requirements.

Select checks for the layers the requested change actually affects:

| Layer           | What a project check should assert                                                                |
| --------------- | ------------------------------------------------------------------------------------------------- |
| Business flow   | Same inputs, roles and starting data produce the required outputs and side effects.               |
| Database logic  | Required objects, triggers, procedures and jobs exist and exhibit the expected behavior.          |
| Schema and data | Mappings, constraints, defaults and reconciliation rules hold; row counts alone are insufficient. |
| Configuration   | Relevant configuration branches exercise the intended behavior.                                   |
| Deployment      | The intended instance, schema, artifact revision and effective configuration are actually active. |

Scripts must assert the target identity before performing their checks. Keep
credentials in the project's existing credential mechanism, never in plan text,
commands or target descriptions. A check should return a nonzero exit code for a
failed assertion, missing environment or skipped required assertion. Avoid wrappers
that mask failures. AX Code cannot infer assertions from a successful process exit.

For large migrations, organize work into bounded business-flow batches and maintain
an inventory linking forms, dependencies, legacy references and acceptance checks.
Report both the accepted batch and remaining coverage. Passing one batch does not
complete the entire migration.

## What a plan records

The planner supplies an `assurance` object. This illustrative fragment assumes the
project has the referenced source export and check script:

```json
{
  "version": 1,
  "sourcePaths": ["src", "checks", "package.json"],
  "sources": [
    { "role": "legacy", "reference": "legacy/invoice-schema.sql at export-v1" },
    { "role": "requirement", "reference": "Invoice acceptance criteria supplied by the user" }
  ],
  "checks": [
    {
      "id": "invoice-parity",
      "acceptanceIds": ["AC1"],
      "command": "node checks/invoice-parity.cjs",
      "purpose": "Assert invoice behavior, database mappings and target identity",
      "environment": "Staging migration target, schema ERP"
    }
  ]
}
```

All acceptance ids must be covered. Commands execute from the workspace root.
The assurance object is frozen with the acceptance contract. The agent receives
validated scope, source references, check ids and declared targets in its continuing
goal context. Missing or altered contracts produce a restore notice. Generated
conversation summaries remain fallible; declared references and target labels
are requirements, not independently observed facts.

Git ranges that measure what this goal changed must use `{BASELINE}` as the
before-state. The planner rewrites that placeholder to the HEAD SHA captured
when the plan is submitted, so pre-existing commits ahead of `origin/main` or
a dirty working tree cannot make the goal uncompletable. Remote-tracking refs
(`origin/main`, `@{u}`, `refs/remotes/…`) are rejected as that before-state
unless the goal objective names the remote. Record already-diverged or dirty
paths under Risks; do not freeze a gating check that is already failing unless
the objective is to fix that failure.

## Freshness and limits

Git source fingerprints include actual bytes of tracked and nonignored untracked
files within the declared `sourcePaths`. Explicit file paths also include ignored
configuration files; directory paths retain Git ignore rules. Mutable goal-plan checklists are excluded; their frozen requirements are
checked through the contract digest. Non-Git projects recursively fingerprint declared
`sourcePaths`, including missing paths. Include every relevant source, configuration
file and check script in that scope.

Fingerprinting is limited to 20,000 entries and 128 MiB of file content. Linked
source, nested Git repositories, special files, escaping paths, changing files and
unavailable reads cannot produce fresh evidence. Such failures block assured
completion. Check output artifacts should go to an ignored location so producing
a report does not change the source being verified.

Ignored files not explicitly named, dependencies outside the source scope, databases and deployments
need assertions in the project command. A receipt records an observation at its
execution time; it does not prove external state has remained unchanged. Rerun
affected checks after changing configuration, databases or deployments. AX Code
does not automatically discover all legacy behavior or certify migration parity.

## Planning context and model selection

Goal planning inherits the selected session model through both `/goal` and the
`create_goal` tool. Compatible caller variants are preserved. The read-only writer
receives recent original user requirements and attachment references, with a
16 KiB record budget. An oversized record stops inclusion of older records, with a notice, so older
requirements cannot silently replace an omitted correction; inline
media content is not treated as inspected evidence. Provide inspectable source
files for requirements that are only present in media.

## Progress and blockers

`get_goal` includes current check status (passed, failed, stale, running or missing)
and recent tool evidence IDs. The completion gate still requires current successful
receipts. A blocked update requires a blocker kind, reason, required external change,
original evidence IDs, and confirmation that no independent work remains. Blocker
reasons are model declarations supported by inspectable records, not a certification
that an external service remains unavailable.

Finished turns that repeatedly produce no new successful tool evidence receive
recovery guidance, then pause the goal with unfinished work disclosed. New research
results can count without source edits; todo rewrites and repeated identical results
do not. This is a bounded heuristic, not proof of semantic progress. `/goal resume`
starts another attempt. Tool calls generated for an earlier goal cannot terminate
its replacement. A tool-created goal is available to status updates after the model
has received the creation result in its next step.

## Revise an existing plan

Use `/goal revise <correction>` to explicitly revise an active, paused or blocked
frozen goal. Completed work and exhausted budgets require a new goal. The previous
plan and digest remain intact. The revised plan gets a fresh identity and a local
prepared revision record linking both digests and the correction. The current
goal identity determines which candidate was actually installed; failed concurrent
candidates may remain on disk for inspection. Old receipts remain in
history and cannot satisfy the new revision. Token budget and accrued usage carry
over; revision does not grant a fresh spending budget.

Revision cancels the current run and pauses the goal while preparing the new plan.
If planning fails, the previous contract remains resumable; a previously blocked
goal keeps that status. A user pause or cancellation during planning prevents
activation. A concurrent replacement
prevents the candidate from taking over. Model tools cannot silently revise frozen
requirements. Review the resulting plan and its acceptance criteria; an executable
command alone does not establish that its assertions cover the corrected request.

### Review results and later source changes

A nonempty review log does not establish successful review. For required external
reviewers, use a project-owned check that validates the actual exit code,
terminal completion, source or diff identity, and final findings or an explicit
no-findings verdict. Warning-only logs, partial reasoning, and timeouts must fail.
Keep failed attempts separately for diagnosis.

New code-change submissions reject recognized simple file-presence and inspection
checks. This is a narrow admission guard, not a semantic proof of arbitrary shell
commands. Existing frozen contracts retain their schema and digest; checkpoints
warn when an older check has this weakness.

Goal-check freshness also fingerprints resolved file paths reported by successful
file-editing tools during the current goal, including paths omitted from the
original source list. Later edits to those files invalidate earlier receipts.
The frozen contract and digest are unchanged. This tracking uses file-tool result
metadata; it does not infer arbitrary shell side effects or test coverage.
Existing filesystem containment, link, size, and file-count limits still apply.

Check output and goal checkpoints disclose additional paths. If a frozen test
command omits necessary regressions, request `/goal revise <correction>` and run
the revised checks. Including a file in a fingerprint proves freshness, not that
a test exercised that file. Prefer bounded source directories and test commands
that include new regressions when planning an open-ended bug sweep.

Workspace aliases are normalized for observed file paths. External scratch files do not become workspace source inputs; checkpoints disclose that external content is not fingerprinted. Required external state still needs project-owned verification.

### Commit scope evidence

A nonempty `git log <baseline>..HEAD -- <paths>` only proves that a commit
matches the filter. It does not exclude unrelated files in that commit or
other commits. New code-change plans reject recognized standalone nonempty
path-filtered Git-log assertions; older frozen checks receive revision guidance without
changing their digest or read-time validation.

Use a project-owned verifier that checks baseline ancestry, requires a nonempty
range, and inspects every changed path in every commit without path filters.
Include deleted files and both sides of renames, handle merge commits explicitly,
and validate any required branch or message properties separately. Use
`/goal revise` to strengthen an existing contract; do not edit frozen requirements.

### Plan size and complete resubmission

The rendered plan, including Markdown and assurance JSON, must fit within 8,192
UTF-8 bytes. Aim below 7,168 bytes. If submission exceeds the cap, shorten
repeated prose and resubmit the complete object, including `kind` and all
required fields. Preserve acceptance ids and checks; the runtime does not
truncate requirements or raise the reader limit to accept an oversized plan.

### Local CLI animation review receipts

The repository-owned `packages/ax-code/script/verify-cli-review-receipts.ts`
checks `round-*` artifacts under the receipt root selected with `--root`. Each round
needs `revision.txt`, and each of `grok`, `claude`, and `codex` needs `exit.txt`
with `0` and one final verdict in `stdout.jsonl` (Grok text events) or
`stdout.txt` (Claude/Codex). Preserve failed attempts outside completed round
directories; do not turn failures into exit-zero receipts.

`dispositions.json` contains a `findings` array. Every entry names `round`,
`cli`, `id`, `status` (`fixed` or `rejected`), and nonblank `evidence`. Fixed
entries additionally require a `regression` object with a literal repository
path `file` under `packages/ax-code/test/cli/tui/` and the exact Vitest
`fullName`. Duplicate dispositions or ambiguous multiple verdicts fail.

The verifier runs those files using the installed Vitest with the global retry
default set to zero (individual test options may override that default),
then checks that each referenced assertion passed exactly once. Missing, skipped,
failed, or ambiguous assertions fail verification. This proves those referenced
tests passed, not that their assertions semantically cover the finding. Rejected
dispositions remain recorded judgments. A final round must match current HEAD;
findings marked fixed require a newer revision and review round. Uncommitted
core-package source, test, or configuration changes prevent verification. Keep the
unrelated local `ax-code.json` configuration out of commits.

For this repository, `vitest run --dir test/cli/tui` preserves the normal lane's
exclusions while scanning the TUI directory. Group runners may still select exact
files with `AX_TEST_FILES`; directory selection does not disable exclusions.
