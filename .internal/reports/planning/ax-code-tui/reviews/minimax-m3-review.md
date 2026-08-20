# MiniMax M3 Architecture Review

| Field | Value |
| --- | --- |
| Reviewer | AX Code `minimax-coding-plan/MiniMax-M3` |
| Date | 2026-08-20 |
| Mode | Read-only architecture review |
| Session | `ses_-e5fdf37692affeFyHomRQD4kW` plus focused follow-up |

## Summary

MiniMax M3 supported consolidating the three private packages while retaining the native/Solid renderer. Its strongest
findings were that the generated core is the load-bearing maintenance risk, package staging is fragile, spinner does not
justify a workspace boundary, public exports should follow actual consumption, local patches need first-class governance,
and runtime rebranding must cover more than import paths.

## Accepted recommendations

1. Publish only the AX-consumed surface from one package.
2. Consolidate spinner into the TUI package.
3. Maintain an explicit, test-backed divergence ledger.
4. Add checks for legacy public/runtime package naming.
5. Preserve JS/native ABI coupling and validate packed distribution behavior.
6. Add virtual-terminal and input-latency instrumentation in the hardening phase.
7. Record the single-engine decision and prevent a second active renderer dependency.

## Adjustments after repository review

- pi-tui's `Terminal` contract is TypeScript, not Rust-native. AX will translate the pattern behind its Solid API rather
  than copy an incompatible interface.
- This package move does not introduce a second renderer, so a legacy/new parallel-renderer flag would add risk without
  parity value. Existing compatible/advanced terminal profiles remain the relevant startup matrix.
- The release staging code cannot be replaced wholesale by Turbo: it intentionally assembles an offline Node bundle and
  prunes cross-platform native assets. It will be simplified from three package copies to one while retaining that role.
- Source conversion and native ABI rebasing are separated from the mechanical consolidation so failures remain
  attributable and rollback is straightforward.
- Old package shims are unnecessary because every consumer is in the same private workspace and migrates atomically.

## Acceptance concerns carried into the specification

- compiled JavaScript and declarations may retain self-imports after TypeScript sources migrate;
- Solid must resolve to one runtime instance;
- native resolution must remain relative to the consolidated root;
- patch checks must fail closed after path/name changes;
- unrelated existing worktree changes must not enter the TUI commit.
