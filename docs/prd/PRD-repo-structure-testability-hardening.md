# PRD: Repository Structure, Maintainability, and Testability Hardening

Status: Completed
Date: 2026-04-04
Owner: Engineering

## Implementation Summary

Completed in this repository:

- normalized root planning and tracking docs under `docs/adr`, `docs/prd`, `docs/bugs`, `docs/todos`, and `docs/specs`
- consolidated bootstrap and repo automation under `script/`
- moved the GitHub and VS Code integrations under `packages/integration-github` and `packages/integration-vscode`
- added package-local architecture notes and CI-backed structure enforcement
- grouped large UI, app session, and CLI command surfaces into more explicit feature folders with compatibility shims
- extracted testable session helpers and added focused unit coverage for them

## 1. Executive Summary

The repository has a strong base for a scalable monorepo:

- `packages/` already separates major product surfaces
- `packages/ax-code` is mostly domain-oriented rather than file-type-oriented
- `packages/ax-code/test` mirrors runtime domains well
- `packages/app` keeps many UI tests close to the code they validate
- `packages/ui` centralizes shared presentation logic

However, the current arrangement is not yet "best practice" for long-term maintainability and testability.

The biggest risks are:

1. Inconsistent top-level taxonomy and naming
2. Very large source areas with too many responsibilities in a single folder
3. Very large files that are hard to reason about and test
4. Inconsistent testing conventions across packages
5. Weakly enforced package and module boundaries

This PRD proposes a structure hardening program, not a cosmetic re-org. The goal is to make ownership clearer, testing easier, and change impact smaller.

## 2. Current Assessment

### What is already good

- Monorepo boundary is clear: product code is primarily under `packages/`
- Runtime/backend domains in `packages/ax-code/src` are mostly organized by capability (`session`, `provider`, `project`, `replay`, `permission`, `tool`)
- Core tests are grouped by the same domains under `packages/ax-code/test`
- App unit tests are largely colocated and e2e tests are isolated under `packages/app/e2e`
- Shared UI exists as its own package instead of being duplicated between app and desktop

### What is currently weak

- Top-level structure mixes product code, docs, work tracking, scripts, and integrations:
  `packages/`, `sdks/`, `github/`, `docs/`, `specs/`, `ADRS/`, `PRDS/`, `BUGS/`, `TODOS/`, `script/`, `scripts/`
- Naming is inconsistent:
  `packages/sdk/js`, `sdks/vscode`, and standalone `github` describe similar concepts in different ways
- Some source areas are too large:
  `packages/ax-code/src/cli` is the largest runtime domain, `packages/ui/src/components` is flat and very broad, and `packages/app/src/pages/session` has grown into a major subsystem
- Several files are far past normal maintainability limits:
  `packages/app/src/pages/layout.tsx`, `packages/app/src/pages/session.tsx`, `packages/ax-code/src/cli/cmd/tui/routes/session/index.tsx`, `packages/ui/src/components/message-part.tsx`, `packages/ax-code/src/session/prompt.ts`
- Testing strategy is uneven:
  backend is mirrored under `test/`, app mostly colocates tests, UI has strong Storybook coverage but sparse automated tests
- Internal imports are flexible but not strongly constrained, which makes accidental cross-domain coupling easier over time

## 3. Problem Statement

The repository can still be worked in effectively by current maintainers, but its current growth pattern will make onboarding, refactoring, and regression prevention progressively more expensive.

Without a clearer information architecture:

- new code will continue to land in oversized folders
- shared packages will become "misc buckets"
- test coverage will drift by team preference rather than by policy
- architectural boundaries will exist socially, not mechanically
- large features will remain hard to split into independently testable units

## 4. Goals

1. Make the repo easier to navigate for a new engineer in under 30 minutes
2. Make package purpose and ownership obvious from folder names alone
3. Reduce blast radius by shrinking oversized files and oversized domains
4. Standardize where tests live and what level of tests each package must have
5. Enforce dependency boundaries so structure remains healthy after the cleanup
6. Preserve delivery speed by rolling changes out incrementally

## 5. Non-Goals

- Rewriting working subsystems only to satisfy aesthetic folder preferences
- Converting every package to the same exact internal layout
- Moving files solely to reduce line counts without improving ownership or tests
- Breaking public imports for consumers without a migration path

## 6. Key Findings From This Review

