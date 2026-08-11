# Protocol — ui-components-files (9-step review)

Reviewer: ax-code-glm
Model: zai-coding-plan/glm-5.2[1m]
Date: 2026-08-11
Unit root: `desktop/packages/ui/src/components/files`

## Step 1 Scope and inventory confirmation

The on-disk unit `ui-components-files` resolves to `desktop/packages/ui/src/components/files/` and contains exactly the six files listed in MODULE-AUDIT §1: `FileStatusDot.tsx` (14 lines), `fileStatus.ts` (65 lines), `fileStatus.test.ts` (40 lines), `latestDirectoryLoadTracker.ts` (33 lines), `latestDirectoryLoadTracker.test.ts` (36 lines), and `types.ts` (9 lines). All six were read in full this pass. No stray `.tsx`/`.ts` siblings were found in the directory, so the audit inventory is complete and the boundary is tight: four source files plus their co-located tests.

## Step 2 Public contract and export surface

Seven exports form the module contract. `FileStatusDot@FileStatusDot.tsx:12` is a presentational React component keyed off the `FileStatus` union. The pure helpers `getFileStatusForPath@fileStatus.ts:18` and `getFolderBadgeForPath@fileStatus.ts:41` are the only producers of `FileStatus` values inside this unit. `LatestDirectoryLoadTracker@latestDirectoryLoadTracker.ts:6` and its `DirectoryLoadToken@latestDirectoryLoadTracker.ts:1` interface form a small race-guard primitive. `FileNode@types.ts:1` and `FileStatus@types.ts:9` are shared types. Consumers are exactly two views — `components/layout/SidebarFilesTree.tsx:39-42` and `components/views/FilesView-impl.tsx:68-71` — confirming the export surface is minimal and actually consumed (no orphan exports).

## Step 3 Correctness of fileStatus.ts status mapping

Walking `getFileStatusForPath@fileStatus.ts:18-39`: `options.isOpen(path)` short-circuits to `"open"` (line 26); the `index === "A" || working_dir === "?"` branch (line 35) maps staged-add and untracked to `"git-added"`; `index === "D"` (line 36) maps staged-delete to `"git-deleted"`; `index === "M" || working_dir === "M"` (line 37) maps staged or worktree-modified to `"git-modified"`. The branch order is correct (most specific first). One LOW-severity gap: a working-tree-only deletion (`working_dir === "D"` with `index === " "`) is not detected — only `index === "D"` is checked on line 36 — so such a file falls through to `return null` (line 38) and renders no dot. This is asymmetric with the modified branch, which does inspect `working_dir`. Behavior is deterministic and the fallthrough is safe (no crash), so this is a coverage nuance rather than a defect.

## Step 4 Correctness of LatestDirectoryLoadTracker

`begin@latestDirectoryLoadTracker.ts:10-15` hands out a monotonic `requestId` (`nextRequestId` starts at 0, first token is 1, so a zero-id token can never be current — safe default). `isCurrent@latestDirectoryLoadTracker.ts:17-19` compares the stored id per directory. `complete@latestDirectoryLoadTracker.ts:21-28` deletes the active entry only when the token is current, returning false for stale completions — exactly the guarantee the consumer relies on at `SidebarFilesTree.tsx:491` to avoid clobbering a newer in-flight request out of the `finally` block. `reset@latestDirectoryLoadTracker.ts:30-32` swaps in a fresh `Map` but intentionally leaves `nextRequestId` monotonic, so post-reset `begin()` ids cannot collide with pre-reset tokens; the consumer calls it from `refreshRoot` and the effect at `SidebarFilesTree.tsx:507,540`. The three tests in `latestDirectoryLoadTracker.test.ts:5-35` cover the stale-current, stale-complete-no-clear, and reset-invalidates paths and match the implementation exactly.

## Step 5 Cross-platform path normalization

