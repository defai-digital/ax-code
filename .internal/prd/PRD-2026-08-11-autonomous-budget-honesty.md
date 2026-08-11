# PRD: Autonomous Budget Honesty

| Field | Value |
|-------|-------|
| Status | Active |
| Owner | AX Code runtime |
| Created | 2026-08-11 |
| Related | Dual review (Codex + Qoder, 2026-08-11); ADR-051; `.internal/reports/planning/autonomous-budget-honesty/TECH-SPEC.md`; ADR-048 (agentic runtime) |
| Location | `.internal/prd/PRD-2026-08-11-autonomous-budget-honesty.md` |

---

## 1. Problem statement

Users report that autonomous mode is "hardcoded to 30 steps" and does not fit
real multi-file / multi-task workloads. A 2026-08-11 dual-agent design review
(Codex + Qoder) of the current tree traced this to a **budget-honesty gap**,
not a single 30-step ceiling. There is a layered budget stack, but three of
its layers disagree with what the UI shows, and one layer is enforced by
prompt text rather than by the API. The product contract is partially sound
at the safety layer and **not honest** at the user-facing layer.

This is not a runaway-cost crisis — the caps that actually fire
(`agent.steps`, the tool-only circuit breaker, the burst limiter) keep runs
bounded. It is a **trust and debuggability** crisis: the status line lies
about how much budget remains, the silent agent switch changes the rules
mid-run, and a model that ignores a text instruction can still call tools on
the step that is supposed to be tool-free.

## 2. Findings (as-built budget stack)

| Layer | Constant / source | Value | Enforced where | Visible to user? |
|-------|-------------------|-------|----------------|------------------|
| Global session step ceiling | `GLOBAL_STEP_LIMIT` (`constants/session.ts:8`) | 500 | `promptLoopLimits.sessionStepLimit` | **TUI denominator (always)** |
| Autonomous aggregate cap | `AUTONOMOUS_MAX_STEPS` (`constants/session.ts:47`) | 500 | `blast-radius.ts` caps | no |
| Per-agent pacing step cap | `agent.steps` (`agent/agent.ts:241-325`) | **build unset (∞)**; react/architect/perf/test = **25**; security/debug/devops = **30** | `handlePromptLoopAgentStepLimit` → stop or auto-continue | **no** |
| Cumulative total across continuations | `maxTotalSteps` = `sessionStepLimit × (maxContinuations+1)` | ~2000 default | prompt loop backstop | no |
| Goal / Super-Long cumulative | `GOAL_TOTAL_STEP_HEADROOM` = `SUPER_LONG_TOTAL_STEP_HEADROOM` = 40 | 500 × 40 = 20,000 | long-run backstop | no |
| Tool-only outer-turn circuit breaker | `TOOL_ONLY_TURN_NUDGE` / `_FINAL_NUDGE` / `MAX_TOOL_ONLY_TURNS` (`prompt-loop-config.ts:9,19,24`) | nudge 15, final nudge **30**, hard stop **35** (observed ~36) | streak counter | no |
| Per-tool call-count caps | `AUTONOMOUS_PER_TOOL_MAX_CALLS` (`constants/session.ts:92`) | bash 50, edit 100, write 50, apply_patch 50, multiedit 50 | per-tool layer | no |
| Sliding-window burst limiter | `processor-impl.ts:159` rate limiter | **30 tool calls / 10s** | per-session window | no |

Three concrete defects follow from this table:

1. **Hardcoded agent steps on auto-routed specialists.** The keyword router
   (`agent/router.ts`) silently switches to `security`/`debug`/`devops` (30)
   or `react`/`architect`/`perf`/`test` (25) on a ≥0.4 keyword match. The
   `build` agent — the default and the honest baseline — has no `steps` field
   (unbounded). So a routine "fix this bug" message auto-routes to `debug`
   and runs under a 30-step cap the user never opted into.
2. **Dishonest busy status.** `prompt-impl.ts:445` emits
   `maxSteps: sessionStepLimit` (500) on the busy event regardless of the
   active agent. The TUI renders `step {n}/{maxSteps}` from
   `autonomous-active.ts`. When the active agent is `debug` (steps 30), the
   status line reads "step 3/500" while the real pacing cap is 30 — so the
   run ends at ~30 with ~470 of the advertised budget apparently unused.
3. **Last step is prompt-only, not API-enforced.** On `isLastStep`,
   `prompt-request-build.ts:73-80` appends the `max-steps.txt` assistant
   message (whose body says "Tools are disabled ... Respond with text only").
   It does **not** set `toolChoice: "none"` or omit the tools array. The only
   path that forces `toolChoice: "none"` is `forceTextOnlyTurn`
   (`prompt-autonomous-decisions.ts` `resolveTurnToolChoice`), which is driven
   by the tool-only breaker and response-only turn profiles — not by
   `isLastStep`. A model that ignores the text instruction can still emit tool
   calls on its final step.

## 3. Goals

