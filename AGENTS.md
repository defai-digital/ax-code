# AGENTS.md

This file provides guidance to Qoder (qoder.com) when working with code in this repository.

## Collaboration Defaults

- Keep files written to disk in English unless a task explicitly requires another language.
- Prefer evidence from the current repository over pasted diagnoses or assumptions.
- In dirty worktrees, never revert unrelated local changes. Work around them or call them out if they block the task.
- Keep commits and staged changes tightly scoped. Internal planning files under `ax-internal/` are gitignored by default; force-add only when the user explicitly wants them committed.

## Toolchain

- Package manager: pnpm `10.33.4` (`preinstall` enforces `only-allow pnpm`).
- Runtime: Node.js `>=24` (`>=26` for the TUI / `--experimental-ffi`). Bun has been removed; scripts run via `tsx`.
- Rust toolchain: stable channel from `rust-toolchain.toml`, edition 2024, used for napi-rs crates under `crates/`.
- Type checker: `tsgo` (TypeScript native preview) for `--noEmit` checks.
- Formatting: Prettier with `semi: false` and `printWidth: 120`; run `tsx script/format.ts` when formatting is needed.
- SQL migrations: Drizzle Kit; migrations live under `packages/ax-code/migration/<timestamp>_<name>/migration.sql`.
- Catalog dependencies: shared dependency versions are declared in `pnpm-workspace.yaml` under `catalog:` and referenced with `catalog:` in package `package.json` files.

## Common Commands

Run these from the repository root unless noted:

- `pnpm install` - install workspace dependencies.
- `pnpm dev` / `pnpm cli` - run the CLI from source on Node (`node --experimental-ffi --env-file-if-exists=../../.env --import tsx --import script/solid-loader.mjs --conditions=node packages/ax-code/src/index-node-tui.ts`).
- `pnpm typecheck` - run typecheck across workspace packages that define it.
- `pnpm run build:native` - build all Rust napi-rs addons (append names like `fs diff` for a subset).
- `pnpm run build:native:debug` - build native addons in debug mode.
- `pnpm run check:structure` - enforce repository structure guardrails.
- `pnpm run setup:cli` - install the local `ax-code` launcher for this checkout. Use `pnpm run setup:cli -- --source` for a checkout-bound source launcher.
- `ax-code doctor` - diagnose install, runtime, storage, and auth issues. Useful when debugging setup or environment problems.

Desktop development (from repo root):

- `pnpm run desktop:dev` — launch the Electron app in dev mode (via Turbo, depends on SDK build).
- `pnpm run desktop:build` — build the Electron app for production.
- `pnpm run desktop:typecheck` — typecheck all desktop packages (builds SDK first).
- `pnpm run desktop:lint` — lint desktop packages.
- `pnpm run desktop:test` — run desktop tests (builds SDK first).
- `pnpm run check:desktop-boundaries` — check desktop package import boundaries (append `:strict` to fail on violation).
- Desktop web dev servers: `cd desktop && pnpm run dev:web:hmr` (Vite HMR on port 5180 + Express API on port 3902) or `pnpm run dev:web:full` (Express-only on port 3001, no HMR).

Do not run tests from the repository root:

- Root `pnpm test` intentionally fails with `do not run tests from root`.
- For `packages/ax-code`, run tests from `packages/ax-code/`.

Root-level script tests:

- `pnpm test:scripts` — run root `script/*.test.ts` suites (setup-cli, release signing, publish) via vitest.

Inside `packages/ax-code`:

- `pnpm test` - full test suite on vitest (`vitest run`; the 30s per-test timeout lives in `vitest.config.ts`).
- `pnpm test:unit` - unit group (excludes e2e, recovery, live).
- `pnpm test:recovery` - recovery group (session resume, diff recovery, message recovery, auth, isolation).
- `pnpm test:e2e` - e2e group (smoke tests, workspace sync, bash tool, LSP client, OAuth, server endpoints).
- `pnpm test:deterministic` - deterministic group (excludes e2e and live).
- `pnpm test:live` - live group (structured output integration tests).

