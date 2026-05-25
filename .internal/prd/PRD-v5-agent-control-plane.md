# PRD: v5 Agent Control Plane

**Date:** 2026-05-02
**Last reviewed:** 2026-05-25
**Status:** In progress — contracts and shadow-mode wiring complete; runtime enforcement pending
**Scope:** Internal
**Owner:** ax-code maintainers
**Related:** ADR-006 (v5 control plane), ADR-004 (autonomous hardening), ADR-005 (subagent orchestration), ADR-012 (continuation contracts), ADR-014 (durable goals)
**Archive criteria:** All 7 phases at runtime enforcement parity; v5.0.0 acceptance bar in ADR-006 met.

---

## Current Phase Status

| Phase | Title | Status |
|-------|-------|--------|
| Phase 0 | v4 bridge and policy cleanup | ✅ Complete |
| Phase 1 | Control-plane contracts and event schema | ✅ Complete — shadow mode |
| Phase 2 | Plan artifact as session state | ✅ Complete — shadow mode |
| Phase 3 | Reasoning policy v5 | ✅ Complete — shadow mode |
| Phase 4 | Execution controller | ✅ Complete — shadow mode |
| Phase 5 | Safety policy | ✅ Complete — shadow mode |
| Phase 6 | TUI/CLI/replay observability | ✅ Complete — shadow mode |
| Phase 7 | Subagent orchestration under policy control | ⏸ Deferred — ADR-005 P1 pending |

**What "shadow mode" means:** The contracts, state machines, event schemas, and view models exist and are tested. The session loop emits replay events through the control-plane factories, and the TUI activity timeline renders them. However, existing `session/processor.ts` and `prompt.ts` control flow has not been replaced — the control plane observes without governing. Runtime enforcement is the remaining work.

**Next milestone:** Wire `ExecutionController` into `session/processor.ts` for the `execute → validate → summarize → complete/blocked` transition, replacing the current prompt-text-based completion signal.

---

## Completed Work (Phases 0–6, all shadow mode)

All shadow-mode work landed in a single implementation session on 2026-05-02. The following modules now exist in `src/control-plane/`:

| Module | What it provides |
|--------|-----------------|
| `agent-control.ts` | `AgentPhase`, `ReasoningDepth`, `AgentControlState`, `PlanArtifact`, `AgentDecision` types; `transition()`, `createPlan()`, `updateTaskStatus()`, `applyCheckpoint()` pure helpers; completion invariants (rejects `complete` while validation pending or tasks open) |
| `reasoning-policy.ts` | `ReasoningPolicy` — canonical policy for `fast` / `standard` / `deep` / `xdeep`; respects explicit overrides, blast-radius signals, failure counts; `src/session/reasoning-policy.ts` re-exports for compatibility |
| `execution-controller.ts` | `ExecutionController` state machine: `assess → plan/execute → validate → summarize → complete/blocked`; keeps `await_approval` and `validate` pending until signals arrive; reuses `transition()` so invariants stay centralized |
| `safety-policy.ts` | `SafetyPolicy` — `allow / ask / deny / allow_with_checkpoint` decisions; protected paths deny first; risky permissions require checkpoint in autonomous mode; glob-to-regex tokenizer for path matching |
| `agent-control-events.ts` | `AgentControlEvents` factory namespace: `phaseChanged`, `reasoningSelected`, `planCreated`, `planUpdated`, `validationUpdated`, `blocked`, `completed`, `safetyDecided`; all strip undefined fields; tests parse every event through `ReplayEvent` |
| `agent-control-summary.ts` | `AgentControlSummary` read model over replay events; `footerAgentControlStatusView()` converts to TUI labels (`Agent Plan · deep reasoning · plan 1/2`) |

**Session-loop integration (shadow):**
- `Permission.ask()` emits `agent.safety.decided` (`shadow: true`) when `SafetyPolicy` would act — existing permission behavior unchanged
- `llm.ts` imports `ReasoningPolicy` from control-plane; emits `agent.reasoning.selected` when checkpoint required
- Plan Mode emits `agent.phase.changed` and `agent.plan.created` shadow events when replay recorder is active
- TUI activity timeline renders all control-plane events: `Phase: ...`, `Reasoning: ...`, plan progress, `Safety: Shadow ...`

**What shadow mode does NOT do:** The existing `session/processor.ts` and `prompt.ts` control flow is unchanged. The control plane observes and emits events; it does not govern decisions or transitions.

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
