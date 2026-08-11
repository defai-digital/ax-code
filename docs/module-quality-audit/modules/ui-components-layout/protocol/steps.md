# Reviewer 9-Step Protocol — ui-components-layout

Unit: `ui-components-layout`
Scope: `desktop/packages/ui/src/components/layout`
Reviewer: ax-code-glm (model `zai-coding-plan/glm-5.2[1m]`)
Verifier (other lane): codex-sol
Date: 2026-08-11

## Step 1 Scope and inventory

The unit is the desktop application's layout shell. The audited inventory lists 20
implementation files plus 6 co-located test files (~10,157 LOC). I read the full
contents of the small/medium components and sampled the largest ones in depth:
`desktop/packages/ui/src/components/layout/ContextPanel-impl.tsx` (2644 LOC),
`desktop/packages/ui/src/components/layout/Header.tsx` (1985 LOC),
`desktop/packages/ui/src/components/layout/ProjectActionsButton.tsx` (976 LOC),
and `desktop/packages/ui/src/components/layout/SidebarFilesTree.tsx` (1093 LOC).

The unit composes the primary chrome: `MainLayout.tsx:58` wires `Header`,
`Sidebar`, `RightSidebar`, `SplitPaneLayout`, `ContextPanel`, and
`BottomTerminalDock`. `ContextPanel.tsx` is a one-line re-export
(`export { ContextPanel } from "./ContextPanel-impl"`) — a seam that signals an
extraction was started but not finished. Pure helpers were split out cleanly:
`contextPanelPathLabels.ts`, `contextPanelPreview.ts`, `contextPanelTabs.ts`,
`desktopBrowserEvents.ts` — each paired with vitest tests.

## Step 2 Threat and boundary model

Three trust boundaries cross this unit and I traced each one:

1. **Preview iframe ↔ parent postMessage bridge.** `ContextPanel-impl.tsx:582-662`
   receives messages from the embedded preview. The handler validates
   `event.source !== iframeRef.current?.contentWindow` (line 583), then requires
   `data.source === "openchamber-preview-bridge"` and `data.version !== 1`
   (line 587). The whole listener is gated by `isLoopback` (line 559), so only
   localhost dev-server content can talk to the parent. Every untrusted field is
   stringified via the local `stringify` helper (lines 563-571) before reaching
   React state — no `dangerouslySetInnerHTML`, no `innerHTML`, no `eval`.
2. **Desktop browser webview events.** `desktopBrowserEvents.ts` normalizes both
   raw Electron webview events and `CustomEvent`-shaped polyglots. The new-window
   handler always calls `event.preventDefault()` (line 81) so no unmanaged popup
   escapes; `readDesktopBrowserLoadFailure` (line 42) filters `ERR_ABORTED (-3)`
   and subframe failures so healthy pages are not flagged as broken.
3. **Terminal-output URL extraction.** `ProjectActionsButton.tsx:90-137`
   (`extractBestUrl`) parses `http(s)://` URLs out of arbitrary process output and
   scores them, preferring `isLoopbackHostname` matches (line 118). The opened URL
   later flows through `normalizeContextPanelBrowserUrl`
   (`contextPanelPreview.ts:43-53`), which restricts to `http:`/`https:` and
   collapses `file:`, `ftp:`, and blank input to `about:blank`.

There are no secrets, no filesystem paths beyond project roots, and no inline
command execution in this unit. All `catch` blocks I inspected carry an
explanatory comment (`/* webview not ready */`, `/* ignore */`); the audit's
"0 empty catches" count matches — none are truly silent.

## Step 3 Correctness of control flow

I verified the four security-relevant invariants the source-guard tests lock in,
by reading the actual code rather than trusting the test names:

- `loadUrl` (`ContextPanel-impl.tsx:1719-1738`) sets React state in the order
  `setCurrentUrl(visibleUrl)` → `setUrlInput(visibleUrl)` →
  `setIsLoading(Boolean(visibleUrl))` **before** calling `webview.loadURL`, so
  the `src={currentUrl || "about:blank"}` render at line 2040 never lags the
  webview navigation.
