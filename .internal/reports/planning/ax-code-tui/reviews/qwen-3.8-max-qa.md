# Qwen 3.8 Max QA Review

| Field | Value |
| --- | --- |
| Reviewer | AX Code `alibaba-token-plan/qwen3.8-max` |
| Date | 2026-08-20 |
| Mode | Read-only implementation QA |
| Session | `ses_-e5fdf098ab7ffer0TTEG85II3` |
| Final verdict | PASS |

## Review scope

Qwen reviewed the consolidated manifest, distribution builder, distribution-pruning helper, patch system, Solid export
targets, vendored native layout, active application identifiers, and the reported verification matrix. The review focused
on workspace topology, Node/Bun conditions, Solid singleton resolution, native hashes, patch idempotency, release
staging, scope isolation, and removal of the abandoned alternate-renderer plan.

## Findings and dispositions

| Severity | Finding | Disposition |
| --- | --- | --- |
| Blocker | Ignored `solid/node_modules` and `spinner/node_modules` retained stale symlinks to the former workspaces. | Resolved: moved the generated directories out, then proved `pnpm install --frozen-lockfile` is a no-op. |
| Blocker | Spinner looked like a remaining workspace boundary. | Resolved: `find packages/ax-code-tui -name package.json` returns only the root manifest; root scripts and exports own `spinner/`. |
| High | Hashed renderer chunks could create fragile filename coupling. | Accepted by design: Phase 1 pins the generated baseline; patch discovery uses content markers and the release bundle externalizes the package for `import.meta.url` asset resolution. |
| High | Existing VS Code, IDE, workspace, and lockfile work could enter the commit. | Commit-time guard: stage by explicit path/hunk and inspect the cached diff before committing. |
| Medium | Solid could resolve more than one runtime instance. | Resolved: stale nested modules removed; `solid-js` is a peer and the Node bundle aliases bare imports to one external `solid-js/dist/solid.js`. |
| Medium | Patch application needed an idempotency contract. | Resolved: apply functions are marker-guarded, checks are fail-closed, and `check:tui-patches` passes with `ax-runtime-identity`. |
| Low | `s-js` was the only caret-ranged dependency and had no proven runtime use. | Resolved: repository search found no import, so the inherited unused dependency was removed. |

## Independently confirmed

- the old workspace directories are absent;
- `@ax-code/tui` is private and owns root, Solid, spinner, and testing exports;
- all inspected Solid script export targets exist;
- all eight vendored native targets and their license files exist;
- active code under `packages/ax-code/src` contains no OpenTUI product/runtime references;
- distribution staging copies one package, rewrites its manifest, validates its native hash, and keeps one target;
- upstream-native identifiers that remain are ABI/provenance details rather than AX package identity.

## Final assessment

Qwen marked the implementation **PASS / commit-ready**, with the remaining requirement that the cached diff exclude
pre-existing VS Code/IDE work and contain only the consolidation-specific lockfile hunks.
