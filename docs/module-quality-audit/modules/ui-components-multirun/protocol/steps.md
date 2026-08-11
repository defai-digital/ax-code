# Protocol Steps: ui-components-multirun

- **Unit slug:** `ui-components-multirun`
- **Scope:** `desktop/packages/ui/src/components/multirun`
- **Reviewer:** ax-code-glm (`zai-coding-plan/glm-5.2[1m]`)
- **Verifier (other lane):** codex-sol
- **Date:** 2026-08-11
- **Baseline commit:** `cab6c0089e3b7b3410f050bc9d824c06a3c3a814`

Every claim below is anchored to a file and line range I opened and read during this pass. No Critical-severity issues were accepted; the `findings/` directory remains empty, so no `reverify.md` is emitted.

## Step 1 Scope and Inventory Confirmation

Opened all 6 files under `desktop/packages/ui/src/components/multirun/`. The full path I started from is `desktop/packages/ui/src/components/multirun/MultiRunLauncher.tsx`. Line counts from my reads: `AgentSelector.tsx` 98, `BranchSelector.tsx` 223, `ModelMultiSelect.tsx` 397, `MultiRunFusionDialog.tsx` 307, `MultiRunLauncher.tsx` 1074, `index.ts` 17 — totaling ~2116 LOC, within 6 lines of the audit's stated 2122. The barrel `index.ts:1-17` is the single public surface and re-exports `MultiRunLauncher`, `ModelMultiSelect`/`ModelChip`/`generateInstanceId` plus their types, `BranchSelector`/`useBranchOptions` plus types, and `AgentSelector` plus props. No co-located test file exists in the folder (matches audit "none auto-matched").

## Step 2 Public Export Surface Review

The contract is 5 React components + 1 hook (`useBranchOptions`, BranchSelector.tsx:59) + 1 utility (`generateInstanceId`, ModelMultiSelect.tsx:38) + prop/type aliases. Two `react-refresh/only-export-components` disables are present (BranchSelector.tsx:58, ModelMultiSelect.tsx:37) with inline rationale. One smell: `generateInstanceId` is now imported cross-file by both `MultiRunFusionDialog.tsx:27` and `MultiRunLauncher.tsx:24`, so it has outgrown its "tightly coupled to ModelMultiSelect" justification and would be better placed in a shared `lib/` helper. No exported symbol is dead within the barrel graph.

## Step 3 State, Effects, and Race Conditions

Traced the effect graphs. `AgentSelector.tsx:47-69` auto-selects a valid agent and lists `onChange` in its dependency array — safe today because both call sites pass stable store setters (`MultiRunLauncher.tsx:545` `setSelectedAgent`, `MultiRunFusionDialog.tsx:266` `setAgent`), but the contract would infinite-loop if a parent ever passed an inline arrow function. `MultiRunFusionDialog.tsx:114-134` rebuilds `sources` whenever `allSessions` changes; `allSessions` (line 105-112) is a fresh `Array.from(byId.values())` on any store tick, so this effect runs often — it is idempotent (full recompute) but worth a memoization pass. `ModelMultiSelect.tsx:187-192` closes the picker when `canAddModel` flips false, which correctly prevents adding past `maxModels`. `MultiRunLauncher.tsx:262-273` uses a `wasIsolationDisabledByNonGitRef` to restore the isolate toggle when a directory re-becomes a git repo — logic is correct but subtle.

## Step 4 Error Handling and Failure Paths

The significant finding lives in `MultiRunFusionDialog.tsx:155-205`. `handleStart` calls `createSession` (line 175), immediately `setCurrentSession` (line 178), and only then attempts `sendMessage` (line 181). If `sendMessage` throws, the catch (line 199) only logs and toasts — the fusion session has already been created and promoted to current, leaving an orphaned empty session the user must clean up. A rollback (`deleteSession`/close) or deferring `setCurrentSession` until after the first send succeeds would fix this. Elsewhere the swallowed catches are defensible: `BranchSelector.tsx:149-151` silently falls back through the branch-resolution priority ladder, and `MultiRunLauncher.tsx:299-301` ignores setup-command load failures (non-critical config read).

