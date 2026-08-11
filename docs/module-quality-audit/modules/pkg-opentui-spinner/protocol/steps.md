# 9-Step Review — pkg-opentui-spinner

Reviewer: ax-code-glm (model `zai-coding-plan/glm-5.2[1m]`)
Unit: `pkg-opentui-spinner` — `packages/opentui-spinner`
Baseline commit: `994f9287e497666e104644eccea299595a35b39a`
Files read: `packages/opentui-spinner/src/index.ts`, `packages/opentui-spinner/src/presets.ts`, `packages/opentui-spinner/src/solid.ts`, `packages/opentui-spinner/src/utils.ts`, `packages/opentui-spinner/package.json`, `packages/opentui-spinner/README.md`, `packages/opentui-spinner/tsconfig.json`, `packages/ax-code/test/cli/tui/opentui-spinner.test.ts`.

## Step 1 Scope and source map

The unit ships four TypeScript source files totaling ~465 LOC behind the `@ax-code/opentui-spinner` package (see `packages/opentui-spinner/package.json:1-32`). The barrel at `packages/opentui-spinner/src/index.ts:1-11` re-exports the public surface: `SpinnerRenderable`, `SpinnerOptions`, the preset helpers (`getSpinnerPreset`, `getSpinnerNames`, `randomSpinner`, `presets`), and the color utilities (`createPulse`, `createWave`, `createStatic`, `createRainbow`) plus the `ColorGenerator` type. `packages/opentui-spinner/src/presets.ts:16-117` declares 40 named presets under an `as const satisfies Record<string, SpinnerPreset>` block; `packages/opentui-spinner/src/solid.ts:1-10` is a side-effecting SolidJS registration subpath exposed via the `./solid` export at `package.json:17-22`. Workspace dependencies are exactly two: `@ax-code/opentui-core` and `@ax-code/opentui-solid` (`package.json:28-31`). No third-party runtime deps. `tsconfig.json:1-19` enforces `strict: true` and `verbatimModuleSyntax: true`.

## Step 2 Threat and failure model

The unit's only risk tag is `ui` (MODULE-AUDIT line 10), and the source confirms it: no filesystem, network, process spawn, env, or secret handling anywhere in the four files. The single native FFI touchpoint is `this._lib = resolveRenderLib()` initialized as a field at `packages/opentui-spinner/src/index.ts:44` and consumed by `_encodeFrames` (`index.ts:88-95`) and `_freeFrames` (`index.ts:97-103`). The lifecycle hazard is the `setInterval(...)` timer scheduled in `start()` at `packages/opentui-spinner/src/index.ts:192-196`: the closure holds a strong reference to `this`, so if `destroySelf()` (which calls `this.stop()` at `index.ts:234-238`) is never invoked, the renderable and its encoded frame handles are retained indefinitely. There are no empty catch blocks (MODULE-AUDIT line 26-29 confirms zero across all four files).

## Step 3 Correctness of public surfaces

The constructor at `packages/opentui-spinner/src/index.ts:56-84` throws on unknown preset (`index.ts:61-63`) and on non-positive interval (`index.ts:73-75`). The setters diverge: the `interval` setter at `index.ts:119-125` silently returns on `value <= 0` (line 120); the `name` setter at `index.ts:131-148` silently returns when `getSpinnerPreset(value)` is undefined (line 134); the `frames` setter at `index.ts:154-160` swallows an empty array and substitutes `DEFAULT_FRAMES` (line 156). This constructor-throws / setter-no-ops asymmetry means callers cannot detect invalid input after construction. In `renderSelf` (`index.ts:213-232`) the per-glyph advance uses `glyph.width` from the encoded handle (line 230), but the layout `width` is computed by `_computeWidth` (`index.ts:105-111`) using `frame.length` (UTF-16 code units), not the unicode display width — the two widths are computed by different rules, which is a latent inconsistency for any future preset containing astral-plane glyphs. The `createPulse` generator at `packages/opentui-spinner/src/utils.ts:35-39` ignores `charIndex`/`totalChars` entirely, so it is per-frame rather than per-character despite the `ColorGenerator` contract documented at `utils.ts:4-12` and `README.md:9`.

## Step 4 Performance and hot paths

Frame encoding is cached once per frame string in `_encodedFrames` (`packages/opentui-spinner/src/index.ts:43, 88-95`), so the native `encodeUnicode` call is not repeated per render tick — good. The animation tick at `index.ts:192-195` is a single modulo and a `requestRender()`, which is the irreducible minimum for a spinner. The hottest loop is `renderSelf` (`index.ts:222-230`): for every glyph it calls `parseColor(resolvedColor)` AND `parseColor(this._backgroundColor)` on line 229. The background is constant across the frame and could be parsed once outside the loop; for presets like `bouncingBar` (6 glyphs × 16 frames at 80 ms) or `aesthetic` (7 glyphs) this is a measurable but non-critical per-frame cost. The `typeof this._color === "function"` branch on line 226 is also evaluated per glyph rather than hoisted. None of these are bottlenecks at terminal frame rates, but they are easy wins.

## Step 5 Design and ownership boundaries

