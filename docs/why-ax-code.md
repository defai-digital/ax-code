# Why AX Code

Status: Active
Scope: current-state
Last reviewed: 2026-08-21
Owner: AX Code maintainers

Most coding agents optimize the moment of writing code. AX Code optimizes the moment after: deciding whether to keep what the agent produced.

## What AX Code optimizes for

Agent output is cheap to generate and expensive to review. When an agent touches twenty files across three modules, the reviewer's problem is not "is this line correct" but "what did it actually do, does it pass, and what happens if I need to undo it."

AX Code is built around that problem:

- **Evidence.** Every session is recorded as a typed event log — routing decisions, model activity, steps, tool calls, tool results — plus file snapshots taken during the run.
- **Verification.** Where a gate is enforceable, your repository's own checks decide. Arena candidates and gated refactor application run typecheck, lint, and tests before a result is accepted.
- **Reversibility.** Snapshot points are recoverable per step, not only per session.
- **Your decision.** AX Code ranks, scores, and reports. It does not merge for you.

## Who it is for

**Primary audience:**

- senior and staff engineers making consequential changes
- open-source and internal-platform maintainers
- teams operating medium-to-large Git repositories
- engineers evaluating refactors, migrations, and cross-module fixes
- anyone running unattended or scheduled agent work that a human must audit afterwards

**Not the primary audience:**

- someone who wants inline autocomplete
- a user making one quick, disposable edit
- a team whose priority is fully managed cloud delegation
- someone unwilling to use Git or run repository checks

For those cases a lighter editor assistant is genuinely the better tool, and this page would rather say so than oversell.

## How it differs

Rather than a feature checklist that decays, here is what each category optimizes for:

| Category                    | Optimizes for                      | Where AX Code differs                                               |
| --------------------------- | ---------------------------------- | ------------------------------------------------------------------- |
| First-party model agents    | one model's experience, end to end | AX Code is model-agnostic and keeps the record locally              |
| Editor agents               | interactive in-IDE flow            | AX Code targets the review and audit step, not the typing step      |
| Lightweight terminal agents | speed and simplicity               | AX Code accepts more concepts in exchange for an inspectable record |
| Cloud agents                | managed delegation and autonomy    | AX Code keeps execution and evidence on your machine, Apache-2.0    |

Several capabilities that AX Code ships are, as of 2026, broadly available elsewhere: sandboxing, checkpoints and restore, MCP, hooks, skills, subagents, worktree isolation, scheduling, provider choice, and running one prompt across several models. None of those alone is a reason to choose AX Code.

The combination that is harder to assemble elsewhere is: an isolated candidate implementation, gated on the repository's own checks, ranked verification-first, with the full execution record retained locally and exportable — and no automatic merge.

## What we do not claim

Positioning is only useful if it survives contact with the product. Explicitly:

- **`replay` reconstructs; it does not re-execute.** It rebuilds and verifies the recorded event stream. It does not re-run models, tools, or the outside world.
- **`risk` is a deterministic heuristic**, computed from churn, validation state, tool failures, touched paths, and security-sensitive file patterns. It is not a probability, a calibrated confidence, or a security assurance.
- **`branch` forks session state**, not a Git branch or worktree. Arena is the Git-worktree implementation path.
- **`compare` compares runs**, not source code. It reports risk, decision path, and event counts — it is not a code diff viewer.
- **Verification gates are not universal.** They apply to arena candidates and gated refactor application. Ordinary interactive edits are not automatically verified.
- **AX Wiki prose is model-generated** from cited sources. The planning, validation, incremental update, and protected-section framework around it is deterministic.
- **CLI-bridge visibility is partial.** AX Code records its own tool execution in full; work happening inside a vendor CLI process is visible only through that bridge's output.
- **Some capabilities are opt-in.** The `workflow` runtime requires `AX_CODE_WORKFLOW_RUNTIME=1`.

## Provenance, plainly

AX Code began on the MIT-licensed OpenCode codebase. That is preserved in [NOTICE](../NOTICE) and stated in the README rather than buried.

What DEFAI built on that foundation is the subject of this page: the execution-evidence layer, the deterministic debug and refactor engine with shadow-worktree verification, the code-intelligence graph and impact analysis, council and arena execution modes, the AX Wiki compiler, OS-level sandboxing, and AX Code Desktop.

## Next

- [Execution Evidence](guides/execution-evidence.md) — the commands that make a run reviewable
- [Verified Multi-Model Changes](guides/verified-multi-model-change.md) — council and arena
- [Start Here](getting-started/start-here.md) — the product mental model