Test groups are defined in `script/test-group.ts`. The `unit` group is the fastest and most isolated; `e2e` tests spawn real processes and may be flaky on CI; `recovery` tests cover session resume and error recovery paths. Grouped runners (`tsx script/test-groups.ts <group>`) resolve the file list and pass it to vitest via the `AX_TEST_FILES` environment variable.

- `pnpm test:ci` - CI-oriented test runner.
- `pnpm test:risk` - risk-oriented test runner.
- `vitest run test/path/to/file.test.ts` - single test file.
- `pnpm typecheck` - package typecheck (`tsgo --noEmit`).
- `pnpm build` - package build (node-bundled TUI via `build-node-tui.ts`).
- `pnpm db` - Drizzle Kit for schema migrations.
- `pnpm run check:tui-layering` - TUI renderer-adapter layering guard.
- `pnpm run check:tui-snapshot` - TUI snapshot consistency check.
- `pnpm run check:skills` - validate discovered Agent Skills.
- `pnpm run check:skills:all` - validate all skill definitions.
- `pnpm run perf:index` - indexing/LSP perf harness.
- `pnpm run perf:report` - perf report generation.
- `pnpm run quality:rollout` - quality rollout runner.
- `pnpm run tui:startup-smoke` - TUI startup smoke test.

Rust validation for the Cargo workspace should run from `crates/`, not the repository root:

- `cargo test` — run all Rust tests across workspace crates.
- `cargo test -p ax-code-tui` — run tests for a single crate (substitute any crate name).
- `cargo clippy --all-targets -p ax-code-tui -- -D warnings` — lint a single crate with warnings-as-errors (CI enforces this).
- `cargo clippy --all-targets --workspace -- -D warnings` — lint the entire workspace.
- `cargo build` — build all crates.
- `cargo fmt --check` — verify Rust formatting (gofmt-style check; `cargo fmt` to auto-fix).

### Rebuilding After Source Changes

After code changes, rebuild the bundled runtime and refresh the launcher:

```bash
pnpm --dir packages/ax-code run build -- --single
pnpm run setup:cli -- --rebuild
ax-code doctor
```

The default `setup:cli` installs a node-bundled launcher (`Runtime: Node vX.Y.Z (node-bundled)`). The `--source` flag installs a checkout-bound source launcher (`Runtime: Node vX.Y.Z (source)`) for debugging only.

## Pre-commit Hook

The `.husky/pre-commit` hook:

1. Scans staged diffs for common API-key/token patterns (Anthropic, OpenAI, Google, AWS, GCP, generic private keys). If detected, the commit is blocked. Use `--no-verify` only after confirming a false positive.
2. Regenerates `packages/ax-code/src/provider/models-snapshot.json` via `script/update-models.ts` and auto-stages it if changed.

Do not bypass the hook casually — secret leaks and stale model snapshots are real CI blockers.

## Repository Layout

This is a pnpm workspace monorepo plus a Cargo workspace:

- `packages/ax-code` - main product: CLI, TUI, server, session engine, tool orchestration, storage, providers, and runtime logic.
- `packages/sdk/js` - programmatic and HTTP SDK (`@ax-code/sdk`).
- `packages/integration-vscode` and `packages/integration-github` - integration surfaces.
- `packages/util`, `packages/plugin`, `packages/script` - shared helpers and tooling.
- `packages/ax-code-{fs,diff,parser,terminal}-native` and `packages/ax-code-index-core` - JS shims for native Rust addons.
- `crates/` - Rust native addon implementations.
- `docs/` - product-facing documentation only.
- `ax-internal/{adr,prd,release,bugs,archive,architecture}` - internal planning workspace for ADRs, PRDs, release notes, bug reports, and strategy notes. Gitignored by default.
- `script/` - repository automation.

Keep development-stage planning out of `docs/`; use `ax-internal/` for internal PRDs, ADRs, bug reports, and temporary reports.

## Rust Workspace (`crates/`)

The Cargo workspace (`crates/Cargo.toml`, edition 2024, `rust-version = "1.85"`) contains native addons and the standalone TUI binary:

| Crate | Type | Purpose |
| --- | --- | --- |
| `ax-code-index` | napi-rs addon | SQLite graph and interval tree for code intelligence. |
| `ax-code-fs` | napi-rs addon | File walker, glob, grep, and watcher (uses `ignore`, `grep-searcher`, `notify`). |
| `ax-code-diff` | napi-rs addon | Diff engine with edit replacer and fuzzy matching (`similar`, `strsim`). |
| `ax-code-parser` | napi-rs addon | Tree-sitter symbol extraction across languages. |
| `ax-code-daemon` | napi-rs addon | Unix daemon process management for background indexing. |
| `ax-code-terminal` | napi-rs addon | PTY terminal emulation. |
| `ax-code-tui` | **binary + lib** | Standalone Ratatui TUI client (ADR-035). Not a napi-rs addon. |
| `ax-code-bench` | bench | Performance benchmarking suite. |

The napi-rs addon crates expose Rust to TypeScript via `#[napi_derive]` macros. Each has a corresponding JS shim package under `packages/ax-code-*-native` that uses `createRequire(import.meta.url)` with try/catch fallback to a pure-JS path.

### `ax-code-tui` Architecture (ADR-035)

A session-first terminal UI that connects to a headless ax-code server via HTTP/SSE. It does NOT own session execution, storage, or provider logic — those remain in the headless runtime. The TUI is a thin client.

**Module layout** under `crates/ax-code-tui/src/`:

| Module | Purpose |
| --- | --- |
| `main.rs` | Binary entry point. Installs a panic hook that restores the terminal before printing the panic message (raw-mode recovery). |
| `runner.rs` | Main event loop: resolves launch route → subscribes SSE → creates/attaches session → runs render/poll loop → dispatches `InputAction` to the headless client. |
| `client.rs` | `HeadlessClient` — HTTP methods (`create_session`, `send_prompt`, `reply_permission`, `reply_question`, `reject_question`, `abort_session`) and SSE subscription with cross-chunk buffer parsing. |
| `events.rs` | `RuntimeEvent` enum — typed SSE events with serde tagged deserialization. Handles payload envelope unwrapping (`payload`, `details` keys). |
| `launch_policy.rs` | `LaunchRoute` resolution: explicit session → explicit prompt → recent session → new session. Never returns a dashboard/home route. |
| `diagnostics.rs` | Structured diagnostic events for observability (logged via `tracing`). |
| `tui/app.rs` | `App` state: messages, tool calls, pending permission/question FIFO queues, multi-question answer collection, cursor management with UTF-8 char-indexed positioning. |
| `tui/render.rs` | Ratatui rendering: header, transcript, prompt input, status bar, permission/question modals, session list sidebar, tool results panel. |
| `tui/input.rs` | Keyboard/mouse handling per `AppMode` (Input, Permission, Question). Number keys 1-9 for direct question option selection. |

**Key patterns in `ax-code-tui`**:

- **FIFO queues**: Permission and question requests are queued front-to-back; the front of the queue is the active modal. Out-of-band `*Replied`/`*Rejected` SSE events clear stale entries by `request_id`.
- **SSE cross-chunk buffering**: `drain_complete_sse_lines()` keeps a carry-over buffer because TCP chunk boundaries are NOT aligned to SSE line boundaries. Handles CRLF, `data:` with/without space, and envelope unwrapping.
- **Multi-question support**: A single `question.asked` event can contain multiple sub-questions. `QuestionAnswerProgress` collects answers across sub-questions before sending the reply.
- **UTF-8 safe cursor**: `cursor_position` is a char index (not byte index). `byte_index_at_char()` converts for `String::insert`/`String::remove` which require byte indices on code-point boundaries.

## Desktop (`desktop/`)

The Desktop app is an Electron + React workspace under `desktop/packages/`:

| Package | Purpose |
| --- | --- |
| `packages/ui` | Shared React component library, hooks, stores, and theme system (source-level, no dev server). |
| `packages/web` | Express API server + Vite frontend + CLI. Primary web development target. |
| `packages/electron` | Electron app shell and native packaging. Depends on `ui` and `web`. |

