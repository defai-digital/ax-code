# PRD: v5 Agent Control Plane

**Date:** 2026-05-02
**Status:** Draft
**Scope:** Internal
**Owner:** ax-code agent
**Related:** `.internal/adr/ADR-006-v5-agent-control-plane.md`, `.internal/adr/ADR-004-autonomous-mode-hardening.md`, `.internal/adr/ADR-005-subagent-orchestration.md`

---

## Implementation log

### 2026-05-02 Phase 1 contract scaffold

Phase 1 started with a shadow-mode contract slice:

- Added `src/control-plane/agent-control.ts` with typed phase, reasoning-depth, validation, approval, plan artifact, decision, and state contracts.
- Added pure transition helpers so invalid lifecycle jumps can be tested before runtime wiring.
- Added agent-control replay events to `src/replay/event.ts`.
- Added tests for phase transitions, plan progress, and replay event parsing.

No session loop behavior changed in this slice.

### 2026-05-02 Bug sweep and reasoning shadow event

Follow-up bug sweep on the touched surfaces fixed:

- Reasoning checkpoint reminders are now inserted before plugin system transforms and prompt normalization, preserving existing caching/extension assumptions.
- Reasoning policy recognizes Traditional Chinese planning/risk prompts.
- Agent control transitions now reject completion while validation is pending/failed or plan tasks remain open/blocked.
- `agent.completed` replay events require the `complete` phase.
- Deep reasoning selections emit `agent.reasoning.selected` shadow events when a recorder is active.

### 2026-05-02 Contract bug sweep and Phase 2 plan helpers

Second bug sweep fixed contract bypasses before runtime wiring:

- `createState({ phase: "complete" })` now enforces the same completion invariants as transitions.
- `agent.completed` replay events now reject failed or pending validation statuses.
- Reasoning policy now respects nested explicit provider reasoning options.
- Empty reasoning variants no longer count as successful deep-reasoning activation.

Phase 2 scaffold started with pure plan helpers:

- `AgentControl.createPlan()` creates typed plan artifacts with conservative defaults.
- `AgentControl.updateTaskStatus()` updates tasks by id and rejects unknown tasks.

### 2026-05-02 Phase 2 shadow plan events

Plan Mode now emits session-local shadow control-plane events when replay recording is active:

- `agent.phase.changed` moves the shadow phase from `assess` to `plan`.
- `agent.plan.created` records a conservative shadow plan artifact initialized from the latest user objective.

This remains shadow-mode only. It does not change Plan Mode execution, tool permissions, or model routing.

### 2026-05-02 TUI activity visibility for control-plane events

The existing TUI activity history now renders control-plane replay events without changing the renderer structure:

- `agent.phase.changed` appears as `Phase: ...`.
- `agent.reasoning.selected` appears as `Reasoning: ...`.
- `agent.plan.created` and `agent.plan.updated` show plan objective and task progress.
- `agent.validation.updated`, `agent.blocked`, and `agent.completed` show validation/blocked/completion status.

This makes Phase 1/2 shadow-mode state visible through the existing activity timeline.

### 2026-05-02 Phase 2 plan checkpoint helper

Added a pure plan-update helper before wiring runtime checkpoints:

- `AgentControl.applyCheckpoint()` merges evidence, assumptions, risks, validation, and task updates into a typed plan artifact.
- Duplicate text entries are ignored so repeated checkpoints do not inflate plan state.
- Unknown task updates fail loudly instead of creating implicit tasks.

This keeps future `agent.plan.updated` emitters on one safe contract.

### 2026-05-02 Control-plane replay event factories

Added `AgentControlEvents` as the canonical factory for control-plane replay payloads:

- Phase, reasoning, plan, validation, blocked, and completed events are created through one typed namespace.
- `llm.ts` now uses the factory for reasoning and plan shadow events instead of hand-writing payloads.
- Factory tests parse every generated event through `ReplayEvent`.

### 2026-05-02 Phase 3 reasoning policy domain move

Moved the reasoning policy into the control-plane domain:

- `src/control-plane/reasoning-policy.ts` is now the canonical policy implementation.
- `src/session/reasoning-policy.ts` remains as a compatibility re-export.
- `llm.ts` imports the policy from the control-plane namespace.

This makes reasoning depth a v5 control-plane decision instead of a session implementation detail.

### 2026-05-02 Phase 3 v5 reasoning depth semantics

Expanded reasoning policy semantics to the v5 depth set while keeping runtime behavior conservative:

- `fast`, `standard`, `deep`, and `xdeep` are now valid policy depths.
- Small requests classify as `fast` without provider options or checkpoint events.
- Explicit `xdeep` requests use `max`/`xdeep` variants when available, otherwise fall back to `deep`.
- Repeated failures, high uncertainty, and high blast radius can request `deep` through the policy contract.
- `llm.ts` only emits reasoning replay events when a checkpoint is required, avoiding noisy fast/standard events.

