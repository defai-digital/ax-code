# PRD: v4.2.0 Autonomous Mode Hardening

**Date:** 2026-04-26
**Status:** P0 + P1 implemented and merged into working tree (uncommitted). P2 deferred to a separate PRD.
**Scope:** Internal
**Owner:** ax-code agent
**Related:** `.internal/adr/ADR-004-autonomous-mode-hardening.md`
**Last reviewed:** 2026-04-26

## Implementation log (2026-04-26)

### Security fix follow-up (2026-04-26, post-review)

Security review surfaced a HIGH-confidence (9/10) glob-bypass: `Wildcard.match` anchors patterns with `^...$` and treats `*` as regex `.*` (no segment semantics). The original `AUTONOMOUS_BLOCKED_PATHS` therefore allowed nested `.env` (e.g. `packages/foo/.env`), top-level `secrets/`, and top-level `.git/hooks/` to slip past the autonomous block. Fix: every "anywhere" guard now ships in two forms (anchored + `**/`-prefixed). Regression test added at `test/session/blast-radius.test.ts` covering nested dotenv, top-level secrets, and top-level `.git/hooks/`.

### Original P0 + P1 slice

P0 + P1 landed in one working-tree slice. Highlights versus the original spec:

- All P0 items shipped as specified.
- P1-3 critic ships with a `phaseReviewer` hook on `Planner.execute()` and a
  `Critic.asPhaseReviewer()` adapter, but production wiring of `Planner.execute()`
  into the live session loop is still pending (Planner currently has no production
  caller — the architect/critic features will run only when something invokes
  `Planner.execute({ phaseReviewer })`). This is acceptable for the PRD slice
  because the autonomous safety guarantees (caps, escalation, hybrid permission,
  cycle detection) all run in the session processor and apply today.
- Recorder telemetry events (`autonomous.cap_hit`, `autonomous.escalation`,
  `planner.architect_call`, `quality.critic_finding`) added to the discriminated
  `ReplayEvent` schema.
- 28 new tests, 192/192 affected suites pass, `pnpm typecheck` clean,
  `script/check-no-effect-solid-in-v4.ts` clean.

## Purpose

Turn ADR-004 into an executable spec. Make `AX_CODE_AUTONOMOUS=true` smarter (confidence-aware, architect/editor split) and more accurate (blast-radius caps, hybrid permission, critic pass) without regressing existing autonomous workflows.

## Out of Scope

- Worktree-isolated parallel sub-agents (P2, separate PRD).
- Long-horizon (multi-hour) sessions and hosted agent runners.
- Replacing the heuristic question scorer with an LLM-based scorer.
- Effect framework reintroduction (frozen per `ARCHITECTURE.md`).

## Goals

1. Eliminate the "loop to step cap on ambiguous request" failure mode by escalating low-confidence decisions.
2. Bound autonomous blast radius with hard caps (steps, files, lines, blocked paths).
3. Improve plan quality by allowing a separate architect model.
4. Catch logic regressions per phase via a critic pass before the planner advances.
5. Replace all-or-nothing permission bypass with a hybrid safe/risk classifier.
6. Strengthen doom-loop detection to cover cycles, not just exact repeats.

## Non-goals

- Changing the activation surface (env var + config remains).
- Breaking backward-compatible defaults for existing autonomous users.

## Phases

### Phase P0 — Smarter and bounded (ship together)

P0 is the smallest set that meaningfully closes the documented failure modes.

#### P0-1 Hard caps + blast-radius limits

**Files:** `src/constants/session.ts`, `src/session/processor.ts`, `src/tool/edit.ts`, `src/tool/write.ts`, `src/tool/apply_patch.ts`, `src/tool/bash.ts`.

Add to `constants/session.ts`:

```ts
export const AUTONOMOUS_MAX_STEPS = 200          // matches existing GLOBAL_STEP_LIMIT, now enforced on autonomous branch
export const AUTONOMOUS_MAX_FILES_CHANGED = 50   // per session
export const AUTONOMOUS_MAX_LINES_CHANGED = 5_000 // per session
export const AUTONOMOUS_BLOCKED_PATHS: readonly string[] = [
  ".env",
  ".env.*",
  "**/secrets/**",
  "**/.git/hooks/**",
  // infra surfaces
  "infra/**",
  "terraform/**",
  ".github/workflows/**",
]
```