- The new-window handler at line 1779 reuses `handleDesktopBrowserNewWindowEvent
(event, loadUrl)`; there is no `w.loadURL(detail.url)` anywhere in the file
  (confirmed by grep), so popups cannot spawn raw Electron windows.
- The loading-safety timeout (lines 1831-1835) guards on
  `if (!isLoading || !currentUrl) return` and re-arms on every `[currentUrl,
isLoading]` change — the 30s ceiling is per-navigation, not per-mount.
- `did-fail-load` is wired through `readDesktopBrowserLoadFailure`
  (`desktopBrowserEvents.ts:36`), which drops `errorCode === 0`,
  `CHROMIUM_ERR_ABORTED`, and `isMainFrame === false`; the failure surface
  renders `t("contextPanel.browser.loadFailed")` (line 2048).

Width clamping is consistent: `clampWidth`, `clampRightSidebarWidth`,
`clampSidebarWidth` all use `Math.min(MAX, Math.max(MIN, value))`. The context
panel additionally reserves `CHAT_MIN_WIDTH = 320`
(`ContextPanel-impl.tsx:70,89-98`) so the panel can never squeeze the chat below
a usable width — a real correctness guard, not cosmetic.

## Step 4 Performance and re-render hygiene

The resize code uses the right pattern: during drag it mutates the DOM node
directly via `applyLiveWidth` (`Sidebar.tsx:33-43`, `RightSidebar.tsx:31-41`,
`ContextPanel-impl.tsx:2185-2192`) and only flushes the final value to the
Zustand store on `pointerup`. This avoids a React re-render per `pointermove`.
`BottomTerminalDock.tsx:61-66` uses a `ResizeObserver` for fullscreen height and
disconnects it in the cleanup, so no observer leaks across open/close cycles.

`ContextSidebarTab.tsx` computes token estimates inside a single `useMemo`
(line 332, deps `[currentSessionId, providers, sessionMessages, sessions, t]`).
The char→token heuristic (`computeContextBreakdown` lines 210-235) walks every
part of every message but only recomputes when the session message array changes
— acceptable for a panel that updates per turn, and it short-circuits to
`EMPTY_BUCKETS` when there are no messages (line 211).

`MainLayout.tsx` debounces window `resize` (100ms for responsive panels at line
258, 150ms for proportional sidebar widths at line 181) and clears the timeout
on cleanup. The native update checker (lines 123-160) clamps its repeat interval
between 5 min and 24 h and sets a `disposed` flag so late `scheduleNext`
callbacks do not fire after unmount.

## Step 5 Design and ownership boundaries

The dominant design issue is size: `ContextPanel-impl.tsx` is 2644 LOC and
bundles three distinct surfaces — the embedded `PreviewFrame` (loopback proxy +
console bridge + inspect mode), the Electron `DesktopBrowserPanel` (webview
event wiring + load-failure surface), and the `ContextPanel` shell (tabs,
resize, directory-keyed state). The one-line `ContextPanel.tsx` re-export
confirms the team already intends to split this; the split is just incomplete.
Ownership is otherwise clean: stores own durable state, hooks own effects,
layout components own geometry, and pure helpers live in `.ts` modules with
co-located tests.

Three resize components (`Sidebar`, `RightSidebar`, `ContextPanel`) share ~80%
structural similarity in their pointer-capture/clamp/keyboard handlers. They
differ on axis, min/max constants, and the context panel's available-space
reservation. Given the meaningful differences I am flagging the duplication as an
observation, not recommending a forced extraction — a shared hook would have to
parameterize axis, clamping, and space reservation, which is borderline worth it
only if a fourth consumer appears.

## Step 6 Dead code and hygiene

