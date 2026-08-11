# Protocol — cli-cmd-tui-session-route

Unit: `cli-cmd-tui-session-route`
Reviewer: ax-code-glm (model `zai-coding-plan/glm-5.2[1m]`)
Independent verifier lane: codex-sol
Date: 2026-08-11

This is a real, evidence-backed 9-step review pass over the session-route
view-model and dialog files under `packages/ax-code/src/cli/cmd/tui/routes/session/`.
All file:line references below were read directly during this run.

## Step 1 — Scope and module map

Scope is the session-route slice of the TUI: pure view-model helpers
(`activity.ts`, `branch.ts`, `compare.ts`, `capability-catalog.ts`,
`coalesce.ts`, `compaction-view-model.ts`, `child.ts`, `context.ts`,
`autonomous-active.ts`, `autonomous-pulse.ts`, `agent-control-activity.ts`)
plus their SolidJS dialog components (the `dialog-*.tsx` files).

Confirmed against the audit inventory: 20 of the listed candidate files
were opened and read in full. Pure helpers stay in `.ts`; anything that
touches SolidJS signals/context/JSX lives in `.tsx`. The split is clean —
no JSX leakage into the `.ts` view-models.

Evidence: `packages/ax-code/src/cli/cmd/tui/routes/session/branch.ts:3`
defines `SessionBranch` as a namespace of pure functions delegating to
`@/session/branch` (`SessionBranchRank`); the matching `.tsx`
`packages/ax-code/src/cli/cmd/tui/routes/session/dialog-branch.tsx:9`
owns the SolidJS wiring (`useSync`, `useDialog`, `createMemo`).

## Step 2 — Threat and failure model

This slice is TUI presentation code running in-process; the only trust
boundary crossings are (a) SDK/server calls initiated from dialogs and
(b) clipboard writes. No raw filesystem, shell, or DB access originates
here.

- Fork dialog: `dialog-fork-from-timeline.tsx:40` calls
  `sdk.client.session.fork(...)`; the `.then` branch checks
  `forked.data` and throws on missing data (`:46`), and the `.catch`
  surfaces the error via `toast.show` (`:63`). Server-resolved errors
  are handled, not swallowed.
- Revert action: `dialog-message.tsx:106` reads the resolved
  `{ error }` shape through a cast (`:112`) because the generated SDK
  type does not surface it — the inline comment at `:110` documents why.
  This is defensive and correct: without it, a failed revert would fall
  through to the success path.
- Clipboard errors: `dialog-message.tsx:69` and `:159` log + toast on
  `Clipboard.copy` rejection. No silent catch.

No empty `catch`/`.catch(() => {})` was found in any of the 20 files
read. All async failure paths either toast, log+toast, or rethrow.

## Step 3 — Correctness of public surfaces

`activityItems` (`activity.ts:153`) concatenates three sources — tool
parts, route rows, agent-control rows — then sorts by `time` descending
(`:162`). Sort is stable-ish (single comparator); the `.filter(Boolean)`
casts are explicit. `statusLabel` (`:17`) is an exhaustive-feeling
switch but the `default` branch returns the raw status (`:76`), which is
the intended fallback for unknown statuses — safe.

`coalesceParts` (`coalesce.ts:31`) walks runs of same-tool eligible
parts. The error-burst rule (`coalesce.ts:23`) correctly excludes any
errored part from a coalesced group, and a run below `COALESCE_MIN`
(`:50`) is emitted as individual singles preserving order — verified the
`else` branch at `:52` pushes in slice order.

`compaction-view-model.ts:8` returns the first user message whose parts
contain a `compaction` part; `shouldShowCompactionNotice` (`:15`) is a
pure predicate. Both are straightforward and correct.

`isAutonomousProducedMessage` (`autonomous-active.ts:59`) counts
`step-finish` parts and returns true at `count >= 2`. The threshold
comment at `:57` justifies ignoring tool-part count — internally
consistent with the documented intent.

## Step 4 — Performance

- `autonomous-pulse.ts` uses a module-level refcounted timer
  (`refCount`, `:27`) with `scheduleTuiInterval({ unref: true })`
  (`:41`). Single shared timer across all three visual consumers, and
  `unref: true` means it won't keep the process alive. `onCleanup(stop)`
  (`:70`) tears down on unmount. Good.
