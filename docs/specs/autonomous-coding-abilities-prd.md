# Autonomous Coding Abilities PRD

## Summary

Improve ax-code's coding ability by making autonomous execution more accurate, less interruptive, and bounded by explicit trust and risk controls.

The guiding principle is not "approve everything." It is "automate low-risk, reversible, and verifiable work; make best-practice choices when users prefer autonomy; record those choices so the user can review them later."

## Problem

Strong LLMs still need a reliable coding runtime to perform real software engineering work. ax-code already provides important runtime capability: repository search, tool execution, agent routing, skills, permission gates, snapshots, and autonomous continuation.

The current autonomous behavior has rough edges:

- Remote skills can be fetched from project-controlled URLs, so the discovery path must enforce the same SSRF expectations used by other config-driven network calls.
- Skill metadata is shown to the model before explicit skill loading, so untrusted metadata must be treated as data and escaped.
- Autonomous question handling should make a best-practice decision, not blindly choose by position when the options include stronger signals.
- Agent permissions and routing should continue moving toward "risk-based autonomy" rather than a single global auto-approve behavior.
- Users expect autonomous mode to improve success odds by creating a PRD/ADR-style decision frame before implementation, while still avoiding over-engineering for small changes.

## Goals

- Reduce unnecessary prompts for safe, deterministic work.
- Preserve human confirmation for high-risk operations while letting autonomous mode decide routine product choices from best-practice/common-practice signals.
- Make remote skill loading safe enough to support autonomous execution.
- Improve coding accuracy through verify-first workflows, targeted tests, and self-correction.
- Keep changes auditable through existing session snapshots and event logs.
- Prefer the simplest common-practice implementation that solves the task and avoid over-engineering.

## Non-Goals

- Do not make autonomous mode bypass sandbox or isolation rules.
- Do not silently approve destructive commands, external directory writes, package installs, publishing, git push, or release operations.
- Do not replace model quality work with prompt-only changes.
- Do not require users to write large policy files before autonomous mode is useful.

## Tradeoffs

### More Autonomy

Pros:

- Faster multi-file work.
- Better headless and CI behavior.
- Less approval fatigue for routine read/search/test/edit loops.
- More practical for long-running migrations and refactors.

Cons:

- Wrong assumptions can propagate through multiple steps.
- Prompt injection or unsafe config becomes more damaging.
- Broad auto-approval can hide risky operations from users.
- Harder to debug why the agent made a decision after the fact.

### More Human Interaction

Pros:

- Safer for ambiguous product decisions.
- Better for unfamiliar or sensitive repositories.
- Gives users a chance to stop incorrect assumptions early.

Cons:

- Slower workflows.
- Headless sessions can hang.
- Approval fatigue can train users to approve without reading.
- Too many prompts reduce the practical value of coding agents.

## Best-Practice Direction

Autonomous mode should use a risk ladder:

- Auto-allow: repository reads, search, code intelligence, low-risk diagnostics.
- Auto-run: targeted typecheck, lint, and test commands that are already part of the repo.
- Auto-edit with limits: small workspace-confined patches with snapshots and verification.
- Decide and record: routine multi-choice questions where an option is marked recommended/default/safe/common/best-practice/simple/minimal, or where the first option is the prompt-author supplied recommendation. Avoid options marked risky/experimental/complex/large refactor/rewrite unless they are the only viable option.
- Ask: external directory access, network-dependent installs, secret/env access, isolation escalation, destructive operations, publishing, and releases.
- Block by default: publishing, releases, destructive file operations, git push, credential access, and sandbox escape attempts unless explicitly configured.

## Phase 1 Implementation

This PRD's first implementation batch covers foundational fixes:

- Guard remote skill discovery with SSRF-pinned fetches.
- Reject unsafe remote skill names before computing cache paths.
- Escape skill names and descriptions in prompt/tool metadata.
- Change autonomous question handling to make a best-practice decision for every question and include the autonomous decision in question tool output so the final answer can report it.
- Bias autonomous continuation toward minimal, common-practice changes and explicitly remind the model not to add abstractions without 3+ concrete use cases.
- Add central system-prompt guidance so autonomous mode uses a concise PRD/ADR-style frame before implementation across all provider prompts.

## Phase 2 Proposal

Phase 2 should improve auditability before adding broader autonomy. The safest next step is a structured decision ledger, because it makes existing autonomous choices reviewable without expanding what autonomous mode can do.

Tradeoffs:

- Pros: better final summaries, easier debugging, safer headless sessions, and a concrete audit trail for user-visible choices.
- Cons: more metadata surface area, possible duplication with text output, and no guarantee that a model will summarize every decision unless the output also reminds it.

Best-practice direction:

- Record autonomous decisions at the tool boundary that made the choice.
- Keep the ledger small and local to the tool result before adding a larger session database or dashboard.
- Store structured fields that are useful for review: question, header, selected labels, selected option descriptions, whether it was multi-select, and total option count.
- Bound and escape ledger text fields so malicious or malformed question payloads cannot inflate session metadata or become unsafe if replayed into model context.
- Escape user/model-provided question text and normalize control whitespace before echoing it back into the model prompt.
- Do not increase autonomous permission scope as part of the ledger work.

Phase 2 implementation batch:

- Add a structured `autonomousDecisions` ledger to question tool metadata.
- Keep the existing final-response reminder so the model can report the decisions to the user.
- Escape and normalize question output before returning it to the model.

Remaining Phase 2 proposals:

- Add an autonomous policy profile, for example `balanced`, `fast`, and `strict`.
- Add edit-size limits for autonomous write/edit/apply_patch approval.
- Make agent read-only presets terminal unless explicitly overridden per agent.
- Add routing validation so read-only specialist agents do not receive modification tasks.

## Phase 3 Proposal

- Add progress detection that compares recent tool calls, changed files, and test state.
- Replace generic auto-continuation with a structured continuation summary.
- Convert doom-loop detection into a strategy-change prompt instead of allowing the identical call to run again.
- Add targeted verification selection from changed paths and package metadata.
- Add evaluation fixtures for common tasks: bug fix, test repair, refactor, migration, and security review.

## Success Metrics

- Fewer human prompts during safe read/search/edit/test loops.
- Multi-choice autonomous answers prefer recommended/default/safe/common/best-practice options and avoid risky/experimental/destructive options.
- Autonomous continuation prompts explicitly remind the model to avoid over-engineering.
- Autonomous system prompts include PRD/ADR-style decision framing and distinguish lightweight plans from persistent docs.
- Remote skill discovery rejects local/private URLs and unsafe cache paths.
- Tool-call loops terminate or change strategy sooner.
- Higher pass rate on targeted coding-task fixtures with no increase in unsafe tool calls.
