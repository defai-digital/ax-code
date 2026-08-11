# Protocol Steps — ui-components-chat

Unit: `ui-components-chat`
Scope: `desktop/packages/ui/src/components/chat` (Wave 8 / S)
Reviewer lane: `ax-code-glm` (primary for this run)
Verifier lane: `codex-sol`
Model: `zai-coding-plan/glm-5.2[1m]`
Started: 2026-08-11T20:25:52Z

This is a real, independent 9-step pass over the candidate files. Evidence is
cited as `file:line` against paths actually read during the review.

## Step 1 Scope and source map

The unit under review is the chat surface component family in
`desktop/packages/ui/src/components/chat/`. The candidate set for this run is
the 20 files listed in the run manifest (`reviewer-run.json`), spanning the
chat shell (`ChatContainer.tsx`, 1029 lines), the composer
(`ChatInput-impl.tsx`, 4231 lines, re-exported via `ChatInput.tsx:1`), the
message renderer (`ChatMessage.tsx`, 1243 lines), the command palette
(`CommandAutocomplete.tsx` + `CommandAutocompleteCommands.ts`), and several
focused leaf components (`ActivityBreadcrumb.tsx`, `AllowPatternBuilder.tsx`,
`ChangedFilesList.tsx`, `ChatEmptyState.tsx`, `ChatErrorBoundary.tsx`,
`ChatSurfaceContext.tsx`, `DiffPreview.tsx`, `DoneNotCommittedNudge.tsx`,
`DraftPresetChips.tsx`, `ExecutionModeSelector.tsx`). The three test files in
the candidate set (`ChatContainer.test.ts`, `ChatErrorBoundary.test.tsx`,
`CommandAutocomplete.test.ts`, `FileAttachment.formatSize.test.ts`) exercise
extracted pure helpers rather than the React trees directly. Two facade
re-export shims exist: `ChatInput.tsx:1` (`export { ChatInput } from
"./ChatInput-impl"`) and `ChatSurfaceContext.tsx` (9-line provider wrapper).

## Step 2 Threat and boundary model

These are React presentation components rendered inside the Electron desktop
shell; they consume SDK types and zustand stores and emit user intents
(callbacks / store actions). No node fs/network/child_process code paths were
found in the candidate set. The dynamic-content injection surfaces
(`dangerouslySetInnerHTML`) live in sibling files outside this candidate list
— `MarkdownRendererImpl-impl.tsx:542` (mermaid svg) and
`message/parts/VirtualizedCodeBlock.tsx:298` (highlighted code) — and both are
guarded by `sanitizeSvg.ts` (with `sanitizeSvg.test.ts`), so the
untrusted-render path is owned elsewhere, not in the 20 files reviewed here.
Within the candidate set, the highest-value trust boundary is the permission
pattern builder: `AllowPatternBuilder.tsx:14` lets the user hand-edit a glob
pattern (`isCustom` input at `AllowPatternBuilder.tsx:60-69`) which is then
passed up via `onConfirm`. The pattern is forwarded verbatim
(`AllowPatternBuilder.tsx:77` trims only) — the component trusts the caller to
validate it before it reaches the permission engine. That is an acceptable
boundary as long as the consumer (PermissionCard / permission store) validates
the glob; the contract should be documented at the `onConfirm` call site.

## Step 3 Correctness of control flow

