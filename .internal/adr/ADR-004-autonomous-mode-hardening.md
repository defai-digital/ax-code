# ADR-004: Harden autonomous mode with confidence-aware escalation, blast-radius caps, and a critic pass

**Status:** Accepted
**Date:** 2026-04-26
**Deciders:** (to be filled by team)
**Related:** ADR-003 OpenTUI + Bun mainline hardening

---

## Context

`AX_CODE_AUTONOMOUS=true` (or `ax-code.json#autonomous`) puts the session processor into a continuous-iteration mode that bypasses `Permission.ask()` and auto-answers `Question.ask()` via `AutonomousQuestion`. Today the mode relies on three reactive guards:

1. Doom-loop detection: a 3-call ring buffer that triggers only when the same tool is called with the exact same canonical input three times in a row (`session/processor.ts:315-336`).
2. Per-session rate limit: 30 tool calls per 10 seconds (`session/processor.ts:272-286`).
3. `GLOBAL_STEP_LIMIT = 200` (`constants/session.ts:5`) — defined but not directly enforced inside the autonomous branch.

Competitor analysis (Claude Code, Cursor 3, Devin, Aider, Cline, Codex CLI) shows the field has converged on additional guarantees that ax-code currently lacks:

- **Confidence-aware escalation.** Devin asks for clarification when self-assessed confidence is low; Cline gates risky actions even in auto-approve. ax-code already produces `AutonomousQuestion.Decision.confidence` but ignores it.
- **Blast-radius caps.** Codex CLI exposes `max_files_per_subagent`, `max_lines_changed_total`, blocked-path lists. ax-code has no equivalent.
- **Architect / Editor split.** Aider's split (reasoning model proposes, editor model applies) is a documented benchmark SOTA. ax-code's planner uses one model end-to-end.
- **Critic pass before commit.** Devin runs a Critic alongside the planner; Claude Code's GUARDRAILS pattern requires "artifact verification". ax-code only runs typecheck post-phase.
- **Hybrid permission.** Cline's "auto-approve safe, gate risky" replaces all-or-nothing autonomy. ax-code's autonomous branch fully bypasses `Permission.ask`.

The user-visible failure mode this ADR targets is the most documented in competitor write-ups: an autonomous session that loops to its iteration cap on an ambiguous request, producing conflicting code instead of asking one clarifying question that would have unblocked it.

## Decision

ax-code will keep the existing autonomous activation surface (env var + `ax-code.json` flag) and add a layered set of guards. The autonomous branch becomes:

> Autonomous = bounded, confidence-aware, hybrid-permissioned execution with explicit escalation, not unconditional auto-approval.

The hardening contract is:

1. **Bound every autonomous loop.** Hard caps for steps per session, files changed per session, lines changed per session, and a blocked-path list are enforced inside the session processor and edit/write/apply_patch tools. Defaults are sized to be wide enough that they do not break ordinary use, narrow enough that a runaway loop fails loudly.
2. **Escalate on low confidence.** When `AutonomousQuestion.Decision.confidence === "low"`, autonomous mode does not auto-answer — it raises the question to the user and pauses the session. An opt-out flag (`experimental.autonomous_escalate_low_confidence: false`) exists for unattended pipelines that prefer the old behavior.
3. **Split architect and editor.** The planner can be configured with a separate "architect" `Provider.Model` for plan generation and replanning, distinct from the executor model. Default keeps the current single-model behavior.
4. **Add a critic pass.** Each phase emits a `Quality.Finding[]` review of its diff via a cheap model before the next phase starts. Findings of severity `high` block plan continuation unless the user confirms. The critic is opt-in via `quality.critic_enabled`.
5. **Hybrid permission.** A `safe-list` of tools (read, glob, grep, list_directory) is auto-approved in autonomous mode. A `risk-list` (write, edit, apply_patch, bash, network egress, package install) ignores the autonomous bypass and falls back to the configured ruleset. `INTERACTIVE_ONLY` continues to override.
6. **Strengthen doom-loop detection.** Cycle detection covers A→B→A→B and A→B→C→A→B→C, not only exact-3 repeats. Minimum cycle length 2, repeat threshold 3.

