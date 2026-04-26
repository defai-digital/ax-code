# PRD: Source + Bun Distribution Rollout

**Date:** 2026-04-25
**Status:** Phase 0 + Phase 1 implemented (dual-publish wired but not yet released)
**Scope:** Internal
**Last reviewed:** 2026-04-25
**Owner:** ax-code agent
**Related:** `automatosx/adr/ADR-002-distribution-source-plus-bun.md`

## Implementation Note (2026-04-25): bundle, not raw source

The PRD originally said "ship raw source files and rely on `bun run`". After spike validation it was simpler to ship a `Bun.build()` bundle (no `--compile`) instead. Reasoning:

- Avoids resolving `pnpm-workspace.yaml` `catalog:` refs at publish time
- Avoids resolving workspace deps (`@ax-code/util`, `@ax-code/plugin`, etc.)
- Tarball is 5.2 MB packed / 33.5 MB unpacked (vs ~80 MB if shipping raw source + node_modules tree)
- Reuses the existing `Bun.build()` configuration from `packages/ax-code/script/build.ts` minus the `compile:` block — proven path with one explicit thing removed
- The bug class ADR-002 retires is `bun build --compile` × Worker; plain `bun build` (without compile) does not trigger bunfs and is unaffected by the bug class
- Migrations and models snapshot are embedded into the bundle via `define` constants exactly as the compiled build does — bundle is fully self-contained

Trade-offs accepted:
- Stack traces show bundled output (mitigated by source maps if/when needed)
- Subtle behavioral difference from contributor source launcher (which runs raw .ts), but the underlying runtime is the same Bun version
- The opentui parser worker (`node_modules/@opentui/core/parser.worker.js`) must be staged into a local path before passing to `Bun.build` so output stays under outdir; build-source.ts handles this

---

## Purpose

Turn the ADR-002 phased rollout into an executable spec. Phase 0 has shipped (foundation refactor, runtimeMode telemetry, ADR + tests). Phase 1+ is the work that actually changes what brew/npm publish, and must be reviewed before execution.

## Out of Scope

- Re-evaluating ratatui (handled by future revision of ADR-001)
- OpenTUI rendering bugs (handled separately as the "opentui hardening as mainline investment" lane in `project_tui_migration_strategy.md`)
- Single-binary distribution as a feature (intentionally retiring per ADR-002)

## Phase 0 — Done

- `packages/ax-code/script/source-launcher.ts` — extracted `sourceLauncherScript()` for reuse
- `packages/ax-code/src/installation/runtime-mode.ts` — `compiled` / `source` / `bun-bundled` / `unknown` detection
- `DiagnosticLog` manifest carries `runtimeMode`; `doctor` shows it in the Runtime line
- Tests under `packages/ax-code/test/script/source-launcher.test.ts` and `packages/ax-code/test/installation/runtime-mode.test.ts`
- ADR-002 + index update

Phase 0 is shipping-safe and can land independently.

## Phase 2 — Done (wired, not released)

- `.github/scripts/update-homebrew-source.sh` — generates a separate `ax-code-source.rb` formula. Pulls the published npm tarball (with retry to handle CDN propagation lag), verifies sha256 cross-platform (`sha256sum` on Linux, `shasum -a 256` on macOS), pushes to the tap repo as a sibling file (does NOT modify `ax-code.rb`).
- `.github/workflows/release.yml` — added `homebrew-source` job. Gated on `publish-source` success, skipped on prerelease tags (mirrors existing `homebrew` job rules).
- 10 tests in `test/script/homebrew-source.test.ts`: script exists/executable, npm registry URL pattern, retry logic, cross-platform sha256, shim shape (`AX_CODE_ORIGINAL_CWD` + `bundle/index.js` + `Formula["bun"].opt_bin`), additivity (existing compiled formula untouched), CI gating.

Critical: Phase 2 is **additive**. Existing `defai-digital/ax-code/ax-code` formula keeps shipping the compiled binary. New `defai-digital/ax-code/ax-code-source` formula is opt-in for early testers. ADR-002 Phase 3 will swap the default later.