### 2026-05-02 Phase 4 execution controller scaffold

Added a pure `ExecutionController` state machine before live session wiring:

- Decides phase transitions from current `AgentControl.State` plus execution/validation/approval/failure signals.
- Routes assess -> plan/execute, plan -> approval/execute, execute -> validate/summarize, validate -> recover/summarize, summarize -> complete/blocked.
- Reuses `AgentControl.transition()` so completion invariants remain centralized.
- Tests cover planning, approval, validation, recovery, blocked, and completion paths.

### 2026-05-02 Phase 5 safety policy scaffold

Added a pure `SafetyPolicy` decision contract before permission runtime wiring:

- Decisions use `allow`, `ask`, `deny`, and `allow_with_checkpoint`.
- Protected paths deny before permission classification.
- Safe permissions allow without checkpoint.
- Risky permissions ask in autonomous mode and require checkpoints in normal mode.
- Unknown permissions ask in autonomous/strict mode and require checkpoints otherwise.
- Blast-radius limits can deny or require checkpoint at the limit.

This prepares the v5 safety policy layer without changing existing permission behavior.

### 2026-05-02 Control-plane bug sweep

Follow-up bug sweep on the new control-plane contracts fixed early runtime-wiring hazards:

- `ExecutionController` now keeps `await_approval` pending until approval is granted instead of prematurely blocking.
- `ExecutionController` now keeps `validate` pending until a validation result arrives instead of prematurely recovering.
- `ReasoningPolicy` honors explicit `fast`/`standard` requests even when the selected model has no reasoning capability.
- `SafetyPolicy` protects directory paths such as `secrets` and `.git/hooks`, not only nested files.

### 2026-05-02 Safety decision observability scaffold

Added shadow observability support for future safety-policy integration:

- `agent.safety.decided` replay event records action, risk, reason, permission, tool/path, checkpoint requirement, and matched rule.
- `AgentControlEvents.safetyDecided()` is the canonical event factory.
- TUI activity history renders safety decisions as `Safety: ...`.

This remains schema/UI scaffolding only; existing permission behavior is unchanged.

### 2026-05-02 Targeted control-plane cleanup

Cleaned up newly added control-plane scaffolding before runtime integration:

- `SafetyPolicy` now converts globs to regex with a small tokenizer so regex metacharacters are escaped predictably while `*` and `**` keep glob meaning.
- `AgentControlEvents` strips undefined optional fields from generated replay payloads.
- TUI activity status labels render safety actions such as `allow_with_checkpoint` as a concise `checkpoint`.

### 2026-05-02 Permission shadow safety wiring

Added the first runtime shadow wiring for v5 safety policy:

- `Permission.ask()` emits `agent.safety.decided` when the v5 `SafetyPolicy` would ask, deny, or require a checkpoint.
- Events are marked `shadow: true` because the policy does not yet change existing permission behavior.
- TUI activity renders shadow safety decisions as `Safety: Shadow ...` to avoid implying that v5 policy has taken over runtime enforcement.

### 2026-05-02 Safety activity copy cleanup

Shortened safety activity labels:

- `allow_with_checkpoint` now renders as `Checkpoint`.
- Shadow checkpoint decisions render as `Safety: Shadow Checkpoint`.

### 2026-05-02 Phase 6 control-plane summary helper

Added `AgentControlSummary` as a pure read model over replay events:

- Summarizes current phase, phase reason, reasoning depth, plan progress, validation, blocked/completed state, and safety counts.
- Provides a compact status line for future TUI/CLI rendering.
- Remains read-only and does not change runtime behavior.

### 2026-05-02 Footer control-plane status view model

Added a footer-friendly read model for control-plane state:

- `footerAgentControlStatusView()` converts `AgentControlSummary` into concise labels such as `Agent Plan · deep reasoning · plan 1/2`.
- Blocked and completed states are prioritized so the footer can avoid ambiguous in-progress copy.
- This is a pure view-model helper only; footer JSX wiring remains a follow-up.

---

## Purpose

Make v5.0.0 a meaningful major upgrade by replacing prompt-heavy autonomous behavior with an explicit Agent Control Plane.

The goal is not to make every task more autonomous. The goal is to make autonomy reliable, observable, bounded, and recoverable.

## Problem

v4.x has useful hardening but still lacks a single runtime authority for:

- Agent phase and lifecycle.
- When planning is required.
- When deeper reasoning is justified.
- How plan evidence, assumptions, tasks, risks, and validation are stored.
- When autonomous mode should continue, ask, recover, or stop.
- How subagents are selected and bounded.
- How TUI/CLI/replay explain the agent's state.

This creates long-term product risk:

