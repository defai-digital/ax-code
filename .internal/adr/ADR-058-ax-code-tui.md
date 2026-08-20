# ADR-058: One AX-Owned TypeScript/Solid TUI Package

| Field | Value |
| --- | --- |
| Status | Accepted |
| Date | 2026-08-20 |
| Deciders | AX Code maintainers |
| Related | PRD-2026-08-20; ADR-047 stability practices |

## Context

AX Code ships one production terminal UI built with SolidJS over a native cell renderer. Its implementation is divided
among three private workspaces named after upstream OpenTUI packages. The split creates redundant manifests, bespoke
release-copy logic, broad upstream-shaped exports, and patch maintenance against generated JavaScript.

The product has a substantial Solid investment and a tested renderer contract. A renderer rewrite would discard that
investment without evidence that AX's product or performance requirements cannot be met. Kimi Code's pi-tui fork shows
better ways to own a TUI fork—source-first maintenance, explicit terminal seams, immediate input scheduling, virtual
terminal tests, and a regression-backed divergence ledger—but its imperative UI model is not a drop-in replacement.

## Decision

### D1 — Single engine and package

AX Code will own one private workspace package:

- path: `packages/ax-code-tui`
- package: `@ax-code/tui`
- application model: SolidJS TSX
- rendering implementation during consolidation: the existing native/Yoga renderer

The old `packages/opentui-core`, `packages/opentui-solid`, and `packages/opentui-spinner` packages are removed after all
consumers migrate. No compatibility engine or permanent dual stack is introduced.

### D2 — Public subpaths

The package root exposes low-level renderer primitives because those are the existing core contract. Framework and AX
components are explicit subpaths:

| Export | Ownership |
| --- | --- |
| `@ax-code/tui` | Renderer primitives and types |
| `@ax-code/tui/testing` | Renderer test utilities |
| `@ax-code/tui/solid` | Solid render function, hooks, components, JSX types |
| `@ax-code/tui/solid/transform` | Build-time Solid transform |
| `@ax-code/tui/solid/preload` | Source-mode preload |
| `@ax-code/tui/solid/jsx-runtime` | JSX runtime |
| `@ax-code/tui/solid/jsx-dev-runtime` | Development JSX runtime |
| `@ax-code/tui/spinner` | Spinner renderable and helpers |
| `@ax-code/tui/spinner/solid` | Spinner element registration |

No new application code may depend on undocumented files below these exports.

### D3 — Rebrand boundary

OpenTUI identifiers are removed from active package names, imports, scripts, environment variables, test groups, release
staging, and runtime diagnostics. Third-party provenance is not branding and remains mandatory in license, notice,
upstream snapshot, and divergence documents.

### D4 — Fork governance

The consolidated package must maintain:

1. a pinned upstream/native manifest with integrity hashes;
2. `UPSTREAM.md` describing the imported baseline and refresh procedure;
3. `DIVERGENCES.md` mapping every AX change to its observable reason and regression test;
4. idempotent apply/check automation while generated artifacts remain;
5. JS/native ABI upgrades as separate, explicit changes.

Phase 1 is allowed to preserve the current generated snapshot to keep the move behavior-neutral. Source ownership is the
next phase and must replace hashed-chunk patching only after native ABI and packed-consumer tests pass.

### D5 — Lessons adopted from pi-tui

AX will incrementally adopt these patterns behind the stable Solid API:

- terminal I/O represented by an explicit driver contract;
- explicit main-screen and alternate-screen ownership;
- coalesced normal frames plus an immediate input-sensitive frame path;
- focus/overlay ownership with deterministic restoration;
- xterm/headless terminal integration tests;
- input-to-render percentile instrumentation;
- grapheme, CJK, narrow-width, overwide-line, paste, SSH, and IME regression cases.

AX will not copy pi-tui's application component model or its large imperative coordinator pattern.
The detailed evidence and adoption sequencing are recorded in
`.internal/reports/planning/ax-code-tui/REFERENCE-REVIEW.md`.

## Alternatives considered

### Keep three renamed packages

Rejected. It preserves upstream boundaries, duplicate packaging, and cross-package synchronization without independent
AX consumers that justify them.

### Replace the application with pi-tui

Rejected. pi-tui provides valuable design practices but adopting its imperative component model would rewrite roughly
90 Solid TSX files and re-open every focus, layout, plugin, and visual contract.

### Merge only the directory names

Rejected as an endpoint. Physical consolidation is Phase 1, followed by source ownership and contract hardening.

## Consequences

### Positive

- One package, manifest, dependency graph, copy operation, native target tree, and owner.
- AX-controlled imports and runtime identity.
- Existing TUI behavior and investment survive the migration.
- Upstream changes become auditable through explicit provenance and divergence tests.
- pi-tui improvements can land behind stable product components instead of forcing a rewrite.

### Costs

- The first phase still contains derived generated code and native binaries.
- A later source import remains substantial and requires ABI discipline.
- Mechanical rename touches many scripts, tests, workflows, docs, and packaging fixtures.
- MIT lineage and upstream copyright notices remain permanently required for derived code.

## Compliance and verification

- `check:tui-vendor`, `check:tui-patches`, `check:tui-package`, and renderer-contract tests are required gates.
- Single-target build and both startup profiles must pass.
- Active source is scanned for legacy package IDs and alternate renderer dependencies.
- Third-party licenses and native artifact hashes remain in shipped packages.
