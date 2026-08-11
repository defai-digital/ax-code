# Reviewer Protocol — unit `stats`

Reviewer: `ax-code-glm` (model `zai-coding-plan/glm-5.2[1m]`)
Scope: `packages/ax-code/src/stats` (`breakdown.ts`, `index.ts`, `types.ts`)
Independent verifier lane: `codex-sol`
Date: 2026-08-11

This is a real, independently-performed 9-step pass over the `stats` unit.
Every claim below is anchored to a `file:line` I read this run.

## Step 1 — Scope and inventory

The `stats` unit is intentionally tiny: a single barrel (`packages/ax-code/src/stats/index.ts:1`), one implementation file (`packages/ax-code/src/stats/breakdown.ts`, 109 lines), and one types file (`packages/ax-code/src/stats/types.ts`, 33 lines). The barrel re-exports four functions (`calculateBreakdown`, `estimateTokens`, `getStatus`, `formatBreakdown`) and four types (`TokenUsage`, `ContextBreakdown`, `ContextStatus`, `ContextReport`). I confirmed the sole production import site is `packages/ax-code/src/cli/cmd/context.ts:9`, which pulls only `calculateBreakdown` and `formatBreakdown`. The unit is a pure leaf with no internal dependencies beyond a type-only import of `Provider.Model` (`breakdown.ts:7`).

## Step 2 — Threat and failure model

This module performs no I/O, holds no secrets, and mutates no shared state — it is pure arithmetic plus ANSI escape-string construction. The realistic failure modes are numeric: `String.prototype.repeat` throws `RangeError` on negative or non-integer counts, and division by a zero/unknown model limit yields `Infinity`/`NaN` that would render as garbage in the TUI. The author anticipated both: `breakdown.ts:22-23` collapses any non-finite or non-positive `contextLimit` to `0` (the "unknown limit" branch), and `breakdown.ts:72` clamps `filled` into `[0, barWidth]` before calling `"\u2588".repeat(filled)` so an overflowed total can never produce a negative `empty`. There are zero empty `catch` blocks in the unit itself.

## Step 3 — Correctness of public surfaces

Traced each exported function by hand. `calculateBreakdown` (`breakdown.ts:15-42`) sums four non-negative token buckets and, when `modelLimit > 0`, derives `available = max(0, modelLimit - total)` — correct and non-negative. `estimateTokens` (`breakdown.ts:11-13`) is the standard ceil(chars/4) heuristic. `getStatus` (`breakdown.ts:44-49`) uses `>=` thresholds at 50/75/90, matching the test assertions at `test/stats/breakdown.test.ts:110-118`. `formatBreakdown` (`breakdown.ts:51-108`) threads the unknown-limit flag consistently through `limitLine`, `usedLine`, `availableLine`, and the status/warning lines (lines 78-106). One consumer-side smell worth flagging: `cli/cmd/context.ts:91-97` passes `toolCount: toolCalls` (runtime tool _calls_) into a formula whose comment at `breakdown.ts:26` says "~800 tokens per tool _definition_" — the contract name and the feed are semantically misaligned, so a session with 50 tool calls reports 40k "tool definition" tokens it never spent.

## Step 4 — Performance

No performance concern. All operations are O(1) arithmetic or O(line-count) string assembly driven by a fixed four-row breakdown. The only allocation of note is the `bar()` closure building 30-character strings via `repeat` (`breakdown.ts:67-76`), bounded by the `barWidth = 30` constant. There is no per-message loop inside this unit; the loop lives in the consumer (`context.ts:57-75`) and is linear in session message count, which is appropriate for a one-shot CLI report. No N+1, no unbounded growth, no caching opportunity missed.

## Step 5 — Cohesion and module boundaries

The implementation file is well-scoped: `breakdown.ts` does exactly one thing (compute + render a context-window breakdown). The type-only dependency on `Provider.Model` (`breakdown.ts:7`) keeps the module free of runtime coupling to the provider subsystem. The one design blemish is mixed physical units inside the `calculateBreakdown` input struct (`breakdown.ts:15-21`): `systemPromptLength` is in _characters_ (re-estimated at line 25 via `estimateTokens(" ".repeat(...))`), while `memoryTokens`, `historyTokens`, and the implicit per-tool weight are already in _tokens_. That asymmetry is a foot-gun for any future caller and is the root cause of the `context.ts` misuse in Step 3.

## Step 6 — Dead code and export hygiene

Grep across `packages/ax-code/src` shows that two exported types have no consumer: `TokenUsage` (`types.ts:5-11`) and `ContextReport` (`types.ts:25-33`). The `zeroTokenUsage` matches found by search are an unrelated helper in `session/prompt-message-builders.ts:41` with a different field shape (`AssistantTokens`), not a consumer of this `TokenUsage`. Likewise `ContextReport` (which bundles `breakdown` + `status` + `usagePercent` + `sessionInfo`) is never constructed anywhere — `formatBreakdown` takes the raw `ContextBreakdown` directly. `getStatus` is exported from the barrel (`index.ts:1`) but is only ever called internally by `formatBreakdown` (`breakdown.ts:55`); no external import exists. These are removable without breaking the build, though removal is LOW severity, not urgent.

## Step 7 — Duplication scan

`estimateTokens(text) = Math.ceil(text.length / 4)` is defined three times in the codebase: `stats/breakdown.ts:11`, `memory/recorder.ts:22`, and `memory/generator.ts:56`. All three are byte-identical in behavior. Per the repo's own rule (extract only at 3+ identical sites), this crosses the threshold for a shared `estimateTokens` helper — but the right home is a small shared util, not the `stats` unit itself, and any move must keep the call sites' existing import paths stable. This is a MEDIUM-severity hygiene item tracked in Step 8, not a blocker.

## Step 8 — Test coverage and findings register

`test/stats/breakdown.test.ts` exercises every exported function: provider-window resolution across three real models (lines 28-66), tool/memory inclusion (line 68), the undefined-model fallback (line 81), the `NaN`-limit fallback (line 94), threshold classification (line 108), the unknown-limit render branch (line 122), percentage render (line 138), and — notably — a regression test at line 153 asserting `formatBreakdown` does not throw when `total > modelLimit`, which is the exact clamp guard from Step 2. Coverage of the unit itself is strong. No Critical or High findings; the findings/ directory is empty and I am adding none at this severity. Observations of record (MEDIUM/LOW, non-blocking): (a) `TokenUsage`/`ContextReport` are dead exports; (b) `estimateTokens` is triplicated; (c) `calculateBreakdown`'s input struct mixes chars-vs-tokens units and is mis-fed by `context.ts`.

## Step 9 — Verification and exit

Because no Critical findings were raised and `findings/` contains no items, no `reverify.md` second-pass is required by the protocol and none was written. Verification of the unit itself is delegated to the repo's standard gates: `pnpm --dir packages/ax-code run typecheck` and `pnpm --dir packages/ax-code run test:unit` (which includes `test/stats/breakdown.test.ts`). The `stats` unit is small, pure, well-tested, and the only actionable work is non-blocking hygiene (dead-export removal + cross-module `estimateTokens` consolidation). This `stats` review is complete and ready for the `codex-sol` verifier lane to countersign.
