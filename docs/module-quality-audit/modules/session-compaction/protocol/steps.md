# Protocol — session-compaction (9-step)

Unit slug: `session-compaction`
Reviewer lane: `ax-code-glm` (model `zai-coding-plan/glm-5.2[1m]`)
Verifier lane (other): `codex-sol`
Baseline commit: `94e95c161c7deb8e055d8806a5f285e516285715`

This is a real nine-step review of the four in-scope source files plus the
adjacent modules their public surfaces depend on. Every claim below cites a
file:line that was read for this run, not a file name lifted from the audit.

## Step 1 Scope And Inventory

The unit is the session-compaction surface inside the core session subsystem.
The four files under review and their real sizes (as read this run):

- `packages/ax-code/src/session/compaction.ts` — 581 lines, namespace
  `SessionCompaction` declared at compaction.ts:22, exports `TriggerReason`
  (compaction.ts:26), `Event` (compaction.ts:29), `budget` (compaction.ts:57),
  `isOverflow` (compaction.ts:91), `prune` (compaction.ts:148), `process`
  (compaction.ts:271), `create` (compaction.ts:537).
- `packages/ax-code/src/session/prompt-loop-compaction.ts` — 233 lines, exports
  `hasUnresolvedMedia` (prompt-loop-compaction.ts:20),
  `processPendingCompaction` (prompt-loop-compaction.ts:29),
  `maybeScheduleUsageCompaction` (prompt-loop-compaction.ts:66),
  `PreflightCompactionResult` (prompt-loop-compaction.ts:108),
  `maybeSchedulePreflightCompaction` (prompt-loop-compaction.ts:142).
- `packages/ax-code/src/session/prompt-session-summary.ts` — 31 lines, single
  export `scheduleFirstTurnSummary` (prompt-session-summary.ts:9).
- `packages/ax-code/src/session/summary.ts` — 241 lines, namespace
  `SessionSummary` (summary.ts:16), public `summarize` (summary.ts:80),
  `diff` (summary.ts:163), `computeDiff` (summary.ts:215).

Adjacencies read for evidence: `packages/ax-code/src/session/prompt-loop-decisions.ts`
(busy-retry limiter `pendingCompactionDecision` at prompt-loop-decisions.ts:86,
`shouldScheduleUsageCompaction` at prompt-loop-decisions.ts:103),
`packages/ax-code/src/session/context-tier.ts` (tier classifier backing
`prune`), and `packages/ax-code/src/constants/session.ts`
(`PRUNE_MINIMUM = 20_000`, `PRUNE_PROTECT = 40_000` at session.ts:1-2).

## Step 2 Threat And Concurrency Surface

The hot-path risks in this unit are concurrency and silent hook failure, not
secret exfiltration. Concurrency is gated by a single module-level
`inFlight = new Set<string>()` at compaction.ts:24, consulted at
compaction.ts:279 inside `process`. The guard is paired with a `try/finally`
that always calls `inFlight.delete` at compaction.ts:303, so an exception
inside `processInner` cannot strand a session in the busy state. The busy
caller path is bounded by `PENDING_COMPACTION_BUSY_RETRY_LIMIT = 40` in
prompt-loop-decisions.ts:80 (40 × 250 ms ≈ 10 s), turning a previously
unbounded livelock into an explicit break with `reason: "error"` at
prompt-loop-decisions.ts:94-99.

Lifecycle hooks (`PreCompact`) are imported dynamically at compaction.ts:292
and wrapped in their own try/catch at compaction.ts:298. Hook failure is
logged with `log.warn` and never blocks compaction — correct for an
observational hook, but it does mean a misconfigured workspace hook becomes
invisible except via logs. The replay/continue writes at compaction.ts:445
and compaction.ts:507 are wrapped in `Database.transaction`, so the message
row plus its part rows publish atomically via `Bus.publishDetached`.

## Step 3 Correctness — Control Flow Defects

Two real defects in `processInner`.

First, the overflow-replay branch is internally inconsistent. When
`input.overflow` is set, compaction.ts:319 builds the `replay` message by
filtering out every file part: `msg.parts.filter((part) => part.type !== "file")`.
Later, when the continuation is being replayed, compaction.ts:458-461 tries
to convert media file parts into text placeholders:

```
const replayPart =
  item.type === "file" && MessageV2.isMedia(item.mime)
    ? { type: "text" as const, text: `[Attached ${item.mime}: ...]` }
    : item
```

Because `replay.parts` already had every `type === "file"` removed at line
319, `item.type === "file"` can never be true here, so the placeholder
branch is unreachable. The user-facing impact is that on a media-driven
overflow the continuation message loses all attachment references with no
placeholder, even though the placeholder copy clearly intended to preserve a
hint for the next agent. The companion notice at compaction.ts:491-494 then
has to compensate with a generic synthetic message.

