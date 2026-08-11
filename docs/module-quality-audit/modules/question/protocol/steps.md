# Protocol Steps — `question`

Reviewer: ax-code-glm (model `zai-coding-plan/glm-5.2[1m]`)
Unit slug: `question` · Independent verifier: codex-sol
Baseline commit: `046510f0ca8a215f632e99fa92aa0633d684cbb9`

Every claim below is grounded in source read this pass. Files read:
`packages/ax-code/src/question/autonomous.ts`, `packages/ax-code/src/question/clarify.ts`,
`packages/ax-code/src/question/index.ts`, `packages/ax-code/src/question/schema.ts`,
plus callers `packages/ax-code/src/tool/question.ts`, `packages/ax-code/src/server/routes/question.ts`,
`packages/ax-code/src/project/instance.ts`, `packages/ax-code/src/project/state.ts`, and the
three test files under `packages/ax-code/test/question/`.

## Step 1 Scope and map

The `question` unit is four files / 583 LOC under `packages/ax-code/src/question/`. Responsibility
splits cleanly into three layers: `schema.ts:3` defines the `QuestionID` branded identifier;
`autonomous.ts:1-144` is a pure heuristic scoring engine (regex markers → score → answer +
confidence + rationale) used when autonomous mode is active; `clarify.ts:1-157` is a pure
ambiguity detector and prompt-shape builder; `index.ts:15-273` is the stateful `Question`
namespace (zod schemas, deferred-promise lifecycle, bus events, bridges to the two pure helpers).
Public exports total ~21 from `index.ts` plus the `AutonomousQuestion`/`Clarify` surfaces. No file
in the unit imports from a UI, storage, or LSP layer — the only cross-cutting imports are
`@/bus`, `@/config/config`, `@/project/instance`, `@/replay/recorder`, `@/flag/scoped`, `@/util/log`,
and `@/session/schema` (`index.ts:1-13`). Boundary is narrow and appropriate for a
prompt/clarification subsystem.

## Step 2 Threat and failure model

