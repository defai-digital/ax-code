# ADR-014: Treat `/goal` as durable session state

**Status:** Accepted
**Date:** 2026-05-23
**Deciders:** ax-code maintainers
**Related:** ADR-004 Autonomous Mode Hardening, ADR-012 Autonomous Continuation Contracts, PRD-2026-05-23 Durable Session Goals

---

## Context

OpenAI Codex CLI uses `/goal` as a durable objective for long-running work. The key architectural idea is that the goal is not just another prompt. It is thread/session state with lifecycle controls and model-visible tools.

`ax-code` already has autonomous continuation paths for unfinished todos, empty model turns, completion-gate retries, and step-limit continuation. Those paths keep a run moving, but they do not provide a first-class user contract for "keep working until this verifiable objective is actually done."

Adding `/goal` as a command template would be easy but would recreate the same weakness as ordinary prompts: the objective would live only in transcript text, could be weakened by compaction, and could not be inspected or controlled separately from assistant output.

## Decision

Implement `/goal` as durable session-domain state:

1. Persist one goal per session in `session_goal`.
2. Expose user lifecycle control through `/goal`.
3. Expose model tools for goal read/create/status update:
   - `get_goal`
   - `create_goal`
   - `update_goal`
4. Restrict model status updates to `complete` and `blocked`.
5. Keep pause, resume, clear, and budget-limited transitions under user/runtime control.
6. Inject current goal state into the system prompt as task context.
7. Let the prompt loop schedule bounded goal continuations after ordinary model stops while the goal remains active.

## Alternatives Considered

- **Slash-command prompt template only.** Rejected. It is discoverable but not durable, not inspectable, and cannot provide lifecycle or budget semantics.
- **Reuse todos as goals.** Rejected. Todos are useful work breakdown state; a goal is the higher-level completion contract.
- **Store goal only in config or project memory.** Rejected. Goals are session-scoped and should be deleted with the session.
- **Implement background daemon execution now.** Deferred. The session state contract is the prerequisite; long-running background scheduling should build on it later.

## Consequences

### Positive

- Goal completion becomes explicit instead of inferred from assistant text.
- Compaction and continuation can retain the objective without relying on transcript search.
- Users get deterministic lifecycle controls.
- Model behavior can be tested through tools instead of fragile prompt text only.

### Costs

- Adds a migration and new session table.
- Adds another branch to the prompt loop, which is already a hotspot.
- Phase 0 still uses bounded continuation caps, so it is not yet a fully independent long-running daemon.

## Follow-Up

- Add TUI status surfaces for active/paused/budget-limited goals.
- Add sync events if live UI state needs to update without polling.
- Revisit goal continuation budgeting after Phase 0 has runtime evidence.
