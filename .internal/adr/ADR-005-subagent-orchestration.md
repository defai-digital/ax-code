# ADR-005: Subagent orchestration via explicit dispatcher with parallel Task fan-out

**Status:** Accepted (P0 partially shipped 2026-04-27)
**Date:** 2026-04-27
**Deciders:** ax-code maintainers
**Related:** ADR-004 Autonomous mode hardening (which deferred parallel subagents to a separate PRD as P2)

## P0 status (2026-04-27)

| P0 item | Status | Landed in |
|---|---|---|
| 1. Module scaffold (`dispatch/index.ts`) | ✅ shipped | `81b2190` |
| 2. Tests | ✅ shipped (16 + 8 = 24 covering empty / parallel / timeout / cancel / NaN / merge strategies / event sink) | `81b2190`, `78c5250`, this slice |
| 3. Permission preset (`dispatcher: deny` for subagent-tier) | ✅ shipped | this slice |
| 4. Bus event sink (`DispatcherEventSink` interface + injection point) | ✅ shipped (interface only — session-layer adapter still pending) | this slice |
| 5. Merge strategies (`all` / `first-success` / `majority`) | ✅ shipped | this slice |
| 6. Tool registration (`Dispatch` tool the LLM emits) | ⏸ deferred to P1 — needs Task-tool-style Session/SessionPrompt integration which the dispatch module is intentionally decoupled from. | — |

The deferred Tool registration is the only P0 item not landed; it requires a session-layer `DispatchExecutor` implementation (mirroring how `Task` tool wraps `Session.create + SessionPrompt.run`) that crosses the Effect-allowed `session/` boundary. Tracking it as the first P1 item.

---

## Context

ax-code today routes every user message to exactly one agent via `agent/router.ts`. Subagents exist as a tier (`mode: "subagent"` — currently `general` and `explore`) but they are invoked one-at-a-time through the `Task` tool emitted by the calling agent. Specialist agents (`security`, `architect`, `debug`, `perf`, `devops`, `test`) live as primary-mode peers that the router can swap to, never as concurrent collaborators.

The most documented gap in field reviews of competing coding agents — Claude Code subagents, Cursor 3 multi-agent runs, Cline architect/engineer/code modes, Aider's `/architect` + `/edit` split, Devin's planner + critic — is that **specialist work is parallelisable but ax-code currently serialises it**.

Concrete user-visible failure modes:

- A request like *"audit auth for vulnerabilities and fix the slow login query"* matches both the security and perf agents. The router picks one; the other concern is dropped or chased serially in a follow-up turn. ([`agent/router.ts:267-323`](packages/ax-code/src/agent/router.ts) returns a single best match.)
- The Planner's replan loop ([ADR-005 Planner.replan; `planner/index.ts`](packages/ax-code/src/planner/index.ts)) decomposes a failure into replacement phases but cannot fan those phases out to different agents — the same executor handles every phase.
- Skill recommendations in `SystemPrompt.skills()` surface multiple matching skills but the agent picks one. There is no protocol for "run skill A and skill B in parallel and merge findings".

ADR-004 explicitly deferred this work as P2. The Memory + Question + Planner + Replanner + Approval work landed in 2026-04-26 prepares the substrate (per-agent memory filtering, clarification → constraints handoff, replan with approver) — orchestration is now the missing layer.

The smallest competitor design that solves the problem is **explicit dispatch by the calling agent**, not auto-decomposition. Claude Code, Cline, and Aider all expose orchestration at the agent layer, not the LLM-decomposition layer. ax-code can match without rewriting agent.ts: a `Dispatcher` namespace wraps parallel `Task` calls, aggregates results, and exposes a single `Promise<DispatchResult>` to the caller.

## Decision

ax-code will introduce a `Dispatcher` module that lets a primary agent fan a unit of work out to multiple subagents (or specialist primary agents in subagent role) in parallel, then merge the results back into one structured response.

The orchestration contract is:

> Subagent dispatch is **explicit** (caller-declared), **parallel-by-default**, **isolation-light** (no worktree), **merge-aware** (each subagent emits a typed result; the dispatcher aggregates with a merge strategy).

Specifically:

1. **Module placement.** New `packages/ax-code/src/dispatch/` namespace. Effect-free (`async/await`, Zod). Importing it must not pull `agent/agent.ts` (which is Effect-heavy) into modules that don't already use it; the dispatcher takes an injectable agent-loader function so test paths can pass fakes.

