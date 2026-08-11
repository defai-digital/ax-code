# Protocol Steps: session-fork-revert

Reviewer: ax-code-glm (model `zai-coding-plan/glm-5.2[1m]`)
Verifier (other lane): codex-sol
Date: 2026-08-11

Evidence is anchored to files actually read for this pass:
`packages/ax-code/src/session/branch.ts`, `packages/ax-code/src/session/compare.ts`,
`packages/ax-code/src/session/move.ts`, `packages/ax-code/src/session/revert.ts`,
`packages/ax-code/src/session/rollback.ts`, plus supporting
`packages/ax-code/src/session/index.ts`, `packages/ax-code/src/session/schema.ts`,
`packages/ax-code/src/session/prompt-run-state.ts`, `packages/ax-code/src/id/id.ts`,
`packages/ax-code/src/id/branded.ts`, `packages/ax-code/src/snapshot/index.ts`.

## Step 1 Scope and map

The `session-fork-revert` unit spans five files under `packages/ax-code/src/session/`:

- `branch.ts:11` defines `SessionBranchRank`, the ranking layer for session
  branch families. `detail()` at `branch.ts:148` dedupes sessions via a `Set`
  (`branch.ts:154-159`) and delegates ordering to `ReplayCompare.rank`.
  `family()` at `branch.ts:192` wraps execution in `Instance.provide` and
  throws literal errors `"no branch family recorded"` / `"no recommended branch"`
  (`branch.ts:215`, `branch.ts:217`) when ranking collapses.
- `compare.ts:11` defines `SessionCompare`, a two-session diff/risk advisory.
  `detail()` at `compare.ts:247` runs `inspect()` for each side and composes a
  `Decision` via `decision()` at `compare.ts:128`.
- `move.ts:12` defines `SessionMove`. Note: this namespace exports only
  `validate()` at `move.ts:129` plus zod schemas — there is no `move()`/`apply()`
  mutation here; the module is validation-only despite its name.
- `revert.ts:14` defines `SessionRevert` with `revert()` (`revert.ts:24`),
  `unrevert()` (`revert.ts:96`), and `cleanup()` (`revert.ts:105`).
- `rollback.ts:12` defines `SessionRollback`, resolving replay steps into
  rollback `Point`s (`rollback.ts:75`) and applying them via `SessionRevert`
  (`rollback.ts:201`).

ID ordering underpins several comparisons: `Identifier.create` at
`id/id.ts:83` packs a 36-bit millisecond timestamp plus counter into ascending
base62 ids, so the `>=` / `<` / `>` string comparisons on `MessageID` used in
`revert.ts:76` and `revert.ts:115-119` are monotonic by construction.

## Step 2 Threat and failure model

The persistence boundary is the working tree plus the session row. Two surfaces
touch durable state:

1. `Snapshot.revert(patches)` at `snapshot/index.ts:461` runs git `checkout
<hash> -- <rel>` per file inside `withOperationLock`. On checkout failure it
   either throws (`snapshot/index.ts:486`) or deletes the file if it did not
   exist in the snapshot (`snapshot/index.ts:488-490`).
2. `Session.setRevert` at `index.ts:542` persists the revert metadata via
   `updateAndPublish`; `clearRevert` at `index.ts:555` nulls it.

The concurrency guard is `SessionPrompt.assertNotBusy` (`revert.ts:25`,
`revert.ts:98`), backed by the in-memory map in `prompt-run-state.ts:32-35`.
Unlike `setProductMetadata` (`index.ts:530`) which takes `Lock.write`, neither
`revert`, `unrevert`, nor `cleanup` acquire a durable `Lock`. This is acceptable
for a single in-process agent turn but does not serialize a second process
(e.g. an HTTP server plus a CLI) touching the same session.

No empty catches exist in the unit itself; the two `.catch(() => undefined)`
swallows in `compare.ts:317-318` and `branch.ts:205` guard optional semantic
enrichment and degrade to `null`, which is the documented contract of the
optional `semantic` fields.

