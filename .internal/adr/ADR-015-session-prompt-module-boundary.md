# ADR-015: Extract pure logic from session/prompt.ts into focused prompt-* modules

**Status:** Accepted; extraction in progress
**Date:** 2026-05-25
**Deciders:** ax-code maintainers
**Related:** ADR-012 Autonomous continuation contracts, ADR-014 Durable session goals

---

## Context

`session/prompt.ts` is the main session processing loop. It accumulated 1752 lines across multiple feature layers:

- Autonomous continuation logic (step-limit, deadline, empty model turn, completion gate, todo, goal).
- Message construction for user, assistant, and synthetic messages.
- Loop control decisions (`continue`, `break`, retry state mutation, error publication).
- Storage side effects (`Session.publishError()`, compaction scheduling, recorder events).
- Agent routing hints embedded in synthetic messages.
- Shell, subtask, file attachment, and reference message assembly.

ADR-012 established the first safe extraction slice: continuation prompt builders separated from loop control. That slice confirmed the boundary: extracted modules can own prompt text and decision logic, but they must not own storage mutations or loop flow control.

The extraction has since expanded to ~35 specialized `prompt-*.ts` modules covering decisions, continuations, messages, helpers, and structured tools. Without a documented boundary, contributors add logic directly to `prompt.ts` or create new modules without a consistent pattern, which re-centralizes the hotspot over time.

## Decision

The `session/prompt.ts` file is the **loop orchestrator**. Extractable modules are **pure helpers**. The boundary is:

> `prompt.ts` owns: session state reads, loop control (`continue`/`break`), storage mutations, Effect calls, retry counter updates, error publication, and conditional orchestration of sub-flows.
>
> Extracted modules own: decision logic, prompt string builders, message factories, and formatting — all as pure TypeScript functions with no side effects.

### What belongs in extracted modules

- **Decision functions** — receive typed inputs, return typed decision objects or discriminated unions. Never mutate state.
- **Continuation builders** — return the prompt string for a named continuation path. Receive todo state, retry counts, etc. as arguments; do not read them from module-level singletons.
- **Message factories** — produce `ModelMessage` or `MessageV2` shapes from typed inputs.
- **Formatters** — produce strings or message parts for display or injection.

### What stays in prompt.ts

- Effect-based session I/O and subscription lifecycles (because `session/` is an Effect-allowed zone per ADR-017).
- Storage writes: `Session.publishError()`, `Recorder.track()`, compaction scheduling.
- Loop control: all `continue`, `break`, retry counter mutation, autonomous flag checks.
- Conditional dispatch to extracted helpers; the extracted helpers never import from `prompt.ts`.

### Module naming conventions

| Pattern | Purpose |
|---------|---------|
| `prompt-{noun}-decisions.ts` | Pure decision functions returning typed result objects |
| `prompt-{noun}-continuations.ts` | Continuation prompt string builders for named recovery paths |
| `prompt-{noun}-messages.ts` | Message assembly for a named message category |
| `prompt-{noun}-builders.ts` | Primitive message factories (e.g., `textPart`, `zeroTokenUsage`) |
| `prompt-{noun}.ts` | General helpers when the above don't apply |

### Key invariants

1. Extracted modules must not import from `prompt.ts` — circular imports indicate a boundary violation.
2. Synthetic continuation messages must pass `agentRouting: "preserve"` through `createUserMessage()` to prevent keyword routing from overriding the current agent.
3. Terminal safety stops must not be represented as completion — use the named non-completion reasons from `prompt-autonomous-decisions.ts`.
4. Decision functions return typed objects (never raw booleans when the meaning is not obvious from call site context).

## Alternatives Considered

- **Extract the full loop into a class or state machine now.** Rejected for this slice. The current loop mixes pure decisions with Effect-based I/O; a class wrapper would add indirection before contracts are stable. ADR-006 covers the eventual `AgentPhase` state machine.
- **Move prompts to `.txt` files.** Deferred. Prompts depend on dynamic formatting, pluralization, retry counts, and completion-gate messages — TypeScript builders are the right first boundary.
- **Keep everything in prompt.ts with better comments.** Rejected. The file was at 1752 lines with 12+ concern areas. At that size, even localized changes produce large, hard-to-review diffs.

## Consequences

### Positive

- Continuation prompts, decision logic, and message builders are independently testable without a full session loop.
- `prompt.ts` shrinks toward a pure orchestrator that is easier to audit for correct loop control.
- New autonomous paths (ADR-014 goal continuation, future `AgentPhase` recovery) have a clear module home.
- The boundary prevents the file from re-accumulating mixed concerns over time.

### Costs

- ~35 modules means more import statements in `prompt.ts`; this is intentional, not tech debt.
- New contributors must learn the boundary before adding features.
- `prompt.ts` remains large (currently 1752 lines) during the extraction phase; shrinkage is incremental.

## Implementation State

| Area | Module | Status |
|------|--------|--------|
| Primitive message factories | `prompt-message-builders.ts` | Extracted |
| Loop control decisions | `prompt-loop-decisions.ts` | Extracted |
| Autonomous decisions | `prompt-autonomous-decisions.ts` | Extracted |
| Continuation builders | `prompt-autonomous-continuations.ts` | Extracted (ADR-012 slice) |
| Todo continuation decisions | `prompt-todo-continuation.ts` | Extracted |
| Agent/model info | `prompt-agent-model-info.ts` | Extracted |
| Command setup | `prompt-command-setup.ts` | Extracted |
| Command selection | `prompt-command-selection.ts` | Extracted |
| Provider fallback | `prompt-provider-fallback.ts` | Extracted |
| Structured output tool | `prompt-structured-output.ts` | Extracted |
| Shell runtime | `prompt-shell-runtime.ts` | Extracted |
| Reminders | `prompt-reminders.ts` | In progress |
| Routing helpers | `prompt-routing.ts` | In progress |
| Shell turn | `prompt-shell-turn.ts` | In progress |
| Subtask execution | `prompt-subtask.ts` | In progress |
| Assistant response | `prompt-assistant-response.ts` | In progress |
| Loop messages | `prompt-loop-messages.ts` | Extracted |
| Message parts | `prompt-message-parts.ts` | Extracted |
| System prompt | `prompt-system.ts` | Extracted |
| Title | `prompt-title.ts` | Extracted |
| Goal arguments | `prompt-goal-arguments.ts` | Extracted |

## Follow-Up

- Complete the in-progress modules and verify no circular imports (`bun run typecheck`).
- Once the pure helpers stabilize, begin extracting branch decisions one at a time from `prompt.ts` per the ADR-012 follow-up plan.
- The `AgentPhase` state machine (ADR-006 pending) should build on these extracted decision functions, not on prompt text.