Snapshots already captured by `Snapshot.track()` (`session/processor.ts:548`) are reused for rollback decisions; we do not introduce a parallel git-stash mechanism.

## Alternatives Considered

- **Single big refactor (parallel sub-agents + worktree isolation).** Matches Cursor 3's flagship surface but requires substantial isolation and merge work. Deferred to a separate PRD as P2.
- **Replace heuristic question scorer with an LLM.** Would dissolve the brittle regex-based scoring entirely, but adds latency and cost to every clarification and breaks deterministic test fixtures. Rejected: tighten the existing scorer, add escalation when it is unsure.
- **External GUARDRAILS.md style YAML config.** Considered for blast-radius rules but rejected — `ax-code.json` already has a structured config story; introducing a parallel file fragments configuration.
- **Git stash checkpoint per turn.** Rejected because `Snapshot` already tracks per-step changes and sits inside the processor; adding `git stash` introduces cross-cutting failure modes (dirty index, untracked files, submodules).

## Consequences

### Positive

- Autonomous mode stops failing the most common documented mode: looping to step cap on ambiguous requests.
- Catastrophic blast radius is bounded by file/line caps and a blocked-path list — runaway loops fail with a specific error class, not a quiet trail of edits.
- Critic + verifier pair gives a semantic + syntactic check before the planner advances, catching logic regressions that typecheck cannot see.
- Hybrid permission removes the all-or-nothing trust cliff, letting users enable autonomous mode without granting blanket write access.
- Architect/editor split is benchmark-proven; default off keeps existing cost profile.

### Negative / Costs

- Each enabled critic phase costs an extra LLM call. Default off mitigates.
- Cycle detection's lower threshold is more sensitive; legitimate retry-test loops may trigger it. Mitigated by the same "clear ring on autonomous detection" semantics already in place.
- Hybrid permission requires classifying every tool. New tools must declare a risk class or default to `risk-list` (fail closed).
- Architect/editor split splits token accounting; observability dashboards may need to learn the new shape.

### Migration / Rollback

- All new caps and the critic are opt-in via config or have backward-compatible defaults. Existing autonomous users see only the cycle-detection improvement and confidence escalation by default.
- Rollback path: toggle `experimental.autonomous_escalate_low_confidence: false`, set caps to `Infinity`, leave critic disabled — restores legacy behavior without code changes.

## Immediate Implementation Slice

P0 (this ADR's first slice):

1. Add `AUTONOMOUS_MAX_STEPS`, `AUTONOMOUS_MAX_FILES`, `AUTONOMOUS_MAX_LINES`, `AUTONOMOUS_BLOCKED_PATHS` to `constants/session.ts`. Enforce in `session/processor.ts` and the edit/write/apply_patch tools.
2. Wire `AutonomousQuestion.Decision.confidence` through `Question.ask()` so low confidence escalates instead of auto-answering.
3. Allow `Planner.create()` to take an optional architect model and route plan-generation calls through it.

P1 (follow-up slice):

4. Cycle-aware doom loop detection.
5. Hybrid permission classifier in `permission/index.ts`.
6. `quality/critic.ts` phase-boundary diff review with `VerificationEnvelope` integration.

P2 (deferred, separate PRD): worktree-isolated parallel sub-agents, automatic re-planning on critic findings, long-horizon (multi-hour) sessions.

## References

- Codebase: `src/session/processor.ts`, `src/question/autonomous.ts`, `src/permission/index.ts`, `src/planner/index.ts`, `src/quality/verification-envelope.ts`, `src/constants/session.ts`.
- Competitor write-ups: Cursor `cursor.com/blog/scaling-agents`, Aider `aider.chat/2024/09/26/architect.html`, Devin `devin.ai/agents101`, Codex CLI `developers.openai.com/codex/cli/features`, Cline `cline.bot/`, Claude Code agent loop docs.