- The system can appear smart while being hard to debug.
- Prompt changes can accidentally change runtime behavior.
- Autonomous completion can be ambiguous without typed validation state.
- Users cannot always tell whether the agent is thinking, planning, executing, stuck, or done.
- Competitors are converging on explicit modes, plan artifacts, permissions, subagents, and safety gates.

## Goals

1. Introduce explicit phase state for agent sessions.
2. Promote plan artifacts to typed session state.
3. Make reasoning depth policy-driven and observable.
4. Convert autonomous mode into a bounded execution lifecycle.
5. Unify safety decisions across autonomous and non-autonomous flows.
6. Give TUI/CLI/replay a clear status model.
7. Integrate subagent dispatch as a controlled capability.

## Non-goals

- Cloud/background hosted agents in v5.0.0.
- Worktree-per-subagent writes as the default v5.0.0 path.
- Unlimited autonomous decomposition.
- Replacing provider infrastructure.
- Replacing all session persistence.
- Exposing raw chain-of-thought.
- Making every simple edit produce a plan.

## User-facing principles

- Simple tasks should stay fast.
- Complex tasks should show a plan and reasoning depth.
- Autonomous work should explain what it is doing and why.
- The agent should ask or declare blocked instead of pretending completion.
- Plans should be useful, not theatrical.
- Deep reasoning should be earned by risk, uncertainty, failure, or explicit user request.

## Architecture overview

Add a new domain surface, tentatively:

```text
src/agent-control/
  decision.ts
  phase.ts
  plan-artifact.ts
  reasoning-policy.ts
  execution-controller.ts
  safety-policy.ts
  events.ts
```

The final placement can change, but the domain boundary should remain.

### Core contracts

```ts
export type AgentPhase =
  | "assess"
  | "plan"
  | "await_approval"
  | "execute"
  | "validate"
  | "recover"
  | "summarize"
  | "complete"
  | "blocked"

export type ReasoningDepth = "fast" | "standard" | "deep" | "xdeep"

export interface AgentControlState {
  sessionID: string
  phase: AgentPhase
  objective: string
  plan?: PlanArtifact
  reasoningDepth: ReasoningDepth
  lastDecisionReason: string
  validationStatus: "not_required" | "pending" | "passed" | "failed"
  blockedReason?: string
}
```

## Phase plan

### Phase 0: v4 bridge and policy cleanup

**Intent:** Finish the low-risk bridge work already started so v5 has a migration point.

**Scope:**

- Keep the current `ReasoningPolicy` behavior as a v4 bridge.
- Move it under the final v5 namespace when contracts are ready.
- Add optional replay/log metadata for depth and reason.
- Do not change user-facing behavior beyond the conservative deep-reasoning triggers.

**Acceptance:**

- Existing plan/build flows continue.
- Manual model variant and explicit reasoning options are never overridden.
- Simple build tasks do not auto-escalate.

### Phase 1: Control-plane contracts and event schema

**Intent:** Define typed runtime state before changing control flow.

**Scope:**

- Add `AgentPhase`, `ReasoningDepth`, `AgentDecision`, `AgentControlState`, and `PlanArtifact` schemas.
- Add recorder/replay events:
  - `agent.phase.changed`
  - `agent.reasoning.selected`
  - `agent.plan.created`
  - `agent.plan.updated`
  - `agent.validation.updated`
  - `agent.blocked`
  - `agent.completed`
- Add pure policy tests for state transitions.
- Keep current runtime behavior; emit events in shadow mode where possible.

**Acceptance:**

- Events can be recorded without changing existing execution.
- Replay can parse the new event schema.
- No new Effect usage.

### Phase 2: Plan artifact as session state

**Intent:** Make planning inspectable and reusable without forcing permanent repo docs.

**Scope:**

- Store session-local `PlanArtifact`.
- Include objective, evidence, assumptions, tasks, risks, validation.
- Support approval states: `not_required`, `pending`, `approved`, `rejected`.
- Add plan update semantics when execution discovers new evidence.
- Keep durable ADR/PRD writing only for explicitly durable work.

**Acceptance:**

- Plan mode produces a typed plan artifact.
- Autonomous complex tasks create or update a typed plan artifact.
- Plans can be summarized in TUI/CLI.
- Plans do not automatically write to `.internal/`.

### Phase 3: Reasoning policy v5

**Intent:** Replace heuristic-only reasoning escalation with first-class routing.

**Scope:**

- Policy inputs:
  - mode/agent
  - user intent
  - task risk
  - estimated blast radius
  - failure count
  - uncertainty
  - validation requirements
  - explicit user depth request
- Policy outputs:
  - reasoning depth
  - provider options
  - model/variant preference
  - checkpoint requirements
  - UI/replay metadata
- Provider mapping remains isolated; no provider-specific logic in agent prompts.

**Acceptance:**

