# ADR-006: Make Agent Control Plane the v5 autonomous architecture foundation

**Status:** Partially implemented via child ADRs; core runtime contract Proposed
**Date:** 2026-05-02; Updated 2026-05-25
**Deciders:** ax-code maintainers
**Related:** ADR-004 Autonomous mode hardening, ADR-005 Subagent orchestration, ADR-007 Headless runtime boundary, ADR-010 Alibaba thinking, ADR-012 Continuation contracts, ADR-013 Qwen backend, ADR-014 Durable session goals

---

## Context

v4.x has accumulated useful autonomous foundations:

- ADR-004 bounded autonomous mode with confidence escalation, blast-radius caps, hybrid permissions, and critic hooks.
- ADR-005 explicit subagent dispatch as a parallel fan-out primitive.
- Session prompts for plan/build/autonomous workflows.
- Provider-level reasoning variants and the new lightweight reasoning policy.
- TUI/session/replay surfaces that can carry richer state.

These improvements are valuable, but they are still mostly tactical. The current system still tends to encode autonomy through prompt text, mode names, environment flags, and localized heuristics. That is acceptable for v4 hardening, but it is not a durable v5 foundation.

The v5 expectation is a major upgrade. We can accept medium-to-large rewrites when they materially improve reliability, observability, and long-horizon task quality. The constraint is risk, not size: changes can be large, but they must be phased, reversible, and backed by explicit contracts.

Competitor patterns also point in the same direction:

- OpenCode separates agents, modes, model options, permissions, and step budgets.
- Claude Code separates plan mode, auto mode, permission modes, subagents, and safety fallback.
- Devin separates Ask/planning from Agent execution and makes assessments and plans inspectable.
- Windsurf and VS Code Copilot make plan artifacts visible and handoff-friendly.
- GitHub Copilot cloud agent treats research, planning, branch work, logs, and PR review as one tracked workflow.

The durable lesson is not "add more agents". It is "make the agent runtime a control plane with explicit state, policy, artifacts, and safety gates".

## Decision

ax-code v5 will introduce an **Agent Control Plane** as the architectural foundation for planning, coding, autonomous execution, reasoning depth, safety, and agent orchestration.

The Agent Control Plane is the policy and lifecycle layer between user intent and tool execution. It owns:

1. **Agent lifecycle.** A session progresses through explicit phases, not only through prompt instructions.
2. **Plan artifacts.** Plans become typed session state with evidence, assumptions, tasks, risks, and validation criteria.
3. **Reasoning policy.** The runtime chooses fast/standard/deep/xdeep reasoning based on mode, risk, uncertainty, failure history, and user intent.
4. **Execution control.** Tool loops are bounded by phase budgets, checkpoint rules, and recovery semantics.
5. **Safety policy.** Permissions, blast radius, protected paths, and approval fallback are applied consistently across normal and autonomous runs.
6. **Orchestration policy.** Subagents are bounded specialists invoked when useful, not an unbounded swarm.
7. **Observability.** TUI, CLI, replay, and logs expose phase, reason, risk, next action, and blocked/completed status.

The control plane becomes the canonical place to answer:

- What phase is the agent in?
- Why is it planning, executing, validating, asking, or stopping?
- How much reasoning budget is appropriate?
- Which tools and subagents are allowed?
- What evidence supports the current plan?
- What validation must pass before completion?
- When should autonomous mode ask for user input or declare itself blocked?

## Architectural shape

The v5 runtime should converge on contracts like:

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

export interface AgentDecision {
  phase: AgentPhase
  reasoningDepth: ReasoningDepth
  planRequired: boolean
  approvalRequired: boolean
  validationRequired: boolean
  allowedSubagents: string[]
  allowedTools: string[]
  reason: string
}