Behavior:
- Steps: `processor.ts` increments `attempt`; when `autonomous && attempt >= AUTONOMOUS_MAX_STEPS`, throw `AutonomousLimitError("steps")` and finalize the message with a clear reason.
- Files / lines: track via a per-session `BlastRadiusTracker` that listens to write/edit/apply_patch outcomes (or imports the existing `Snapshot.patch()` files list). On overage, throw before the next write.
- Blocked paths: matched at the tool layer pre-write. Returns a tool-error (not a thrown exception) so the model can adjust.

Config overrides via `experimental.autonomous_caps: { steps?, files?, lines?, blockedPaths? }`. `Infinity` disables the cap.

#### P0-2 Confidence-gated clarification escalation

**Files:** `src/question/index.ts`, `src/question/autonomous.ts`, `src/config/config.ts`.

In `Question.ask()`, when `process.env.AX_CODE_AUTONOMOUS === "true"`:

1. Compute decisions via `AutonomousQuestion.decisions(input.questions)` (already exists).
2. If **any** decision has `confidence === "low"` and `experimental.autonomous_escalate_low_confidence !== false`:
   - Log `autonomous escalating to user`.
   - Fall through to the human-ask path (`Bus.publishDetached(Event.Asked, info)`); do not auto-resolve.
3. Otherwise auto-answer with `decisions.map(d => d.answer)` (current behavior, unchanged).

Add `experimental.autonomous_escalate_low_confidence: boolean` (default `true`).

Acceptance:
- Existing `AutonomousQuestion` decision tests unchanged.
- New unit test: low-confidence decision in autonomous mode returns the human-ask deferred promise.
- New unit test: high-confidence decision in autonomous mode auto-answers (regression guard).

#### P0-3 Architect / Editor model split

**Files:** `src/planner/index.ts`, `src/planner/types.ts`, `src/planner/replan-llm.ts`, `src/config/config.ts`.

Extend `Planner.create(opts)` and `Planner.execute(opts)` to accept an optional `architectModel: Provider.Model`. The replanner already has `providerReplanGenerator` (`replan-llm.ts`) that takes provider config; thread the `architectModel` through it.

Config:

```jsonc
{
  "experimental": {
    "planner_architect_model": "anthropic/claude-opus-4-7"
  }
}
```

Default unset → existing single-model behavior preserved.

### Phase P1 — Defense in depth (ship after P0 stabilises)

#### P1-1 Doom-loop cycle detection

**Files:** `src/session/processor.ts`.

Replace the exact-3-repeat check with a cycle detector:
- Maintain a sliding window of the last `2 * MAX_CYCLE_LEN` tool calls (default `MAX_CYCLE_LEN = 4`).
- For each cycle length `k` in `[1, MAX_CYCLE_LEN]`, check if the last `2k` entries are `[A,B,...,k entries]` repeated.
- Trigger if any `k` matches with at least 2 full repeats.
- Action unchanged: in autonomous mode clear the buffer and let the call proceed once; otherwise `Permission.ask("doom_loop")`.

Tests: synthetic sequences `[A,B,A,B,A,B]`, `[A,B,C,A,B,C,A,B,C]`, plus negative cases (legit retry-test loop must not trip with buffer < 2k+1).

#### P1-2 Hybrid permission for autonomous

**Files:** `src/permission/index.ts`, new `src/permission/risk-classes.ts`.

Introduce risk classes:

```ts
export const SAFE_PERMISSIONS: ReadonlySet<string> = new Set([
  "read", "glob", "grep", "list", "list_directory",
])

// risk-list: never bypass; fall through to ruleset/ask
export const RISK_PERMISSIONS: ReadonlySet<string> = new Set([
  "edit", "write", "apply_patch", "bash", "network", "package_install",
])
```

In `askPromise`, the autonomous bypass at line 209 becomes:

```ts
if (process.env["AX_CODE_AUTONOMOUS"] === "true" && !INTERACTIVE_ONLY.has(request.permission)) {
  if (SAFE_PERMISSIONS.has(request.permission)) {
    return // auto-approve as today
  }
  if (!RISK_PERMISSIONS.has(request.permission)) {
    // unknown permission: log + auto-approve to avoid breaking new tools (preserve current behavior)
    log.warn("autonomous: unknown permission risk class, defaulting to allow", { permission: request.permission })
    return
  }
  // risk-listed permission: fall through to the existing ruleset/ask path below
}
```