Turbo orchestrates the build graph: `@ax-code/sdk` → `ax-code-desktop` (ui+web) → `@ax-code/electron`. The SDK must be built before the desktop packages.

**Desktop code style**: functional React components only, TypeScript strict mode (no `any` without justification), Tailwind v4 for styling, theme colors/typography from `packages/ui/src/lib/theme/` (do not add new ones), components must support light and dark themes.

**Branding**: use "AX Code Desktop" for public product names and user-facing UI. Keep `openchamber` names only where required for compatibility with existing data, APIs, or package internals.

**Boundary checks**: `script/check-desktop-boundaries.ts` enforces import restrictions between desktop packages. Run `pnpm run check:desktop-boundaries:strict` before submitting desktop changes.

## `packages/ax-code` Architecture

**Entry point**: `src/index.ts` loads the OpenTUI SolidJS preload, then calls `cli/boot.ts` which sets up yargs, registers all commands (from `src/cli/cmd/`), and runs middleware (env init → DB migration → command dispatch). For the Node+TUI development path, `src/index-node-tui.ts` is the entry used by `pnpm dev` (it pre-imports the SolidJS loader and TUI conditions). A separate `src/index-compiled.ts` is used for standalone binary builds to avoid bundling Babel transforms.

**Domain-first layout** under `src/` — each top-level folder is a domain:

| Domain | Purpose |
| --- | --- |
| `session` | **Largest domain (~80+ files)**. Prompt loop, agent step, completion gates, compaction, cycle detection, risk/review, rollback, DRE graph, todo convergence, retry, semantic diff. Treat as a primary hotspot. |
| `tool` | ~50+ tools, each with a `.ts` implementation and a `.txt` prompt template (e.g., `bash.ts` + `bash.txt`). Registry in `tool/registry.ts`. |
| `provider` | Model routing, provider auth, prompt cache, model snapshot, agent optimization profiles. Bundled providers use Vercel AI SDK (`@ai-sdk/google`, `@ai-sdk/openai`, `@ai-sdk/xai`). |
| `control-plane` | Agent execution controller, autonomous completion gate, safety policy, workspace routing, SSE events. Orchestrates session lifecycle and agent step execution. |
| `quality` | Probabilistic rollout, promotion pipeline (review → approval → release), DRE graph rendering, finding registry, shadow runtime, stability guard. |
| `debug-engine` | Incremental bug analysis, race/security/hardcode/lifecycle detection, safe refactor planning, pattern memory, shadow worktree. |
| `lsp` | LSP client management, server lifecycle, diagnostics, caching, envelope runner, oxc/oxlint integration. |
| `mcp` | MCP discovery, auth, OAuth provider, permission patterns, tool conversion. |
| `workflow` | Routine, scheduler, eval, budget, task queue, dispatch adapter, template, projection. |
| `worktree` | Git worktree management for isolation. |
| `memory` | Context memory management. |
| `skill` | Agent Skill validation and dispatch. |
| `replay` | Session replay engine. |
| `permission` | Permission rulesets and enforcement for tool execution and file access. |
| `config` | Configuration loading/merging from `ax-code.json`, global config, wellknown remote configs, and env vars. |
| `project` | Project identity, workspace instance scoping, and project-level state. |
| `agent` | Agent definitions (tiers: `core`, `specialist`, `internal`, `subagent`), prompt templates, and agent routing. |
| `code-intelligence` | Semantic indexing, code graph, symbol extraction (tree-sitter), native store bindings, auto-index scheduling. |
| `runtime` | Runtime lifecycle, service manager, task queue execution, detached process management. |

**Interface layers** (keep thin, delegate into domains):

- `src/cli/cmd/` — yargs commands; root files should be thin shims that delegate into domain folders.
- `src/server/` — Hono HTTP routes (`ax-code serve`).
- `src/cli/cmd/tui/` — OpenTUI/SolidJS TUI (app, renderer, components, routes).

**Storage**:

- SQLite via Drizzle ORM. Import map: `#db` resolves to `src/storage/db.node.ts` under Node (uses `node:sqlite` `DatabaseSync`). The legacy `bun` condition and `db.bun.ts` have been removed.
- Domain `.sql.ts` files define Drizzle table schemas (e.g., `session/session.sql.ts`, `workflow/workflow.sql.ts`).
- `src/storage/schema.ts` aggregates all domain `.sql.ts` exports.
- Migrations under `packages/ax-code/migration/` are loaded by `script/build.ts` during the build process.

### Cross-Cutting Patterns

**Bus event system** (`src/bus/`): Typed pub/sub for domain events. Events are defined with `BusEvent.define("event.name", zodSchema)` and published via `Bus.publish()`. The `Bus` is used for session lifecycle events, provider updates, message deltas, and SSE propagation to the TUI and server clients. Prefer `Bus.publishDetached()` for fire-and-forget emission from async contexts.

**Instance scoping** (`src/project/instance.ts`): `Instance` provides per-workspace scoped state via an async context pattern. `Instance.state()` creates lazily-initialized, workspace-scoped singletons. `Instance.current` gives access to the active project's `directory`, `worktree`, and `project` metadata. Most domain state is scoped to an Instance rather than being global.

**Feature flags** (`src/flag/flag.ts`): Environment-variable-driven feature flags exposed as `Flag.AX_CODE_*` getters. Boolean flags use `truthy()`/`falsy()` helpers that parse env vars at access time (not module load). Feature flags gate tool availability (e.g., `AX_CODE_EXPERIMENTAL_LSP_TOOL`, `AX_CODE_EXPERIMENTAL_DEBUG_ENGINE`), provider behavior, and UI features.

**Prompt template pairs**: Tools and agents both use `.ts` + `.txt` pairs. The `.ts` file imports the `.txt` file as a string (text import) and interpolates it at runtime. Agent prompt templates live under `src/agent/prompt/` and session prompt assembly under `src/session/prompt/`.

**Native addon fallback**: `createRequire(import.meta.url)` with try/catch — JS path always works. Preserve this pattern when adding new native-accelerated paths.

**Plugin system** (`src/plugin/`): Plugins can register custom tools, hooks, and event handlers. Custom tools from `{tool,tools}/*.{js,ts}` in config directories are auto-discovered and registered in `tool/registry.ts`.

**Configuration** (`src/config/config.ts`): Hierarchical config merging from defaults → global config → project `ax-code.json` → env vars → wellknown remote configs. The `Config` namespace exposes the merged result. The root `ax-code.json` is the project-level config; `~/.config/ax-code/` holds global config. Key `ax-code.json` fields include `provider` (provider routing), `autonomous` (boolean), `isolation` (mode/network/protected), `mcp` (server definitions), `permission` (tool rules), `routing` (LLM routing), `model`, and `skills`.

**Hotspot guardrails**:

- Treat `packages/ax-code/src/cli` and `src/session` with extra care.
- Prefer files under 300 lines, review carefully at 500+ lines, and split at 800+ lines unless there is a strong reason.
- Avoid adding unrelated logic to interface-heavy folders when it belongs in a domain folder.
- Enforced in CI via `.github/workflows/repo-structure.yml` and `pnpm run check:structure`.

**Improvement skill guidance**: when running the `improve-overall` skill in this repo, follow `ax-internal/arch/improve-overall-guidance.md` (scope to the maintainability surface, tier actions by risk, treat `ax-internal` as bidirectional, prioritize by ADR alignment). The builtin skill's "follow local guidance" clause makes that doc authoritative here.

## CI Repo Guards

Beyond import guards, the `repo-structure.yml` CI workflow runs three additional repo-wide checks:

1. **`pnpm run check:structure`** — enforces file-size limits, domain-folder boundaries, and interface-layer thinness (`script/structure.ts`).
2. **`pnpm run check:no-cost`** — blocks reintroduction of cost/pricing tracking. ax-code intentionally does NOT track or display monetary cost for LLM calls. Forbidden: schema fields named `cost`, identifiers like `pricePerToken`/`totalCost`/`costUsd`, and `/cost` slash commands (`script/check-no-cost.ts`).
3. **`pnpm run check:openapi`** — validates the OpenAPI snapshot is in sync with server routes (`packages/sdk/js`).

