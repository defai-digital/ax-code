# AX Code App Architecture

`packages/app` is the first-party web renderer for the AX Code desktop app.

Boundary rules:

- The renderer consumes AX Code through `@ax-code/sdk/headless` and public SDK exports only.
- The renderer must not import from `packages/ax-code/src/**`.
- Canonical runtime state is reconstructed from backend bootstrap data and event replay.
- Local storage may hold drafts and presentation preferences, but not canonical task, permission, queue, automation, or
  worktree execution state.
- Desktop-only capabilities must go through the typed bridge contract in `packages/desktop`; no raw Electron, shell,
  filesystem, process, or IPC APIs are available to renderer code.

The initial implementation is fixture-driven so app layout and projection behavior can be tested without a live backend.
