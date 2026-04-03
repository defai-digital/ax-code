# AGENTS.md — AX Code monorepo

## Repository Overview

- **Monorepo** managed with pnpm workspaces + Turborepo.
- **Packages**: `packages/ax-code` (CLI/backend), `packages/app` (web UI, SolidJS), `packages/desktop` (Tauri), `packages/sdk/js`, `packages/plugin`, `packages/util`, `packages/ui`, `packages/script`.
- **Runtime**: Bun. Package manager: pnpm (lockfile: `pnpm-lock.yaml`).
- **Default branch**: `dev`. Local `main` may not exist; use `dev` or `origin/dev` for diffs.
- **Language**: TypeScript with `@tsconfig/bun`. JSX via `@opentui/solid` in ax-code.
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- Prefer automation: execute requested actions without confirmation unless blocked by missing info or safety/irreversibility.

## Build / Lint / Test Commands

All commands run from the **package directory**, never the repo root. The root `bunfig.toml` blocks `bun test` from repo root (`do-not-run-tests-from-root`).

```bash
# ── packages/ax-code (main CLI package) ──
bun test                          # run all tests (30s timeout)
bun test test/tool/bash.test.ts   # run a single test file
bun test --test-name-pattern "basic"  # run tests matching a name pattern
bun typecheck                     # typecheck (uses tsgo, not tsc)
bun run build                     # production build
bun run db generate --name <slug> # generate a Drizzle migration

# ── monorepo-wide ──
pnpm typecheck                    # typecheck all packages
```

### SDK regeneration

```bash
./packages/sdk/js/script/build.ts
```

## Style Guide

### General Principles

- Keep things in one function unless composable or reusable.
- Avoid `try`/`catch` where possible.
- Avoid using the `any` type.
- Prefer single word variable names where possible.
- Use Bun APIs when possible, like `Bun.file()`.
- Rely on type inference; avoid explicit type annotations or interfaces unless necessary for exports or clarity.
- Prefer functional array methods (`flatMap`, `filter`, `map`) over for loops; use type guards on `filter` to maintain type inference downstream.
- No semicolons. Print width 120 (see `package.json` prettier config). Indent: 2 spaces (see `.editorconfig`).

### Imports

- External packages first, then local imports using relative paths.
- Workspace packages imported by name: `@ax-code/util/error`, `@ax-code/plugin`.
- Conditional imports use `package.json` `imports` field (e.g., `#db` resolves to `db.bun.ts` or `db.node.ts`).
- Path aliases in `packages/ax-code/tsconfig.json`: `@/*` → `./src/*`, `@tui/*` → `./src/cli/cmd/tui/*`.

### Naming Enforcement (Mandatory for Agent-Written Code)

- Use **single word** names by default for locals, params, and helper functions.
- Multi-word names allowed only when a single word would be unclear or ambiguous.
- Do not introduce new camelCase compounds when a short single-word alternative is clear.
- Before finishing edits, review touched lines and shorten newly introduced identifiers.
- Good: `pid`, `cfg`, `err`, `opts`, `dir`, `root`, `child`, `state`, `timeout`.
- Bad: `inputPID`, `existingClient`, `connectTimeout`, `workerPath`.

```ts
// Good
const foo = 1
function journal(dir: string) {}

// Bad
const fooBar = 1
function prepareJournal(dir: string) {}
```

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

### Control Flow

Avoid `else` statements. Prefer early returns.

### Code Organization

- The `packages/ax-code/src` directory uses namespace modules (`export namespace Foo { ... }`) extensively.
- Each domain lives in its own folder with co-located SQL schema (`*.sql.ts`), types, and logic.
- Shared utilities live in `src/util/`.

## Database (Drizzle)

- **Schema**: `src/**/*.sql.ts` — uses Drizzle ORM with SQLite dialect.
- **Naming**: tables and columns use `snake_case`; join columns are `<entity>_id`; indexes are `<table>_<column>_idx`.
- **Migrations**: `bun run db generate --name <slug>` creates `migration/<timestamp>_<slug>/migration.sql`.
- **Timestamps**: use the shared `Timestamps` helper from `src/storage/schema.sql.ts` (`time_created`, `time_updated`).
- Use `snake_case` field names so column names don't need redefining as strings.

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})
```

## Effect (packages/ax-code)

See `packages/ax-code/specs/effect-migration.md` for the full pattern reference.

- Use `Effect.gen(function* () { ... })` for composition.
- Use `Effect.fn("Domain.method")` for named/traced effects.
- Use `Schema.Class` for multi-field data, `Schema.brand` for single-value types, `Schema.TaggedErrorClass` for typed errors.
- Prefer Effect services over raw platform APIs: `FileSystem`, `ChildProcessSpawner`, `HttpClient`, `Path`, `Config`, `Clock`, `DateTime`.
- **Instance-scoped services** (per-directory state) use `InstanceState` from `src/effect/instance-state.ts`. Global services use the shared runtime.
- Use `Instance.bind(fn)` for native addon callbacks that need ALS context (e.g., `@parcel/watcher`, `node-pty`).

## Testing

- Avoid mocks; test actual implementation. Do not duplicate logic into tests.
- Run from package directories only (e.g., `packages/ax-code`).
- Use the `tmpdir` fixture from `test/fixture/fixture.ts` for isolated test directories:
  ```ts
  import { tmpdir } from "../fixture/fixture"
  test("example", async () => {
    await using tmp = await tmpdir({ git: true })
  })
  ```
- Tests use `bun:test` (`describe`, `test`, `expect`).
- `test/preload.ts` sets up isolated XDG directories and clears provider env vars before any src imports.

## Type Checking

- Run `bun typecheck` from package directories. Never run `tsc` or `tsgo` directly.
- `packages/ax-code` uses `tsgo` (TypeScript native preview) via `bun typecheck`.
- `noUncheckedIndexedAccess` is disabled in the ax-code tsconfig.

## Package-Specific Notes

- **packages/app**: Never restart app/server processes. For local UI: run backend (`bun run serve --port 4096`) and app (`bun dev -- --port 4444`) separately. Prefer `createStore` over multiple `createSignal`.
- **packages/desktop**: Never call Tauri `invoke` manually; use generated bindings in `packages/desktop/src/bindings.ts`.