Second, compaction.ts:332-333 reads:

```
if (!agent) throw new Error("Compaction agent is not configured or has been disabled")
const model = agent?.model ? ... : ...
```

After the throw on line 332, `agent` is narrowed to non-null, so the
`agent?.model` optional chain on line 333 is dead defensive code. Harmless
but misleading — it implies the null case is still in play.

A subtler correctness note: in `prune`, the `total` accumulator at
compaction.ts:186 is incremented for every protected-status tool part before
the `PRUNE_PROTECT` threshold check on line 187. That means `total` is the
running sum of _all_ post-turn-2 tool output, but only candidates past
`PRUNE_PROTECT` (40 000) are pushed. The two-threshold design (40 k to start
collecting, 20 k of collected tokens to actually prune) is intentional and
documented, but the variable name `total` versus `pruned` versus
`selectedTokens` makes the three running sums easy to confuse on a future
edit.

## Step 4 Performance And Token Accounting

Token accounting is centralized in `effectiveTotal` (compaction.ts:52) which
deliberately takes `Math.max(tokens.total, componentTotal(tokens))` so a
provider that under-reports `total` cannot fool compaction into skipping. The
`budget` function at compaction.ts:57-83 is the single place that turns a
`Provider.Model` into `{ cap, reserved, usable }`, with a documented
ax-engine special case at compaction.ts:72-75 that picks
`max(ceil(cap*0.1), model.limit.output)` when no explicit `limit.input` is
declared, and a `MIN_USABLE_TOKENS = 1_000` floor at compaction.ts:81 that
returns `undefined` (i.e. disables auto-compaction) when the usable budget is
too small to converge. `isOverflow` (compaction.ts:91-100) is the only thing
the prompt loop needs to call per turn, and it is a single `Math.max` +
comparison — no I/O.

`prune` is the heaviest path. The original per-part DB writes were folded
into a single batched `Session.updateParts(...)` call at compaction.ts:253,
with a documented fallback to per-part writes (with per-iteration try/catch)
at compaction.ts:256-266 if the batch transaction aborts. The fallback
counter (`succeeded`/`failed`) is logged at compaction.ts:267. Tier-aware
pruning (compaction.ts:168-225) builds three candidate arrays keyed off
`ContextTier.classify`, then within each tier iterates the reversed candidate
list so the oldest tool results compact first — a deterministic ordering that
survives the bucketing step.

## Step 5 Design And Module Boundaries

The unit cleanly separates five concerns into five exports: token math
(`budget`, `isOverflow`), tool-result pruning (`prune`), the model-driven
summary call (`process`), the user-facing scheduling entry
(`create`/`fn`-wrapped at compaction.ts:537), and the prompt-loop integration
layer in `prompt-loop-compaction.ts`. The integration layer never reaches
into `processInner` — it only consumes `process`, `isOverflow`, `budget`, and
`create`, which is the right shape for a hot-path module.

One boundary smell: `prompt-loop-compaction.ts` ships its own
`MIN_COMPACTABLE_HISTORY_TOKENS = 512` constant
(prompt-loop-compaction.ts:123) and `SUPER_LONG_USABLE_FRACTION` lives inside
`compaction.ts` (compaction.ts:89). Both are compaction policy knobs but they
live on opposite sides of the module line. Not worth moving for two symbols,
but worth noting if a third one shows up. The plugin extension point at
compaction.ts:360 (`experimental.session.compacting`) and the message
transform at compaction.ts:395 (`experimental.chat.messages.transform`) are
both properly namespaced as experimental and use defensive defaults
(`{ context: [], prompt: undefined }`), so a plugin that throws will not
poison the compaction request.

## Step 6 Dead Code And Hygiene

Three concrete items.

1. The unreachable media-placeholder branch at compaction.ts:458-461 (see
   Step 3). This is dead code today and the most valuable to fix because
   removing it (or, better, restoring the intended non-media-preserving
   behaviour by tightening the filter at compaction.ts:319) changes user
   -visible behaviour on overflow.
2. The redundant `agent?.model` optional chain at compaction.ts:333 after the
   null-guard throw on the previous line.
3. `isSyntheticContinuation` at prompt-loop-compaction.ts:104-106 casts each
   part through `(part as { synthetic?: boolean }).synthetic === true`. The
   `MessageV2.Part` union already has `synthetic` on its text-part variant
   (the synthetic continuation is created at compaction.ts:495-506 with
   `synthetic: true`), so a typed discriminator would be safer than a cast
   that silently returns `false` for any new part shape.

No empty `catch` blocks — every catch in this unit either rethrows, logs at
`warn`/`error`, or counts `failed++` (compaction.ts:261-263). The
`prompt-session-summary.ts` failure path at prompt-session-summary.ts:20-30
correctly falls back to `Session.setTitle("Untitled session")` and then logs
if _that_ also fails.