## Isolation / Sandbox Model

The runtime enforces an isolation boundary configured via `ax-code.json` `isolation.mode` (and `isolation.network`). Three modes exist:

| Mode | Writes | Network | Typical use |
| --- | --- | --- | --- |
| `read-only` | blocked everywhere | disabled by default | auditing, code review |
| `workspace-write` (default) | workspace only; `.git/` and `.ax-code/` always protected | disabled by default | normal development |
| `full-access` | unrestricted | enabled | trusted automation |

The isolation layer (`src/isolation/`) gates file writes, bash commands, and network calls. In `session/llm.ts`, tools are removed from the LLM tool set based on isolation mode (e.g., `edit`/`write`/`bash` removed in `read-only`; `webfetch`/`websearch` removed when `network` is `false`). The TUI exposes a sandbox toggle that flips between `workspace-write` and `full-access` via the server `/isolation` route. When working on tool or session code, always verify behavior under each isolation mode.

## Testing Conventions

- Tests for `packages/ax-code` mirror the runtime tree under `packages/ax-code/test/`.
- Prefer real integration coverage over mocks when the behavior crosses module boundaries.
- Use `tmpdir()` from `packages/ax-code/test/fixture/fixture.ts` with `await using` for automatic cleanup.
- `packages/ax-code/test/AGENTS.md` documents fixture options such as `git`, `config`, `init`, and `dispose`.

## Import Guards and Validation

The CI guard `packages/ax-code/script/check-no-effect-solid-in-v4.ts` enforces three import restrictions on `src/`:

1. **No Effect** — Effect has been fully removed from product code. Do not reintroduce `effect`, `@effect/*`, or Effect Schema. The allowlist is empty; any new Effect import is a CI failure.
2. **No SolidJS outside TUI** — `solid-js`, `solid-js/*`, and `@solid-primitives/*` imports are restricted to `src/cli/cmd/tui/` only. SolidJS is the TUI rendering framework and must not leak into domain logic.
3. **No OpenTUI outside TUI** — `@opentui/*` imports are similarly restricted to `src/cli/cmd/tui/`. The terminal UI framework must stay behind the TUI boundary.

Beyond import guards:

- Use `async/await` for async control flow. Use `Result<T, E>`, `.catch()`, or boundary-level `try/catch` for errors.
- Use Zod for new validation. Do not introduce Valibot or Effect Schema. Branded ID types use the pure-Zod helpers in `src/id/branded.ts`.
- Use `Log.create({ service: ... })` for structured logging. Include useful log fields such as `toolName` or `command`, `durationMs`, `status`, and `errorCode` on failures.

## Native Addons

Native addon paths are optional runtime accelerators with JS fallbacks. Preserve `createRequire(import.meta.url)` plus guarded `try/catch` fallback behavior.

Useful feature flags:

- `AX_CODE_NATIVE_INDEX=1` - SQLite graph and interval tree paths.
- `AX_CODE_NATIVE_FS=1` - walker, glob, grep, and watcher paths.
- `AX_CODE_NATIVE_DIFF=1` - edit replacer and fuzzy match paths.
- `AX_CODE_NATIVE_PARSER=1` - tree-sitter symbol extraction paths.

## VS Code Configuration

The workspace `.vscode/settings.json` sets `typescript.tsserver.maxTsServerMemory: 8192` because `packages/ax-code` is large enough to exhaust the default TS server heap, causing phantom errors like "Cannot find module 'hono'". It also pins `typescript.tsdk` to the workspace TypeScript and enables `tsgo` (TypeScript Native Preview) as the language server when the extension is installed. The repo typecheck (`pnpm typecheck`) runs `tsgo`, so these settings make the in-editor experience match.

## Contribution Boundary

External PRs are not accepted for this repository. Do not suggest opening external PRs; make changes locally and leave review or commit handling to the internal workflow.