2. **API surface.**
   ```ts
   export interface DispatchSpec {
     agent: string                   // agent name as registered in agent/agent.ts
     prompt: string                  // the subagent's task description
     constraints?: string[]          // soft requirements (typically from Question.toConstraints)
     timeoutMs?: number              // per-subagent timeout
   }

   export interface DispatchResult {
     agent: string
     status: "completed" | "failed" | "timeout"
     output?: string
     error?: string
     durationMs: number
     filesModified: string[]
     tokensUsed: number
   }

   export interface DispatchOptions {
     maxParallel?: number            // default 3
     mergeStrategy?: "all" | "first-success" | "majority"
     onSubagentStart?: (spec: DispatchSpec) => void
     onSubagentComplete?: (result: DispatchResult) => void
   }

   export async function dispatch(
     specs: DispatchSpec[],
     options?: DispatchOptions,
   ): Promise<{ results: DispatchResult[]; summary: string }>
   ```

3. **Permission propagation.** Each subagent runs under its own `Permission.Ruleset` as resolved by `Agent.get(name)`. The dispatcher does not bypass permissions — a subagent that lacks `edit` access fails its phase, just as it would in normal routing. A new `dispatcher` permission action gates whether an agent is even allowed to call `dispatch()` (default deny for `subagent`-tier agents to prevent fork bombs).

4. **Read-write conflict avoidance — for now, pessimistic.** When `mergeStrategy: "all"` runs and two subagents declare overlapping `filesModified` candidates ahead of time, the dispatcher serialises them and emits a `Bus` event for diagnostics. We do **not** introduce worktree-per-subagent in this slice (deferred — see Alternatives). Read-only subagents (security, perf, architect — already configured `readOnlyWithWeb`/`readOnlyNoWeb`) parallelise without conflict.

5. **Merge strategies.**
   - `all`: wait for every subagent, return the full set. Caller aggregates.
   - `first-success`: cancel siblings as soon as one returns `completed`. Used for "race two analysers".
   - `majority`: useful for critic-style consensus — wait for the majority of subagents to converge on the same finding, then return.

6. **Observability.** Dispatcher emits `Bus.Event`s (`dispatch.started`, `dispatch.subagent.started`, `dispatch.subagent.completed`, `dispatch.completed`) so the TUI can render parallel progress and the audit log can record the fan-out shape. Bus events live in `session/` (Effect-allowed); `dispatch/` will not import Bus directly — instead it accepts an optional `events: DispatcherEventSink` injection. The session layer will provide a sink that translates to Bus events.

7. **Tool surface.** A single new `Dispatch` tool (`packages/ax-code/src/tool/dispatch.ts`) lets a primary agent declare a fan-out from inside its turn. The tool input is `DispatchSpec[]` plus options; the tool output is the aggregated `DispatchResult[]` rendered as a string for the model. This is the on-ramp the LLM sees — `dispatch()` itself is a programmable lower layer for direct use from session/processor.

8. **No automatic decomposition.** The dispatcher does **not** itself decide how to split a task across agents. That is the caller's job — typically the primary agent's LLM emits a `Dispatch` tool call with explicit specs, or the planner's replanner returns phases each tagged with a target agent. Automatic decomposition is an orthogonal capability that can sit on top of `Dispatcher` later.

## Alternatives Considered

- **Worktree-per-subagent isolation (Cursor 3 model).** Each subagent operates in a fresh git worktree, edits are merged via three-way diff at completion. Solves write-write conflicts cleanly but introduces ~5–15s setup cost per subagent (especially in Bun + nfs/macOS sandbox), needs a merge-conflict surface in the TUI, and complicates `Snapshot.track()`. Deferred to a follow-up ADR; the `dispatch/` API leaves room for an `isolation: "worktree"` option without breaking changes.

- **LLM-driven auto-decomposition.** Have a meta-agent split the request and choose which subagents to dispatch. Tempting but fragile: it doubles the LLM round-trips, the meta-agent's choice is hard to audit, and benchmarks (Aider, Claude Code) show explicit `/architect` style decomposition outperforms LLM-mediated splitting. Rejected — `Dispatcher` is a primitive the planner or a primary agent calls; the splitting decision lives at a higher layer.

- **Run subagents inside the existing `Task` tool with `parallel: true` flag.** Considered. Rejected because `Task` is a single-call tool — its result is a string. We need typed `DispatchResult[]`, per-subagent permission resolution, merge strategies, and Bus eventing that don't fit the Task abstraction. `Task` stays for one-off subagent invocations; `Dispatch` is for structured fan-out.

- **Reuse Effect's `Effect.all` parallelism inside agent/agent.ts.** Would require pushing Effect deeper into the dispatch path. Repo's Effect-frozen rule (CLAUDE.md, `script/check-no-effect-solid-in-v4.ts`) blocks this — new modules must not introduce Effect.

