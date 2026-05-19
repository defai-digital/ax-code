# PRD: v4.2.1 Autonomous Mode Follow-up

**Date:** 2026-04-27
**Status:** Drafted, P2-3 in progress
**Scope:** Internal
**Owner:** ax-code agent
**Related:** `.internal/adr/ADR-004-autonomous-mode-hardening.md`, `.internal/archive/prd/PRD-v4.2.0-autonomous-hardening.md`, `.internal/adr/ADR-005-subagent-orchestration.md`

## Purpose

Pick up the two smallest P2 items from PRD v4.2.0 — long-horizon re-planning on MEDIUM critic findings, and per-tool blast-radius accounting — that don't require new architectural primitives. The third P2 item (worktree-isolated parallel sub-agents) is now owned by ADR-005 (Subagent orchestration via explicit dispatcher) and not duplicated here.

## Out of Scope

- Subagent orchestration / parallel `Task` fan-out — owned by ADR-005.
- Worktree isolation — explicitly off-table per ADR-005's "isolation-light" stance.
- Production wiring of `Planner.execute()` into the live session loop — separate work.
- Replacing `Wildcard.match` with a real glob library — defense-in-depth nice-to-have, not blocking.

## Items

### P2-3 Per-tool blast-radius caps (this slice's first land)

**Why:** Session-wide caps from v4.2.0 catch *aggregate* runaway, but a phase that issues 30 `bash` commands in 30 seconds, or rewrites the same file 50 times via `edit`, slips under the per-session 50-file/5000-line ceiling because each call is small. Field reports from Codex CLI's `max_files_per_subagent` and Claude Code's per-tool guardrails show this is a real failure mode worth catching.

**Design:**
- Add `AUTONOMOUS_PER_TOOL_MAX_CALLS: Record<string, number>` to `constants/session.ts`. Initial values are conservative and based on observed runaway shapes:
  ```ts
  bash: 50,
  edit: 100,
  write: 50,
  apply_patch: 50,
  multiedit: 50,
  ```
  (Read-only tools — `read`, `glob`, `grep`, `list_directory` — are NOT capped per-tool: their only cost is tokens, which the LLM provider already rate-limits.)
- `BlastRadius` gains a `Map<toolName, count>` per session and an `incrementToolCall(sessionID, toolName)` method that bumps the counter and throws `LimitExceededError({kind: "tool_calls", current, limit, message})` when the per-tool cap is exceeded.
- Hook from `session/processor.ts` at the same point we already increment session steps. Per-tool tally is skipped for tools not in the cap map (default unrestricted).
- Caps are config-overridable via `experimental.autonomous_caps.perTool: Record<string, number>`. `0` or negative disables the cap for that tool; missing tool stays unrestricted.

**Acceptance:**
- New `tool_calls` kind in `LimitExceededError` discriminator and `Recorder` `autonomous.cap_hit` event.
- New tests in `test/session/blast-radius.test.ts`: bash flood trips at 50, edit flood trips at 100, untracked tool unaffected, override via caps map honored, non-autonomous mode no-ops.
- `pnpm typecheck` clean across workspace.

### P2-2 Long-horizon re-planning on MEDIUM critic findings

**Why:** Today `Critic.asPhaseReviewer` blocks on HIGH/CRITICAL only. MEDIUM findings ("risky but not certain to break") are logged but ignored — a phase can ship a regression-prone diff because no fallback fires. Devin's planner+critic loop and Aider's `/architect` mode both treat moderate concerns as replan triggers, capped by an explicit budget so the loop terminates.

**Design:**
- Add `phaseReplanBudget` field to `ExecutionOptions` (default `0` = legacy behavior, MEDIUM does not trigger replan). When set to N>0, `Critic.asPhaseReviewer` returns `{block: true}` on the first N MEDIUM-only findings per phase, then stops escalating.
- Counter lives on `Critic.asPhaseReviewer`'s closure (per-instance, per-phase) — no global state.
- HIGH/CRITICAL still always block, regardless of budget.
- The block error message distinguishes "blocked by HIGH/CRITICAL" vs. "blocked by MEDIUM (replan budget remaining: X)".

**Acceptance:**
- New tests in `test/planner/phase-reviewer.test.ts` (or a new critic-specific file): MEDIUM with budget=0 doesn't block, budget=1 blocks once then passes, HIGH always blocks regardless of budget exhaustion.
- Telemetry: `quality.critic_finding` already carries severity; no new event needed. `autonomous.escalation` is reserved for clarification escalation, not finding escalation.

## Rollout

Both items default-off:
- P2-3 caps map ships populated but `experimental.autonomous_caps.perTool` overrides allow disabling per-tool by setting to a high number; zero disables.
- P2-2 `phaseReplanBudget` defaults to 0; users opt in by setting it on `Planner.execute()` call sites.

When ADR-005 lands, the dispatcher will inherit BlastRadius accounting (subagents share their parent's per-session caps so a fan-out can't exceed the user's blast-radius authorization).

## Risks

- **Per-tool cap miscalibration.** 50/100 are guesses. Mitigation: telemetry (`autonomous.cap_hit` already exists) — observe one release before tightening.
- **Replan budget vs. cycle detection interaction.** A MEDIUM-finding-driven replan that produces another MEDIUM-finding diff could iterate up to `phaseReplanBudget` times. The doom-loop cycle detector (P1-1) catches identical-tool-call cycles but NOT "same finding shape, different code" loops. Acceptable: budget is bounded so worst case is `budget` extra LLM calls per phase. Document in PRD only.
