# Repository Structure

This repo is a pnpm workspace monorepo. The structure rules below are intended to keep package ownership, dependency flow, and test placement predictable as the codebase grows.

## Canonical Top-Level Layout

- `packages/`: shipped packages and product surfaces
- `crates/`: Rust native addons (napi-rs) for performance-critical operations
- `docs/`: product-facing documentation (user guides, policies, specs, images)
- private internal planning workspace: development-stage materials, not part of public docs or shipped artifacts
- `script/`: repository automation scripts run from the root

## Package Roles

- `packages/ax-code`: runtime, CLI, TUI, server, and core backend logic
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

### Shared UI packages

Keep primitives, composites, content rendering, icons, and session/file surfaces grouped by concern. Avoid a single flat `components/` surface for everything new.

## Dependency Rules

- `ax-code` must not depend on `ui`
- prefer package public exports over deep internal imports

## Testing Rules

- `packages/ax-code`: mirrored `test/` tree for runtime and integration coverage
- `packages/ui`: colocated component and interaction tests near exported components
- supporting packages: colocated tests unless a harness requires a dedicated test tree

## Hotspot Guardrails

These folders need special care:

- `packages/ax-code/src/cli`
- `packages/ui/src/components`

These are soft limits:

- preferred file size: under 300 lines
- review threshold: 500+ lines
- split threshold: 800+ lines unless there is a strong reason not to

## Canonical Docs Layout

`docs/` is **product-facing** — content that users, contributors, and reviewers reference. Internal planning materials are kept separate from this public documentation surface.

### docs/ (product-facing, committed to git)

- `docs/architecture/`: repo and package-level policies
- `docs/policies/`: JSON policy files for sandbox and governance
- `docs/specs/`: stable reference specs (API contracts, protocols)
- `docs/images/`: diagrams and architecture images referenced by README
- `docs/*.md`: user guides (sandbox.md, autonomous.md, etc.)

This separation keeps `docs/` focused on stable, public-facing material. Internal planning artifacts and working notes are maintained outside the public docs surface and are not part of the shipped product.