## Step 5 Type Safety

Several `as` casts bypass SDK/derived types. `MultiRunFusionDialog.tsx:137-139` narrows `selectedProviderModel` to `{ variants?: Record<string, unknown> } | undefined` via assertion; the same file at line 59 hand-types a record as `{ info?: { role?: string }; parts?: unknown[] }` instead of using the SDK message type. `ModelMultiSelect.tsx:322-325` walks `provider.models` casting each entry through `Record<string, unknown>` to read `.id` and `.variants`. None of these are exploitable, but they defeat compile-time guarantees if the provider model shape changes; a shared `ProviderModel` type from config/store would be safer.

## Step 6 Coupling and Cohesion

Three coupling smells. (1) `BranchSelector.tsx:24` hardcodes `LAST_SOURCE_BRANCH_KEY = "oc:lastWorktreeSourceBranch"` with a comment "matching NewWorktreeDialog" — an implicit cross-module contract; if the worktree dialog renames the key, this selector's default-restore silently breaks. The key should be shared from one module. (2) `ModelMultiSelect.tsx:164-179` walks `parentElement` chain at runtime sniffing for `role="dialog"` or overflow styles to size the dropdown — fragile coupling to ancestor DOM that will break if the dialog wrapper changes. (3) `MultiRunFusionDialog.tsx` fans in to `useConfigStore`, `useGlobalSessionsStore`, `useSessionUIStore`, `useAllLiveSessions`, `axCodeClient`, and `magicPrompts` — a lot of wiring for one dialog, though each is legitimately needed.

## Step 7 Performance and Render Hygiene

`AgentSelector.tsx:38` calls `getVisibleAgents()` on every render rather than via `useMemo`; the downstream `selectableAgents` memo (line 39) bounds the damage, but if the store returns a fresh array the component re-renders unnecessarily. `ModelMultiSelect.tsx:129-145` correctly memoizes `modelCounts` and `getInstanceIndex` on `selectedModels`. `MultiRunLauncher.tsx:369` memoizes `totalRunCount`. `RunGroupCard` (MultiRunLauncher.tsx:741) is declared at module scope, so it is not re-created per parent render — good. The height-measuring effect (ModelMultiSelect.tsx:148-185) reads `getComputedStyle` and `getBoundingClientRect` only while open, which is acceptable.

## Step 8 Accessibility and i18n

i18n coverage is strong: every visible label flows through `t()` from `useI18n` (e.g. AgentSelector.tsx:83, BranchSelector.tsx:166-218, MultiRunLauncher.tsx field labels). Accessibility gaps are present on icon-only buttons: `ModelMultiSelect.tsx:64-66` remove-`ModelChip` button has no `aria-label`; `MultiRunFusionDialog.tsx:284-290` source-list remove button is icon-only with no accessible name; `MultiRunLauncher.tsx:596-603` setup-command delete relies on `aria-label` (good, present). Adding `aria-label` to the two unlabeled close buttons would close the gap. `BranchSelector` loading and empty states (lines 172-179) are correctly announced visually.

## Step 9 Tests and Verification

No tests exist for any of the 6 files. The highest-leverage untested logic is the autocomplete splice/insert block in `MultiRunLauncher.tsx:776-940` — `handleFileSelect` (836), `handleAgentSelect` (867), and `handleSnippetSelect` (916) each re-implement near-identical "find trigger index, splice, restore cursor" arithmetic against `group.prompt`. This is the kind of pure, cursor-mathy code that is cheap to unit-test once extracted into a `lib/` helper (and the three handlers are a dedup candidate per the improve-overall rule, with 3+ call sites sharing identical logic). Secondary untested risk is the orphan-session path in Step 4; a regression test that forces `sendMessage` to reject and asserts no empty session remains would lock in the eventual fix.