## Step 7 Test Coverage Delta Versus The Audit

`MODULE-AUDIT.md` §1.3 lists 14 test files but every one of them is a TUI /
ACP / CLI integration test (e.g.
`packages/ax-code/test/cli/tui/session-compaction-notice.test.ts`, which only
exercises the view-model). It omits the three direct unit-test files that
actually cover the compaction surface under review:

- `packages/ax-code/test/session/compaction.test.ts` — 1079 lines. Exercises
  `isOverflow`, `budget`, `prune` (compaction.test.ts:465, :493, :533, :557,
  :629, :987) and `process` busy semantics (compaction.test.ts:659, :666,
  :696, :705), including the `compaction.auto === false` disable path
  (compaction.test.ts:332) and the `compaction.reserved` override
  (compaction.test.ts:253).
- `packages/ax-code/test/session/prompt-loop-compaction.test.ts` — 271 lines.
  Mocks `SessionCompaction.budget`/`create`/`isOverflow` and asserts the
  preflight block message at prompt-loop-compaction.test.ts:146 (the
  "Automatic compaction cannot help this new or tiny session" copy from
  prompt-loop-compaction.ts:136-139) and the #259 unresolved-media skip at
  prompt-loop-compaction.test.ts:254.
- `packages/ax-code/test/session/context-tier.test.ts` — covers the tier
  classifier that `prune` depends on, including the "compaction summaries are
  Tier 3" rule at context-tier.test.ts:156.

So the unit is _not_ under-tested — the audit's inventory was. The one gap
that remains is end-to-end coverage of the overflow-replay branch in
`processInner` (the Step 3 defect), which the existing tests do not
exercise because they short-circuit before the model call.

## Step 8 Findings Register

No `findings/` files exist for this unit yet (the directory is empty). From
this independent read, the items worth filing are:

- MEDIUM — Unreachable media-placeholder branch in the overflow-replay path.
  Location `packages/ax-code/src/session/compaction.ts:458-461`, caused by
  the broader filter at `compaction.ts:319`. Net effect: on a media-driven
  provider overflow, attachment references disappear from the replayed turn
  with no placeholder, weakening the continuation prompt.
- LOW — Redundant `agent?.model` optional chain after the null-guard throw at
  `packages/ax-code/src/session/compaction.ts:332-333`.
- LOW — `isSyntheticContinuation` cast at
  `packages/ax-code/src/session/prompt-loop-compaction.ts:104-106` bypasses
  the `MessageV2.Part` discriminator.
- INFO — Audit test inventory missed the three direct unit-test files in
  `packages/ax-code/test/session/` (see Step 7).

Independent re-read confirmation (this pass): two candidate systemic smells
were considered and deliberately excluded as unit-specific findings because
they are established session-package conventions, not compaction defects.
(1) The discarded return value of `Plugin.trigger("experimental.chat.messages.transform", {}, { messages })`
at `compaction.ts:395` — the identical discard-and-mutate pattern is used at
`prompt-request-build.ts:46`, whose comment at `:47-50` documents that the
hook contract is mutate-the-array-in-place. Reassignment-style plugins
silently no-op, but that is a codebase-wide contract, not a compaction bug.
(2) The direct `Database.transaction((db) => { db.insert(MessageTable)...; db.insert(PartTable)... })`
writes at `compaction.ts:445` and `:507` — this is the standard session-package
shape for multi-row atomic inserts (see `session/index.ts:357-375`, which uses
the same `MessageTable`/`PartTable` insert loop), with `Session.updateMessage`/
`Session.updatePart` reserved for single-row updates. So the transactional
replay/continue writes follow package convention.

No Critical-severity items were found in this pass. The concurrency guards
(inFlight + try/finally + busy-retry cap) and DB transaction usage are
correct as written.

## Step 9 Verification And Exit

This is a documentation-only review pass — no source files were modified, so
no typecheck/test run is required to validate a code change. The evidence
cited above is read-only against the baseline commit
`94e95c161c7deb8e055d8806a5f285e516285715`. Because no Critical findings
were produced, no `reverify.md` second-pass is required by the dual-agent
gate and none is written.

Exit checklist for this run:

- [x] Real nine-step protocol executed against read file:line evidence
- [x] All four in-scope source files read in full
- [x] Adjacent dependencies (prompt-loop-decisions, context-tier,
      constants/session) read for cross-checks
- [x] Direct unit-test coverage located and cited
- [x] No Critical findings; MEDIUM finding on the replay-branch dead code is
      the single most valuable follow-up

Sign-off: primary reviewer `ax-code-glm` (this run). Independent verifier
`codex-sol` to countersign per the dual-agent protocol.
