# Protocol Steps — ui-components-terminal

Reviewer: ax-code-glm · Model: zai-coding-plan/glm-5.2[1m] · Date: 2026-08-11
Baseline commit: `994f9287e497666e104644eccea299595a35b39a` · Fingerprint: `cfeb22d6bedca5e7`

## Step 1 Scope and Inventory

The unit `ui-components-terminal` resolves to exactly one source file:
`desktop/packages/ui/src/components/terminal/TerminalViewport.tsx` (1734 lines).
It exports two symbols (lines 1733-1734): the `TerminalViewport` component and the
`TerminalController` type. The component is a `React.forwardRef`
(declared at line 83) that renders a Ghostty-based terminal canvas, with an
optional hidden-input overlay for mobile IME (lines 1657-1718), kinetic touch
scrolling (lines 581-984), selection/copy bridging (lines 406-486), resize
fitting (lines 498-520), and chunked write batching (lines 522-579). The sole
consumer is `desktop/packages/ui/src/components/views/TerminalView.tsx:1231`,
which supplies `bufferChunks`, resize/input callbacks, theme, and the
`enableTouchScroll` / `isVisible` flags.

## Step 2 Threat and Failure Surface

This is a desktop UI component sitting on top of several untrusted-ish input
streams: raw PTY byte chunks (`chunks` prop), user keystrokes, paste payloads,
touch/pointer gestures, and clipboard writes. Boundary walk:

- Paste handler (lines 1573-1586) forwards `event.clipboardData?.getData("text")`
  straight to `inputHandlerRef.current`, wrapping in bracketed-paste markers when
  `terminal.hasBracketedPaste?.()` is truthy. This is expected terminal behavior
  but it does trust the browser clipboard and pipe it to the PTY unchanged.
- `copySelectionToClipboard` (lines 448-459) writes terminal/DOM selection text
  out via `copyTextToClipboard` (imported from `@/lib/clipboard`, line 8).
- The component mutates surrounding DOM aggressively: `disableTerminalTextareas`
  (lines 158-224) rewrites `contenteditable`, `tabIndex`, `aria-hidden`, and
  inline styles on every textarea/contenteditable under the container. This
  assumes the component owns its container subtree — a reasonable assumption
  inside a docked terminal pane, but it would corrupt neighbors if the container
  were ever re-parented.
- No secret handling, no network calls, no file IO. Risk tags `desktop, ui` from
  MODULE-AUDIT confirmed accurate.

## Step 3 Correctness — Control Flow

I traced the initialization effect (lines 986-1215), the chunk-replay effect
(lines 1249-1279), the write flusher (lines 522-579), and the imperative handle
(lines 1281-1301).

- The init effect's cleanup (lines 1176-1202) is thorough: it flips `disposed`,
  tears down touch scroll, removes the `focusin`/`blur` listeners, disposes all
  `localDisposables`, restores the patched `scrollToBottom` (1070-1081) and the
  patched `container.focus` (1003-1014), disconnects both observers, disposes the
  terminal, nulls the refs, and calls `resetWriteState` which cancels the pending
  `requestAnimationFrame` (lines 488-496).
- `flushWrites` (522-554) correctly handles the "terminal gone mid-flush" case
  by calling `resetWriteState` (lines 528-531) and guards re-entry with
  `isWritingRef`.
- One real robustness concern: in the chunk-replay effect, when
  `lastProcessedId` is not found in `chunks` (line 1270 returns -1), the fallback
  at line 1271 sets `pending = chunks` and re-writes the entire buffer WITHOUT a
  preceding `terminal.reset()`. This is only safe under an append-only chunk
  contract from `useTerminalStore`. If the store ever compacts or removes a chunk
  from the middle of the array, the user would see duplicated output. Today the
  store is append-only, so this is latent rather than active.

## Step 4 Correctness — Edge Cases and Null Handling

- `findScrollableViewport` (lines 22-50) guards SSR with
  `typeof window === "undefined"` (line 23) and returns `null` when no
  overflow-auto/scroll element exists; the caller at lines 1117-1124 handles the
  null viewport by skipping `OverlayScrollbar` (condition at line 1719).
- `fitTerminal` (lines 498-520) bails when the container rect is below 24px in
  either dimension (line 506), preventing degenerate zero-size fit calls during
  initial layout.
- `focusHiddenInput` (lines 258-300) clamps the overlay coordinates to viewport
  bounds with padding (lines 274-276) and falls back to `input.focus()` if
  `focus({ preventScroll: true })` throws (lines 290-297).
- Imperative `clear`/`fit`/`focus` (lines 1283-1300) all null-check
  `terminalRef.current` before touching the terminal.
- The genuine dead-code spots are narrow: lines 790 and 945 do
  `scrollByPixels(...) ?? false`, but `scrollByPixels` (lines 632-651) only ever
  returns `boolean` (line 634 `return false`, line 650 `return after !== before`),
  so the nullish branch is unreachable. Lines 1324-1325
  (`void isInsideTerminal; void isHiddenInput;`) are no-ops on values already
  consumed in the early-return condition at line 1318.

## Step 5 Performance and Resource Lifecycle

- Write batching is healthy: `enqueueWrite` (570-579) accumulates into
  `pendingWriteRef` and drains through `scheduleFlushWrites` (556-568) on
  `requestAnimationFrame`, so a burst of chunks becomes one `terminal.write`.