`SpinnerRenderable` is defined in `packages/opentui-spinner/src/index.ts:35-238` in the same file as the public barrel re-exports (lines 1-11). For a class this small (204 lines) co-locating with the barrel is defensible, but it mixes "module public API" with "primary implementation." The SolidJS glue at `packages/opentui-spinner/src/solid.ts:1-10` performs a side effect at module load (`extend({ spinner: SpinnerRenderable })` on line 10), mutating a shared registry in `@ax-code/opentui-solid`; this is the documented integration path (`README.md:59-65`) but means importing `./solid` is never side-effect-free. Presets are correctly modeled as `readonly` (`packages/opentui-spinner/src/presets.ts:9-14, 117`) and the `satisfies Record<string, SpinnerPreset>` clause at line 117 keeps the literal narrow while validating the shape. The dependency direction is clean: spinner → core/solid, never the reverse.

## Step 6 Hygiene and dead code

`_defaultOptions` declared at `packages/opentui-spinner/src/index.ts:47-54` is never read — the constructor at `index.ts:56-84` inlines all defaults (`options.interval ?? DEFAULT_INTERVAL`, `options.autoplay ?? true`, etc.) and never references `this._defaultOptions`. It is dead state. The `_freeFrames` loop at `index.ts:97-103` uses `for (const frame in this._encodedFrames)` (`for...in` over string keys); `Object.keys(this._encodedFrames)` would be idiomatic and avoid the prototype-chain scan, though the object has no prototype so this is cosmetic. In `packages/opentui-spinner/src/utils.ts:54` the `?? colors[0]!` fallback is unreachable when `totalChars > 0` because the preceding division guarantees an in-range index — defensive but provably dead in that branch. The README claim of "40 built-in presets" (`README.md:8`) matches the test at `packages/ax-code/test/cli/tui/opentui-spinner.test.ts:21` and the literal block at `presets.ts:16-117`.

## Step 7 Tests and verification coverage

The dedicated test file `packages/ax-code/test/cli/tui/opentui-spinner.test.ts:1-136` exercises `presets.ts` (lines 19-62) and `utils.ts` (lines 67-135) thoroughly — preset count, positive intervals, `randomSpinner` validity, `createPulse` speed clamping, `createWave` zero-`totalChars` guard, `createRainbow` hex format. However, `SpinnerRenderable` itself has zero direct test coverage: no test constructs the class, so `start`/`stop`/`reset`/`destroySelf`, the `name`/`interval`/`frames`/`color`/`backgroundColor` setters, `_encodeFrames`, `_freeFrames`, and `renderSelf` (`packages/opentui-spinner/src/index.ts:190-232`) are all untested. Critically, the asymmetric error paths identified in Step 3 (`index.ts:120` silent return, `index.ts:134` silent return, `index.ts:156` silent fallback) and the constructor throw paths (`index.ts:62`, `index.ts:74`) have no test assertions. The sibling files `spinner.test.ts` and `spinner-profile.test.ts` in the same directory test unrelated modules under `src/cli/cmd/tui/...`, not this package. Tests also import via relative path (`opentui-spinner.test.ts:6`) bypassing the package `exports` map, so the published `dist/` build (`package.json:7-23`) is never validated.

## Step 8 Finding register

No `findings/*.md` files exist for this unit (directory is empty). From the 9-step pass the actionable items, by severity:

- MEDIUM — Constructor/setter asymmetry: constructor throws on bad input (`packages/opentui-spinner/src/index.ts:61-63, 73-75`) but `interval`/`name`/`frames` setters silently no-op (`index.ts:120, 134, 156`). Recommendation: either throw from setters to match, or return a boolean, and add tests.
- MEDIUM — Layout width uses `frame.length` (UTF-16) in `_computeWidth` (`index.ts:105-111`) while `renderSelf` advances by encoded `glyph.width` (`index.ts:230`). Recommendation: derive `width` from the encoded handle max so both paths agree.
- LOW — Dead field `_defaultOptions` at `packages/opentui-spinner/src/index.ts:47-54` is never referenced. Recommendation: delete.
- LOW — `createPulse` ignores `charIndex`/`totalChars` (`packages/opentui-spinner/src/utils.ts:38`); README implies per-character behavior. Recommendation: align doc or implement per-character phase.
- LOW — `parseColor(this._backgroundColor)` re-parsed per glyph in `renderSelf` (`index.ts:229`); hoist outside the loop.
- LOW — No `SpinnerRenderable` lifecycle tests; add coverage for setters, throws, and `destroySelf` timer cleanup.
  No Critical items, so no `reverify.md` is required from this primary pass.

## Step 9 Verification and exit

Recommended verification commands for `pkg-opentui-spinner`:

- Typecheck the package: `pnpm --dir packages/opentui-spinner run typecheck` (note: the package `tsconfig.json:15` sets `noEmit: true`; the workspace-wide `pnpm run typecheck` aggregator also covers it).
- Run the dedicated test file: `AX_TEST_FILES=test/cli/tui/opentui-spinner.test.ts pnpm --dir packages/ax-code exec vitest run` (per `AGENTS.md` test-targeting convention).
- Build the package dist to validate the `exports` map that the tests bypass: `pnpm --dir packages/opentui-spinner build` if a build script is added (currently `package.json:1-32` declares no `scripts` block, so dist is produced by the workspace build pipeline rather than per-package).
- Lifecycle/FFI sanity: a follow-up test that constructs `SpinnerRenderable` with a stub `RenderContext`/`RenderLib`, asserts `running` toggles on `start`/`stop`, and asserts the interval handle is cleared after `destroySelf`, would close the largest coverage gap.
  Static extract fingerprint `0b5db7fc2446fb7c` and source inventory match MODULE-AUDIT lines 15 and 26-29. No Critical findings, no `findings/` artifacts, dual-agent independent verification by `codex-sol` remains pending per MODULE-AUDIT line 90.
