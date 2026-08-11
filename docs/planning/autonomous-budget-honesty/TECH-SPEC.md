Status: Active
Scope: planning
Last reviewed: 2026-08-11
Owner: ax-code runtime

# Tech Spec: Autonomous Budget Honesty

| Field | Value |
|-------|-------|
| Status | Active |
| Date | 2026-08-11 |
| PRD | [PRD-2026-08-11-autonomous-budget-honesty](../../prd/PRD-2026-08-11-autonomous-budget-honesty.md) |
| ADR | [ADR-051](./ADR-051-autonomous-budget-honesty.md) |

---

## 1. Scope

In scope:

- `packages/ax-code/src/agent/agent.ts` — remove native specialist `steps` literals
- `packages/ax-code/src/session/prompt-impl.ts` — effective pacing cap on busy; last-step tool omit
- `packages/ax-code/src/session/prompt-loop-status.ts` — optional agent label on busy (if used)
- `packages/ax-code/src/cli/cmd/tui/routes/session/header.tsx` + related view helpers
- `docs/guides/autonomous.md` — budget documentation
- Tests under `packages/ax-code/test/agent/`, `test/session/`, TUI pure tests

Out of scope:

- OpenAPI / SDK generation unless schema fields are required
- `experimental.autonomous_caps` promotion
- Burst / tool-only configurability

---

## 2. As-built (relevant)

```
prompt loop (prompt-impl.ts)
  step++ / totalSteps++
  resolve agent → maxSteps = agent.steps ?? Infinity
  agent step-limit decision (continue / stop / ignore)
  isLastStep = step >= maxSteps
  build request (+ max-steps.txt if isLastStep)
  omitToolSchemas only if forceTextOnly / response-only   ← gap
  processor tool path: blast radius + 30/10s rate limit

TUI
  SessionStatus busy { step, maxSteps } always sessionStepLimit at loop top  ← gap
  autonomousActiveView: presence of step+maxSteps ⇒ "AUTONOMOUS" chip
```

---

## 3. Design

### 3.1 Specialist defaults

In `Agent.state` factory for `react|security|architect|debug|perf|devops|test`, delete `steps: 25|30` properties. Config merge path (`item.steps = value.steps ?? item.steps`) already supports overrides.

### 3.2 Effective pacing cap

After agent resolution each outer iteration:

```ts
const agentMax = agent.steps ?? Infinity
const effectiveMaxSteps = Number.isFinite(agentMax)
  ? Math.min(agentMax, sessionStepLimit)
  : sessionStepLimit

await markPromptLoopBusy({
  sessionID,
  step,
  maxSteps: effectiveMaxSteps,
  consecutiveErrors,
})
```

Keep the early loop-top busy update for heartbeat, then **overwrite** after agent resolve so the chip converges to the truth before the model call.

### 3.3 Last-step tool omit

Where `omitToolSchemas` is computed:

```ts
const omitToolSchemas =
  Boolean(responseOnlyProfile) ||
  ((forceTextOnlyTurn || isLastStep) && lastUser.format?.type !== "json_schema")
```

Ensure the tool map passed to the stream/processor is empty when omitted (existing force-text path).

### 3.4 TUI

- Chip continues to use `autonomousActiveView` for multi-step busy.
- Prefer `sync.data.autonomous` for the word "AUTONOMOUS" vs neutral "WORKING" when multi-step is active but autonomous is off (optional polish).
- Denominator is whatever server emitted (now effective).

### 3.5 Docs

Extend `docs/guides/autonomous.md` with:

| Cap | Default | Config |
|-----|---------|--------|
| Session per-segment steps | 500 | `session.max_steps` |
| Auto-continuations | 3 | `session.max_continuations` |
| Cumulative total | 2000 / 20000 goal | `session.max_total_steps` |
| Agent steps | ∞ (unless set) | `agent.<name>.steps` |
| Blast tool calls | 500 / segment | `experimental.autonomous_caps.steps` |
| Tool-only streak | ~35 | (constant) |
| Burst | 30 / 10s | (constant) |

---

## 4. Test plan

| Case | Expect |
|------|--------|
| Default specialists have no `steps` | `undefined` |
| Config `agent.debug.steps: 40` | steps === 40 |
| Pure function / unit: effective cap `min(30, 500) === 30` | if extracted |
| `autonomousActiveView` still works with step/maxSteps | existing tests green |
| isLastStep forces omit tools | unit on request path or prompt-impl decision |

---

## 5. Implementation order

1. Docs + ADR index (this folder + prd + adr)
2. agent.ts specialist steps removal
3. prompt-impl effective busy + last-step omit
4. TUI label polish (if small)
5. autonomous.md
6. tests
7. commit + push
