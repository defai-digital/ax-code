# Technical Specification: `packages/ax-code-tui`

| Field | Value |
| --- | --- |
| Status | Approved for implementation |
| Date | 2026-08-20 |
| PRD | `.internal/prd/PRD-2026-08-20-ax-code-tui.md` |
| ADR | `.internal/adr/ADR-058-ax-code-tui.md` |

## 1. Scope

This change performs a behavior-preserving physical and namespace consolidation. It does not change the renderer/native
baseline, introduce a second renderer, or convert the generated renderer snapshot to upstream source.

## 2. Target filesystem

```text
packages/ax-code-tui/
  package.json                 # @ax-code/tui, combined dependency/export map
  index.js / index.d.ts        # renderer root
  testing.js / testing.d.ts
  assets/
  vendor/
  patches/
  solid/
    index.js / index.d.ts
    jsx-runtime.*
    jsx-dev-runtime.*
    components.*
    scripts/
    src/
    patches/
  spinner/
    src/
    dist/
    tsconfig.json
    tsconfig.build.json
  UPSTREAM.md
  DIVERGENCES.md
```

Keeping renderer artifacts and `vendor/` at the package root preserves the current `import.meta.url`-relative native and
tree-sitter asset resolution. Solid and spinner move below stable subpath exports.

## 3. Package manifest

The root manifest is the union of the three runtime dependency sets, excluding the old internal workspace dependencies.
Build-only spinner TypeScript dependencies stay in `devDependencies`; Solid remains a peer resolved by the application.

Required exports:

```text
.
./testing
./runtime-plugin
./runtime-plugin-support
./runtime-plugin-support/configure
./yoga
./tree-sitter/update-assets
./parser.worker
./solid
./solid/preload
./solid/bun-plugin
./solid/transform
./solid/runtime-plugin-support
./solid/runtime-plugin-support/configure
./solid/components
./solid/jsx-runtime
./solid/jsx-dev-runtime
./spinner
./spinner/solid
```

The runtime-plugin and asset-maintenance exports remain temporarily because existing distribution/source-mode checks use
them. They should be removed only through a separate usage audit.

## 4. Mechanical import map

Replacement order matters so spinner subpaths do not become malformed:

1. `opentui-spinner/solid` → `@ax-code/tui/spinner/solid`
2. `opentui-spinner` → `@ax-code/tui/spinner`
3. `@opentui/solid` → `@ax-code/tui/solid`
4. `@opentui/core` → `@ax-code/tui`

The replacements apply to TypeScript, TSX, JavaScript, declarations, scripts, tests, build fixtures, and documentation.
Upstream provenance prose is updated manually rather than blindly erased.

## 5. Solid build integration

- `packages/ax-code/tsconfig.json` sets `jsxImportSource` to `@ax-code/tui/solid`.
- `script/solid-loader.mjs` resolves Babel dependencies from `@ax-code/tui/solid` and emits that module name.
- Node bundle transformation imports `@ax-code/tui/solid/transform`.
- Esbuild externalizes `@ax-code/tui` and its runtime subpaths so core and Solid share the same external `solid-js`
  instance and native assets remain file-backed.

## 6. Release staging

`build-node-tui.ts` must:

1. read one TUI manifest;
2. derive one combined runtime dependency set;
3. copy one `@ax-code/tui` workspace package;
4. rewrite its copied manifest so pruned build/type entries and Babel dependencies are not advertised;
5. preserve patched source verification;
6. prune `dist/node_modules/@ax-code/tui/vendor` to the requested target;
7. assert no extra target library remains.

Native fetch/check automation targets `packages/ax-code-tui/vendor`. The manifest continues to record the actual
upstream packages and filenames for license and reproducibility purposes.

## 7. Patch and divergence governance

Current required divergences:

| ID | Purpose | Guard |
| --- | --- | --- |
| `ffi-pointer-pin` | Keep Node FFI pointer owners reachable through synchronous native consumption. | Focused pointer-pin test |
| `ffi-geometry-guard` | Sanitize negative/fractional cell geometry before strict Node FFI marshaling. | Coordinate-guard test |
| `vendored-native-resolver` | Resolve hash-pinned offline native libraries from the package. | Resolver test |
| `drop-zig-parser` | Do not ship an unused parser asset. | Patch/package check |
| `slim-solid-catalogue` | Do not register unused Solid renderables. | Surface check |
| `ax-runtime-identity` | Use AX names for JS flags, plugin IDs, and worker globals while retaining native ABI keys. | Patch and identity check |

The patch applier is renamed to AX terminology but may mention OpenTUI inside provenance and upstream matching logic.

## 8. Naming policy

Active names:

- scripts: `vendor:tui-native`, `check:tui-vendor`, `apply:tui-patches`, `check:tui-patches`, `check:tui-package`;
- package test group: `tui-renderer`;
- libc override: `AX_CODE_TUI_LIBC`;
- runtime/package labels: AX Code TUI.

Allowed legacy word occurrences are limited to third-party licenses, upstream URLs/package names in the vendor manifest,
provenance, and code that matches the imported upstream artifact. They are not allowed in application imports or active
AX command names.

## 9. Verification matrix

### Package and static

- spinner build and checked-in distribution parity;
- TUI patch and native manifest checks;
- workspace structure check;
- AX Code typecheck;
- import/export surface test;
- legacy import/name scan.

### Renderer behavior

- FFI coordinate guard;
- FFI pointer pin;
- vendored native resolver;
- spinner lifecycle/render test;
- renderer contract;
- golden frames and TUI snapshot;
- compatible and advanced startup smoke.

### Distribution

- `pnpm --dir packages/ax-code run build -- --single`;
- inspect staged `@ax-code/tui` contents and native target count;
- execute bundled CLI startup smoke where supported.

## 10. Commit isolation

The worktree contains unrelated VS Code integration changes. Implementation must not rewrite or revert them. Shared
workspace/lockfile changes are reviewed and staged by hunk so the TUI commit includes only the new importer/package
topology. The final push is allowed only after the staged diff is independently reviewed.
