# Project Boundaries

This repository works best when the desktop app stays a thin integration layer
around the AX Code runtime instead of becoming a second runtime implementation.
Use this map when adding features, moving code, or deciding where a bug should
be fixed.

## Ownership map

| Area                                           | Owns                                                                                                                                            | Should not own                                                               |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `packages/electron`                            | Window lifecycle, auto-update, packaged resources, utility-process startup, desktop security policy                                             | AX Code runtime behavior, provider logic, search logic, project indexing     |
| `packages/web/server`                          | Local desktop control plane: loopback HTTP server, auth bridge, static app hosting, local file/git/terminal adapters, AX Code process lifecycle | UI presentation, SDK-private internals, duplicated AX Code runtime semantics |
| `packages/web/src`                             | Browser entrypoints and web runtime adapters that install `RuntimeAPIs` for the UI                                                              | Deep UI internals, desktop shell behavior                                    |
| `packages/ui`                                  | Presentation, state, typed UI API contracts, SDK-facing client facade                                                                           | Local process lifecycle, Electron APIs, Tauri APIs, server-only dependencies |
| workspace `@ax-code/sdk` / installed `ax-code` | Sessions, models/providers, skills/plugins, search/indexing, runtime API contracts                                                              | Desktop windowing or packaging                                               |

## Import rules

- `packages/web` may import `@openchamber/ui` only through documented UI
  entrypoints: app entrypoints, styles, `terminalApi`, and `api/*` contracts.
- `packages/web` and `packages/electron` must not import sibling package source
  paths such as `../ui/src` or `../desktop/src`.
- Runtime access should prefer public SDK entrypoints such as `@ax-code/sdk/v2`
  and the server-side AX Code lifecycle adapter. Do not import SDK `dist/`
  internals.

The authoritative checker for these rules runs from the monorepo root with
`pnpm run check:desktop-boundaries` and fails on violations. The historical
`desktop/scripts/check-boundary-imports.mjs` entrypoint delegates to that same
checker, so local and CI policy cannot drift. When a new cross-package
entrypoint is genuinely needed, add it to the checker with a short reason in
the change description.

## Stability guidance

- Keep Electron work focused on startup, packaging, update, window, and security
  concerns. Server CPU and IO should stay out of the main process.
- Keep AX Code feature behavior behind SDK/API contracts. If desktop code needs
  to mirror SDK internals, track it as temporary compatibility debt.
- Prefer explicit degraded states over silent mock data or empty fallbacks for
  backend failures.
- Add verification before moving ownership. A refactor that only moves code but
  weakens tests or runtime contracts is not a boundary improvement.

## Performance guidance

- Preserve the utility-process server boundary; it protects the main Electron
  event loop from server work.
- Treat bundle size as a UI loading concern first. Lazy-load heavy UI surfaces
  before moving runtime ownership across packages.
- Measure `ax-code` pipeline overhead before changing transport layers. The
  current SDK headless bridge is the supported integration path until upstream
  ships a materially different runtime transport.
