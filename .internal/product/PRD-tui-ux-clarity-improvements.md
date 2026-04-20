# PRD: TUI UX Clarity Improvements

**Date:** 2026-04-19
**Status:** Draft
**Author:** ax-code agent

---

## Problem Statement

The revised TUI UX report identified four issues that are valid, implementation-ready, and materially affect day-to-day TUI usability:

1. Large pasted text is summarized into a virtual token, but users cannot inspect it from the prompt surface without pasting again.
2. Nested subagent sessions expose parent/previous/next navigation, but not the user’s current position in the ancestry chain.
3. Session compaction is rendered as a divider only, with no first-time explanation that it is expected behavior.
4. On narrow terminals, transcript metadata can occupy disproportionate visual space relative to message content.

These issues are local to the TUI surface and can be addressed without changing session semantics, revert semantics, or server APIs.

One correction from the source UX report is important for implementation scope: current user-message transcript metadata does not render model or variant information. The current row is made up of routing/delegation badges, timestamps, and queued state. This PRD scopes the narrow-screen work to the metadata that actually exists today.

## Goals

- Goal 1: Let users inspect large summarized paste content without re-pasting and without changing submitted prompt semantics.
- Goal 2: Make subagent nesting depth and ancestry obvious in the session header.
- Goal 3: Explain compaction the first time it appears in a session so it reads as normal system behavior rather than an error.
- Goal 4: Reduce transcript metadata density below 100 columns while preserving a keyboard path to full detail.
- Non-goal: Do not redesign `Esc` behavior, sidebar-less context warnings, revert branch visualization, shell discoverability, or denial-reason differentiation in this PRD.

## Current State

### Paste summarization

`packages/ax-code/src/cli/cmd/tui/component/prompt/index.tsx` collapses pasted text longer than 3 lines or 150 characters into a virtual token such as `[Pasted ~N lines]`. The full pasted content is still retained in `store.prompt.parts` as a text part, and `packages/ax-code/src/cli/cmd/tui/component/prompt/view-model.ts` reconstructs the original prompt text correctly during submit. The missing capability is inspection from the composer surface.

### Subagent session header

`packages/ax-code/src/cli/cmd/tui/routes/session/header.tsx` renders child-session controls as:

- `Subagent session`
- `Back to Parent`
- `Prev`
- `Next`

This helps with sibling navigation, but it does not communicate ancestry depth or current location for nested subagent trees.

### Compaction presentation

`packages/ax-code/src/cli/cmd/tui/routes/session/index.tsx` renders compaction as a divider labeled `Compaction`. There is no session-scoped “first occurrence” explainer, and there is no persisted dismissal state for the explanation.

### Transcript metadata density

`packages/ax-code/src/cli/cmd/tui/routes/session/index.tsx` renders user-message metadata inline under the message body when metadata is visible. `packages/ax-code/src/cli/cmd/tui/routes/session/view-model.ts` exposes renderer-neutral helpers for whether metadata should be shown, but not for width-aware density modes. The current user-message metadata includes:

- primary route badge
- delegated subagent badges
- timestamp
- queued state

There is no compact metadata mode for narrow terminals and no keyboard-first command to temporarily expand transcript metadata detail.

### Existing keyboard-first surfaces

The TUI already has suitable keyboard-first extension points:

- `packages/ax-code/src/cli/cmd/tui/routes/session/display-commands.ts` for session-level commands and toggles
- `packages/ax-code/src/cli/cmd/tui/component/dialog-command.tsx` for command palette access
- `packages/ax-code/src/cli/cmd/tui/context/kv.tsx` for local persisted TUI state

These should be reused instead of adding hover-only affordances.

## Proposed Solution

### Overview

Ship a focused TUI clarity pass that covers:

1. inspectable large paste summaries
2. breadcrumb-style subagent ancestry in the header
3. first-compaction explainer notice
4. compact metadata mode for narrow transcript layouts

The changes remain TUI-local. Prompt submission payloads, session storage, revert behavior, and server routes remain unchanged.

### Technical Design

#### 1. Inspectable large paste summaries

Add a renderer-neutral helper for summarized paste parts, likely under `packages/ax-code/src/cli/cmd/tui/component/prompt/`, that derives:

- whether a text part is a summarized paste token
- total line count
- preview label
- preview content

The key product requirement is:

- summarized paste content must become inspectable from the prompt surface
- inspection must not mutate the underlying prompt text that is submitted

Preferred UI behavior:

- keep the collapsed token in the textarea
- when the user activates that token via mouse or keyboard, open a bounded read-only preview directly below the prompt
- allow closing the preview without altering the stored paste part or extmark mapping