User-facing opt-in:
```sh
brew install defai-digital/ax-code/ax-code-source
```

## Phase 1 — Done (wired, not released)

- `packages/ax-code/script/build-source.ts` — `Bun.build()` without `--compile`, flat-named output to `dist-source/bundle/`
- `packages/ax-code/script/publish-source.ts` — assembles tarball staging dir, generates source-distribution `package.json` (bun as regular dep, no other runtime deps), writes sh+cmd shims with symlink resolution and a postinstall that records the resolved bun path
- `.github/workflows/release.yml` — added `publish-source` job in parallel to existing `build`/`publish`. Compiled flow unchanged. Source job publishes under `source` npm dist-tag.
- `.github/workflows/install-matrix-smoke.yml` — 6-platform × 2-channel post-release smoke; asserts `runtimeMode` matches the channel; runs `--version`, `doctor`, and a non-interactive command.
- `.gitignore` — `dist-source/` added so build artifacts don't pollute git
- 13 tests in `test/script/publish-source.test.ts` covering: dist-tag default, no-compile invariant, bun as regular dep (not optional), shim symlink resolution, postinstall skip env var, manifest shape

End-to-end validation done locally on macOS arm64:
- `AX_CODE_DRY_RUN=1 bun run script/publish-source.ts` produces a 5.2 MB tarball
- `npm install <tarball>` into a clean dir succeeds
- Installed `ax-code --version` prints the published version
- Installed `ax-code doctor` reports `Runtime: Bun 1.3.13 (bun-bundled)` — runtimeMode telemetry working

Not yet validated:
- Other platforms — covered by install-matrix smoke once a tag actually publishes
- Native addons — currently stripped from the bundle (JS fallback used). Phase 1.6 if needed.

## Phase 1 — Source-distribution npm package (dual-publish)

### Goal

Ship `@defai.digital/ax-code` under a new `source` npm tag in addition to the existing `latest` (compiled). Validate it on every supported platform via an install-matrix smoke workflow before flipping any defaults.

### Deliverables

#### 1.1 — `packages/ax-code/script/publish-source.ts`

Build a npm tarball that contains:

```
package/
├── package.json              # type: module, bin: { ax-code: ./bin/ax-code }, postinstall
├── bin/
│   ├── ax-code               # shim — runs bun against src/index.ts (uses sourceLauncherScript)
│   └── postinstall.mjs       # detect bun, fall back to optionalDeps, fail loud on miss
├── src/                      # entire source tree (excluding test/, node_modules/, dist/)
├── migration/                # SQL migrations (already imported at build time)
├── package-lock pieces       # production deps from packages/ax-code/package.json
└── LICENSE
```

Use the existing `script/build.ts` model-snapshot step to ensure the snapshot is committed/up-to-date before tarball generation. Do not embed bun itself in the tarball — defer that to the postinstall.

`type: module` is required so Node can parse the ESM `bin/ax-code` shim (matching the fix from `3c2bced`).

#### 1.2 — postinstall logic (`bin/postinstall.mjs`)

Deterministic order:

1. If `AX_CODE_SKIP_POSTINSTALL=1`, exit 0 (CI override).
2. If `bun` is on PATH (`which bun`), record the path in `.ax-code-bun-path` next to the shim. Done.
3. Else, look for a per-platform optional dependency `@oven/bun-${platform}-${arch}` in `node_modules/`. If present, point `.ax-code-bun-path` at its bundled bun binary.
4. Else, print a clear instruction to install bun (`curl -fsSL https://bun.sh/install | bash`) and exit 1.

Steps 2–3 mirror esbuild's per-platform pattern. The platform packages must be declared as `optionalDependencies` in `package.json`. Validate availability of `@oven/bun-darwin-arm64`, `@oven/bun-darwin-x64`, `@oven/bun-linux-x64`, `@oven/bun-linux-arm64`, `@oven/bun-linux-x64-musl`, `@oven/bun-linux-arm64-musl`, `@oven/bun-windows-x64`, `@oven/bun-windows-arm64` before relying on this — if any are missing or stale, fall back to a vendored bun via the curl installer in postinstall (accepts install-time network).