- **G1 — Remove hidden specialist step walls** for auto-routed primary agents
  so ordinary autonomous work is not silently capped at 25/30. The
  session-level and aggregate caps remain the real backstops.
- **G2 — Honest live budget reporting.** The TUI denominator is the
  **effective pacing cap** for the active agent —
  `min(finite agent.steps, sessionStepLimit)` — not always 500, and the chip
  names the agent when capped.
- **G3 — Enforce last-step finalization at the API.** Omit tool schemas and
  force `toolChoice: "none"` on `isLastStep`, reusing the `forceTextOnlyTurn`
  path rather than relying on prompt text.
- **G4 — Document the full budget stack** in user-facing guides. Documentation
  is part of the product contract (ADR-051 D4).
- **G5 — Preserve safety.** Sandbox, deny rules, blast-radius mutation caps,
  doom-loop detection, goal verification, and Super-Long ceilings remain
  intact. v1 removes a *pacing* cap, not a cost backstop.

## 4. Non-goals (v1)

- Full `autonomy.budget` schema redesign / named profiles (`quick`/`long`/`goal`).
- Progress-aware soft budget extension.
- Making tool-only and burst limits user-configurable (follow-up).
- Changing Super-Long / goal cumulative defaults (20,000).
- Removing auto-routing entirely (optional disable already exists).

## 5. Requirements

### Specialist defaults (R1–R2)

- **R1 — Unbound primaries:** remove the `steps` field from the auto-routed
  primary specialists (`security`, `architect`, `debug`, `perf`, `devops`,
  `test`, and the core `react` agent) in `src/agent/agent.ts` so they default
  to unbounded, matching `build` / `plan` (runtime resolves
  `agent.steps ?? Infinity`). The agent definitions gain a comment noting
  that pacing is the session/aggregate cap's job.
- **R2 — Config override preserved:** a user may still set a finite
  `agent.<name>.steps` through config, and that value is honored exactly as
  today (it flows into the same `maxSteps` used by
  `handlePromptLoopAgentStepLimit`). v1 changes only the *default*, not the
  override mechanism.

### Honest status / UI (R3–R5)

- **R3 — Effective denominator:** the busy event emitted by the prompt loop
  carries `maxSteps = min(finite agent.steps, sessionStepLimit)` rather than
  `sessionStepLimit` unconditionally. When the active agent has no finite
  `steps` (the default after R1), the denominator is `sessionStepLimit`
  (unchanged behavior).
- **R4 — Agent label:** when the denominator is capped by `agent.steps`, the
  TUI status line shows the agent display name (e.g. `· step 3/30 · debug`)
  so the cap is self-explaining. When the denominator is `sessionStepLimit`,
  the label is shown only if the active agent differs from the session's
  default (i.e. auto-routing fired).
- **R5 — Autonomous flag:** the busy event also carries the autonomous flag;
  the chip reflects the true autonomous preference from `sync.data.autonomous`
  and multi-step progress shows only while busy with step counters.

### Last-step enforcement (R6)

- **R6 — Last step is tool-free at the API:** when `isLastStep` is true (and
  the request is not a JSON-schema structured-output turn whose `required`
  tool choice must be preserved), the request builder sets
  `toolChoice: "none"` and omits the tools array, reusing the same resolution
  as `forceTextOnlyTurn` (`resolveTurnToolChoice`). The `max-steps.txt`
  assistant message is still appended as prompt-level guidance so the model
  explains what it accomplished, but the guarantee no longer depends on the
  model obeying that text.

### Documentation & surfacing (R7–R8)

- **R7 — autonomous.md budget section:** `docs/guides/autonomous.md` gains:
  (a) the full budget table from §2 in user-facing terms; (b) an explicit
  auto-routing note explaining that keyword matches may switch the active
  agent and that, when a finite per-agent cap is in force, the status line
  names the agent; (c) the config keys that move each layer
  (`session.max_steps`, `session.max_continuations`, `session.max_total_steps`,
  per-agent `steps`, `experimental.autonomous_caps`). The "Source of Truth"
  section is extended to point at `prompt-loop-config.ts`, `blast-radius.ts`,
  `constants/session.ts`, and `agent/router.ts`.
- **R8 — Route toast mentions budget when capped:** the existing auto-route
  toast already announces the agent switch. After R1 most primaries are
  unbounded, so this is usually a no-op; but when the routed-to agent has a
  finite `steps` (explicit config or a future bounded primary), the toast
  includes the step budget. A mid-turn agent switch applies the new cap from
  the next outer turn, never retroactively to the in-flight turn.

## 6. Acceptance criteria

- [ ] Default `Agent.get("debug")` (and `security`, `architect`, `perf`,
      `devops`, `test`, `react`) has `steps` undefined unless user config
      sets it.
- [ ] With `agent.debug.steps: 30` and `session.max_steps: 500`, busy status
      reports `maxSteps: 30` and the TUI chip renders `step n/30 · debug`.