- `ContextSidebarTab.tsx:17` — `CONTEXT_COST_DISPLAY_ENABLED = false` gates out
  the cost stat and the `totalAssistantCost` reducer branch (lines 351-356, 500).
  This is a dead feature toggle; either remove the gated code or move the flag to
  a feature-registry so it is not a local constant.
- `contextPanelTabs.ts:34` — `getContextPanelModeLabel("dashboard")` returns the
  hardcoded string `"Dashboard"` while every other mode returns an i18n key. This
  breaks the i18n contract for that one mode and will ship untranslated in
  non-English locales.
- The source-substring guard tests (`context-panel-source.test.ts`,
  `loopback-source.test.ts`, `project-actions-terminal-source.test.ts`) assert on
  literal source text (`expect(source).toContain(...)`). They are intentional
  regression guards for security-relevant patterns and I confirmed each claim
  against the code, but they are fragile under refactors and will break on
  innocent formatting changes. Acceptable as tripwires; worth a comment.
- `BottomTerminalDock.tsx` resizes via window-level `pointermove`/`pointerup`
  listeners (lines 96-101) while the other three resizers use
  `setPointerCapture`. Both approaches are correct and leak-free; noting the
  inconsistency only.

## Step 7 Tests

Pure helpers have strong, direct unit coverage: `contextPanelPathLabels.test.ts`
(Windows/UNC/POSIX/sibling-prefix cases), `contextPanelPreview.test.ts` (filter
matrix for every console level + URL scheme rejection), `contextPanelTabs.test.ts`
(directory-key normalization, file/preview/diff label derivation, truncation,
session-dedupe parsing), and `desktopBrowserEvents.test.ts` (new-window
disposition matrix + load-failure filtering including `ERR_ABORTED` and
subframes). These exercise behavior, not implementation text.

The three `*-source.test.ts` files exercise source text and serve as
security-pattern tripwires (see Step 6). There are no component-level tests for
resize geometry, pointer drag, or responsive auto-open/close inside this unit;
the only layout-behavior tests live in `packages/ax-code/test/cli/tui/` against
the TUI surface, not the desktop React surface. Helper coverage is solid;
interaction coverage for the desktop layout components themselves is thin and is
the main gap.

## Step 8 Finding register

No Critical or High severity issues. Confirmed during this pass:

| Severity | Finding                                                                                                                                                                     | Location                                                                                             |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| MEDIUM   | `ContextPanel-impl.tsx` (2644 LOC) bundles PreviewFrame + DesktopBrowserPanel + ContextPanel shell behind a 1-line re-export shim; maintainability and merge-conflict risk. | `ContextPanel-impl.tsx`, `ContextPanel.tsx`                                                          |
| LOW      | `CONTEXT_COST_DISPLAY_ENABLED = false` is a dead local feature flag gating out cost UI.                                                                                     | `ContextSidebarTab.tsx:17`                                                                           |
| LOW      | Dashboard mode label is hardcoded `"Dashboard"`, bypassing i18n.                                                                                                            | `contextPanelTabs.ts:34`                                                                             |
| LOW      | Source-substring guard tests are brittle under refactors (intentional tripwires).                                                                                           | `context-panel-source.test.ts`, `loopback-source.test.ts`, `project-actions-terminal-source.test.ts` |

The `findings/` directory is empty, consistent with a Wave-8 small-effort unit
where the primary reviewer records issues in-protocol rather than spawning
per-finding files. No Critical items → no `reverify.md` required.

## Step 9 Verification and exit

This is a documentation/review pass: no source files were modified, so no
typecheck/lint/test run is cited. The 9-step protocol above is backed by
file:line evidence read directly from the unit under review. Sign-off:

- Reviewer: ax-code-glm — 9 steps complete.
- Independent verifier: codex-sol — pending.
- Critical independent re-verification: not triggered (no Critical findings).

Recommended follow-up (non-blocking): split `ContextPanel-impl.tsx` into
`PreviewFrame.tsx` and `DesktopBrowserPanel.tsx` siblings and remove the dead
cost-display flag. These are MEDIUM/LOW and do not block the verifier gate.