This keeps the current extmark-backed prompt model intact while solving the “what did I just paste?” problem.

#### 2. Subagent breadcrumbs and depth indicator

Add a pure helper, likely `packages/ax-code/src/cli/cmd/tui/routes/session/header-view-model.ts`, that computes the ancestry chain for the current session from the synced session graph.

Requirements:

- render a breadcrumb row for child sessions
- preserve existing `Back to Parent`, `Prev`, and `Next` actions
- degrade gracefully when a title is unavailable by falling back to a short session label
- collapse middle ancestors on tight widths rather than wrapping uncontrollably

Example target presentation:

- wide: `Root Session > Parent Session > Current Subagent`
- narrow/deep: `Root Session > … > Parent Session > Current Subagent`

#### 3. First-compaction explainer

Add a TUI-local compaction explainer state, likely backed by `useKV()`, keyed by session ID.

Requirements:

- when the first compaction marker appears in a session, show a dismissible explanatory notice near that first divider
- copy should explain that older context was summarized to free context window capacity and that the session can continue normally
- once dismissed for a given session, the explainer stays hidden for that session on reopen
- later compaction markers continue to render the existing compact divider without repeating the explainer

This is a TUI education layer, not a server-side session feature.

#### 4. Narrow-screen compact transcript metadata

Extend `packages/ax-code/src/cli/cmd/tui/routes/session/view-model.ts` or add a dedicated helper to compute a metadata density mode from:

- terminal content width
- queued state
- delegation count
- timestamp visibility
- user preference override

Requirements for `<100` columns:

- default to a compact metadata row for user messages
- compact row must prioritize the current route indicator and queue/timestamp state
- delegated badges must compress to a concise summary rather than render a long badge list
- full metadata must remain reachable through a keyboard-first command path

Proposed initial keyboard path:

- add a session command in `display-commands.ts` to toggle metadata density between `auto/full/compact`
- expose it through the command palette

Mouse activation may mirror the same behavior, but must not be the only way to reach it.

Assistant footer layout is explicitly out of scope for this PRD unless user-message compact mode reveals a broader transcript-wide pattern worth a follow-up PRD.

### API / Interface Changes

No server API changes are required.

Internal TUI interface changes likely include:

- new prompt paste preview helper(s)
- new header ancestry helper(s)
- new compaction explainer helper/state
- new transcript metadata density helper/state
- new session display command for metadata density override
- new KV keys for compaction explainer dismissal and metadata-density preference

User-facing UI changes:

- prompt can inspect summarized paste tokens
- child session header shows ancestry/breadcrumbs
- first compaction shows a dismissible explanation
- user-message metadata defaults to a compact row below 100 columns

## Alternatives Considered

### Alternative 1: Ship four unrelated patches without a shared PRD

- Pros: lower document overhead, each fix can move independently
- Cons: weak scope control, duplicated TUI state decisions, easier to accidentally absorb deferred issues like `Esc` affordance or revert visualization
- Why not chosen: these changes share the same TUI state surfaces and testing patterns, so one scoped PRD is cleaner

### Alternative 2: Expand scope to cover all redefined UX issues in the revised report

- Pros: one larger UX sweep, fewer future planning docs
- Cons: mixes backlog-ready improvements with unresolved product-direction work such as revert branch visibility and broader interaction-model consistency
- Why not chosen: this would blur implementable UX debt with open product decisions and slow down delivery

## Implementation Plan

### Phase 1: View Models and State Contracts

- [ ] Add a pure prompt paste preview helper that classifies summarized paste parts without changing submission semantics
- [ ] Add a pure session ancestry helper for breadcrumb rendering
- [ ] Add a pure compaction explainer state helper keyed by session ID
- [ ] Add a pure transcript metadata density helper for narrow-width rendering

### Phase 2: Prompt and Header Integration

- [ ] Integrate summarized paste inspection into the prompt surface
- [ ] Render child-session breadcrumbs above or alongside the existing navigation buttons
- [ ] Ensure deep ancestry collapses cleanly on narrow widths

### Phase 3: Transcript and Compaction Integration

- [ ] Render the first-compaction explainer with dismiss support
- [ ] Integrate compact user-message metadata mode below 100 columns
- [ ] Add a keyboard-first command path for metadata density override

### Phase 4: Polish and Validation

- [ ] Verify the four changes together on 80, 100, and 120 column layouts
- [ ] Update any help or command labels needed for new toggle surfaces
- [ ] Confirm no regressions to prompt submission, session navigation, or transcript export

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Prompt paste preview breaks extmark-to-part synchronization | Medium | High | Keep preview state separate from submitted prompt text and reuse existing `promptSubmissionView` contract |
| Breadcrumb ancestry is incomplete when ancestor titles are not locally available | Medium | Medium | Build a graceful fallback label strategy and avoid blocking rendering on missing titles |
| Compact metadata mode hides too much routing context | Medium | Medium | Define a minimum compact contract and keep a keyboard override to full mode |
| Compaction explainer becomes noisy or reappears unexpectedly | Low | Medium | Persist dismissal by session ID and show the explainer only for the first compaction marker in that session |

