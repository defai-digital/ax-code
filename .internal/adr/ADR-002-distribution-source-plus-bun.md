# ADR-002: Distribute source + bun runtime instead of `bun build --compile` binary

**Status:** Accepted
**Date:** 2026-04-25
**Deciders:** (to be filled by team)
**Supersedes:** None
**Related:** ADR-001 (historical ratatui migration decision), ADR-003 (OpenTUI + Bun mainline hardening)

---

## Context

`brew install` and `npm i -g @defai.digital/ax-code` ship a `bun build --compile` single binary. Users on these channels have hit TUI startup hangs that users running from source via `pnpm setup:cli` have not. The asymmetry is reproducible and the root causes are documented:

- **Bun compile × Worker upstream bugs:** `oven-sh/bun#26762`, `#27766`, `#29124`. Same bug class hits opencode (`#12834`) and Claude Code (`#18532`). The TUI thread spawns a Bun Worker for the backend; in compiled-binary mode that Worker subsystem has timing/lifecycle issues `bun run` does not exhibit.
- **`AX_CODE_WORKER_PATH` bunfs path bug** (`packages/ax-code/script/build.ts`, fixed in commit `3c2bced`): the worker entrypoint was a relative path that resolved against the host CWD instead of the embedded `/$bunfs/root/`. Fixed, but the fix depends on undocumented Bun internal layout (`/$bunfs/root/`, `B:/~BUN/root/`).
- **Other bunfs/compile edge cases** (timer drift, `fetch` lifecycle, `import.meta` corner cases) — these are speculative but consistent with a class of issues that the contributor source path simply does not hit.

Mitigations already in tree:

- `v4.0.13` (`43bef46`): `pnpm setup:cli` defaults to source launcher for contributors, citing the upstream bugs above. This proved the source path is stable.
- `71bda65`: 10 s bootstrap timeout, fail-fast worker error, removed blocking OSC color probe — these stop the compiled-binary failures from looking like infinite hangs.

Strategic constraints that make this decision urgent now:

- The v4.1.0 ratatui migration plan in **ADR-001** anticipated replacing the OpenTUI/Worker rendering path, which would have eliminated the Bun-Worker exposure indirectly. That plan is no longer viable: ratatui has been prototyped and rejected on UI/UX grounds. Even sidebar-only ratatui was evaluated and rejected — the hybrid-renderer cost (cursor/color/resize/mouse coordination plus dual maintenance surface) does not justify the partial benefit, and it does not solve install-channel hangs. **ADR-003** now records OpenTUI + Bun as the mainline runtime to harden directly.
- OpenTUI is therefore the permanent rendering layer. The Bun-Worker exposure is not transitional — it is the steady state until upstream Bun fixes the compile×Worker bug class. We cannot wait.

Available solutions were evaluated:

| Option | Time-to-fix | Risk | Coverage |
|---|---|---|---|
| S1 — wait for upstream Bun fix | unknown | indefinite hang persists | 0% |
| S2 — ship source + bun, retire compiled binary | 1–2 wk | Low (proven path, just productionizing) | Bypasses the entire `bun build --compile` bug class |
| S3 — refactor Worker → child_process; keep single binary | 4–6 wk | High (orphan processes, FD leaks, untested stdio IPC in compiled binary, Windows ctrl-c forwarding) | Worker class only; does not cover non-Worker bunfs bugs |
| S4 — collapse Worker into main thread | 6–10 wk | Very high (loses async/error isolation) | Worker class only |
| S5 — ratatui replaces TUI | invalid (rejected) | n/a | n/a |

S3 was reconsidered carefully after ratatui's rejection (the throwaway argument is moot when ratatui is dead), but the new failure modes plus unverified stdio IPC in compiled binary still outweigh single-binary preservation, especially since ax-code's value proposition does not depend on a single-binary distribution.

## Decision

AX Code stops shipping `bun build --compile` artifacts as the default for brew and npm. Both channels move to **source + bun runtime** distribution, mirroring the contributor source launcher proven via `pnpm setup:cli`.

The default package names (`@defai.digital/ax-code` and `defai-digital/ax-code/ax-code`) now point to the source+bun runtime. The transitional `@defai.digital/ax-code-source` and `ax-code-source` Homebrew formula remain compatibility aliases. The compiled binary build path (`packages/ax-code/script/build.ts` and GitHub release assets) is preserved as a fallback but is no longer the default publish artifact.

Phased rollout:

1. **Phase 0 — foundation (complete).** Extract `sourceLauncherScript` to a shared module reusable by `setup-cli` and packaged distribution. Add `runtimeMode` detection (`compiled` / `source` / `bun-bundled` / `unknown`) and surface it in `DiagnosticLog` and `doctor`.
2. **Phase 1 — source package (complete).** `publish-source.ts` produces a source-distribution npm tarball: ships a bundled JS runtime, bin shims, a postinstall that resolves `bun`, and OpenTUI native optional dependencies.
3. **Phase 2 — flip defaults (current implementation).** `publish-source.ts` publishes the source distribution under `@defai.digital/ax-code` using the release channel (`latest` or `beta`) and also publishes `@defai.digital/ax-code-source` as a compatibility alias. `update-homebrew.sh` generates the default `ax-code` formula from the source npm tarball and depends on Homebrew `bun`. `ax-code-source` remains an alias formula for existing users.
4. **Phase 3 — compiled fallback only.** Compiled artifacts remain downloadable from GitHub releases for diagnostics and rollback, but compiled npm publish is guarded so it cannot reclaim `latest` / `beta` without an explicit rollback override.
5. **Phase 4 — retire compiled.** After a further release cycle without bug reports tied to source distribution, stop building compiled platform artifacts and remove the compiled-binary CI matrix.