Default classification keeps current UX (unknown → allow). Strict mode (`experimental.autonomous_strict_permission: true`) flips unknown → ask.

#### P1-3 Critic pass before commit

**Files:** new `src/quality/critic.ts`, `src/planner/index.ts` (post-phase hook), `src/quality/verification-envelope.ts` (already done).

Critic runs after a phase's `executor` succeeds:

1. Compute the phase diff (reuse `Snapshot.patch(snapshot)` from processor).
2. Send diff + phase description to the architect model (or executor model if architect not configured) with a structured prompt asking for `Quality.Finding[]` (`src/quality/finding.ts` already defines the schema per recent commit `cc55386`).
3. If any finding has `severity === "high"`:
   - Wrap in a `VerificationEnvelope` and attach to the `PhaseResult`.
   - Treat as a failure for fallback strategy purposes (`replan` / `abort` / `skip`).
4. Otherwise log findings as a warning and continue.

Disabled by default. Enable via `quality.critic_enabled: true`.

### Phase P2 — Deferred to next iteration (planning only)

Spec captured here for traceability; implementation in a follow-up PRD.

- **P2-1 Worktree-isolated parallel sub-agents.** Cursor 3 / Codex pattern. Requires extending `src/isolation/` and `Snapshot` for concurrent safety.
- **P2-2 Long-horizon re-planning loop.** Critic findings of severity `medium` automatically trigger a `replan` fallback once per phase budget.
- **P2-3 Per-tool blast-radius accounting.** Currently per-session caps; finer per-tool caps would let a long phase still write many small files but cap any single mass-rewrite.

## Acceptance criteria

P0 ships when:

- [x] All new constants exist and are referenced from the autonomous code path.
- [x] `bun run test:unit` passes including new tests under `test/session/`, `test/question/`, `test/planner/`.
- [x] `pnpm typecheck` passes across the workspace.
- [x] `script/format.ts` is clean.
- [x] No new Effect Framework usage (verified by `script/check-no-effect-solid-in-v4.ts`).
- [x] Autonomous regression smoke: covered by the new escalation test in `test/question/question.test.ts` ("autonomous mode escalates low-confidence multi-option to user").

P1 ships when:

- [x] Cycle-detection tests cover at least three positive and three negative shapes (5 positive + 4 negative in `test/session/cycle-detection.test.ts`).
- [x] `Permission.ask` autonomous-branch coverage includes safe/risk/unknown matrices (`test/permission/risk-classes.test.ts`, plus existing question/permission integration tests).
- [x] Critic findings flow end-to-end into Recorder events (`quality.critic_finding`), and the planner runs the configured fallback strategy on blocking findings (`test/planner/phase-reviewer.test.ts`).

## Telemetry

New `Recorder` events (no schema change required, reuse `tool.result` / `permission.ask` style):

- `autonomous.cap_hit` `{ kind: "steps" | "files" | "lines" | "blocked_path", value, limit }`
- `autonomous.escalation` `{ reason: "low_confidence", question }`
- `planner.architect_call` `{ model, durationMs, tokens }`
- `quality.critic_finding` `{ severity, ruleId, file, message }`

Logged with `Log.create({ service })` using the standard required fields (`durationMs`, `status`, `errorCode`).

## Rollout

1. P0 lands behind `experimental.*` flags where applicable (escalation default-on, architect default-off, caps default-on with permissive defaults).
2. P1 ships disabled by default; opt-in for two weeks of internal use, then default-on.
3. P2 starts a fresh PRD when P1 has stabilised.

## Risks

- **Escalation fatigue.** If users see clarifications too often, autonomous mode's value drops. Mitigation: only escalate on `confidence === "low"`; tighten the scorer if false-low rate is high.
- **Cap miscalibration.** 50 files / 5k lines may be too tight for legitimate large refactors. Mitigation: config override; observe `autonomous.cap_hit` telemetry for a release cycle.
- **Critic latency.** Adds ~1 LLM call per phase. Mitigation: opt-in only; future work could batch critic across phases.
- **Permission classifier drift.** New tools added without classification land in the unknown bucket. Mitigation: add a `repo-structure.yml` guard that fails CI when a tool is registered without a risk class.