- **Per-subagent rate limit instead of `maxParallel`.** Rejected: `maxParallel` is what callers want to bound (LLM provider quota, local CPU). Rate limits can be layered on top.

## Consequences

### Positive

- Removes the most documented competitor gap: parallel specialist work in one turn.
- Builds cleanly on the rounds-1–5 substrate: replan phases can be tagged with target agents and dispatched; clarification-derived constraints flow through to each subagent unchanged; per-agent memory filtering already exists.
- Read-only specialist parallelism (security + perf + architect) is unblocked immediately — no isolation infrastructure needed.
- Effect-frozen contract preserved: the dispatcher is plain async/await + Zod, with Bus integration via injection at the session layer.
- The `Dispatch` tool gives the LLM an explicit fan-out surface, matching the `/architect` UX users transferring from Aider already expect.

### Negative / Costs

- Two writers to overlapping files still serialise (pessimistic). Heavy multi-file refactors that benefit from parallel writes will need worktree isolation — that work is explicitly out of scope here.
- Token cost scales with parallelism. `maxParallel` is the only knob; cost-aware scheduling is not modeled.
- New permission action (`dispatcher`) means existing agents need to be reviewed for whether they should be allowed to fan out. Default-deny for subagent-tier agents is the safe stance but may surprise downstream users who expect `general` to recursively dispatch.
- Merge strategies are a new failure mode surface — `first-success` cancellation needs careful AbortSignal plumbing through tool calls.

### Migration / Rollback

- `dispatch/` is purely additive; nothing existing changes.
- The `Dispatch` tool is opt-in by tool registration — disabling it leaves all behaviors at status quo.
- The `dispatcher` permission defaults to deny everywhere except for `primary` core agents (`build`, `react`); existing configs do not need migration.
- Rollback path: unregister the `Dispatch` tool and the `dispatch/` module is dead code — no Bus consumers, no permission interactions, no schema versions.

## Immediate Implementation Slice

P0 (this ADR's first slice):

1. **Module scaffold.** `packages/ax-code/src/dispatch/index.ts` exports `dispatch(specs, options)` with the API above. Implementation uses `Promise.allSettled` + a `Promise.race` for `first-success`. No Effect, no Bus.

2. **Tests.** `test/dispatch/index.test.ts` covers: parallel happy path, per-subagent timeout, merge strategies (`all`/`first-success`/`majority`), error propagation, AbortSignal cancellation. Uses an injected agent-loader fake — no Provider needed.

3. **Permission.** Add `"dispatcher"` to `Permission.Action`. Default ruleset in `agent/agent.ts` defaults: `dispatcher: "deny"` for subagent-tier; `"allow"` for `build`, `plan`, `react`.

4. **Bus event sink.** Define `DispatcherEventSink` interface in `dispatch/`. Provide a session-layer adapter (`session/dispatch-bus-sink.ts`) that translates to Bus events. Audit the existing audit-log subscribers so dispatch events flow to telemetry.

5. **Tool registration.** Add `packages/ax-code/src/tool/dispatch.ts` with input schema `{ specs: DispatchSpec[], options?: DispatchOptions }` and output rendering that summarises each subagent result. Wire it into the tool registry.

P1 (next slice, separate PR):

- Architect/editor split inside Planner: phases declare `agent` field; `Planner.execute` routes each phase through the dispatcher.
- TUI rendering of parallel-progress (depends on the Bus events from P0).
- `Replanner` integration: `withApproval` extension that lets the user pick which agent runs which proposed phase.

P2 (deferred to a future ADR):

- Worktree isolation per subagent. Likely needs a separate `worktree/` namespace and `Snapshot` integration.
- Conflict-aware optimistic concurrency for write-mode subagents.
- LLM-driven auto-decomposition that chooses dispatch specs from a single prompt.

## Open Questions

- **How does `dispatch()` interact with `INTERACTIVE_ONLY` tools?** A subagent that needs `Question.ask()` blocks until the user replies; if the parent's `mergeStrategy: "first-success"` cancels siblings while one is awaiting a question, the question should be retracted. P0 design: cancellation triggers `Question.reject()` for any pending question owned by the cancelled subagent. Needs Bus plumbing.

- **Audit-log shape.** Replay tests depend on event ordering. Parallel subagents will emit interleaved tool events; the replay layer must gain a "subagent group" framing. Not P0 — but needed before this ships behind a flag.

- **Cost telemetry.** Token usage aggregation across subagents is straightforward; latency is not (parallel ≠ sum). Decide whether the Quality dashboard reports max(child_latency) or sum(child_latency).
