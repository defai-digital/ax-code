Status: Active
Scope: planning
Last reviewed: 2026-08-11
Owner: ax-code runtime

# ADR-051: Autonomous Budget Honesty

| Field | Value |
|-------|-------|
| Status | Accepted |
| Date | 2026-08-11 |
| Deciders | AX Code maintainers |
| Supersedes | Implicit specialist step defaults in `agent.ts` (25/30) |
| Related | PRD-2026-08-11-autonomous-budget-honesty; ADR-048; dual review 2026-08-11 |

---

## Context

Autonomous mode already has layered safety:

- Permission / question policy
- Per-continuation `session.max_steps` (default 500)
- Auto-continuations and cumulative `max_total_steps`
- Blast-radius tool/file/line/per-tool caps
- Tool-only and doom-loop breakers
- Goals / Super-Long long-run backstops

Despite that, users experienced a **30-step wall**. Review showed three independent ~30 ceilings (specialist `agent.steps`, tool-only warning, burst rate limit) plus a TUI that always advertised `session.max_steps` (500) as the denominator.

Hardcoding finite `steps` on **auto-routed primary** specialists conflicts with the OpenCode-like semantic that **unset means model-driven / session-capped only**.

## Decision

### D1 — Primary specialists default unbounded like `build`

Native primary specialists do not ship a built-in `steps` integer. Runtime continues to use `agent.steps ?? Infinity`. Users may still set `agent.<name>.steps` in config for deliberate budgets. Subagent nesting depth and workflow agent caps remain separate systems.

### D2 — Busy status reports the effective pacing cap

`SessionStatus` busy `maxSteps` is the effective per-segment pacing ceiling for the **resolved** agent:

```text
effective = finite(agent.steps)
  ? min(agent.steps, session.max_steps)
  : session.max_steps
```

The TUI chip uses this value so the governing limit is visible. Multi-step busy still emits `step`/`maxSteps`; the AUTONOMOUS label prefers the real autonomous preference from sync when available.

### D3 — Last finite agent step is technically tool-free

When the loop is on the last permitted agent step (`isLastStep` for a finite agent budget), the provider request omits tool schemas (same mechanism as force-text recovery), not only the advisory `max-steps.txt` assistant message.

### D4 — Documentation is part of the product contract

User-facing `docs/guides/autonomous.md` must describe the budget stack (session, agent, continuations, totals, blast radius, stall breakers). Internal PRD/ADR/tech-spec live under `.internal/`.

## Alternatives considered

- **Raise 25/30 to 500** — rejected: preserves a second silent ceiling that can diverge from `session.max_steps` and still confuses auto-routed sessions.
- **Disable auto-routing by default** — deferred: routing still useful for specialist prompts; honesty + unbounded specialists fix the sharp edge without removing routing.
- **Full `autonomy.budget` schema in v1** — deferred: high migration cost; v1 fixes honesty with existing knobs.

## Consequences

- Large debug/security/devops tasks no longer die at an invisible 30 on default installs.
- Users who relied on specialist 25/30 as an implicit cost brake must set `agent.<name>.steps` explicitly (document this).
- Tests that assumed native specialist steps must be updated if any existed; config override tests remain the source of truth for finite budgets.
- Follow-up work: `/limits` doctor, configurable tool-only/burst, composable stop reasons.
