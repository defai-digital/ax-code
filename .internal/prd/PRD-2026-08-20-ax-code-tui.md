# PRD: AX Code TUI Consolidation and Ownership

| Field | Value |
| --- | --- |
| Status | Active |
| Owner | AX Code CLI |
| Created | 2026-08-20 |
| Related | ADR-058; TUI renderer contract; TUI performance criteria |
| Technical plan | `.internal/reports/planning/ax-code-tui/TECH-SPEC.md` |

## 1. Problem

AX Code's production terminal UI is split across three private workspace packages:

- `@opentui/core`, a checked-in prebuilt JavaScript/type/native snapshot;
- `@opentui/solid`, the SolidJS renderer and build transform; and
- `opentui-spinner`, a small AX-maintained component package.

The split mirrors upstream packaging rather than AX ownership. The CLI build externalizes and copies the packages
individually, patch automation edits generated chunks, product code imports renderer internals from dozens of files, and
the public/runtime identity remains tied to OpenTUI even though AX maintains the fork and its release packaging.

The shipping TypeScript/Solid TUI is the only engine and must become an AX-owned subsystem.

## 2. Product decision

Create one private workspace package at `packages/ax-code-tui` named `@ax-code/tui`.

The first migration preserves renderer behavior and native ABI while consolidating ownership:

| Existing import | AX-owned import |
| --- | --- |
| `@opentui/core` | `@ax-code/tui` |
| `@opentui/solid` | `@ax-code/tui/solid` |
| `opentui-spinner` | `@ax-code/tui/spinner` |
| `opentui-spinner/solid` | `@ax-code/tui/spinner/solid` |

OpenTUI remains third-party lineage that must be acknowledged in licenses and provenance. It must not remain a public
package name, runtime configuration name, product label, or build-system concept.

Kimi Code's pi-tui fork is a design reference, not a dependency or a replacement component model. AX will adopt its
source-fork discipline, explicit terminal boundaries, focused render scheduling, virtual-terminal testing, and
test-backed divergence ledger incrementally while preserving the existing Solid TSX application.

## 3. Goals

| ID | Goal |
| --- | --- |
| G1 | Replace three workspace packages with one `@ax-code/tui` package without user-visible rendering regressions. |
| G2 | Remove legacy package/import/script/runtime configuration names from active AX code. |
| G3 | Preserve Node FFI, native target selection, Solid JSX, testing, and offline release packaging. |
| G4 | Make every AX-specific renderer divergence explicit, source-located, and guarded by a regression test. |
| G5 | Reduce the supported public surface to the exports AX actually consumes. |
| G6 | Establish a path from prebuilt upstream artifacts to reviewed source ownership without a renderer rewrite. |

## 4. Non-goals

- Rewriting the 90-file Solid TSX application into pi-tui's imperative `render(width)` component model.
- Replacing the native renderer, Yoga layout, terminal editor, or selection implementation in the consolidation change.
- Claiming clean-room authorship of derived OpenTUI code or removing required MIT notices.
- Adding a second production renderer, compatibility flag, or long-lived dual stack.
- Changing AX Code CLI commands, session semantics, Desktop UI, or server APIs.
- Rebasing JavaScript and native binaries to a new upstream ABI in the same change as the package move.

## 5. Requirements

### 5.1 Package and API

1. Exactly one TUI workspace package is installed and shipped.
2. Solid JSX compiles with `jsxImportSource: "@ax-code/tui/solid"`.
3. Required subpaths remain available: core root, testing, Solid root, Solid transform/preload/JSX runtimes, spinner, and
   spinner Solid registration.
4. Runtime-plugin and parser-related exports are retained only where current build/runtime checks prove they are needed.
5. Application code contains no imports from the legacy package names.

### 5.2 Runtime and packaging

1. Compatible main-screen and advanced alternate-screen startup profiles both work.
2. The native library resolver loads the checked-in target relative to the consolidated package.
3. Cross-platform release staging copies one package and prunes it to the selected native target.
4. JS/native provenance, version, integrity, target, and hashes remain recorded offline.
5. `AX_CODE_TUI_LIBC` replaces the legacy libc override name.

### 5.3 Quality

1. Existing coordinate, pointer-lifetime, native-resolution, spinner, golden-frame, startup, and layering tests migrate
   to AX-owned names and continue passing.
2. The renderer contract and performance criteria remain the behavioral authority.
3. The package contains an `UPSTREAM.md` snapshot record and `DIVERGENCES.md` with a regression test for every local
   behavior patch.
4. A repository check prevents legacy package identifiers or alternate renderer dependencies from returning to active code.
5. The generated spinner distribution is reproducible from its checked-in source.

## 6. Delivery phases

### Phase 1 — Consolidation (this implementation)

- Move core, Solid, and spinner into `packages/ax-code-tui`.
- Publish the internal export map under `@ax-code/tui`.
- Migrate imports, loaders, build/release staging, scripts, tests, docs, and CI naming.
- Preserve the current renderer/native versions and behavior.
- Add provenance and divergence records.

### Phase 2 — Source ownership

- Import a pinned, license-complete renderer source snapshot matching its native ABI.
- Reapply AX divergences as readable source changes with focused tests.
- Remove patching of hashed generated JavaScript once parity and packed-distribution gates pass.

### Phase 3 — pi-tui-informed hardening

- Introduce an explicit terminal driver contract around terminal I/O and capabilities.
- Separate main-screen and alternate-screen ownership behind that contract.
- Add an immediate input-to-frame scheduling lane and latency percentiles.
- Add an xterm/headless virtual-terminal harness alongside native framebuffer golden tests.

## 7. Acceptance criteria

- The three `packages/opentui-*` directories no longer exist.
- `packages/ax-code-tui/package.json` is named `@ax-code/tui` and owns all required exports and runtime dependencies.
- Repository application/build/test imports contain no `@ax-code/opentui-*` identifiers.
- One native target is present in a single-target bundle and startup smoke passes for both renderer profiles.
- TUI typecheck, focused renderer tests, package checks, golden frames, structure check, and single-target build pass.
- MiniMax M3 architecture review and Qwen 3.8 Max QA results are recorded with dispositions.
- The Kimi Code/pi-tui reference review and phased adoption matrix are recorded.

## 8. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Compiled chunks retain an old self-import | Scan JavaScript, declarations, scripts, and built output for legacy package IDs. |
| Solid runtime duplication | Externalize the consolidated root/subpaths consistently and preserve one `solid-js` module instance. |
| Native target path changes | Keep the core at the package root during Phase 1 and exercise resolver tests plus packed startup. |
| Lockfile mixes unrelated work | Preserve existing worktree changes and stage only migration-specific lockfile hunks. |
| Rebrand obscures third-party lineage | Keep MIT licenses, upstream version/hash manifest, `UPSTREAM.md`, and NOTICE references. |
| Package move becomes a renderer rewrite | Freeze behavior with existing contracts and defer source/terminal redesign to separately gated phases. |