- [ ] With an uncapped agent, busy status reports
      `maxSteps: session.max_steps` (default 500) — unchanged behavior.
- [ ] On the last finite-agent step, the outgoing provider request has
      `toolChoice: "none"` and an absent/empty tools array (unit + integration
      coverage), except for JSON-schema structured-output turns which keep
      `required`.
- [ ] `docs/guides/autonomous.md` renders the full budget table and the
      auto-routing note; the "Source of Truth" list includes the four new
      files.
- [ ] The auto-route toast includes a step budget when the routed-to agent is
      finite-capped.
- [ ] Existing unit tests for agent config overrides, blast-radius, and
      isolation escalation still pass.

## 7. Success metrics

- Fewer "stopped at 30 steps" reports on default specialist routes for
  multi-file tasks.
- A run auto-routed to a specialist (post-R1, unbounded) runs to the
  session/aggregate ceiling without an agent-specific early stop, and the TUI
  shows `step n/500` throughout — matching the enforced denominator.
- Support can map symptoms to named limits using the published budget table.
- No regression in blast-radius / isolation-escalation behavior.

## 8. Risks

- **Cost increase from unbounded primaries:** bounded by the unchanged
  session (`GLOBAL_STEP_LIMIT`), aggregate (`maxTotalSteps`), blast-radius
  (`AUTONOMOUS_MAX_STEPS`), per-tool, and burst limits. The agent-step cap
  was a pacing cap, not a cost backstop. Mitigated further by the tool-only
  breaker and doom-loop detector.
- **Last-step enforcement interacts with structured output:** a structured
  (JSON-schema) response that requires tools must not be broken by R6. The
  design reuses `resolveTurnToolChoice`, which already encodes the rule that
  a `required` structured-output choice is not silently overridden; the test
  plan covers this case explicitly.
- **TUI denominator changes shape:** users with muscle memory around "/500"
  will see "/30 · debug" in the rare finite-cap case. This is the intended
  honesty improvement; the agent label makes it self-explaining, and the
  unbounded default after R1 means the common case is unchanged.
- **Docs drift:** the budget table in code changes more often than docs.
  ADR-051 D4 records that the table in `autonomous.md` must be re-validated
  whenever a constant in `constants/session.ts` or `prompt-loop-config.ts`
  moves.

## 9. File paths to change

| Area | File | Change |
|------|------|--------|
| Agent defaults | `packages/ax-code/src/agent/agent.ts` | Remove `steps: 25/30` from `react`, `security`, `architect`, `debug`, `perf`, `devops`, `test`; add rationale comment |
| Busy status source | `packages/ax-code/src/session/prompt-impl.ts` (line ~445) | Emit `min(finite agent.steps, sessionStepLimit)`; carry agent name + autonomous flag |
| Status schema | `packages/ax-code/src/session/status.ts` | Add optional `agentName`, `autonomous` fields to the busy event |
| Last-step enforcement | `packages/ax-code/src/session/prompt-request-build.ts` + `prompt-autonomous-decisions.ts` | Treat `isLastStep` like `forceTextOnlyTurn` in `resolveTurnToolChoice`; omit tools when `toolChoice === "none"` |
| TUI chip | `packages/ax-code/src/cli/cmd/tui/routes/session/header.tsx` + `autonomous-active.ts` | Render effective denominator + agent label |
| Route toast | auto-route toast handler (TUI) | Append step budget when routed-to agent is finite-capped |
| Docs | `docs/guides/autonomous.md` | Budget table, auto-routing note, config keys, Source-of-Truth list |

(Full per-file design in
`.internal/reports/planning/autonomous-budget-honesty/TECH-SPEC.md` §3.)

## 10. Test plan (summary)

- **Unit:** `resolveTurnToolChoice` with `isLastStep` → `toolChoice: "none"`
  and empty tools; structured-output `required` is preserved; busy-status
  `maxSteps` math for capped/uncapped agents.
- **Integration:** auto-route to a finite-capped agent shows `/30 · debug`;
  default unbounded specialist shows `/500`; last finite step emits a
  tool-free request on the wire.
- **Docs:** link check on `autonomous.md`; budget table constant validation.
- **Regression:** blast-radius, isolation-escalation, agent-config-override,
  doom-loop suites unchanged.

(Full test matrix in TECH-SPEC §5.)

## 11. Rollout

1. Land docs (PRD + ADR-051 + TECH-SPEC) + code in one PR on branch
   `feat/autonomous-budget-honesty`.
2. No feature flag needed: R1 only loosens defaults, R3/R4 only make an
   existing cap visible, R6 only strengthens an existing guarantee.
3. Follow-up PR (out of v1): configurable tool-only/burst limits and a
   `/limits` doctor command.

## 12. Out of scope (recorded for later PRDs)

Unified `autonomy.budget` schema; named workload profiles
(small/standard/marathon); progress-based soft-extend; per-agent cost meters
in the TUI; promoting the burst limiter and tool-only constants to first-class
config keys.
