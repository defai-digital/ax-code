# ADR-016: Agent routing is keyword-only; no LLM tier, intent gates, or delegation modes

**Status:** Accepted
**Date:** 2026-04-27; Accepted 2026-05-25
**Deciders:** ax-code maintainers
**Related:** ADR-005 Subagent orchestration, ADR-015 Session prompt module boundary

---

## Context

`agent/router.ts` routes a user message to the appropriate specialist agent (`security`, `perf`, `architect`, `debug`, `devops`, `test`, etc.) when the primary agent can be skipped in favor of a direct specialist.

The v2.x router was keyword-only: score message tokens against a per-agent keyword list, fire the top match when score ≥ threshold. Users perceived it as working because it was simple and predictable.

v3+ added layers to improve precision:

- **Intent gates** — an LLM classification call before keyword scoring to assess user intent.
- **Negative-keyword blockers** — deny-list patterns that suppressed specialist routing.
- **LLM routing tier** — a second model call to choose between equally-scoring agents.
- **Switch/delegate modes** — routing could trigger an agent handoff mid-session rather than a single-turn specialist invocation.
- **Read-only specialist restrictions** — routing logic enforced read-only mode for certain agents.

The cumulative effect was that routing almost never fired in practice. Each layer added a condition the message had to satisfy, and real user messages rarely satisfied all of them. When routing did fire, the LLM tier made the decision non-auditable: neither the user nor the developer could predict or explain why a particular agent was chosen.

On 2026-04-27, all v3+ routing additions were removed and the v2-style keyword router was restored.

## Decision

Agent routing is sync, keyword-only, and fires whenever a topic keyword scores ≥ 0.4.

Specifically:

1. **`route()` is synchronous.** No async calls, no LLM invocations, no external lookups. It scores keywords against the message and returns the best match or `null`.
2. **Threshold is 0.4.** A match at or above this confidence fires; below it, the primary agent handles the message.
3. **`classifyComplexity()` is a separate async function.** It uses an LLM to classify message complexity for fast-model selection. It is not part of routing and must not gate routing decisions.
4. **No intent gates.** Routing must not require an LLM call to assess whether the user "really" wants a specialist.
5. **No negative-keyword blockers.** Routing must not maintain deny-list patterns. If a keyword match is wrong, adjust the keyword list or the threshold, not the gate logic.
6. **No switch/delegate modes.** Routing selects the agent for this message. It does not trigger mid-session agent handoffs or delegation chains. Agent-to-agent delegation belongs in the subagent dispatch layer (ADR-005).
7. **No read-only enforcement in routing.** If a specialist agent should be read-only, that is expressed in the agent's permission configuration, not in routing logic.

### Allowed extensions

- Add or tune keywords in `RULES` to improve specialist match quality.
- Adjust the confidence threshold if field evidence shows the current value is too aggressive or too conservative.
- Add new specialist agents by adding a new entry to `RULES` with keywords and patterns.

### Prohibited changes

- Adding an async LLM call inside `route()` for any reason.
- Introducing a gating condition that must be true before keyword scoring runs.
- Adding a deny-list that suppresses routing after a keyword match.
- Re-introducing switch/delegate/handoff semantics inside `route()`.
- Enforcing agent permission level or read-only status from within the router.

## Alternatives Considered

### Keep the v3+ routing layers

Rejected. The layers were individually reasonable but collectively prevented routing from firing. Field evidence was clear: users could not predict or rely on specialist routing, and several bug reports described the primary agent handling work that should have gone to a specialist.

### Replace keyword routing with full LLM routing

Rejected. LLM routing costs an extra round-trip on every message, makes routing non-auditable, and adds latency before the user's actual work begins. The performance/reliability trade-off is not justified when keyword matching is sufficient for the known specialist domains.

### Remove routing entirely

Considered. If subagent dispatch (ADR-005) matures into explicit parallel fan-out, keyword routing may become redundant. Not removed now because dispatch requires the primary agent to emit an explicit `Dispatch` tool call, which means the primary agent must first recognize the specialist need. Keyword routing fires before the primary agent starts, which is a different and faster path for unambiguous cases.

### Move routing into a prompt-injection rather than an agent swap

Considered. Injecting a "you are a security expert" system-prompt extension into the primary agent's context avoids routing overhead. Rejected for now because specialist agents have distinct permission presets, tool sets, and skill profiles that cannot be replicated by prompt injection alone.

## Consequences

### Positive

- Routing is auditable: given a message and the `RULES` table, any developer can predict the outcome without running the system.
- No latency cost: `route()` is synchronous and completes in microseconds.
- Specialist routing fires reliably for unambiguous cases (messages with clear domain keywords).
- The router remains easy to extend (add keywords, add agents) without touching control flow.

### Negative / Costs

- Ambiguous messages with mixed domain keywords may route to the wrong specialist.
- Keyword lists need maintenance as specialist domains evolve.
- Messages that do not hit the 0.4 threshold go to the primary agent, even when a specialist could help; the user can work around this with explicit agent commands.

## Invariants to Preserve

- `route()` must remain synchronous and return `string | null`.
- The confidence threshold (0.4) must be a named constant, not a magic literal.
- Each specialist entry in `RULES` must include both `keywords` (string) and `patterns` (RegExp) arrays.
- `classifyComplexity()` must remain a separate export and must never be called from `route()`.