## Step 3 Correctness

`SessionRevert.revert` (`revert.ts:24`) is the highest-risk function. Two
observations:

- **Split-brain window.** At `revert.ts:67` `Snapshot.revert(patches)` rewrites
  the working tree, then `revert.ts:68` computes a diff, `revert.ts:77-78`
  writes the diff to `Storage` and publishes `Session.Event.Diff`, and finally
  `revert.ts:83` calls `Session.setRevert`. If any step between
  `Snapshot.revert` and `setRevert` throws, the working tree is physically
  reverted while the session row still reports no revert — callers reading
  `Session.get` see an un-reverted session pointing at reverted files. There is
  no compensating `Snapshot.restore` in a `catch`. This is the most material
  correctness gap in the unit.
- **messageID rebinding.** `revert.ts:45-49` rewrites `revert.messageID` to the
  preceding `lastUser.id` when a whole assistant message is reverted. `cleanup`
  (`revert.ts:115-119`) then treats `msg.info.id < messageID` as preserve and
  `> messageID` as remove, so the user message is also removed. This is
  intentional (the turn is re-prompted from that user message) but the only
  rationale lives in commit history, not the code. The `Object.assign(session,
await Session.get(...))` at `revert.ts:65` and the `narrowed` capture at
  `revert.ts:75` are explicit fixes for prior shadowing/closure bugs (referenced
  as BUG-82), confirming this function has been fragile.

`SessionRollback.apply` (`rollback.ts:201`) delegates to `revert` then
`cleanup`; the ordering is correct (revert first, cleanup only if `next.revert`
is set). `resolve()` at `rollback.ts:75-106` drops points whose step index is
unknown (`rollback.ts:94`), which silently degrades the rollback list when
replay events and message parts disagree.

## Step 4 Performance

- `SessionCompare.detail` (`compare.ts:247`) calls `Replay.compare` twice when
  `deep` is set (`compare.ts:219`, once per `inspect`). For large sessions this
  is the dominant cost; `deep` is opt-in, so the default path stays cheap.
- `SessionRevert.cleanup` (`revert.ts:148-159`) awaits `Bus.publish` serially
  inside two loops. With many removed messages/parts this linearizes event
  emission; a `Promise.all` over the publish list would flatten it. It is not a
  hot path, but the change is mechanical.
- `SessionBranchRank.family` (`branch.ts:192-227`) issues `N` parallel
  `SessionSemanticDiff.load` calls via `Promise.all` (`branch.ts:202-207`), good
  fan-out; `detail()` itself is synchronous ranking, fine.

No N+1 query patterns were observed in this unit; `Session.messages` is called
once per public entry point.

## Step 5 Design

- **Namespace cohesion.** `SessionMove` (`move.ts`) is named for a mutation but
  contains only `validate()` and zod schemas. The actual directory move is not
  in this file. Either rename to convey "validation only" or co-locate the
  executor so the namespace matches its responsibility.
- **Error type discipline.** `family()` throws bare `Error` strings
  (`branch.ts:215`, `branch.ts:217`); `revert()` throws a templated `Error`
  (`revert.ts:93`). The rest of the session layer uses typed events via `Bus`
  and zod-validated `fn(...)`. String errors here are catchable only by message
  inspection.
- **Return-type honesty.** `SessionBranchRank.detail` (`branch.ts:160`) returns
  bare `return` on empty input, so its inferred type is `Detail | undefined`,
  but the declared return annotation is omitted; the only caller (`family`)
  handles it, but external callers could miss the `undefined` case.
- `SessionRollback.resolve` (`rollback.ts:75`) couples replay-event indexing to
  message-part indexing via a hand-rolled `idx` counter (`rollback.ts:89`). It
  works but is the kind of dual-index that drifts silently if the replay event
  schema adds a new step kind.

## Step 6 Dead code and hygiene

- No TODO/FIXME markers in the unit. The large comment block at `revert.ts:56-64`
  documents a fixed shadowing bug and is retained as rationale; it is not dead
  weight, but could be condensed now that the fix is in.