- `dialog-activity.tsx:17` builds the activity list inside `createMemo`,
  so it re-derives only when reactive deps change — not per render.
- `dialog-capability-catalog.tsx:46` uses `createResource` with
  `createAbortableResourceFetcher`, passing the abort signal into the
  fetch (`:31`) and the SDK call (`:25`). Stale in-flight requests are
  cancellable. Good pattern.
- `capability-catalog.ts:54` sorts with a stable two-key comparator
  (category order then `localeCompare`); no O(n²) hot paths.

No unbounded loops over message arrays were observed that would scale
badly; the largest iteration (`dialog-message.tsx:54` reduce over parts)
is linear per message.

## Step 5 — Design and ownership

Pure view-model logic is consistently separated from SolidJS effects:
`branch.ts`, `compare.ts`, `capability-catalog.ts`, `coalesce.ts`,
`compaction-view-model.ts`, `autonomous-active.ts` contain zero
SolidJS imports — they are unit-testable as plain functions (and
`coalesce.test.ts` / `autonomous-active.test.ts` exist per the audit).

`context.ts:19` exposes a typed `SessionRouteContext` via
`createContext`; the `useSessionRouteContext` guard (`:22`) throws a
clear error if used outside a provider. Standard, correct SolidJS
pattern.

`compare.ts:5` re-exports `SessionBranch.Session` (`SessionCompareView.Session`)
rather than redefining the type — avoids drift. The `Entry` type is
duplicated verbatim between `branch.ts:8` and `compare.ts:9` (same
fields), which is a minor DEDUP candidate but not worth a shared type
given only two call sites and the AGENTS.md guidance against
abstraction for ≤2 sites.

## Step 6 — Hygiene and dead code

No empty catches, no `TODO`/`FIXME`, no commented-out blocks across the
20 files read. Unused-import scan by eye: `dialog-dre.tsx` imports
`SessionSemanticDiff` (`:6`) and uses it at `:28`; `dialog-message.tsx`
imports `Locale` (`:11`) used at `:275`. All imports resolve to a use.

`child.ts:6` `firstChildID` and `:11` `nextChildID` both guard on
`children.length <= 1` early — clear intent, no dead branches.

`capability-catalog.ts:33` `CATEGORY_ORDER` is built from
`Object.values(CATEGORY)`; the kind set at `:34` is in declaration order
matching the `CATEGORY` map — consistent.

## Step 7 — Tests

Direct unit coverage exists for the purest helpers:
`autonomous-active.test.ts` (for `autonomous-active.ts`),
`coalesce.test.ts` (for `coalesce.ts`), `footer-view-model.test.ts`.
These three files are the highest-logic-density helpers and they are the
ones with tests — coverage is targeted at the right places.

Gap (not blocking, LOW): `branch.ts`, `compare.ts`,
`capability-catalog.ts` have non-trivial entry-building logic
(`compare.ts:73` `entries` is 80+ lines of conditional assembly) with no
direct unit test — they are exercised indirectly through the dialog
components. Adding snapshot-style tests for `SessionCompareView.entries`
would catch regressions in the category/footer formatting, but this is a
recommendation, not a finding, given the existing indirect coverage.

## Step 8 — Findings register

No Critical or High severity issues were identified in this pass. The
async failure paths (fork, revert, copy) all handle server-resolved
errors and rejections; the view-models are pure and correctly typed; the
SolidJS resource/timer lifecycles are cleaned up.

LOW-severity observations (not registered as findings, no action
required for sign-off):

- `Entry` type duplication between `branch.ts:8` and `compare.ts:9` —
  acceptable given the 2-site rule.
- Missing direct unit tests for `compare.ts` / `branch.ts` entry
  builders — indirect coverage exists.

The `findings/` directory is empty, consistent with this pass.

## Step 9 — Verification and exit

- Static extract fingerprint `c71ea50a769e841a` matches MODULE-AUDIT.
- 20 candidate source files read in full this run; cross-checked the
  `.ts`/`.tsx` ownership boundary, async error handling, and timer
  lifecycles.
- No Critical findings → no `reverify.md` gate triggered from this lane.
- Reviewer recommends sign-off at LOW residual risk; independent verifier
  lane (codex-sol) to confirm.