`getRelativePathForRoot@fileStatus.ts:5-16` delegates to `normalizeProjectPath` and `projectPathMatchesRoot` from `@/lib/projectResolution`. Because `projectResolution.ts:16-17` lowercases drive-prefixed and UNC paths for comparison only, the matcher is case-insensitive on Windows and case-sensitive on POSIX, which is the desired platform semantics. This is verified by `fileStatus.test.ts:9-17` (Windows root `C:/Users/Alice/Project` matched against lowercase input `c:/users/alice/...`) and `fileStatus.test.ts:32-39` (POSIX sibling-prefix `src2` must not badge `src`). The `relative.startsWith("/") ? relative.slice(1) : relative` strip on line 15 correctly handles both the leading-slash POSIX case and the no-slash Windows case after normalization.

## Step 6 Coupling and dependency direction

Dependency edges from this unit point strictly inward to lower layers: `fileStatus.ts:1-2` imports `GitStatus` from `@/lib/api/types` and the two project-resolution helpers from `@/lib/projectResolution`; `FileStatusDot.tsx:2` imports the local `FileStatus` type. No file in this directory imports React component code, store state, or view logic, so there is no layering violation and no circular dependency. The tracker and types files have zero non-local imports. The two consumers (`SidebarFilesTree.tsx`, `FilesView-impl.tsx`) sit above this module and import downward — the direction is consistent.

## Step 7 Hygiene and hardcoded values

No empty catches, no TODOs, no console side-effects, and no secrets/IO appear in any of the four source files. The `FILE_STATUS_COLORS@FileStatusDot.tsx:4-10` record maps each `FileStatus` variant to a CSS custom property (`var(--status-info)` etc.); these are theme tokens, not magic values, and are correctly kept inline as a static lookup rather than externalized. The `prefix = relative ? \`${relative}/\` : ""`construction at`fileStatus.ts:52` is the only string composition and is localized to one line. No constants warrant extraction. Naming is consistent (`get\*ForPath`, `isCurrent`, `complete`) and the files are small enough that the lack of a barrel `index.ts` is fine.

## Step 8 Test coverage analysis

`fileStatus.test.ts:8-39` exercises three scenarios: Windows case-insensitive file match (line 9), Windows case-insensitive folder badge counts (line 19), and POSIX sibling-prefix rejection (line 32). `latestDirectoryLoadTracker.test.ts:4-35` exercises stale-vs-current, stale-complete-does-not-clear, and reset. Coverage gaps (LOW): no test drives the `working_dir === "M"` branch of `getFileStatusForPath@fileStatus.ts:37` independently of `index === "M"`; no test exercises `index === "D"` → `"git-deleted"` (line 36); no test covers the `isOpen` → `"open"` short-circuit (line 26); no test covers the root-folder badge path where `relative === ""` and `prefix === ""` (line 52); no test asserts the `requestId` continues monotonically after `reset()`. The presentational `FileStatusDot.tsx` has no snapshot test, which is acceptable for a 14-line pure component.

## Step 9 Findings disposition and verdict

No Critical or High severity findings; `findings/` is empty and this independent pass raises none at those tiers. Three LOW-severity, non-blocking observations are recorded for future hardening: (1) `getFileStatusForPath@fileStatus.ts:36` does not treat `working_dir === "D"` as deleted, asymmetric with the modified branch; (2) the `"modified"` variant of `FileStatus@types.ts:9` has no producer inside this unit (the single repo-wide hit at `useSessionRollbackStore.test.ts:40` is an unrelated `status` field on a different type), so its color mapping at `FileStatusDot.tsx:6` is defensive-only — acceptable, but worth a comment; (3) the branch-coverage gaps listed in Step 8. The module is small, well-bounded, correctly factored into pure testable helpers, and its sole piece of stateful logic (`LatestDirectoryLoadTracker`) is correctly used by its consumer. Verdict: approve `ui-components-files` with the LOW-severity notes above tracked for optional follow-up.
