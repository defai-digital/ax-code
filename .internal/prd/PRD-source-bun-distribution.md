# PRD: Source + Bun Distribution Rollout

**Date:** 2026-04-25
**Last reviewed:** 2026-05-25
**Status:** In progress — Phases 0–2 implemented; Phase 3 gate decision pending
**Scope:** Internal
**Owner:** ax-code maintainers
**Related:** ADR-002 (distribution strategy — Accepted)
**Archive criteria:** Phase 3 gate flipped to source+bun as default; Phase 4 compiled binary retirement completed after ≥2 stable release cycles.

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

## Completed Phases (0–2)

All three phases are implemented and wired into CI. They have not yet gone through a production release cycle — that gate is Phase 3.

| Phase | What shipped | Key files |
|-------|-------------|-----------|
| Phase 0 | `sourceLauncherScript()` reuse, `runtimeMode` detection (`compiled`/`source`/`bun-bundled`/`unknown`), `doctor` display, ADR-002 | `script/source-launcher.ts`, `src/installation/runtime-mode.ts` |
| Phase 1 | `Bun.build()` bundle (no `--compile`), `publish-source.ts` tarball script, postinstall bun discovery, `release.yml` `publish-source` job, 6-platform × 2-channel install-matrix smoke | `script/build-source.ts`, `script/publish-source.ts`, `.github/workflows/release.yml`, `.github/workflows/install-matrix-smoke.yml` |
| Phase 2 | `update-homebrew-source.sh` generates additive `ax-code-source.rb` formula; `homebrew-source` CI job gated on `publish-source` success; existing `ax-code.rb` (compiled) untouched | `.github/scripts/update-homebrew-source.sh`, `.github/workflows/release.yml` |

**Opt-in install path (source channel, currently early-access):**
```sh
npm install -g @defai.digital/ax-code@source   # npm
brew install defai-digital/ax-code/ax-code-source  # homebrew
```

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
- [ ] Package size of source tarball stays within **80–120 MB after install** (compressed + bun runtime). Check `du -sh node_modules/@defai.digital` after a `npm i -g @defai.digital/ax-code-source` install.
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