The unit's risk tag is `correctness` (per MODULE-AUDIT). It holds no secrets and performs no
filesystem or network I/O of its own. The one security-relevant surface is the HTTP reply path:
`server/routes/question.ts:121-157` runs `validateQuestionAnswers` before `Question.reply`, enforcing
answer-count match, non-empty values, no duplicate selections, single-select when `multiple !== true`,
and label whitelist when `custom === false` (the fix referenced as #242 at `question.ts:68`). A grep
for direct internal callers of `Question.reply`/`Question.reject` returns only that route
(`server/routes/question.ts:73,105`), so the validation gate is not bypassable by an in-process
caller today. The denial-of-service angle is bounded: `ask` registers one entry per call keyed by a
monotonic `QuestionID` (`index.ts:218`), and the instance dispose hook (`index.ts:167-172`) clears
the map, so pending entries cannot accumulate past instance lifetime.

## Step 3 Correctness — control flow on the ask/reply/reject lifecycle

`ask` (`index.ts:185-236`) has two branches. Under `ScopedFlag.autonomous()` it first computes
`autonomousDecisions`, then evaluates `escalateOnLow` (`index.ts:188`) and the `lowConfidenceIndex`
guard (`index.ts:192-194`). The guard requires `options.length > 1` before escalating a low-confidence
decision — this prevents a forever-block on single-option questions and is explicitly tested at
`question.test.ts:359-386` ("autonomous mode answers single-option questions"). On escalation it
falls through to the human path; otherwise it returns the auto-answers (`index.ts:211-213`).

The human path is correct: `current.pending.set(id, ...)` happens before `await deferred.promise`
inside a `try/finally` that always deletes the entry (`index.ts:228-235`), so a resolved or rejected
promise cannot leak a stale map entry. `reply` (`index.ts:238-252`) and `reject` (`index.ts:254-267`)
both no-op on an unknown `requestID` with a `log.warn`, which matches the "does nothing for unknown
requestID" tests (`question.test.ts:183-195`, `257-266`). The `Instance.state` disposer
(`index.ts:167-172`) rejects every pending deferred on dispose/reload — verified by the
"rejects on instance dispose" and "rejects on instance reload" tests (`question.test.ts:687-755`).

`confidenceFromRanked` (`autonomous.ts:78-91`) relies on `ranked` being sorted descending, which
`chooseDecision` guarantees at `autonomous.ts:120` (`.sort((a, b) => b.score - a.score)`). Because
`Array.prototype.filter` preserves order, `rejected[0]` is correctly the highest-scoring rejected
option. The single-select high-confidence thresholds (`top >= 9.5 && top - second >= 5` and
`top > 0 && top - second >= 10`) are consistent with the scoring magnitudes in `scoreOption`
(best-practice +10, risk −20, low-scope +3/+6, index tiebreak −index/1000).

One real edge case: between the `await Config.get()` at `index.ts:188` and the `await state()` at
`index.ts:217` on the escalation fall-through, an concurrent `Instance.dispose` could run. The
disposer would find no entry for this in-flight `ask` (none registered yet), and the subsequent
`state()` call lazily re-inits a fresh `{ pending: new Map() }` (`state.ts:44-50`). The deferred
would then hang on a disposed instance. This is a narrow race (dispose-during-ask) and low-impact
(the process is tearing down), so it is recorded as LOW, not fixed.

## Step 4 Performance

All hot paths are O(options²) at worst. `chooseDecision` (`autonomous.ts:115-135`) maps then sorts
the options; `confidenceFromRanked` does a second pass of `filter` over `ranked` (≤ option count).
For realistic questions (2–4 options, bounded by `clarify.ts:137` to max 4 on the `build` path and
by agent convention elsewhere) this is trivially fast. `detectAmbiguity` (`clarify.ts:79-102`) is
O(message-length) across a fixed set of regex lists (`VAGUE_ACTION_VERBS` × 13, `SCOPE_ANCHORS` × 8,
`EXPLICIT_AMBIGUITY` × 11), with one `new RegExp` construction per verb per call at `clarify.ts:92`
— a micro-cost that could be hoisted to module-scope precompiled regexes, but at 13 verbs it is
sub-microsecond and not worth the readability trade. `Bus.publishDetached` (`index.ts:229,246,262`)
is fire-and-forget by design, so it never blocks the reply/reject critical path. The only duplicated
work is in `tool/question.ts:54`, where `autonomousDecisions` is recomputed after `ask` already
computed it internally — pure functions over short strings, negligible.

## Step 5 Design — ownership and layering

Ownership is coherent: the two pure helpers own heuristics and never touch state; `index.ts` owns
the lifecycle and is the single integration point (`tool/question.ts:4`, `tool/plan.ts:3`,
`session/task-queue-executor-impl.ts:5`, `session/processor-impl.ts:20` all import `Question` from
`@/question`). The `QuestionInfoShape` interface in `clarify.ts:13-19` is explicitly documented as a
local duplicate "to avoid a circular import" (`clarify.ts:12`), and `buildClarification`
(`index.ts:74-76`) bridges it back to the canonical `Question.Info` with a cast — acceptable given
the structural compatibility and the documented cycle-avoidance rationale.

The autonomous scorer is intentionally more permissive than the runtime schema: `QuestionLike.question`
and `.header` are optional and `OptionLike.description` is optional (`autonomous.ts:8-9,4`), whereas
`Info` requires all of them (`index.ts:27-34`). This is defensive coding so the scorer degrades
gracefully if a future caller passes partial data, and `rationaleFor` (`autonomous.ts:93-113`) has an
explicit fallback for the case where the returned answer did not match any provided option
(`autonomous.ts:112`). The design correctly keeps the heuristic layer pure and side-effect-free, with
all I/O and escalation policy concentrated in `ask`.

## Step 6 Hygiene and dead code

No empty catches, no TODOs (matches the MODULE-AUDIT inventory row). Minor hygiene notes, none
blocking:

- `RejectedError` (`index.ts:133-144`) sets `name` twice — once via `override readonly name` on the
  class and once in the constructor body (`index.ts:138`) — and overrides the `message` getter to
  return the same constant passed to `super`. Redundant but harmless; the getter override does
  guarantee a stable serialized message.
- `toConstraints` (`index.ts:89-105`) uses `q.header?.trim() || ...` even though `Info` types
  `header` as a required `string`. The optional chaining is dead but the `||` correctly falls through
  on whitespace-only headers, which is exactly the case exercised by the test at
  `question.test.ts:38-46`.
- `AVOID_OVERENGINEERING_CONTEXT_MARKER` (`autonomous.ts:34-37`) is a strict subset of
  `AVOID_OVERENGINEERING_MARKER` (`autonomous.ts:29-32`) and the two are used together as a
  "negative-choice-without-avoid-overengineering" discriminator (`autonomous.ts:60-61,101-102`).
  The naming does not make the subset relationship obvious; a comment would help future readers.

## Step 7 Tests

Coverage is strong on the pure layers. `autonomous.test.ts` exercises best-practice preference,
over-engineering avoidance, risk-class penalty, multi-select filtering, negative-choice ("avoid
mentioning" / "not mention") context, and a specific regression for the `over-engineer` context
marker (`autonomous.test.ts:102-128`). `clarify.test.ts` covers vague-action detection, scope-anchor
suppression, explicit-ambiguity phrases, short broad requests, and the 2–4 option bounds on `build`
(`clarify.test.ts:65-84`). `question.test.ts` covers the full ask/reply/reject lifecycle, directory
isolation (`question.test.ts:626-685`), dispose/reload rejection, and four autonomous-mode
behaviors including the escalation path (`question.test.ts:312-357`).

Gap: the `toConstraints` mismatched-length tolerance branch (`index.ts:91-95`, `Math.min` +
`continue` on empty answers) is only indirectly exercised by the single test at
`question.test.ts:26-47`, which does not feed a length-mismatched input. The `custom === false`
validation arm of `validateQuestionAnswers` (`server/routes/question.ts:147-153`) lives outside this
unit but has no direct unit test here either; it is covered by `test/tool/question.test.ts` per the
MODULE-AUDIT inventory. Recommend one targeted test that passes more answers than questions (and
fewer) to lock the `Math.min` contract.

## Step 8 Finding register

No findings carried over from `findings/` (directory is empty). New findings raised this pass:

| #   | Severity | Category                | Location              | Synopsis                                                                                                                                                                                         |
| --- | -------- | ----------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | LOW      | correctness (race)      | `index.ts:188-217`    | Narrow dispose-during-ask race on the autonomous escalation fall-through; deferred can hang on a re-init'd map after dispose. Low impact (process tearing down).                                 |
| 2   | LOW      | correctness (heuristic) | `clarify.ts:55-63`    | `SCOPE_ANCHORS` regex `\bin\s+[\w./@-]+` treats "in progress" / "in general" as a scope anchor, suppressing ambiguity detection for genuinely vague messages.                                    |
| 3   | LOW      | maintainability         | `autonomous.ts:29-45` | `AVOID_OVERENGINEERING_CONTEXT_MARKER` is an undocumented strict subset of `AVOID_OVERENGINEERING_MARKER`; the subset relationship that drives the negative-choice discriminator is non-obvious. |
| 4   | LOW      | test gap                | `index.ts:89-105`     | `toConstraints` length-mismatch tolerance (`Math.min`, empty-answer skip) has no direct test.                                                                                                    |

No Critical or High findings. The unit is structurally sound, well-isolated, and defended at its
HTTP boundary.

## Step 9 Verification and exit

This pass was a static read-and-review; no code was modified (read-only architect role). I did not
execute `pnpm --dir packages/ax-code run test:unit` or `pnpm run typecheck` myself — the
verification expectation for this unit is delegated to the codex-sol independent lane, which can run
`AX_TEST_FILES=test/question/autonomous.test.ts,test/question/clarify.test.ts,test/question/question.test.ts pnpm exec vitest run`
from `packages/ax-code` plus the root `pnpm run typecheck`. The findings raised here are all LOW and
do not block sign-off; the recommended test addition (Step 7 / finding #4) is a nice-to-have, not a
gate. Status: review complete pending independent verifier (codex-sol) confirmation.
