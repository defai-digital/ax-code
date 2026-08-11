# Protocol steps — unit `pkg-script`

## Step 1 Scope and Public Contract

The `pkg-script` runtime surface is one ESM export: `packages/script/package.json:13-15` maps the package root to `packages/script/src/index.ts`, where `Script` exposes channel, version, preview, release, and team getters (`packages/script/src/index.ts:48-64`). The adjacent `packages/script/sst-env.d.ts:1-10` is generated ambient SST wiring and adds no runtime export. The audit inventory identifies the same two candidate source files at `docs/module-quality-audit/modules/pkg-script/MODULE-AUDIT.md:20-30`.

## Step 2 Inputs and Trust Boundaries

Four process variables are snapshotted once at module evaluation (`packages/script/src/index.ts:7-12`). If none selects a channel, Git is invoked through `execFileSync` with a fixed argv array rather than a shell (`packages/script/src/index.ts:13-18`), avoiding command interpolation. The module also performs an HTTPS request to GitHub (`packages/script/src/index.ts:24-30`) and reads the fixed repository path `.github/TEAM_MEMBERS` (`packages/script/src/index.ts:38-46`); `.github/TEAM_MEMBERS:1-3` contains one reviewed username. The final log emits release metadata and team names, but no credential-valued environment variable (`packages/script/src/index.ts:65`).

## Step 3 Version and Flag Correctness

An explicit version has one leading `v` removed (`packages/script/src/index.ts:21-23`), and latest-release bumps apply major, minor, or default patch arithmetic (`packages/script/src/index.ts:31-35`). A direct probe with `AX_CODE_VERSION=v1.2.3` produced version `1.2.3`, channel `latest`, and `preview=false`. Two edge cases remain. First, `CHANNEL` is inserted into a prerelease string without normalization (`packages/script/src/index.ts:13-23`); probing `AX_CODE_CHANNEL=feature/release` produced `0.0.0-feature/release-...`, which `semver.valid` rejected. Second, `release` uses string truthiness (`packages/script/src/index.ts:58-60`), so even `AX_CODE_RELEASE=false` evaluates to `true`. The current workflow supplies the intended literal `"true"` (`.github/workflows/release.yml:228-234`), limiting production exposure of the latter case.

## Step 4 Latency and Resource Behavior

Module evaluation is eager: channel discovery can synchronously spawn Git (`packages/script/src/index.ts:13-18`), version discovery can await the GitHub API (`packages/script/src/index.ts:21-36`), team loading synchronously reads disk (`packages/script/src/index.ts:38-46`), and logging always runs (`packages/script/src/index.ts:65`). The API request checks HTTP status but has no abort deadline (`packages/script/src/index.ts:24-30`), so a stalled network can delay every importer in the bump-without-explicit-version path. Normal release CI avoids that request by setting `AX_CODE_VERSION` (`.github/workflows/release.yml:228-234`). Memory use is bounded to one small response object and the short team list.

## Step 5 Ownership and Consumer Integration

Centralizing release channel and version derivation in `@ax-code/script` keeps callers consistent: `script/version.ts:3-18` consumes version and preview for GitHub release setup, while npm publishing passes the computed channel as its distribution tag in `packages/plugin/script/publish.ts:29-33` and `packages/sdk/js/script/publish.ts:33-39`. The package contract itself is compact (`packages/script/src/index.ts:48-64`), although the `team` and `release` getters have no repository consumers found outside their declaration, and `semver` is declared in `packages/script/package.json:6-8` without being imported by the package. Those are cleanup opportunities rather than runtime failures.

## Step 6 Failure Handling and Hygiene

Git execution, team-file reading, and JSON decoding are allowed to fail loudly (`packages/script/src/index.ts:17`, `packages/script/src/index.ts:24-30`, `packages/script/src/index.ts:39-46`), which is appropriate for release metadata that must not be silently fabricated. The remote payload is typed `any` at `packages/script/src/index.ts:29`; a malformed tag then degrades missing or nonnumeric components to zero through `Number(x) || 0` (`packages/script/src/index.ts:31-35`) instead of validating semantic-version shape. No catches, TODO markers, or suppression comments occur in the runtime file. The only suppressions are generated-file directives in `packages/script/sst-env.d.ts:1-5`, followed by the expected SST type import at `packages/script/sst-env.d.ts:7-10`.

## Step 7 Test Evidence and Coverage Gaps

The audit lists repository tests with `script` in their paths (`docs/module-quality-audit/modules/pkg-script/MODULE-AUDIT.md:32-47`), but none directly exercises the exported getters or import-time branches. Behavioral subprocess probes covered explicit-version normalization, preview derivation, release-flag coercion, team loading, and semver validation against a slash-containing channel; they exposed the two edge cases in Step 3. `packages/script/tsconfig.json:3-23` was checked with `pnpm exec tsc -p packages/script/tsconfig.json --pretty false` and passed. Dedicated tests should isolate fresh module processes for each environment combination and mock GitHub, Git, clock, and the team file.

## Step 8 Audit Register Reconciliation

The existing register states `_none accepted_` at `docs/module-quality-audit/modules/pkg-script/MODULE-AUDIT.md:61-65`, and the reviewed `docs/module-quality-audit/modules/pkg-script/findings/` directory is empty. This review nevertheless records the unsanitized preview channel as a release-reliability concern and false-string coercion as a configuration-footgun concern, both evidenced at `packages/script/src/index.ts:13-23` and `packages/script/src/index.ts:58-60`. Neither is Critical: the observed outcomes are invalid preview metadata or an incorrectly enabled flag under a misconfigured environment, with no demonstrated code execution, credential exposure, or data loss. Therefore no `protocol/reverify.md` is required.

## Step 9 Verification and Exit Assessment

`pnpm exec tsc -p packages/script/tsconfig.json --pretty false` passed, and `pnpm run check:structure` reported no package boundary violations or dependency cycles; the relevant export and dependency declarations are at `packages/script/package.json:6-15`. `pnpm run test:scripts` ran but failed only the three documentation-navigation assertions in `script/docs-navigation.test.ts:54`, `script/docs-navigation.test.ts:75`, and `script/docs-navigation.test.ts:87`; those failures are outside this package's runtime behavior. With the direct probes and static review complete, the nine-step `pkg-script` review is complete while retaining the test-gap and two non-Critical correctness observations above.
