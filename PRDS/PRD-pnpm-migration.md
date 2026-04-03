# PRD: pnpm Package Manager Migration
## Retain Bun Runtime, Build, and Test Execution

**Author:** Engineering Team
**Date:** 2026-04-02
**Priority:** HIGH
**Estimated Effort:** 2-4 days
**Status:** Draft
**Dependencies:** AX Code rebrand stabilization, CI access, package publish verification

---

## 1. Problem Statement

The `ax-code` monorepo currently uses Bun as all of the following:

- workspace package manager
- lockfile owner
- runtime for scripts and local development
- primary test runner

This is efficient for existing contributors, but it creates avoidable friction for users and maintainers who expect a standard monorepo package manager with mature workspace tooling, familiar install flows, and predictable lockfile behavior in CI.

The repo is a poor candidate for a full Bun removal today. It still contains extensive Bun-specific runtime and test usage, including:

- `bun:test` across a large test surface
- `Bun.*` runtime APIs in scripts and product code
- Bun-only modules such as `bun-pty`
- Bun-targeted import conditions and runtime branches

Therefore, the migration target is not "replace Bun". The target is:

**Use `pnpm` as the monorepo package manager while intentionally retaining Bun as the runtime, script host, and test/build engine.**

---

## 2. Goals

| Goal | Outcome |
|------|---------|
| Standardize package management | Contributors install dependencies with `pnpm install` |
| Preserve current runtime behavior | Product code, scripts, and tests that require Bun continue to run under Bun |
| Reduce migration risk | Avoid a simultaneous runtime rewrite |
| Improve monorepo ergonomics | Use `pnpm-workspace.yaml`, `workspace:` linking, catalogs, and pnpm lockfile |
| Keep publishability intact | Workspace packages still pack and publish correctly |

### Success Metrics

| Metric | Target |
|--------|--------|
| Fresh install succeeds with pnpm | 100% on macOS and Linux CI |
| Existing workspace links resolve correctly | 100% |
| Catalog-based versions remain centralized | 100% |
| Bun-based dev/test commands still work after install | 100% |
| CI install time regression | <= 10% from current baseline |

---

## 3. Non-Goals

The following are explicitly out of scope for this PRD:

- Replacing Bun with Node.js
- Rewriting `bun:test` to Vitest/Jest
- Replacing `Bun.file`, `Bun.write`, `Bun.spawn`, `Bun.serve`, or `bun:sqlite`
- Removing Bun from package scripts that truly require it
- Reworking product architecture to become Bun-free
- Rewriting unrelated docs or examples beyond package-manager instructions

---

## 4. Current State

### 4.1 Workspace Characteristics

The repo currently depends on Bun-specific workspace behavior in the root manifest:

- root `packageManager` is Bun
- root workspace configuration is embedded in `package.json`
- dependency versions are centralized through the `catalog:` protocol
- package links use `workspace:*`
- patch files are stored under `patches/`

### 4.2 Bun Coupling We Are Intentionally Keeping

This migration does **not** try to remove Bun runtime usage. Bun remains required after the migration because the repo still has:

- Bun-driven package scripts
- Bun shebang scripts
- Bun-specific test files
- Bun runtime APIs in `packages/ax-code`, `packages/app`, `packages/desktop`, `packages/sdk/js`, `packages/plugin`, `packages/script`, and `packages/ui`

### 4.3 Repo Implication

After this migration:

- `pnpm` owns dependency installation and lockfile generation
- Bun still must be installed for development, build, and test workflows

This is a dual-tool setup by design, not an incomplete migration.

---

## 5. User Stories

### 5.1 Contributor

As a contributor, I want to install dependencies with `pnpm install` so the repo uses a familiar monorepo package manager.

### 5.2 Maintainer

As a maintainer, I want centralized dependency versions and workspace linking to continue working so package updates remain low-friction.

### 5.3 CI Operator

As a CI maintainer, I want deterministic installs through `pnpm-lock.yaml` while still running Bun-based build and test commands.

### 5.4 Publisher

As a package publisher, I want workspace packages and patched dependencies to continue packing and publishing correctly.

---

## 6. Requirements