- `ResizeObserver` (lines 1154-1157) only calls `fitTerminal`, which itself
  short-circuits when size is unchanged via `lastReportedSizeRef` (512-516).
- The notable hot path is the `MutationObserver` at lines 1105-1114. It watches
  the entire container with `childList:true, subtree:true, attributes:true` and
  an `attributeFilter` over four attributes, and every callback runs
  `disableTerminalTextareas` (158-224) — which in turn does two
  `querySelectorAll` sweeps (lines 173 and 194) plus per-node inline style
  writes. On a high-throughput terminal where the renderer may add or remove DOM
  nodes, this is O(mutations × DOM size) and is the most plausible source of
  scroll/input jank. Recommend narrowing the observer (drop `subtree` if the
  textareas are direct children, or debounce the callback) — this is the
  MEDIUM finding below.
- No resource leaks detected: every RAF id, observer, listener, and disposable
  registered in the init effect is removed in its cleanup.

## Step 6 Design and Cohesion

The component holds roughly 25 `useRef` slots (lines 102-130) and owns seven
distinct responsibilities: terminal lifecycle, write batching, resize fitting,
cursor blink, selection/copy, kinetic touch scroll, and IME hidden-input
handling. `setupTouchScroll` alone (lines 581-984) is ~400 lines and forks into
a `PointerEvent` branch (663-831) and a `TouchEvent` branch (833-983) that share
near-identical kinetic math (compare the `step` closures at 785-805 vs
940-958, and the velocity EMA at 723-733 vs 888-898). This is design debt rather
than a defect — the code is stable and the two branches are not byte-identical
enough to trivially merge — but it makes the file expensive to audit. Under the
"3+ call sites" rule, the shared kinetic step + velocity update would justify
extraction into a `useKineticTouchScroll` hook if the touch code is expected to
keep changing; if it is frozen, leaving it in place is the lower-risk choice.

## Step 7 Hygiene and Dead Code

The MODULE-AUDIT static map reports 0 empty catches and 0 TODOs. In practice
the file has many `catch { /* ignored */ }` blocks (lines 251-253, 291-296,
394-396, 517-519, 687-689, 761-763, and others) — all of them guard
best-effort DOM/focus/pointer-capture calls where ignoring the exception is the
correct behavior for a defensive UI layer. They are acceptable. The only true
dead code is what Step 4 already called out: the unreachable `?? false` at lines
790 and 945 and the `void` no-ops at lines 1324-1325. No commented-out code, no
hardcoded URLs, no inline filesystem paths. The physics tuning literals at
lines 609-615 (`baseScrollMultiplier`, `maxScrollBoost`, `velocityAlpha`,
`maxVelocity`, `deceleration`) are local constants inside `setupTouchScroll`,
which is the right place for them — they are not environment-dependent and
should not be externalized.

## Step 8 Findings Register

No Critical or High severity findings. Accepted items:

- **LOW (dead-code)** — redundant `?? false` on a boolean return at
  `desktop/packages/ui/src/components/terminal/TerminalViewport.tsx:790` and
  `:945`.
- **LOW (dead-code)** — no-op `void isInsideTerminal; void isHiddenInput;`
  statements at `TerminalViewport.tsx:1324-1325`, where both values are already
  consumed by the condition at line 1318.
- **MEDIUM (performance)** — `MutationObserver` at
  `TerminalViewport.tsx:1105-1114` runs `disableTerminalTextareas` on every
  subtree mutation; narrow the observer scope or debounce the callback.
- **LOW (test gap)** — no behavioral tests exercise this 1734-line component.
  The only test that reads the file,
  `desktop/packages/ui/src/components/views/terminal-view-source.test.ts:42-49`,
  asserts source substrings (`onInitializeError`), not behavior. The tests
  cited in MODULE-AUDIT (`packages/ax-code/test/cli/tui/terminal-cleanup.test.ts`,
  `terminal-suspend.test.ts`) cover the core SolidJS TUI, not this desktop
  React component.
- **LOW (robustness)** — chunk-replay fallback at `TerminalViewport.tsx:1271`
  re-writes the entire buffer without `terminal.reset()` when
  `lastProcessedId` drifts; safe today under append-only contract, fragile if
  the store ever compacts.
- **INFO (design)** — god component with ~25 refs and duplicated kinetic-scroll
  branches; flagged for awareness, no action required unless the touch code
  churns.

## Step 9 Verification and Exit

Static-extract fingerprint `cfeb22d6bedca5e7` in MODULE-AUDIT matches the file
under review (1734 lines, single source). Because this review produced no
Critical findings and the `findings/` directory is empty, no `reverify.md` is
required for the gate. Recommended verification for an implementer picking up
the MEDIUM finding: run
`pnpm --dir desktop exec vitest run src/components/views/terminal-view-source.test.ts`
to confirm the source-guard suite still passes, and
`pnpm run desktop:typecheck` to confirm types after any change to the observer.
This review was read-only — no source files were modified — so those commands
are advisory for the next agent, not a verification I ran on a diff. Protocol
complete for `ui-components-terminal`; the actionable work is the
`MutationObserver` scope (MEDIUM) and, optionally, extraction of the shared
kinetic-scroll hook if the touch path is expected to keep evolving.
