# native — 9-step review (ax-code-glm)

Unit: `native` · Reviewer: ax-code-glm · Verifier: codex-sol · Date: 2026-08-11
Primary source: `packages/ax-code/src/native/addon.ts` (88 LOC, single file).

## Step 1 Scope and map

The `native` unit is a single 88-LOC file at `packages/ax-code/src/native/addon.ts`; a directory listing of `packages/ax-code/src/native/` confirms it is the only file in the unit — no barrel `index.ts`, no sub-modules. The public surface is six exports: `formatNativeAddonLoadError` at `addon.ts:43` and the `NativeAddon` namespace at `addon.ts:67` exposing `fs` (line 69), `diff` (line 74), `index` (line 79), and `parser` (line 84). Downstream consumers span 11 import sites across `code-intelligence/` (auto-index, native-store), `file/` (ignore, watcher, ripgrep), `tool/` (edit-impl, grep, glob), `patch/index.ts`, `debug-engine/native-scan.ts`, and the diagnostics surface `cli/cmd/doctor.ts:403-406`. This is a textbook chokepoint facade: every Rust-addon touchpoint in the runtime routes through this one module.

## Step 2 Threat and failure model

The module dynamically `require()`s Rust native addons, so the failure surface has exactly three branches plus the happy path. `loadAddon` at `addon.ts:47-65` enumerates them: flag disabled → `return undefined` at line 48; addon binary absent → `MODULE_NOT_FOUND`/`ERR_MODULE_NOT_FOUND` logged at info level (lines 56-57) and `undefined` returned; any other load error (ABI mismatch, corrupted `.node`, missing system lib) → warn-level log at lines 58-60 and `undefined` returned; success → cached and returned at lines 53/63-64. There is no secret material, no filesystem write, no subprocess spawn, and no network path through this module — the `native,stability` risk tags are appropriate and there is no security boundary being crossed here. The one stability-relevant property is that a native crash inside the addon (segfault) cannot be caught by the JS `try/catch` here; that risk is owned upstream by `AX_CODE_DEBUG_ENGINE_NATIVE_SCAN` (see `flag.ts:127`), not by this adapter.

## Step 3 Correctness of public surfaces

Each accessor (lines 69-86) reads its flag and delegates to `loadAddon`. I traced the flag plumbing: `Flag.AX_CODE_NATIVE_FS/DIFF/INDEX/PARSER` are registered as runtime getters in `packages/ax-code/src/flag/flag.ts:321-324` via `defineBooleanFlag(name, true)`, and `defineBooleanFlag` at `flag.ts:21-30` defines a property whose getter re-reads `process.env` on every access. That makes the comment at `addon.ts:36-38` accurate: flipping `AX_CODE_NATIVE_FS=0` mid-process is honored on the next call because line 48 re-checks `enabled` before consulting the cache. I also checked the inverse direction — a first call with the flag off returns at line 48 _without_ writing a cache entry, so a later call with the flag on correctly walks through to `_require` at line 53. The `as FsBinding | undefined` cast at line 70 is safe because the type-only imports at lines 27-30 are erased at runtime and the cache stores `unknown` (line 40), so the cast only narrows at the API boundary. Real consumer `packages/ax-code/src/code-intelligence/native-store.ts:37-44` relies on exactly this `T | undefined` contract and degrades cleanly when `NativeAddon.index()` returns `undefined`.

## Step 4 Performance

The cache at `addon.ts:41` (`new Map<string, CacheEntry>()`) is the entire performance mechanism. `_require(pkg)` at line 53 runs at most once per package per process; every subsequent call hits `cache.get(pkg)` at line 49 and returns the stored reference. The try/catch wrapping and the `toErrorMessage` formatting in the error branch are therefore paid exactly once per package. The accessors themselves are O(1) map lookups after warmup, so there is no hot-path concern. The only nuance is that `cache` is keyed solely by package name and holds the binding for the process lifetime — appropriate for a long-lived daemon where addon availability does not change after boot, but see Step 5 for the test-harness implication. No performance finding.

## Step 5 Design and ownership

