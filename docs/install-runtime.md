# Installation and Runtime Channels

Status: Active
Scope: current-state
Last reviewed: 2026-05-16
Owner: ax-code runtime

The root [README](../README.md) keeps the shortest install path. This page is the source of truth for the package channels, `ax-code doctor` runtime labels, and local launcher behavior.

## Recommended Path

Use the default compiled package unless you are debugging a source-bundle issue or developing from a checkout.

```bash
# Homebrew (macOS / Linux)
brew install defai-digital/ax-code/ax-code

# npm (any platform)
npm i -g @defai.digital/ax-code
```

Verify the installed runtime:

```bash
ax-code doctor
```

The default package-manager install should report `Runtime: Bun X.Y.Z (compiled)`.

## Channel Matrix

| Channel                      | Install or setup command                                                                        | Expected runtime label | Use when                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------ |
| Compiled package             | `brew install defai-digital/ax-code/ax-code` or `npm i -g @defai.digital/ax-code`               | `compiled`             | Normal user install path                                           |
| Source compatibility package | `brew install defai-digital/ax-code/ax-code-source` or `npm i -g @defai.digital/ax-code-source` | `bun-bundled`          | Diagnosis, fallback, or source-bundle compatibility checks         |
| Local bundled launcher       | `pnpm install && pnpm run setup:cli`                                                            | `compiled`             | Contributor parity with the packaged startup path                  |
| Local source launcher        | `pnpm run setup:cli -- --source`                                                                | `source`               | Contributor-only source debugging                                  |
| Direct checkout run          | `pnpm cli` or `pnpm dev`                                                                        | `source`               | Short-lived development runs without replacing the global launcher |

`compiled`, `bun-bundled`, and `source` are runtime modes, not package-manager names. They describe which executable loads the app code:

- `compiled`: a Bun single-file binary loads the runtime.
- `bun-bundled`: Bun loads the published source bundle.
- `source`: Bun loads files directly from a checkout.

## Updating

For the default compiled channel:

```bash
ax-code upgrade
brew upgrade ax-code
npm update -g @defai.digital/ax-code
```

For the source compatibility channel:

```bash
brew upgrade ax-code-source
npm update -g @defai.digital/ax-code-source
```

## Contributor Launcher Behavior

`pnpm run setup:cli` is intentionally compiled-path by default. It builds or reuses the local bundled binary under `packages/ax-code/dist/...` and installs a global launcher that points at that binary. This keeps local packaged-runtime checks close to what npm and Homebrew users run.

After source changes that should affect the packaged runtime, refresh the bundled binary before testing the global launcher:

```bash
pnpm --dir packages/ax-code run build -- --single
pnpm run setup:cli -- --rebuild
ax-code doctor
```

Use the source launcher only when you intentionally want the global `ax-code` command to execute this checkout through Bun source files:

```bash
pnpm run setup:cli -- --source
ax-code doctor
```

The source launcher should report `Runtime: Bun X.Y.Z (source)`.

## Toolchain Requirements

The repository enforces `pnpm@10.33.4` through the root `packageManager` field and `only-allow pnpm`. Bun must match the root `package.json` engine (`^1.3.14` at this review).

Do not use root `pnpm test`; the root script intentionally exits with `do not run tests from root`. For `packages/ax-code`, run tests from `packages/ax-code/`.