The shim (`bin/ax-code`) reads `.ax-code-bun-path` and execs `bun run --cwd <package> --conditions=browser src/index.ts "$@"`, preserving `AX_CODE_ORIGINAL_CWD` (use `sourceLauncherScript` from Phase 0).

#### 1.3 — `release.yml` source job

New job `publish-source` that runs after `typecheck` (parallel to `build`/`publish`):

```yaml
publish-source:
  needs: typecheck
  runs-on: ubuntu-latest
  permissions:
    contents: write
    packages: write
  steps:
    - uses: actions/checkout@v6
    - uses: pnpm/action-setup@v6
      with: { version: 9.15.9 }
    - uses: oven-sh/setup-bun@v2
      with: { bun-version: 1.3.12 }
    - run: pnpm install --frozen-lockfile
    - name: Publish source distribution
      run: cd packages/ax-code && bun run script/publish-source.ts
      env:
        NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
        NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
        AX_CODE_VERSION: ${{ github.ref_name }}
        AX_CODE_CHANNEL: source         # forces `npm publish --tag source`
```

Important: `script/publish-source.ts` must use a different npm dist-tag (`source`) so it does not collide with the compiled-binary `latest` flow. Beta and prerelease tags follow the same channel convention as the compiled flow.

#### 1.4 — Install-matrix smoke workflow (`.github/workflows/install-matrix-smoke.yml`)

Triggered after a release tag publishes. Matrix:

| OS | Arch | Channel | Source channel |
|---|---|---|---|
| macos-latest | arm64 | `latest` (compiled) | `source` |
| macos-13 | x64 | n/a (unsupported) | n/a (unsupported) |
| ubuntu-latest | x64 | `latest` | `source` |
| ubuntu-24.04-arm | arm64 | `latest` | `source` |
| ubuntu-latest (alpine container) | x64 | `latest` | `source` |
| windows-latest | x64 | `latest` | `source` |
| windows-11-arm | arm64 | `latest` | `source` |

Each cell:

1. `npm i -g @defai.digital/ax-code@<channel>`
2. `ax-code --version` — must print the published version
3. `ax-code doctor` — must report `runtimeMode = compiled` for `latest`, `source` or `bun-bundled` for `source`
4. `ax-code run "echo hello" --print` (or smallest possible non-interactive smoke) — must exit 0 within 30s

A failure in any source-channel cell **blocks Phase 3** (default flip).

#### 1.5 — Acceptance criteria for Phase 1

- `@defai.digital/ax-code@source` installs successfully on all 6 supported platforms in the install-matrix smoke
- `runtimeMode` correctly reports `bun-bundled` (or `source` if the user already had bun on PATH)
- No regression in compiled-channel installs (still `runtimeMode = compiled`)
- DiagnosticLog `runtimeMode` shows up in support telemetry

### Risks & mitigations (Phase 1)

- **`@oven/bun-*` packages may not exist or may be partial.** Validate with `npm view @oven/bun-darwin-arm64 versions` etc. before merging Phase 1. If unavailable, vendor bun via curl installer (network at install-time but proven mechanism).
- **Postinstall hangs in air-gapped CI.** Honor `AX_CODE_SKIP_POSTINSTALL=1` and document.
- **Linux musl detection.** Reuse `binary-selection.cjs` `detectMusl()` to pick the right `@oven/bun-linux-*-musl` package.
- **Windows shim must be `.cmd` not `.sh`.** `sourceLauncherScript({ windows: true })` already handles this.

## Phase 2 — Brew formula source variant

### Goal

Update the homebrew tap so `brew install defai-digital/ax-code/ax-code` installs the source-distribution form, depending on `bun`.

### Deliverables

#### 2.1 — `.github/scripts/update-homebrew.sh` rewrite