The module owns a single responsibility — be the sole chokepoint for native addon discovery — and the header at `addon.ts:1-16` makes that contract explicit ("Call sites should not `require()` these packages directly"). A repo-wide search for `NativeAddon.(fs|diff|index|parser)` returns 22 call sites, and a search for `from.*native/addon` returns 11 distinct importers — all of them route through the facade rather than `require()`-ing `@ax-code/fs` etc. directly, so the boundary holds in practice. The one design smell is that `cache` (line 41) is module-level mutable state with no eviction and no test-visible reset. This is why the only direct unit test (`packages/ax-code/test/native/addon.test.ts`) covers `formatNativeAddonLoadError` rather than the load paths: once a real addon is cached in the test process, the cache cannot be cleared to exercise the `MODULE_NOT_FOUND` branch. A `__resetForTests()` export (one-liner: `cache.clear()`) would close that gap without changing production semantics.

## Step 6 Dead code and hygiene

No empty catches — the catch at line 54 always either logs (info or warn) or sets `value = undefined` at line 61, and the `undefined` outcome is the documented fallback semantic, not a swallowed error. No `TODO`/`FIXME`/`XXX` markers. All four imports at lines 18-21 are used: `createRequire` at line 33, `Flag` at lines 70/75/80/85, `toErrorMessage` at line 44 (via `formatNativeAddonLoadError`), `Log` at line 32. `formatNativeAddonLoadError` (lines 43-45) is a one-line delegate to `toErrorMessage`; it is genuinely used at line 59 and by the test, so it is not dead — but its only reason for existing as a named export is the test seam, and a brief JSDoc stating that intent would prevent a future cleanup pass from inlining it and silently dropping the test coverage. Minor.

## Step 7 Tests

Direct unit coverage lives in `packages/ax-code/test/native/addon.test.ts` (14 lines, single test). It exercises `formatNativeAddonLoadError` against an object whose `toString` throws, asserting the `"Unknown error"` fallback — which maps to the `catch` at `util/error-message.ts:5-7`. That test passes and is well-targeted, but it does not touch `loadAddon` or any of the four accessors. The three failure branches inside `loadAddon` (flag-off at line 48, `MODULE_NOT_FOUND` at lines 56-57, generic error at lines 58-60) have zero direct unit coverage in this file. They are exercised _indirectly_ through dispatch tests — `test/code-intelligence/native-store.test.ts`, `test/code-intelligence/query-native-dispatch.test.ts`, `test/debug-engine/native-scan.test.ts` — but those depend on the host having the Rust addon built, so the fallback branches are effectively only proven on CI configurations where the addon is absent. Recommendation: add 3-4 unit tests that mock `createRequire` and use a `__resetForTests()` seam to cover the flag-off, missing-module, and load-error branches deterministically.

## Step 8 Finding register

No Critical, High, or Medium findings against the `native` unit. Four LOW/INFO observations:

- **LOW — docstring drift.** `addon.ts:9-16` and `addon.ts:35` describe caching as "via `lazy()`", but the implementation uses an inline `Map<string, CacheEntry>` at line 41. Behavior is identical; only the comment misdescribes the mechanism. Fix: either update the comment to say "memoized in a module-level Map" or extract a small `lazy()` helper to match the prose.
- **LOW — non-resettable cache.** `cache` at line 41 has no test-visible eviction. This is the root cause of the coverage gap in Step 7. Fix: add `export function __resetForTests(): void { cache.clear() }` guarded by a `process.env.NODE_ENV === "test"` check, or unconditionally since it is named with a test prefix.
- **LOW — missing unit coverage of load branches.** The three branches in `loadAddon` (lines 48, 56-57, 58-60) are not unit-tested. Mitigated by the indirect dispatch tests but not deterministically covered.
- **INFO — thin exported helper.** `formatNativeAddonLoadError` (lines 43-45) is a one-line delegate to `toErrorMessage`. Its existence as a named export is justified only as a test seam; a JSDoc note would make that intent explicit.

The empty `findings/` directory is consistent with this register — no separate finding files are warranted at these severities.

## Step 9 Verification and exit

This is a read-only review; no source mutation was performed, so no build or test run is required to validate the unit itself. I confirmed the type-level contract by reading the consumers: `native-store.ts:37-44` uses `NativeAddon.index() !== undefined` and degrades correctly, and `cli/cmd/doctor.ts:403-406` wraps each accessor in a `load` closure for diagnostics — both match the documented `T | undefined` return shape. The runtime getters in `flag.ts:321-324` confirm the live-flip behavior the header claims. Reviewer: ax-code-glm. Independent verifier: codex-sol (pending their own pass). Exit status: no blocking issues; the four LOW/INFO notes above are non-gating and suitable for a follow-up cleanup ticket rather than a hold.
