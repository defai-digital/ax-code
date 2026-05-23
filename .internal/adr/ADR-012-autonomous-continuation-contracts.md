# ADR-012: Make autonomous continuation prompts and terminal semantics explicit contracts

**Status:** Accepted
**Date:** 2026-05-23
**Deciders:** ax-code maintainers
**Related:** ADR-004 Autonomous Mode Hardening, ADR-005 Subagent Orchestration

---

## Context

Autonomous mode now has several continuation paths in `packages/ax-code/src/session/prompt.ts`:

- Global step-limit continuation.
- Per-agent step-limit continuation.
- Empty model turn recovery.
- Completion-gate recovery for incomplete subagent evidence.
- Large-context report todo convergence.
- Deadline convergence before agent tools are disabled.
- Pending-todo continuation after the model stops early.

These paths are correct but fragile because prompt wording, retry state, storage side effects, terminal reasons, and specialist-agent routing are still close together in the main prompt loop. Prior regressions showed two contracts are especially important:

- A synthetic autonomous continuation must preserve the current agent instead of being keyword-routed by todo text.
- An autonomous safety stop with pending work must not be represented as true completion.

The current architecture review correctly identifies `prompt.ts` as the hotspot, but a full decision-tree extraction is too large for the next safe slice. The low-risk boundary is to make continuation prompt construction explicit first, then extract branch decisions incrementally.

## Decision

Treat autonomous continuation behavior as a set of explicit contracts, not incidental prompt-loop text:

1. Continuation prompt strings live behind named builder functions.
2. Synthetic continuation messages continue to call `createUserMessage()` with `agentRouting: "preserve"`.
3. Terminal safety stops keep their current non-completion reasons and assistant diagnostics.
4. Decision extraction happens branch-by-branch only after each branch has focused tests.
5. `SafetyPolicy` remains documented as a control-plane/telemetry policy model until it is wired into the enforcement path.

The immediate implementation slice is prompt-builder extraction plus tests. It intentionally leaves storage, logging, retry counter mutation, `Session.publishError()`, and loop `continue`/`break` behavior in `prompt.ts`.

## Alternatives Considered

- **Extract the full autonomous decision tree now.** Rejected for this slice. The current code mixes pure decisions with message creation, cache resets, error publication, and terminal reasons. Moving it all at once creates regression risk around completion semantics.
- **Move prompts to `.txt` files.** Deferred. The prompts depend on dynamic todo formatting, pluralization, retry counts, and completion-gate messages, so TypeScript builders are a better first boundary.
- **Create an `AutonomousMode` class.** Rejected. Autonomous behavior is cross-cutting across prompt, permission, question, and control-plane surfaces. A wrapper class would add indirection before the contracts are stable.

## Consequences

### Positive

- Prompt wording can be reviewed and tuned in one module without editing loop control flow.
- Tests can assert the exact high-risk continuation guidance independently of the full session loop.
- Future branch-by-branch decision extraction has a smaller diff and clearer acceptance criteria.
- The current specialist-agent preservation behavior stays explicit.

### Costs

- `prompt.ts` remains large after this slice; this ADR prioritizes correctness contracts over line-count reduction.
- The prompt builder module imports session todo formatting and locale helpers, so it is still a session-domain helper, not a generic prompt package.

## Follow-Up

After this slice, extract pure decisions one branch at a time:

1. Empty model turn decision.
2. Completion-gate retry/stop decision.
3. Context and deadline convergence nudges.
4. Pending-todo stop/continue behavior already has a helper and should remain the reference pattern.
