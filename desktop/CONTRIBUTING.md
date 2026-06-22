# Contributing to AX Code Desktop

## Getting Started

```bash
git clone https://github.com/defai-digital/ax-code.git
cd ax-code
pnpm install
```

This repository pins `pnpm@10.33.4` in the root `package.json` and requires
Node `>=24`; run `corepack enable` to get the pinned pnpm so dependency
resolution matches CI.

On Apple Silicon with newer Node versions, the optional `sharp` dependency can
fall back to a source build and require libvips. If `pnpm install` fails while
linking `vips-cpp`, install the system library and retry:

```bash
brew install vips
pnpm install
```

## Dev Scripts

### Web

| Script                  | Description                                                                    | Ports                           |
| ----------------------- | ------------------------------------------------------------------------------ | ------------------------------- |
| `pnpm run dev:web:full` | Build watcher + Express server. No HMR — manual refresh after changes.         | `3001` (server + static)        |
| `pnpm run dev:web:hmr`  | Vite dev server + Express API. **Open the Vite URL for HMR**, not the backend. | `5180` (Vite HMR), `3902` (API) |

Both are configurable via env vars: `AX_CODE_DESKTOP_PORT`, `AX_CODE_DESKTOP_HMR_UI_PORT`, `AX_CODE_DESKTOP_HMR_API_PORT`.

### Desktop (Electron)

```bash
pnpm run desktop:dev
```

Launches the Electron desktop app in dev mode.

### Shared UI (`packages/ui`)

No dev server — this is a source-level library consumed by other packages. During development, `pnpm run dev` runs type-checking in watch mode.

## Before Submitting

```bash
pnpm run desktop:typecheck  # Must pass
pnpm run desktop:lint       # Must pass
pnpm run desktop:test       # Must pass
pnpm run desktop:build      # Must succeed
```

## Code Style

- Functional React components only
- TypeScript strict mode — no `any` without justification
- Use existing theme colors/typography from `packages/ui/src/lib/theme/` — don't add new ones
- Components must support light and dark themes
- Prefer early returns and `if/else`/`switch` over nested ternaries
- Tailwind v4 for styling; typography via `packages/ui/src/lib/typography.ts`

## Branding and Attribution

- Use AX Code Desktop for public product names, release text, screenshots, and user-facing UI.
- Keep `openchamber` names only where they are required for compatibility with existing data, APIs, package internals, or migration paths.
- Do not remove upstream OpenChamber attribution from [NOTICE](./NOTICE). If a change imports or replaces code from another project, update `NOTICE` in the same pull request.

## Pull Requests

1. Fork and create a branch
2. Make changes
3. Run the validation commands above
4. Submit PR with clear description of what and why

## Project Structure

```
desktop/packages/
  ui/        Shared React components, hooks, stores, and theme system
  web/       Web server (Express) + frontend (Vite) + CLI
  electron/  Electron app shell and native packaging
```

See [AGENTS.md](./AGENTS.md) for detailed architecture reference.

## Not a developer?

You can still help:

- Report bugs or UX issues — even "this felt confusing" is valuable feedback
- Test on different devices, browsers, or OS versions
- Suggest features or improvements via issues
- Help others in Discord

## Questions?

Open an [issue](https://github.com/defai-digital/ax-code/issues) or visit [defai.digital](https://defai.digital).
