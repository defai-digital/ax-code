# TUI Rework Plan

The TUI should evolve incrementally rather than through a full rewrite. The current surface under
`packages/ax-code/src/cli/cmd/tui` is large enough that a greenfield replacement would risk regressions in keyboard
handling, prompt editing, scrolling, dialogs, diff rendering, session routes, theming, and terminal compatibility.

## Current Position

- `packages/ax-code/src/cli/cmd/tui` contains the product TUI and still uses `@opentui/core` and `@opentui/solid`
  directly.
- OpenTUI is a TUI framework dependency, not an OpenCode coupling by itself.
- OpenCode naming should be treated as legacy only when it is not a real provider ID, compatibility key, historical
  fixture, or migration document.

## Near-Term Work

- Keep OpenTUI as the active renderer.
- Route runtime OpenTUI preload behavior through local AX Code files instead of direct `bunfig.toml` package paths.
- Centralize TUI transport constants, worker fetch, and event source setup before changing UI behavior.
- Keep AX Code and legacy OpenCode transport headers/env names centralized so compatibility is explicit.
- Remove low-risk OpenCode-branded fake origins and internal-only names, but keep real provider IDs, themes, fixtures, and
  historical migration docs intact.
- Add tests when touching keyboard, focus, selection, prompt editing, session message rendering, or transport behavior.

## Near-Term Regression Checklist

Run this checklist when changing OpenTUI versions or TUI transport behavior:

- `pnpm --dir packages/ax-code run typecheck`
- `pnpm --dir packages/ax-code exec bun test test/cli/tui/thread.test.ts test/cli/tui/transport.test.ts`
- `bun run --cwd packages/ax-code --conditions=browser src/index.ts --version`
- Manual TUI pass: prompt input, Tab/Shift-Tab, dialog focus, transcript scroll, mouse selection, and terminal state after
  exit.

## Medium-Term Work

- Introduce a renderer adapter boundary for high-churn surfaces: prompt, dialogs, scroll containers, transcript items,
  and diff/code display.
- Move session UI state into renderer-independent view models where practical.
- Keep OpenTUI-specific imports in leaf components or adapter modules, not shared session or transport logic.
- Track hotspot files above 500 lines and split only when extracted units gain direct or adjacent integration coverage.

## Quality Review Criteria

Before considering a fork or replacement, measure:

- startup time and first-render latency
- input latency during large transcript updates
- scroll correctness with long, wrapped, and CJK text
- terminal compatibility across macOS, Linux, tmux, and common CI terminals
- stability of OpenTUI public APIs used by AX Code
- install/build complexity from Bun, native binaries, and tree-sitter assets

## Long-Term Decision Gate

Build an internal TUI kit, fork OpenTUI, or switch renderers only if the adapter work proves that OpenTUI blocks product
requirements or quality targets. Until then, the preferred path is containment, measurement, and gradual extraction.