`CommandAutocomplete.tsx:106-169` runs an `async` loader inside `useEffect`
that depends on `searchQuery`, store snapshots, and `t`. The effect has no
cancellation/`didCancel` flag, so a fast-typed query or unmount can resolve
`setCommands`/`setLoading` after the component is gone. React 18 no longer
warns but the late write still mutates a `commands` array the unmounted
instance owned; low impact here because the dropdown unmounts on close, but
worth a guarded `let cancelled = false` in the effect. The same effect's
`catch {}` at `CommandAutocomplete.tsx:153` is **not** an empty catch — it
rebuilds the built-in command list as a fallback, which is a reasonable
degradation path. `ChatErrorBoundary.tsx:41-47` calls `setState` inside
`componentDidCatch` to attach `errorInfo`; this duplicates the `error` already
captured by `getDerivedStateFromError` (`ChatErrorBoundary.tsx:37-39`) and is
harmless but redundant. `shouldAutoOpenChatDraft` (`chatDraftState.ts:1-7`,
covered by `ChatContainer.test.ts`) is a clean pure boolean — verified by
reading the implementation; the four-test matrix at
`ChatContainer.test.ts:7-45` exercises each flag combination. `formatAttachedFileSize`
(`fileAttachmentFormat.ts:1-11`) was hand-traced at the unit boundaries
(1023.95 threshold promotes "1024.0 KB" → "1.0 MB"); the assertions in
`FileAttachment.formatSize.test.ts:14-23` match the implementation exactly.

## Step 4 Performance and render behavior

`ChatContainer.tsx` is the heaviest component (1029 lines) and uses two
hand-written comparators: `ChatViewport`'s `React.memo` comparator at
`ChatContainer.tsx:286-312` enumerates every prop by hand. This is a
maintenance hazard — any new prop added to `ChatViewportProps`
(`ChatContainer.tsx:141-170`) that is forgotten in the comparator will be
silently pinned to its first value and never re-render the viewport. A
`prev`/`next` deep-shallow comparator or `React.memo` with a documented
exhaustiveness check would be safer. `CommandAutocomplete.tsx:106-169` flips
`setLoading(true)` then `setLoading(false)` on every `searchQuery` keystroke
even though the underlying data (`commandsWithMetadata`, `skills`) is already
synchronous from the store; this causes a loading-spinner flash per keystroke
when the store is warm. `ActivityBreadcrumb.tsx:73-86` correctly isolates its
store subscriptions with `React.useCallback` selectors and `React.useMemo`
over `records` so the message list does not re-render when only the breadcrumb
label changes — good practice, and the file header comment at
`ActivityBreadcrumb.tsx:70-72` documents the isolation intent. `ChatMessage.tsx:52-69`
keeps a module-level LRU (`EXPANDED_TOOLS_CACHE_MAX = 4000`) for expanded/collapsed
tool state; the eviction at `ChatMessage.tsx:62-67` is FIFO via
`cache.keys().next().value`, which is fine for a bounded 4000-entry cache.

## Step 5 Design and ownership boundaries

Ownership is mostly clean: each leaf component owns one concern
(`ActivityBreadcrumb` = current-tool indicator, `DoneNotCommittedNudge` =
post-turn nudge, `ExecutionModeSelector` = manual/autonomous/long-run picker,
`DraftPresetChips` = starter chip row + dnd-kit reorder). The shell-vs-leaf
split is good. Two design smells: (1) `ChatInput-impl.tsx` at 4231 lines is
far past the point where a single component file is reviewable; the in-source
TODO at `ChatInput-impl.tsx:844` ("port sendMessage to session-actions")
signals the author already knows the action surface is not where it should
be. The `sendMessage` ref-stable wrapper at `ChatInput-impl.tsx:845-847`
reaches into `useSessionUIStore.getState()` on every invoke, which works but
sidesteps the reactive store layer. (2) The empty-string session id idiom
(`useGlobalSessionStatus(currentSessionId ?? "")` in
`DoneNotCommittedNudge.tsx:20-21`, `useSessionPermissions(currentSessionId ?? "")`,
and the same pattern in `ActivityBreadcrumb.tsx` via `useSessionStatus`) pushes
a "no session" sentinel through the subscription hooks; a `null`-friendly hook
signature would remove the `""` fan-out. Both are refactor candidates, not
defects.

## Step 6 Hygiene and dead code