- `compare.ts:268-269` uses non-null assertions `replay(left.deep)!` /
  `replay(right.deep)!`. The local `replay()` helper (`compare.ts:202-209`)
  returns `undefined` only when its input is `undefined`, and the inputs are
  gated by `input.deep`, so the assertions hold today — but they encode an
  invariant that is not type-checked. Prefer `??` with an explicit throw, or
  restructure so `replay` accepts the narrowed non-undefined shape.
- `rollback.ts:123-124` uses `node!.label` / `node.tool` after a `.filter` —
  same pattern, safe by construction, fragile under refactor.
- No duplicated logic across the five files worth extracting; `inspect()`
  (`compare.ts:211`) and `detail()` ranking (`branch.ts:162`) share intent but
  differ enough in shape that a shared helper would obscure more than it saves.

## Step 7 Tests

Coverage from the MODULE-AUDIT test inventory targets the TUI routes and CLI
session lifecycle rather than these modules directly. Specifically:

- `revert.ts` is exercised indirectly through
  `test/cli/tui/h-session-undo-redo-revert-error.test.ts` (revert error path)
  and `test/cli/tui/session-child.test.ts` (fork children), but there is no unit
  test that drives `SessionRevert.revert` through the split-brain window
  described in Step 3 — i.e. no test forces `setRevert` to fail after
  `Snapshot.revert` succeeds.
- `rollback.ts` `resolve`/`pick`/`match` are pure functions
  (`rollback.ts:75`, `rollback.ts:140`, `rollback.ts:156`) and would benefit
  from direct table tests covering step/tool selection and the
  unknown-step drop case (`rollback.ts:94`).
- `move.ts` `selectReason` priority (`move.ts:102-113`) is a pure total
  function over its inputs and is a natural target for property-style tests.

The most valuable missing test is the revert atomicity scenario above.

## Step 8 Finding register

| Finding                                                                                                                                                                    | Category                  | Severity | Location                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | -------- | ------------------------------------------------------- |
| `revert()` rewrites the working tree before persisting revert metadata; failure between `Snapshot.revert` and `setRevert` leaves tree reverted but session row un-reverted | correctness / persistence | MEDIUM   | `revert.ts:67-91`                                       |
| Concurrent `revert`/`unrevert` from a second process is not serialized; `assertNotBusy` is in-memory only and no `Lock.write` is held                                      | concurrency               | LOW      | `revert.ts:25,98`; `index.ts:542,555` vs `index.ts:530` |
| `SessionMove` namespace is validation-only; name implies a mutation that does not live in this file                                                                        | cohesion                  | LOW      | `move.ts:12-166`                                        |
| Non-null assertions on `deep` replay results encode an un-checked invariant                                                                                                | hygiene                   | LOW      | `compare.ts:268-269`                                    |
| `cleanup` serializes `Bus.publish` across removed messages/parts                                                                                                           | performance               | LOW      | `revert.ts:148-159`                                     |

No Critical findings. No `findings/` files exist for this unit yet.

## Step 9 Verification and exit

This pass is a read-only architectural review; no source was modified, so no
build or test run is required to validate the unit itself. The evidence above is
file:line anchored to the read sources and to the supporting modules
(`session/index.ts`, `snapshot/index.ts`, `prompt-run-state.ts`, `id/id.ts`)
that determine whether each finding is real.

Recommended follow-ups, in priority order:

1. Wrap the `Snapshot.revert` → `setRevert` sequence so a failure after the tree
   rewrite either restores the prior snapshot or marks the session explicitly
   inconsistent (MEDIUM, Step 3).
2. Add a direct unit test for the revert split-brain window (Step 7).
3. Decide whether `SessionMove` should host its executor or be renamed (Step 5).
4. Replace the two `!` assertions in `compare.ts` with a narrowed helper
   signature (Step 6).

Independent verifier: codex-sol. No Critical items, so no `reverify.md` is
required by the protocol.
