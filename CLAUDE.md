# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is ax-code

ax-code is a provider-agnostic, LSP-first AI coding CLI built as a monorepo. It originated as a fork of OpenCode with features ported from ax-cli. It supports multiple LLM providers (Google Gemini, xAI/Grok, Groq, OpenAI-compatible, Z.AI), 9 specialized agents, 25+ built-in tools, and ships as a CLI, web app, and Tauri desktop app.

## Build & Development Commands

All package-level commands must run from the **package directory** (e.g., `packages/ax-code`), never the repo root. The root `bunfig.toml` blocks `bun test` at repo root.

```bash
# ── Setup ──
bun install                           # install all dependencies
bun run setup:cli                     # install global ax-code command

# ── Development (from repo root) ──
bun dev                               # start TUI in dev mode (targets packages/ax-code)
bun dev <directory>                   # start TUI against a specific directory
bun dev .                             # start TUI against repo root
bun dev serve --port 4096             # start headless API server
bun run --cwd packages/app dev        # web app dev server (needs server running)
bun run --cwd packages/desktop tauri dev  # desktop app (requires Rust toolchain)

# ── From packages/ax-code ──
bun test                              # run all tests (30s timeout)
bun test test/tool/bash.test.ts       # run a single test file
bun test --test-name-pattern "basic"  # run tests by name pattern
bun typecheck                         # typecheck (uses tsgo, not tsc)
bun run build                         # production build
bun run db generate --name <slug>     # generate Drizzle migration

# ── Monorepo-wide ──
bun turbo typecheck                   # typecheck all packages

# ── Build standalone executable ──
./packages/ax-code/script/build.ts --single
# output: packages/ax-code/dist/ax-code-<platform>/bin/ax-code

# ── Regenerate JS SDK after API/server changes ──
./packages/sdk/js/script/build.ts
```

## Monorepo Structure

| Package | Purpose |
|---------|---------|
| `packages/ax-code` | Core CLI/backend — agents, tools, providers, sessions, server |
| `packages/app` | Shared web UI (SolidJS) |
| `packages/desktop` | Tauri desktop wrapper around `packages/app` |
| `packages/sdk/js` | JavaScript SDK for programmatic use |
| `packages/plugin` | Plugin system (`@ax-code-ai/plugin`) |
| `packages/ui` | UI component library (SolidJS) |
| `packages/util` | Shared utilities |
| `packages/script` | Build and release scripts |

## Core Architecture (packages/ax-code)

**Runtime:** Bun. **Language:** TypeScript. **Key frameworks:** Effect (functional effects), Vercel AI SDK, Hono (HTTP), Drizzle (SQLite ORM), SolidJS + opentui (TUI).

Entry point: `src/index.ts` (yargs CLI). Key subsystems:

- **`src/agent/`** — 9 agents (build, security, architect, debug, perf, plan, react, general, explore) with auto-routing via `agent/router.ts`
- **`src/provider/`** — LLM provider abstraction with auth (AES-256-GCM key encryption)
- **`src/tool/`** — 25+ built-in tools (bash, read, edit, glob, grep, lsp, batch, etc.) with `.txt` doc files
- **`src/session/`** — Session persistence in SQLite
- **`src/storage/`** — Database schema, migrations, Drizzle setup. Conditional imports: `#db` resolves to `db.bun.ts` or `db.node.ts`
- **`src/server/`** — Hono HTTP server (default port 4096)
- **`src/cli/cmd/tui/`** — Terminal UI (SolidJS + opentui)
- **`src/mcp/`** — Model Context Protocol integration
- **`src/lsp/`** — Language Server Protocol
- **`src/config/`** — Configuration system (`ax-code.json`)
- **`src/context/`** — AX.md context generation
- **`src/effect/`** — Effect runtime, `InstanceState` for per-directory scoping

## Code Style (Mandatory)

- **No semicolons.** Print width 120. Indent 2 spaces.
- **Single-word identifiers** for locals, params, helpers. Multi-word only when single word is ambiguous. Good: `pid`, `cfg`, `err`, `opts`. Bad: `inputPID`, `existingClient`.
- **Inline single-use values** — don't create variables for one-time expressions.
- **No unnecessary destructuring** — use `obj.a` instead of `const { a } = obj`.
- **`const` over `let`.** Use ternaries or early returns instead of reassignment.
- **Avoid `else`** — use early returns.
- **Avoid `try`/`catch`** — prefer `.catch()`.
- **Avoid `any`** — use precise types, rely on type inference.
- **Functional array methods** (`flatMap`, `filter`, `map`) over `for` loops.
- **Bun APIs** when possible (e.g., `Bun.file()`).
- **Namespace modules:** `export namespace Foo { ... }` is used extensively.
- **Imports:** external packages first, then local. Workspace imports by name: `@ax-code/util/error`. Path aliases: `@/*` → `./src/*`, `@tui/*` → `./src/cli/cmd/tui/*`.

## Database Conventions (Drizzle + SQLite)

- Schema files: `src/**/*.sql.ts`
- `snake_case` for tables and columns. Join columns: `<entity>_id`. Indexes: `<table>_<column>_idx`.
- Use `Timestamps` helper from `src/storage/schema.sql.ts` for `time_created`/`time_updated`.
- Generate migrations: `bun run db generate --name <slug>`

## Effect Patterns

- Compose with `Effect.gen(function* () { ... })`
- Named effects: `Effect.fn("Domain.method")`
- Prefer Effect services (`FileSystem`, `HttpClient`, `Path`, etc.) over raw platform APIs
- Per-directory state: `InstanceState` from `src/effect/instance-state.ts`
- Native addon callbacks: use `Instance.bind(fn)` for ALS context

## Testing

- **Framework:** `bun:test` (`describe`, `test`, `expect`). No mocks — test actual implementations.
- **Isolation:** `test/preload.ts` sets up isolated XDG dirs and clears provider env vars. Use `tmpdir()` from `test/fixture/fixture.ts` for temp directories (`{ git: true }` to init a git repo).
- **Run from package dir only** — never from repo root.

## PR Conventions

- Conventional commit titles: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:` with optional scope `feat(app):`
- All PRs must reference an existing issue (`Fixes #123`)
- If API/server changes are made in `packages/ax-code/src/server/`, regenerate SDK with `./script/generate.ts`

## Package-Specific Notes

- **packages/app:** Never restart app/server processes during dev. Run backend and app separately. Prefer `createStore` over multiple `createSignal`.
- **packages/desktop:** Never call Tauri `invoke` manually — use generated bindings in `src/bindings.ts`. Requires Rust toolchain + Tauri prerequisites.
- **Type checking:** Always use `bun typecheck`, never `tsc` or `tsgo` directly.
