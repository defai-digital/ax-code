# Protocol Steps: config

- Slug: `config`
- Lane: `codex-sol`
- Date: `2026-08-11`

## Step 1 Map

`Config` is re-exported by `packages/ax-code/src/config/config.ts:1` and implemented in `packages/ax-code/src/config/config-impl.ts:81-1559`, including source precedence, MCP provenance, schema aliases, global/state reads, parsing, and updates. Supporting boundaries are JSONC path/error handling in `packages/ax-code/src/config/paths.ts:14-161`, markdown expansion in `packages/ax-code/src/config/markdown.ts:6-172`, schemas in `packages/ax-code/src/config/schema-impl.ts:44-1084` and `tui-schema.ts:13-68`, trust in `project-config-trust.ts:7-12`, and TUI/migration helpers in the remaining listed files.

## Step 2 Threat model

The key boundary is source provenance: global, managed, inline, and account config are trusted, whereas project files, worktree `.ax-code` directories, and well-known remote config can be attacker-controlled (`packages/ax-code/src/config/config-impl.ts:316-670`). Untrusted input could otherwise select executables, load plugins, read `{file:...}` secrets, expand shell markdown, add credentials/endpoints, or relax permissions; `restrictUntrustedConfig` and trust-aware token substitution remove those capabilities (`packages/ax-code/src/config/config-impl.ts:106-200`, `packages/ax-code/src/config/config-impl.ts:1265-1375`).

## Step 3 Correctness

Precedence is accumulated in `loadState()` and source-specific MCP metadata is retained so a later consumer can distinguish trusted and untrusted definitions (`packages/ax-code/src/config/config-impl.ts:316-712`). Every explicitly untrusted source passes `trusted: false` through substitution, has agent grants converted to denials-only semantics, loses executable/provider credential fields, and only retains plugins that resolve inside the source root (`packages/ax-code/src/config/config-impl.ts:1265-1429`). `update` and `updateGlobal` serialize read-modify-write, reparse raw JSONC to preserve unevaluated file/env references, and dispose affected instances only after durable output (`packages/ax-code/src/config/config-impl.ts:1434-1559`).

## Step 4 Performance

Config loading parallelizes independent directory reads but merges them in deterministic order, while dependency installation is serialized to prevent competing package mutations (`packages/ax-code/src/config/config-impl.ts:489-590`, `packages/ax-code/src/config/config-impl.ts:720-901`). `Instance.state` caches the resolved configuration per project and `global` is lazy (`packages/ax-code/src/config/config-impl.ts:314`, `packages/ax-code/src/config/config-impl.ts:1230-1261`); remaining schema parsing and directory walks are startup/config-change costs rather than per-token hot paths.

## Step 5 Design

The split between `schema-impl.ts` and `config-impl.ts` is sound: declarative validation remains separate from I/O, provenance, merge, trust, and installation policy, while `packages/ax-code/src/config/schema.ts:1` provides a stable re-export. `packages/ax-code/src/config/paths.ts`, `markdown.ts`, and `project-config-trust.ts` each own narrow reusable policies, but `config-impl.ts` is still a large orchestration hub whose trusted/untrusted branches warrant continued targeted review.

## Step 6 Dead code/hygiene

`packages/ax-code/src/config/migration.ts:1-213` is a deprecated `super_long` compatibility module with a stated 2026-12-15 removal date, and a repository search found no production importer; it should be removed on schedule or wired intentionally before then. The empty catch at `packages/ax-code/src/config/config-impl.ts:123` is the invalid-URL branch of untrusted file-reference filtering and immediately returns the original non-URL value, so the existing Low hygiene record is auditable but does not hide a failed write or security decision.

## Step 7 Tests

`packages/ax-code/test/config/config.test.ts:801-1760` covers untrusted markdown, denial-only permissions, plugin containment, executable/credential stripping, and source behavior; `config.test.ts:970-1225` also covers raw-reference preservation and serialized/restored dependency installs. `packages/ax-code/test/config/markdown.test.ts`, `permission-env.test.ts`, `tui.test.ts`, and `k-tui-config-salvage.test.ts` cover their focused parsers and migration edges. Gaps remain for a compact source-precedence matrix spanning every provenance kind and for explicit removal-date enforcement of the otherwise dormant `packages/ax-code/src/config/migration.ts`.

## Step 8 Findings

`docs/module-quality-audit/modules/config/findings/AUDIT-config-001.md` is High and verified-fixed: trust now follows source rather than destination, and updates retain raw secret references instead of materializing them. `docs/module-quality-audit/modules/config/findings/AUDIT-config-empty-catch.md` is a deferred Low hygiene item; review of `packages/ax-code/src/config/config-impl.ts:116-125` shows the catch is a deliberate URL-validation outcome. No new finding was accepted because the dormant migration and precedence-matrix observations are maintainability/test gaps, not demonstrated invariant failures.

## Step 9 Verification

I ran `AX_TEST_FILES=test/auth/encryption.test.ts,test/auth/auth.test.ts,test/config/config.test.ts,test/config/markdown.test.ts,test/config/permission-env.test.ts,test/config/tui.test.ts pnpm --dir packages/ax-code exec vitest run`; all six files and 186 tests passed, including the config trust and update regressions in `packages/ax-code/test/config/config.test.ts`. I also ran `pnpm --dir packages/ax-code run typecheck` successfully; the separate `k-tui-config-salvage.test.ts` and a full deterministic group would be appropriate before a release that changes migration behavior.