### Finding A: top-level taxonomy is not normalized

The repo currently has multiple homes for package-like or spec-like content:

- product packages in `packages/`
- a VS Code SDK/integration in `sdks/`
- a GitHub integration in standalone `github/`
- architecture and planning docs split across `docs/`, `specs/`, `ADRS/`, `PRDS/`, `BUGS/`, `TODOS/`
- both `script/` and `scripts/`

This reduces discoverability and creates avoidable debates about where new work belongs.

### Finding B: some domains have outgrown a flat folder model

`packages/ax-code/src` is mostly healthy, but its top level is now very wide. The CLI/TUI area is especially large and is acting as both product interface and orchestration layer.

`packages/ui/src/components` is also too flat for its scale. Shared UI components, session-specific components, file viewers, icons, motion helpers, and content rendering all live under one broad component surface.

### Finding C: file size is now a structural risk

Several 1000-2500 line files indicate subsystems that need explicit slicing. Large files are not automatically bad, but this pattern usually means:

- too many reasons to change one file
- hard-to-target tests
- review fatigue
- high merge conflict frequency

### Finding D: testing policy is good locally but inconsistent globally

The repo uses three valid patterns today:

- mirrored integration-style tests in `packages/ax-code/test`
- colocated unit tests in `packages/app/src`
- separate e2e tests in `packages/app/e2e`

The problem is not that these patterns exist. The problem is that the repo does not define when each pattern should be used.

### Finding E: boundaries are implied, not enforced

The monorepo has package-level separation, but internal imports still allow broad cross-domain reach. Over time that makes architectural drift likely.

## 7. Product Requirements

### R1. Normalize top-level repository taxonomy

The repository must define one canonical home for:

- product/runtime packages
- integrations/extensions
- scripts/tooling
- docs/specs/decision records
- work tracking artifacts

Recommended direction:

```text
/packages           # shippable packages and product surfaces
/tools              # repo tooling, generators, publish helpers, local scripts
/docs               # ADRs, PRDs, specs, architecture, runbooks
```

Suggested repo changes:

- move `github/` to `packages/github-action` or `packages/integration-github`
- choose one SDK convention:
  either `packages/sdk` + `packages/sdk-vscode`
  or `packages/sdk/js` + `packages/sdk/vscode`
- consolidate `script/` and `scripts/` into one canonical folder
- consolidate `ADRS/`, `PRDS/`, `BUGS/`, `TODOS/`, and `specs/` under `docs/` with clear subfolders

### R2. Define package naming rules

Every package should communicate one of these roles:

- runtime/application
- shared library
- integration/adapter
- tooling/generator

Recommended naming pattern:

- `packages/app`
- `packages/desktop`
- `packages/ax-code`
- `packages/ui`
- `packages/util`
- `packages/sdk`
- `packages/integration-vscode`
- `packages/integration-github`

The repository should avoid mixing role-first naming in one place and platform-first naming in another.

### R3. Define standard source-folder rules per package type

Not every package needs the same internal layout, but each package type should have a default template.

#### Runtime-heavy packages

Example: `packages/ax-code`

Preferred structure:

```text
src/
  domain/
  platform/
  interface/
  shared/
```

For `packages/ax-code`, the current domain-oriented layout should be preserved, but large interface surfaces should be split more explicitly:

- `src/interface/cli`
- `src/interface/tui`
- `src/interface/server`
- `src/domain/session`
- `src/domain/project`
- `src/domain/provider`
- `src/platform/lsp`
- `src/platform/mcp`
- `src/shared/util`

This can be achieved incrementally without changing public behavior.

#### Frontend application packages

Example: `packages/app`

Preferred structure:

```text
src/
  pages/
  features/
  components/
  context/
  lib/
  testing/
```

The main need is to stop `pages/session` and `components/` from carrying feature logic indefinitely. Session-related behavior should move toward a feature-first layout.

#### Shared UI packages

Example: `packages/ui`

Preferred structure:

```text
src/
  primitives/
  composites/
  session/
  file/
  content/
  icons/
  context/
  hooks/
  styles/
  assets/
```

This package is the clearest candidate for grouping by feature family instead of keeping nearly everything flat in `components/`.

### R4. Introduce file-size and folder-size guardrails

The repo should adopt soft limits:

- preferred file size: under 300 lines
- review threshold: 500+ lines requires justification
- refactor threshold: 800+ lines should be split unless there is a strong reason not to

The repo should also track "hotspot folders" where count growth is a known risk:

- `packages/ax-code/src/cli`
- `packages/app/src/pages/session`
- `packages/ui/src/components`

### R5. Standardize testing policy by package type

The repo should document one default testing strategy per package type.

Recommended policy:

- `packages/ax-code`: mirrored `test/` tree for integration-heavy runtime coverage
- `packages/app`: colocated unit tests for component and hook logic, plus `e2e/` for workflows
- `packages/ui`: colocated unit and interaction tests next to exported components, with Storybook as support rather than replacement
- integrations/extensions: colocated tests near integration entry points unless an external harness requires otherwise

Also required:

- each new domain folder must declare its expected test location
- shared UI components with state, keyboard logic, or rendering branches should have automated tests, not only stories

### R6. Enforce architecture boundaries with tooling

The repo should add dependency-boundary checks. Suitable options include:

- `eslint-plugin-boundaries`
- `dependency-cruiser`
- custom `rg`-based policy checks if a lighter solution is preferred initially

Minimum enforceable rules:

1. app and desktop may depend on `ui`, `sdk`, `util`
2. shared packages may not import from app or desktop
3. runtime interfaces may not create new dependencies back into UI packages
4. internal `src` domains in `packages/ax-code` should have allowed dependency directions
5. deep imports that bypass intended public exports should be flagged

### R7. Document ownership and placement rules

Each major package should include a short local architecture note describing:

- package purpose
- allowed dependencies
- test strategy
- where new files should go
- where they should not go

This can live in package README files or package-local architecture notes.

## 8. Proposed Target Layout

This is a direction, not a required one-shot migration:

```text
/
  packages/
    ax-code/
    app/
    desktop/
    ui/
    util/
    plugin/
    sdk/
    integration-vscode/
    integration-github/
  tools/
    build/
    publish/
    generators/
  docs/
    adr/
    prd/
    specs/
    bugs/
    todos/
    architecture/
```

## 9. Recommended First Moves For This Repository

### Phase 1: conventions and guardrails

- publish a repo structure guide
- define canonical top-level folders
- define package naming rules
- define per-package testing rules
- add boundary enforcement tooling in warning mode
- add file-size reporting to CI for hotspot files

### Phase 2: normalize naming and placement

- move `github/` into `packages/`
- unify `packages/sdk/js` and `sdks/vscode` naming under one convention
- unify `script/` and `scripts/`
- consolidate planning and architecture docs under `docs/`

### Phase 3: split hotspot areas

- split `packages/ax-code/src/cli` into clearer interface subdomains
- split `packages/app/src/pages/session` into feature-owned modules
- split `packages/ui/src/components` into grouped subfolders
- break up the largest 10 source files first

### Phase 4: testability upgrades

- add missing automated tests for stateful shared UI components
- ensure each hotspot refactor lands with tests for the extracted units
- add architecture checks to CI in blocking mode after cleanup stabilizes

## 10. Acceptance Criteria

This effort is complete when all of the following are true:

1. A new engineer can identify where to place a new package, spec, script, and feature without asking a maintainer.
2. The repository has one canonical location for packages, one for tooling, and one for docs/specs.
3. `github/`, `sdks/vscode`, and `packages/sdk/js` no longer use mixed taxonomy.
4. The top structural hotspots have documented ownership and placement rules.
5. No newly added source file exceeds the agreed review threshold without explanation.
6. `packages/ui` has a documented and enforced component grouping model.
7. `packages/app` and `packages/ax-code` have documented testing conventions and follow them consistently.
8. Dependency boundary checks run in CI.

## 11. Success Metrics

- reduce top-level "where should this go?" ambiguity to near zero
- reduce number of 800+ line files quarter over quarter
- reduce merge conflicts in known hotspot files
- increase automated test coverage in `packages/ui`
- reduce architectural review comments about import direction and file placement

## 12. Recommendation

The repository is already good enough to keep shipping, but it should not be treated as fully best-practice yet.

Recommendation:

- keep the current package split
- do not do a repo-wide rewrite
- harden the structure with explicit rules first
- then refactor the highest-risk hotspots in small, test-backed slices

That approach will improve maintainability and testability without freezing feature delivery.
