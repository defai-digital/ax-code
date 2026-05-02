# ax-code v4.6.4

This release fixes slash-command autocomplete keyboard navigation, widens the gap between command name and description, and includes additional autocomplete popup placement hardening.

## Highlights

- **Slash autocomplete keyboard navigation fixed** — pressing up / down (or Ctrl+P / Ctrl+N) now reliably moves the selection in the `/` and `@` dropdowns. Previously, in some mode-transition states, arrow keys fell through to the textarea's cursor keybinding and moved the text caret instead of the dropdown selection.
- **Wider two-column layout** — the gap between command name and description in the autocomplete dropdown is now 4 spaces (was 2), matching opencode's airier two-column look.
- **Popup placement helper** — autocomplete popup now uses a dedicated `autocompletePopupPlacement` helper that picks above/below based on terminal height, avoiding cramped renderings on short terminals.

## TUI

- **Keyboard routing fix** (`component/prompt/index.tsx`): keys are now always routed to `autocomplete.onKeyDown` whenever the dropdown is visible, regardless of `store.mode`. The mode-gate still applies for the *initial* triggers (`/`, `@`), which only make sense in normal mode. Optional-chaining (`autocomplete?.`) added on all access sites for defense-in-depth against stale-ref ordering.
- **Spacing**: `padEnd(max + 2)` → `padEnd(max + 4)` in the autocomplete display formatter.
- **Popup placement** (`component/prompt/autocomplete-scroll.ts`): new `autocompletePopupPlacement` helper centralizes above/below selection based on `desiredHeight`, `anchorGlobalY`, `anchorHeight`, and `terminalHeight`. Scroll-delta calculation refactored from `(scrollTop)` to `(viewportY, scrollOffset)` for clearer semantics. Test coverage updated.

## Install

- npm compiled package: `npm install -g @defai.digital/ax-code@4.6.4`
- npm source package: `npm install -g @defai.digital/ax-code-source@4.6.4`
- Homebrew compiled formula: `brew upgrade ax-code` or `brew install defai-digital/ax-code/ax-code`
- Homebrew source formula: `brew upgrade ax-code-source` or `brew install defai-digital/ax-code/ax-code-source`

## Release Artifacts

- macOS: `ax-code-darwin-arm64.zip`
- Linux x64: `ax-code-linux-x64-baseline.tar.gz`
- Linux arm64: `ax-code-linux-arm64.tar.gz`
- Windows x64: `ax-code-windows-x64.zip`
- Windows arm64: `ax-code-windows-arm64.zip`