Replace the current binary-asset download with a source-tarball model:

```ruby
class AxCode < Formula
  desc "Sovereign AI coding agent"
  homepage "https://github.com/defai-digital/ax-code"
  version "<VERSION>"
  url "https://registry.npmjs.org/@defai.digital/ax-code/-/ax-code-<VERSION>.tgz"
  sha256 "<SHA>"

  depends_on "bun"
  depends_on "ripgrep"

  def install
    libexec.install Dir["*"]
    (bin/"ax-code").write <<~EOS
      #!/bin/sh
      AX_CODE_ORIGINAL_CWD="$(pwd)" exec #{Formula["bun"].opt_bin}/bun run --cwd "#{libexec}" --conditions=browser "#{libexec}/src/index.ts" "$@"
    EOS
    (bin/"ax-code").chmod 0755
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/ax-code --version")
  end
end
```

The url points at the npm tarball published by Phase 1 (`@source` tag) so the formula always tracks the source distribution, never the compiled subpackages.

#### 2.2 — Acceptance criteria for Phase 2

- `brew install defai-digital/ax-code/ax-code` works on macOS arm64 and Linux x64/arm64 (brew's two supported OS lines)
- `ax-code doctor` reports `runtimeMode = bun-bundled` (since brew installs bun via dependency)
- Formula passes `brew test ax-code` and `brew audit ax-code`

### Risks & mitigations (Phase 2)

- **brew users on macOS Intel are still unsupported** — keep the existing `odie "macOS Intel is not supported"` guard.
- **Dual formula migration** — coordinate with the tap maintainer on whether to keep the compiled formula at `defai-digital/ax-code/ax-code-compiled` for one cycle. Recommend yes for safety.
- **`bun` in `homebrew/core`** — verify it stays available; cap to a known-working `bun` version with `depends_on "bun" => "1.3.12"` if needed.

## Phase 3 — Flip default

After one release cycle of dual-publish with clean install-matrix smoke:

- `npm dist-tag add @defai.digital/ax-code@<version> latest` (the source-distribution version)
- Move the previous `latest` (compiled) to `compiled` tag
- Update README install instructions to show `npm i -g @defai.digital/ax-code` as the source path; document `npm i -g @defai.digital/ax-code@compiled` for legacy users
- Brew formula already pointed at source in Phase 2 — no change

### Decision gate for Phase 3

All four must hold for at least one full release cycle:

1. Install-matrix smoke green on all 6 platforms × source channel
2. No support reports for `runtimeMode = bun-bundled` install failures
3. Source-distribution package size confirmed within 80–120 MB (check before flip)
4. `runtimeMode` telemetry in DiagnosticLog shows source-channel users hitting fewer worker-related issues than compiled (the whole point of the migration)

If any fails, hold Phase 3 and remediate.

## Phase 4 — Retire compiled binary

After one further release cycle on default-source:

- Remove the `build` and `publish` jobs from `release.yml` (compiled binary)
- Stop publishing `@defai.digital/ax-code-${platform}-${arch}` subpackages
- Mark the `compiled` npm tag deprecated; keep the last-published version available for rollback for ≥6 months
- Optionally: remove `script/build.ts` and `bin/binary-selection.cjs` — but leave them in place if they cost nothing to keep, since they document the historical compile-binary path

### Decision gate for Phase 4

- ≥1 release cycle on default-source with no install regressions
- Tap maintainer confirms brew users have migrated successfully
- Telemetry shows < 5% of installs still on `compiled` tag (otherwise extend Phase 3 deprecation period)

## Rollback plan

At any phase, if the source distribution shows a critical regression:

- **Phase 1 (dual-publish):** stop running `publish-source` job; users on `source` tag stay on the last working version. No impact on `latest` users.
- **Phase 2 (brew):** revert tap formula to compiled-binary form (keep prior generation in tap repo history for one cycle).
- **Phase 3 (default flip):** `npm dist-tag add @defai.digital/ax-code@<old-compiled-version> latest`. Document in changelog. Move source distribution back to `source` tag.
- **Phase 4 (retired compiled):** harder — requires re-running compiled build pipeline. This is why Phase 4 should not happen for ≥2 release cycles after Phase 3, and `script/build.ts` is preserved.

## Open questions

- **Version pinning for `bun` dep:** lock to a specific bun version, or accept latest? Locking gives reproducibility but means we ship CVE exposure until we update; latest gives security patches but introduces a moving runtime.
  - Recommendation: pin minor (`^1.3.0`), update on each ax-code minor release.
- **Native addon shims (`packages/ax-code-{fs,diff,parser,terminal}-native`):** these are workspace-linked locally but must be packaged for source distribution. Verify the postinstall correctly resolves them, or pre-build them into the tarball.
  - Action: spike before Phase 1 to confirm.
- **Windows ctrl-c handling for source mode:** verify `win32InstallCtrlCGuard` behaves correctly when running under `bun run` (vs compiled binary it was tuned for).
  - Action: install-matrix smoke covers this.

## Phase 3 — Decision Gate Checklist (flip default)

Phase 3 cannot execute until **all** items below are satisfied. Document each with evidence (workflow run links, telemetry queries, registry tag inspections) before flipping any tag.

### Pre-flip evidence required

- [ ] `publish-source` job has run on **at least 2 stable release tags** (not betas) without failure. Verify in Actions history.
- [ ] `homebrew-source` job has run on **at least 2 stable release tags** without failure, and `defai-digital/homebrew-ax-code:ax-code-source.rb` exists in the tap repo with a current version.
- [ ] `install-matrix-smoke.yml` has run **green on the source channel for every supported platform cell** for the last 2 stable releases:
  - macOS arm64
  - Linux x64 glibc
  - Linux arm64 glibc
  - Linux musl x64 (alpine container)
  - Windows x64
  - Windows arm64 (source-only is acceptable)
- [ ] `runtimeMode` telemetry from `ax-code doctor` / DiagnosticLog manifests on the source channel shows **no install-time bun-detection failures** (postinstall fail rate < 0.5%).
- [ ] **Zero open critical-severity bug reports** filed against `@source` tag installs in the last release cycle.
- [ ] Package size of source tarball stays within **80–120 MB after install** (compressed + bun runtime). Check `du -sh node_modules/@defai.digital` after a `npm i -g @defai.digital/ax-code@source` install.
- [ ] README's "Source channel (early access)" section has been live for at least one release cycle (so opt-in users have had a chance to surface issues).

### Flip steps (when gates pass)

1. **npm dist-tag move** — first, capture the current latest version:
   ```sh
   npm view @defai.digital/ax-code dist-tags
   ```
2. Move the current `latest` (compiled) to the `compiled` tag for rollback:
   ```sh
   npm dist-tag add @defai.digital/ax-code@<current-latest-version> compiled
   ```
3. Promote the source tag's version to `latest`:
   ```sh
   npm dist-tag add @defai.digital/ax-code@<source-version> latest
   npm dist-tag rm  @defai.digital/ax-code source   # or keep `source` as an alias for one cycle
   ```
4. **Brew formula swap** — in the tap repo, atomic commit:
   - Rename `ax-code.rb` → `ax-code-compiled.rb`
   - Rename `ax-code-source.rb` → `ax-code.rb` (the new default)
   - Update class names accordingly (`AxCodeCompiled`, `AxCode`)
5. **Update `release.yml` and homebrew scripts** to reflect the new naming:
   - `update-homebrew.sh` now generates the source-distribution formula under `ax-code.rb`
   - `update-homebrew-source.sh` is renamed `update-homebrew-compiled.sh` and generates the rollback formula
6. **Update README** — remove the "Source channel (early access)" section (it's now the default install). Keep `@compiled` documented as the rollback path.
7. **Announce in changelog** — the `vX.Y.Z` release notes for the flip release must include:
   - "Default install now ships source + bun runtime instead of single binary"
   - "Rollback: `npm i -g @defai.digital/ax-code@compiled`" or "`brew install defai-digital/ax-code/ax-code-compiled`"
   - Pointer to ADR-002 for rationale

### Rollback (if Phase 3 reveals a regression)

Within one release cycle:
1. `npm dist-tag add @defai.digital/ax-code@<old-compiled-version> latest`
2. Revert the brew tap commit (tap repo `git revert`)
3. File a hold on the next stable release until the regression is fixed
4. Document the regression in PRD, hold Phase 3 re-attempt for 2+ release cycles

## Phase 4 — Decision Gate Checklist (retire compiled binary)

Phase 4 retires the compiled binary entirely. **Cannot execute until Phase 3 has been live for ≥ 2 stable release cycles.**

### Pre-retire evidence required

- [ ] Phase 3 default flip has been live for **≥ 2 stable release cycles** with no critical-severity regressions filed.
- [ ] `runtimeMode` telemetry shows **< 5% of `ax-code doctor` runs report `compiled`**. Use this as the proxy for `@compiled` tag traffic.
- [ ] No open issues citing the `@compiled` tag specifically as a current dependency. Search:
  ```
  is:issue is:open "ax-code@compiled" OR "ax-code-compiled"
  ```
- [ ] Brew tap maintainer has confirmed that no internal/team flows still depend on `ax-code-compiled`.
- [ ] At least one external Anthropic/Bun upstream fix (`oven-sh/bun#26762`, `#27766`, `#29124`) **has NOT** landed and been verified — i.e. the original bug class motivating ADR-002 has not been independently fixed. *If those fixes do land, reopen the architectural question before retiring compiled — single-binary distribution may become viable again.*

### Retire steps (when gates pass)

1. **release.yml**: remove the `build`, `publish`, and `homebrew-compiled` jobs. Remove the `homebrew` job's compiled-binary fallback path. The remaining jobs are `typecheck`, `publish-source`, `homebrew`. Worker count drops by ~5 platforms.
2. **`script/build.ts`**: Move to `script/build-compiled-archive.ts` with a clear deprecation header. Don't delete — preserves the option to rebuild a compiled binary for diagnostics or rollback. Update `setup-cli.ts --bundled` flag to point at this archive script.
3. **`script/publish.ts`**: Remove. Compiled platform subpackages are no longer published.
4. **`bin/ax-code` (Node wrapper)** and **`bin/binary-selection.cjs`**: Remove from the source distribution's tarball (they're already excluded by the `files:` array in `publish-source.ts`'s manifest). Keep in repo as documentation of the historical compile-binary install path.
5. **npm `@compiled` tag**: Mark the last published `@compiled` version as deprecated:
   ```sh
   npm deprecate @defai.digital/ax-code@<last-compiled-version> "ax-code now ships source + bun runtime by default. To rollback, install this version explicitly."
   ```
   Keep the version installable for ≥ 6 months.
6. **Brew `ax-code-compiled` formula**: Mark deprecated in tap README. Schedule removal at 6 months from Phase 4 ship date.
7. **Update changelog** with a "Deprecation" section listing what was retired and the deprecation timeline.

### Hard rollback from Phase 4 (if needed)

Phase 4 is intentionally non-destructive — `script/build.ts` and the compiled-binary CI matrix can be restored from git history within one release cycle. The forcing function: ADR-002 says "`script/build.ts` is preserved [as a rollback option]". Do not violate this until at least 6 months post-Phase 4.

## Execution rules

- **Do not start Phase 1 implementation** without explicit user signoff on this PRD.
- **Do not modify** `.github/workflows/release.yml`, `packages/ax-code/script/publish.ts`, or `.github/scripts/update-homebrew.sh` outside of phase-gated PRs.
- **Phase 1 must include** the install-matrix smoke workflow before its first dual-publish ships — Phase 3 cannot proceed without smoke evidence.
- **Each phase ends with written go/no-go evidence**, not just merged code.