export interface PlanArtifact {
  objective: string
  evidence: string[]
  assumptions: string[]
  tasks: PlanTask[]
  risks: string[]
  validation: string[]
  approvalState: "not_required" | "pending" | "approved" | "rejected"
}
```

These names are illustrative; the important decision is the boundary:

> Prompt text may express behavior, but the runtime contract owns state, policy, and enforcement.

## Scope allowed for v5

Because v5 is expected to be a major upgrade, the following larger changes are acceptable:

- Reworking `session/` control flow around explicit phase state.
- Promoting planner state from helper behavior into typed session state.
- Introducing a new `agent-control/` or `control-plane/` domain module.
- Moving autonomous completion logic out of prompt-only reminders and into runtime decisions.
- Replacing ad hoc reasoning heuristics with a policy object that emits provider options, reminders, UI metadata, and replay events.
- Unifying permission, blast-radius, and validation gates behind a common decision contract.
- Adding TUI/CLI/replay support for agent phase, plan status, and reasoning depth.
- Integrating ADR-005 dispatch as an orchestration primitive under policy control.

The following remain out of scope for v5.0.0 unless proven low-risk:

- Cloud/background hosted agents.
- Worktree-per-subagent write isolation as the default execution model.
- LLM-driven unlimited auto-decomposition.
- Replacing the provider stack.
- Replacing storage/session persistence wholesale.
- Exposing raw chain-of-thought. v5 should expose summaries, evidence, and decisions only.

## Risk posture

v5 may include medium-to-large rewrites, but should avoid very-high-risk delivery patterns:

- No big-bang switch without a compatibility adapter.
- No autonomous behavior that bypasses safety policy.
- No unbounded subagent recursion.
- No permanent repo plan artifacts for every session.
- No mandatory deep reasoning for simple edits.
- No hidden completion state; completion must be explainable by plan/todo/validation state.

The migration should be flaggable and reversible:

1. Define contracts and record events first.
2. Run v5 control-plane decisions in shadow mode where possible.
3. Route one phase at a time through the new controller.
4. Preserve v4 behavior behind a fallback until v5 reaches parity.

## Alternatives considered

### Continue with v4 hardening only

This is lowest risk but not enough for long-term differentiation. It improves symptoms but leaves autonomous behavior prompt-heavy and hard to reason about.

### Build a large autonomous planner from scratch

This could produce a clean conceptual model, but it is very high risk. It would touch session execution, tools, permissions, storage, TUI, and replay all at once. Rejected as the initial v5 path.

### Make subagents the core architecture

Subagents are useful, but they are not the product foundation. Without a control plane, more subagents can increase cost, latency, conflicts, and inconsistent results. Subagents should be governed by policy.

### Adopt a pure plan-file workflow

Visible plan artifacts are important, but a file-only workflow is too coarse. The runtime still needs typed state for recovery, validation, replay, and TUI status.

## Consequences

### Positive

- v5 gains a durable architectural center for autonomous work.
- Planning quality, execution safety, and user trust can improve together.
- Agent state becomes inspectable and testable.
- Provider/model reasoning can be routed consistently.
- Subagent dispatch can be used where it helps without becoming a swarm.
- TUI and replay can explain the agent's current behavior and stop conditions.

### Negative / costs

- Requires cross-cutting changes across session, planner, agent, permission, and TUI surfaces.
- Requires careful migration from existing prompts and autonomous flags.
- Adds more product concepts that must be explained clearly.
- May increase latency when deep reasoning/checkpoints are triggered.
- Requires new tests around state transitions, policy decisions, and rollback behavior.

## Acceptance bar for v5.0.0

v5.0.0 should not ship only as new prompts or renamed modes. It should ship when:

- Agent phase is explicit runtime state.
- Plan artifact is typed session state, not only text.
- Reasoning depth is policy-driven and visible in logs/replay.
- Autonomous execution has clear checkpoint/recovery/blocked semantics.
- Safety gates apply consistently in autonomous and non-autonomous modes.
- The user can see why the agent is planning, executing, validating, asking, blocked, or complete.
- Existing v4 build/plan flows have a compatibility path.

## Implementation Progress

Several ADRs have shipped v5 control-plane pieces. Track them here to avoid re-deciding settled questions.

### Shipped via child ADRs

| v5 capability | Child ADR | Status |
|---------------|-----------|--------|
| Headless runtime boundary — HeadlessRuntimeCommand/Event, projection, effects, `runHeadlessSession` | ADR-007 | Accepted; MVP shipped |
| Subagent orchestration — `dispatch/` module, parallel Task fan-out, merge strategies, permission gate | ADR-005 | Accepted; P0 shipped; P1 (tool registration, planner integration) pending |
| Alibaba/OpenAI-compatible reasoning policy — `enable_thinking`, clamped `thinking_budget`, capability flags | ADR-010 | Accepted; shipped |
| Provider-neutral orchestration with per-provider reasoning options, context packing, cache policy | ADR-013 | Accepted; all phases shipped in v5.5.0 |
| Continuation semantics as explicit contracts — named builder functions, `agentRouting: "preserve"`, terminal stop non-completion | ADR-012 | Accepted; initial extraction shipped |
| Typed session state for long-horizon goals — `session_goal` table, `get_goal`/`create_goal`/`update_goal` tools, goal injection into system prompt | ADR-014 | Accepted |

### Pending (still Proposed scope of this ADR)

| v5 capability | Notes |
|---------------|-------|
| `AgentPhase` as explicit runtime state (`assess → plan → await_approval → execute → validate → recover → summarize → complete → blocked`) | No runtime state machine yet; phases still encoded as prompt logic |
| `PlanArtifact` as typed session state with evidence, assumptions, tasks, risks, and validation criteria | ADR-014 covers goals; a full plan artifact with sub-tasks and evidence is separate |
| General `ReasoningPolicy` object emitting provider options, reminders, UI metadata, and replay events | ADR-010/013 cover provider-specific policies; a unified provider-agnostic policy contract does not exist yet |
| Unified safety gate via `AgentDecision` contract across normal and autonomous runs | ADR-004 has hybrid permissions; the unified enforcement boundary is still per-module heuristics |
| TUI/CLI/replay observability for agent phase, plan status, and reasoning depth | Not yet exposed; TUI shows session state, not control-plane phase |
| `Dispatcher` as an orchestration primitive under policy control | ADR-005 P1 deferred; planner phase-tagging and replanner integration pending |

## Next Steps

1. Define the `AgentPhase` state machine as a typed runtime contract in `src/session/` (the lowest-risk first slice per the phased migration plan above).
2. Create a v5 PRD turning the remaining pending items into implementation slices with acceptance criteria.
3. Run each new phase in shadow mode before routing live traffic through it.