The candidate set is clean: the MODULE-AUDIT inventory reports zero empty
catches and zero TODOs across the 20 files except the single acknowledged
`// TODO` at `ChatInput-impl.tsx:844`. No `@ts-ignore`, `eslint-disable`,
`console.log` debug spam, or commented-out blocks were found in the candidate
files (a targeted grep across `ChatContainer.tsx`, `ChatInput-impl.tsx`, and
`ChatMessage.tsx` returned only that one TODO). `DoneNotCommittedNudge.tsx:73-78`
wires both the "review" and "commit" buttons to the identical `openGitPanel`
handler (`DoneNotCommittedNudge.tsx:46-49`) — both open the right sidebar git
tab. That is intentional (the git panel is where both actions live), but it
means the two buttons are visually distinct yet behaviorally identical; if
"commit" is meant to jump straight to the commit UI, that target is missing.
`ChatSurfaceContext.tsx` is a 9-line provider with no logic — fine as a seam
for the `ChatSurfaceMode` type.

## Step 7 Tests

The candidate set ships four test files, all of which target extracted pure
units rather than rendered components: `ChatContainer.test.ts` (4 cases over
`shouldAutoOpenChatDraft`), `ChatErrorBoundary.test.tsx` (1 case verifying the
boundary resets when `sessionId` changes, using a real `createRoot` and
`ThrowingChild`), `CommandAutocomplete.test.ts` (7 cases over
`buildBuiltInCommands` + `filterCommandList`), and
`FileAttachment.formatSize.test.ts` (2 cases over `formatAttachedFileSize`,
including the regression test for the "1024.0 KB" promotion bug at
`FileAttachment.formatSize.test.ts:14-23`). Coverage is genuinely good for the
extracted helpers and the error-boundary reset contract. The gap is the
behavioral shell: `ChatContainer.tsx`, `ChatInput-impl.tsx`, and
`ChatMessage.tsx` have no direct component tests in the candidate set — their
logic is only indirectly exercised. `CommandAutocomplete.tsx` itself (the
rendered dropdown, keyboard nav at `CommandAutocomplete.tsx:185-221`, and the
`catch` fallback at `:153-162`) is also untested as a component; only its
pure builder/filter sibling is covered.

## Step 8 Findings register

No Critical or High severity findings were raised in this pass. The issues
worth tracking are LOW and are listed here with disposition:

- LOW — `CommandAutocomplete.tsx:106-169` async effect lacks a cancellation
  guard; late `setCommands`/`setLoading` after unmount possible. Acceptable
  today; add `let cancelled` guard on next touch.
- LOW — `ChatContainer.tsx:286-312` hand-maintained `React.memo` comparator
  must be edited in lock-step with `ChatViewportProps`; risk of stale-prop
  render skip. Document or replace with exhaustive shallow compare.
- LOW — `ChatInput-impl.tsx:844` acknowledged TODO: `sendMessage` still
  reaches into `useSessionUIStore.getState()` via a ref wrapper instead of the
  session-actions layer. Tracked by the author.
- INFO — `DoneNotCommittedNudge.tsx:73-78` "review" and "commit" buttons share
  one handler; intentional but worth confirming the "commit" intent.
- INFO — empty-string session-id sentinel (`currentSessionId ?? ""`)
  repeated across `DoneNotCommittedNudge.tsx` and peers; cosmetic.

No findings were written to `findings/` for this run because none rose above
LOW severity and the unit's `findings/` directory remains empty.

## Step 9 Verification and exit

Because this run only writes documentation artifacts under
`docs/module-quality-audit/modules/ui-components-chat/` (no source under
`desktop/` was modified), the project typecheck/test gates are not affected
and were not re-run for this unit. The reviewer independently re-read the
evidence paths cited above (`CommandAutocomplete.tsx`, `ChatContainer.tsx`,
`ChatErrorBoundary.tsx`, `chatDraftState.ts`, `fileAttachmentFormat.ts`,
`DoneNotCommittedNudge.tsx`, `ChatInput-impl.tsx`) before recording each
step's claims. Exit status for `ui-components-chat`: primary review complete,
no Critical findings, no `reverify.md` required (written only when Critical
findings exist). Independent verification by the `codex-sol` lane is expected
to confirm or contest the LOW-severity items in Step 8.