### 6.1 Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-01 | Root package manager must change from Bun to pnpm | P0 |
| FR-02 | Root workspace config must move to `pnpm-workspace.yaml` | P0 |
| FR-03 | Existing `workspace:*` dependencies must continue to resolve correctly | P0 |
| FR-04 | Existing centralized `catalog:` versions must remain supported under pnpm catalogs | P0 |
| FR-05 | Existing dependency patching under `patches/` must remain functional | P0 |
| FR-06 | Developer setup docs must clearly state that Bun is still required as runtime | P0 |
| FR-07 | CI install steps must switch to pnpm while runtime commands may still invoke Bun | P0 |
| FR-08 | Publish and pack flows must work with pnpm-managed installs | P1 |
| FR-09 | Root and package scripts should be updated where the package-manager layer is Bun-specific but runtime behavior is not | P1 |
| FR-10 | Repo diagnostics and docs should describe the dual-tool model accurately | P1 |

### 6.2 Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-01 | Migration safety | No functional regression in app, CLI, SDK, or desktop install flows |
| NFR-02 | Developer clarity | No ambiguous setup steps about when to use pnpm vs Bun |
| NFR-03 | CI determinism | Lockfile-driven installs with pnpm |
| NFR-04 | Low blast radius | No product runtime rewrites in this phase |

---

## 7. Proposed Approach

### 7.1 Tooling Model

Adopt the following split:

- `pnpm` for dependency installation, workspace management, lockfile, catalogs, and patch registration
- `bun` for runtime execution of Bun-native scripts, tests, and product commands

### 7.2 Workspace Model

Create a root [`pnpm-workspace.yaml`](/Users/akiralam/code/ax-code/pnpm-workspace.yaml) that defines:

- workspace package globs
- default catalog entries migrated from the root `package.json`
- any top-level pnpm settings needed for the repo

This aligns with pnpm's documented workspace and catalog model:

- https://pnpm.io/workspaces
- https://pnpm.io/catalogs

### 7.3 Patch Model

Retain `patches/` and migrate patch ownership to pnpm-compatible `patchedDependencies` handling where needed.

Reference:

- https://pnpm.io/cli/patch

### 7.4 Runtime Policy

Do not rewrite Bun-native execution in this PRD. The following remain valid after migration:

- `bun test`
- `bun run ...`
- `#!/usr/bin/env bun` scripts
- Bun-targeted runtime branches and import conditions

---

## 8. Scope Breakdown

### 8.1 In Scope

- root package-manager switch
- `pnpm-workspace.yaml`
- lockfile migration
- package-manager-related script updates
- install/setup/readme/CI documentation updates
- publish flow validation
- contributor guidance for dual-tool usage

### 8.2 Out of Scope

- replacing Bun runtime APIs
- replacing Bun test runner
- changing package internals that only run correctly on Bun
- Node-only compatibility work

---

## 9. Implementation Plan

### Phase 0: Audit and Baseline

Deliverables:

- inventory of package-manager-specific Bun usage
- inventory of Bun runtime usage to leave untouched
- CI baseline for install and main verification jobs

Exit Criteria:

- clear separation between package-manager concerns and runtime concerns

### Phase 1: Workspace Migration

Deliverables:

- change root `packageManager` to pnpm
- create `pnpm-workspace.yaml`
- move root workspace package globs to pnpm workspace config
- move root catalog definitions into pnpm catalogs
- generate `pnpm-lock.yaml`
- remove Bun lockfile only if no remaining workflow requires it

Exit Criteria:

- `pnpm install` resolves the entire workspace cleanly
- workspace links and catalogs behave correctly

### Phase 2: Script and Config Alignment

Deliverables:

- update root scripts that should invoke `pnpm` rather than Bun at the package-manager layer
- keep Bun execution where scripts genuinely require Bun runtime
- update package docs and helper scripts to avoid install-command ambiguity

Examples:

- use `pnpm install` for setup
- keep `bun test` where test runner remains Bun
- keep `bun ./script/build.ts` where script runtime remains Bun

Exit Criteria:

- setup instructions are internally consistent
- no script suggests `bun install`

### Phase 3: CI and Publish Flows

Deliverables:

- switch CI dependency installation to pnpm
- cache pnpm store in CI
- verify Bun is still installed in jobs that run build/tests/scripts
- validate workspace package packing and publishing

Exit Criteria:

- CI passes with pnpm install + Bun execution
- package publish path remains correct

### Phase 4: Docs and Adoption

Deliverables:

- update root README and package READMEs
- update contributor docs and agent docs where setup steps mention Bun installs
- add short guidance explaining the dual-tool model

Exit Criteria:

- new contributor can follow docs without confusion

---

## 10. File and System Impact

High-probability touch points:

- [package.json](/Users/akiralam/code/ax-code/package.json)
- [bunfig.toml](/Users/akiralam/code/ax-code/bunfig.toml)
- [packages/ax-code/package.json](/Users/akiralam/code/ax-code/packages/ax-code/package.json)
- [packages/app/package.json](/Users/akiralam/code/ax-code/packages/app/package.json)
- [packages/sdk/js/package.json](/Users/akiralam/code/ax-code/packages/sdk/js/package.json)
- [packages/desktop/package.json](/Users/akiralam/code/ax-code/packages/desktop/package.json)
- [packages/ui/package.json](/Users/akiralam/code/ax-code/packages/ui/package.json)
- [README.md](/Users/akiralam/code/ax-code/README.md)
- [packages/ax-code/README.md](/Users/akiralam/code/ax-code/packages/ax-code/README.md)
- [packages/app/README.md](/Users/akiralam/code/ax-code/packages/app/README.md)
- CI workflow files under `github/` and repository automation scripts

Potentially impacted behavior:

- install instructions
- root bootstrap commands
- publish packaging
- dependency patch registration
- workspace dependency resolution

---

## 11. Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| pnpm install behavior differs from Bun install behavior | broken workspace install | run full workspace install verification before merging |
| Catalog migration is incomplete | version drift or install failure | migrate all root catalog entries to `pnpm-workspace.yaml` |
| Patch handling differs | patched packages stop applying | validate `patchedDependencies` explicitly under pnpm |
| Scripts become inconsistent | contributors use wrong command path | document `pnpm` vs `bun` responsibilities clearly |
| CI caches are misconfigured | slower or flaky builds | switch to pnpm store cache with a clean baseline |
| Bun lockfile removal breaks a residual workflow | hidden automation failure | search and verify all references before removal |

---

## 12. Rollout Strategy

### 12.1 Rollout

Merge as a single migration PR if the scope stays limited to package management.

If publish or CI issues expand, split into:

1. workspace and lockfile migration
2. CI and doc migration
3. publish flow cleanup

### 12.2 Rollback

Rollback remains straightforward if the migration is isolated:

- restore root `packageManager`
- restore Bun workspace/install config
- restore prior lockfile
- revert CI install commands

---

## 13. Acceptance Criteria

The migration is complete when all of the following are true:

1. Contributors install with `pnpm install`.
2. The workspace resolves using pnpm catalogs and `workspace:` dependencies.
3. Bun remains available and documented for runtime, tests, and Bun-native scripts.
4. CI installs with pnpm and runs required Bun-based commands successfully.
5. Publish and pack workflows still succeed.
6. Root and package docs no longer describe Bun as the package manager.
7. There is no repo ambiguity about when to use `pnpm` versus `bun`.

---

## 14. Open Questions

1. Should Bun remain declared as a contributor prerequisite in the root README, or should setup scripts install/check it automatically?
2. Do we want to keep `bunfig.toml` only for test/runtime config, or reduce it further after migration?
3. Should root scripts like `typecheck`, `dev:web`, and `dev:desktop` be exposed through `pnpm` wrappers even when they invoke Bun internally?
4. Are any release workflows currently depending on `bun.lock` specifically rather than Bun itself?
5. Should translated READMEs be updated in the same PR or in a follow-up docs sweep?

---

## 15. Recommendation

Proceed with the migration as a **package-manager-only change**:

- adopt `pnpm` for workspace management and installs
- retain Bun as an explicit runtime dependency
- avoid runtime rewrites in the same PR

This yields most of the package-management benefits with materially lower risk than a Bun removal project.