`script/build.ts` is not deleted until Phase 4 completes — the path stays buildable as `pnpm setup:cli -- --bundled` for diagnostic purposes and as a rollback option.

## Alternatives Considered

### Alternative 1: Wait for upstream Bun fix (S1)
- **Pros:** Zero engineering cost.
- **Cons:** Hangs persist indefinitely for brew/npm users. No timeline. Bun's compile×Worker bug class spans multiple open issues with no clear fix horizon.
- **Why not chosen:** Unacceptable user impact for an indefinite period.

### Alternative 2: Refactor Worker → child_process, keep single binary (S3)
- **Pros:** Preserves single-binary distribution.
- **Cons:** Introduces orphan-process / FD-leak / SQLite-lock failure modes that don't exist with Workers (workers die with parent automatically). stdio IPC is unverified inside `bun build --compile` — there is no evidence it is unaffected by the same bug class. 4–6 weeks of cross-platform engineering with high test-coverage cost. Only solves the Worker subset of compile-binary bugs.
- **Why not chosen:** Single-binary distribution is not a stated AX Code value proposition (README does not call it out). The new failure modes plus unverified IPC plus partial coverage is worse than just bypassing `bun build --compile` entirely.

### Alternative 3: Collapse Worker into main thread (S4)
- **Pros:** Architecturally simplest.
- **Cons:** Loses async isolation (TUI renders block on backend work) and error isolation (worker uncaught becomes whole-app crash). Requires rewriting `Rpc` and lifecycle plumbing.
- **Why not chosen:** Real architectural regression for a transient bug class.

### Alternative 4: Ship a dual-mode binary that falls back to source if compiled launch fails
- **Pros:** Backwards compatible.
- **Cons:** Hides the failure mode behind opaque postinstall logic. Still ships the compiled binary, so install size and bug exposure remain. Postinstall complexity becomes a new bug surface.
- **Why not chosen:** The simplification that "compiled is no longer the default" is exactly what makes this strategy maintainable.

## Consequences

### Positive

- brew/npm users stop hitting compiled-binary hangs.
- ax-code is decoupled from `bun build --compile` upstream status — no longer a dependency on Bun fixing the Worker bug class.
- Future runtime swaps (Node, Deno, alternative TUI stacks) become tractable because the distribution mechanism no longer assumes single binary.
- Aligns shipped channel with the path that has been validated by the contributor base for 6+ months.
- `runtimeMode` telemetry makes it possible to triage future support reports by channel automatically.

### Negative

- npm package install size grows from ~50 MB to ~80–100 MB once the bun runtime is included via `optionalDependencies`.
- "Single binary" is no longer part of the install story.
- `npm i -g` users without `bun` already on PATH need the postinstall to either fetch a per-platform bun package or fail with an installer instruction.
- One more moving piece on Windows (bun-on-Windows is newer than bun-on-Unix).

### Risks

- **`@oven/bun-${platform}-${arch}` packages may not exist or may have incomplete coverage.**
  Mitigation: Phase 1 spike validates availability in the install-matrix smoke workflow; if unavailable, vendor bun via the curl installer in postinstall, accepting the install-time network call.
- **Windows postinstall is the highest-risk platform.**
  Mitigation: Phase 1 ships dual-publish so Windows can stay on compiled artifacts an extra cycle if the install-matrix smoke flags Windows-specific failures.
- **Brew formula change requires a tap maintainer push.**
  Mitigation: Tap is `defai-digital/homebrew-ax-code` (own repo); coordinate the formula update with the Phase 2 ship.
- **Some users may prefer the single-binary form.**
  Mitigation: compiled GitHub release assets stay available throughout Phase 3 and most of Phase 4. Returning compiled npm artifacts to `latest` / `beta` requires an explicit rollback override.
- **Postinstall increases install-time network exposure.**
  Mitigation: per-platform bun packages avoid this when present; curl fallback is documented and uses bun.sh's official installer.

## Decision Triggers for Re-evaluation

Reopen this decision if any of the following becomes true:

- Bun upstream lands a `bun build --compile` × Worker fix that has been verified in the install-matrix smoke for at least one release cycle (would unlock returning to single-binary distribution as an option).
- Single-binary distribution becomes a stated product requirement (would force returning to S3 with proper spike coverage).
- Install matrix smoke shows source distribution failure rate > 5% on any major platform after Phase 1 — abort Phase 3 and reassess.

## Related

- ADR-001: Ship ratatui as the bundled renderer — superseded for the rendering decision.
- ADR-003: Keep OpenTUI and Bun as the mainline runtime and harden them directly.
- Memory: `project_distribution_strategy.md`, `project_tui_migration_strategy.md`.
- Phase 1+ implementation spec: `.internal/prd/PRD-source-bun-distribution.md` (to be written; not yet implemented).
