# Repository Structure

This repo is a pnpm workspace monorepo. The structure rules below are intended to keep package ownership, dependency flow, and test placement predictable as the codebase grows.

## Canonical Top-Level Layout

- `packages/`: shipped packages and product surfaces
- `docs/`: architecture notes, ADRs, PRDs, specs, bugs, todos, and reference docs
- `script/`: repository automation scripts run from the root

## Package Roles

- `packages/ax-code`: runtime, CLI, TUI, server, and core backend logic
- `packages/app`: web application
- `packages/desktop`: desktop shell and Tauri bindings
- `packages/ui`: shared UI components and visual infrastructure
- `packages/util`: small shared utilities with minimal dependencies
- `packages/plugin`: plugin-facing helpers and types
- `packages/sdk/js`: programmatic and HTTP SDK
- `packages/integration-github`: GitHub automation and repository integration package
- `packages/integration-vscode`: VS Code integration package

## Source Placement Rules

### Runtime packages

Use domain-first folders. Keep orchestration layers separate from domain logic.

- put business logic under domain folders such as `session`, `project`, `provider`, `permission`
- keep interface-heavy code in interface-oriented folders such as CLI, TUI, and server routes
- keep low-level helpers in shared utility layers, not mixed into product interfaces

### Frontend app packages

Keep route entry, feature logic, and reusable UI separate.

- `pages/` owns route composition
- `components/` owns reusable app-level view units
- `context/` owns shared app state
- `testing/` owns shared test helpers
- feature logic that grows past page-local scope should move into feature-owned folders instead of staying in route files

### Shared UI packages

Keep primitives, composites, content rendering, icons, and session/file surfaces grouped by concern. Avoid a single flat `components/` surface for everything new.

## Dependency Rules

- `app` and `desktop` may depend on `ui`, `sdk`, and `util`
- shared packages must not depend on `app` or `desktop`
- `ax-code` must not depend on `app`, `desktop`, or `ui`
- prefer package public exports over deep internal imports

## Testing Rules

- `packages/ax-code`: mirrored `test/` tree for runtime and integration coverage
- `packages/app`: colocated unit tests plus `e2e/` workflow coverage
- `packages/ui`: colocated component and interaction tests near exported components
- supporting packages: colocated tests unless a harness requires a dedicated test tree

## Hotspot Guardrails

These folders need special care:

- `packages/ax-code/src/cli`
- `packages/app/src/pages/session`
- `packages/ui/src/components`

These are soft limits:

- preferred file size: under 300 lines
- review threshold: 500+ lines
- split threshold: 800+ lines unless there is a strong reason not to

## Canonical Docs Layout

- `docs/architecture/`: repo and package-level policies
- `docs/adr/`: decision records
- `docs/prd/`: product and engineering requirement documents
- `docs/specs/`: stable reference specs
- `docs/bugs/`: bug inventories and bug-focused reviews
- `docs/todos/`: tracked follow-up work and deferred tasks