## Testing Strategy (TDD)

Design tests before implementation. These tests define the contract for the feature.

### Test Cases (write these first)

| # | Test Name | Input | Expected Output | Type |
|---|-----------|-------|-----------------|------|
| 1 | summarized paste preview classifies large pasted text | text part with `[Pasted ~8 lines]` source token and full text payload | helper reports inspectable summarized paste with correct line count | unit |
| 2 | prompt submission ignores preview state | summarized paste part is previewed then submitted | submitted text matches original full pasted content | unit |
| 3 | breadcrumb ancestry orders sessions root-to-current | nested session chain | helper returns ordered ancestry path | unit |
| 4 | breadcrumb collapses middle ancestors on narrow width | deep ancestry plus narrow width | rendered/view-model output keeps root, current, and compressed middle segment | unit |
| 5 | compaction explainer appears only on first compaction in a session | session with first compaction marker | explainer visible once with dismiss affordance | integration |
| 6 | compaction explainer stays dismissed for the same session | dismissed session reopened with compaction marker | explainer remains hidden | integration |
| 7 | user message metadata defaults to compact mode below 100 columns | width 80 with delegated badges and timestamp | compact metadata model is returned | unit |
| 8 | user message metadata stays full at wider widths | width 120 with same message data | full metadata model is returned | unit |
| 9 | metadata override wins over auto width mode | width 80 plus user override `full` | full metadata model is returned | unit |
| 10 | existing prompt and child-session helpers remain correct | paste summary present, nested sessions present | existing helper behavior still passes unchanged where intended | regression |

### Test Files to Create

- `packages/ax-code/test/cli/tui/prompt-paste-view-model.test.ts` — summarized paste classification and preview-state contract
- `packages/ax-code/test/cli/tui-session-header-view-model.test.ts` — ancestry ordering, fallback labels, and narrow-width breadcrumb collapsing
- `packages/ax-code/test/cli/tui-session-compaction-notice.test.ts` — first-occurrence notice visibility and dismissal persistence

### Test Files to Extend

- `packages/ax-code/test/cli/prompt-view-model.test.ts` — verify prompt submission remains stable with summarized paste preview state
- `packages/ax-code/test/cli/tui/session-view-model.test.ts` — add width-aware metadata density coverage
- `packages/ax-code/test/cli/tui-session-child.test.ts` — keep child navigation helpers aligned with ancestry work

### Coverage Goals

- Cover every new pure helper introduced for paste preview, ancestry, compaction notice visibility, and metadata density
- Cover the interaction between preview state and `promptSubmissionView`
- Cover narrow-width edge cases at the threshold boundary around 100 columns
- Cover missing ancestor titles and repeated compaction markers in the same session

### Existing Tests to Verify

- `packages/ax-code/test/cli/prompt-view-model.test.ts`
- `packages/ax-code/test/cli/tui/session-view-model.test.ts`
- `packages/ax-code/test/cli/tui-session-child.test.ts`
- `packages/ax-code/test/cli/tui-session-navigation.test.ts`
- `packages/ax-code/test/cli/tui-footer-view-model.test.ts`

## Dependencies

- External packages needed: none expected
- Internal modules affected:
  - `packages/ax-code/src/cli/cmd/tui/component/prompt/index.tsx`
  - `packages/ax-code/src/cli/cmd/tui/component/prompt/view-model.ts`
  - `packages/ax-code/src/cli/cmd/tui/routes/session/header.tsx`
  - `packages/ax-code/src/cli/cmd/tui/routes/session/index.tsx`
  - `packages/ax-code/src/cli/cmd/tui/routes/session/view-model.ts`
  - `packages/ax-code/src/cli/cmd/tui/routes/session/display-commands.ts`
  - `packages/ax-code/src/cli/cmd/tui/context/kv.tsx`
- Breaking changes to existing APIs: none intended

## Success Criteria

- Users can inspect large summarized pasted content from the prompt surface without re-pasting.
- Nested subagent sessions display ancestry context, not only sibling navigation controls.
- The first compaction in a session is explained once and can be dismissed.
- At 80-column layouts, user-message metadata is visibly lighter than today by default while full detail remains reachable through keyboard interaction.
- Prompt submission semantics, child-session navigation, and existing transcript/test behavior remain intact.