- `fast`, `standard`, `deep`, and `xdeep` have explicit semantics.
- Policy respects manual user/model/agent overrides.
- TUI/CLI/replay can show selected depth and reason.
- Cost-sensitive defaults keep simple tasks fast.

### Phase 4: Execution controller

**Intent:** Move autonomous behavior from prompt-only continuation into a typed lifecycle.

**Scope:**

- Introduce `ExecutionController`.
- Control phase transitions:
  - assess -> plan
  - plan -> await_approval or execute
  - execute -> validate
  - validate -> complete or recover
  - recover -> plan or blocked
- Add checkpoint rules:
  - after N tool calls
  - after repeated failures
  - after high-risk writes
  - before completion on complex tasks
- Add blocked semantics:
  - missing context
  - permission denied
  - validation failed
  - unsafe action
  - ambiguous request

**Acceptance:**

- Autonomous mode cannot mark complete while required plan tasks remain open.
- Validation failure routes to recover or blocked.
- User can see why the session paused or stopped.
- v4 continuation behavior remains available behind compatibility fallback during rollout.

### Phase 5: Safety policy integration

**Intent:** Make safety a policy decision, not a side effect of mode.

**Scope:**

- Unify:
  - permission rules
  - blast-radius caps
  - protected paths
  - package/network risk
  - validation requirements
  - approval fallback
- Every tool action gets a risk decision:
  - allow
  - ask
  - deny
  - allow_with_checkpoint
- Add fail-closed behavior for unknown high-risk tools in autonomous mode.

**Acceptance:**

- Autonomous mode cannot silently bypass risky actions.
- Safety decision is logged with reason.
- Existing permission config remains compatible.
- Protected path behavior is consistent across modes.

### Phase 6: Observability UX

**Intent:** Make the control plane visible and reassuring.

**Scope:**

- TUI status:
  - phase
  - reasoning depth
  - plan progress
  - validation status
  - blocked reason
- CLI/session summary:
  - what was planned
  - what was done
  - what was validated
  - why it stopped
- Replay:
  - phase timeline
  - checkpoint summaries
  - safety decisions

**Acceptance:**

- User can distinguish planning, executing, validating, recovering, blocked, complete.
- Deep reasoning explains its reason without exposing private chain-of-thought.
- Session summary includes plan and validation state when applicable.

### Phase 7: Bounded subagent orchestration

**Intent:** Use subagents where they increase quality, without turning v5 into a swarm.

**Scope:**

- Integrate ADR-005 dispatcher under control-plane policy.
- Define role contracts:
  - explore
  - reviewer
  - debugger
  - architect
  - perf
  - security
- Add fan-out limits:
  - max subagents per phase
  - max parallel subagents
  - no recursive dispatch by default
  - read-only default for research/review agents
- Route subagent outputs into plan evidence or validation findings.

**Acceptance:**

- Subagent fan-out is explicit and bounded.
- Main session receives summaries, not raw context floods.
- Write conflicts are avoided or serialized.
- Subagent use is visible in TUI/replay.

## v5.0.0 minimum ship bar

v5.0.0 should include Phases 1-6.

Phase 7 can ship in v5.0.0 only if it remains bounded and does not introduce high-risk worktree merge behavior. Otherwise, it should ship in v5.1.

## Migration strategy

1. Keep existing agents and modes.
2. Add control-plane state in shadow mode.
3. Emit events without changing behavior.
4. Route plan mode through typed plan artifact.
5. Route autonomous through execution controller behind a feature flag.
6. Make control-plane runtime the default once parity is proven.
7. Keep v4 compatibility fallback for one minor release.

## Testing strategy

- Pure unit tests for phase transitions.
- Policy tests for reasoning depth and safety decisions.
- Session tests for plan artifact lifecycle.
- Autonomous tests for completion, blocked, recovery, and validation failure.
- Replay tests for event schema compatibility.
- TUI snapshot tests for status labels.
- Regression tests that simple tasks do not produce unnecessary plans.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Scope explosion | Keep phases contract-first and independently shippable |
| Planner theater | Require evidence, assumptions, risks, validation, and task closure |
| Cost/latency increase | Reasoning depth policy defaults simple tasks to fast/standard |
| Migration breakage | Shadow mode first, compatibility fallback for v4 behavior |
| Too much UI complexity | Display only phase, depth, progress, validation, and blocked reason |
| Subagent thrash | Bounded fan-out, no recursive dispatch, read-only defaults |
| Unsafe autonomy | Safety policy gates risky tools and protected paths consistently |

## Open questions

- Should v5 expose `ask`, `plan`, `build`, and `autonomous` as user-facing modes, or keep modes simpler and expose phase internally?
- Should plan artifacts live only in session storage, or should users be able to export them explicitly?
- What is the default approval policy for complex autonomous plans?
- Should `xdeep` be user-request only at launch?
- Which TUI labels best communicate depth and phase without creating noise?
