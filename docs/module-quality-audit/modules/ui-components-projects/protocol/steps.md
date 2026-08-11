# Review protocol: ui-components-projects

## Step 1 Scope and public surfaces

The unit contains the two exported React surfaces identified by the audit: `ImportProjectsDialog` at `desktop/packages/ui/src/components/projects/ImportProjectsDialog.tsx:52` and `ProjectsHome` at `desktop/packages/ui/src/components/projects/ProjectsHome.tsx:24`. The declared unit root and candidate count agree with `docs/module-quality-audit/modules/ui-components-projects/MODULE-AUDIT.md:5-17`. Call-site checks found the full home component in `desktop/packages/ui/src/components/chat/ChatEmptyState.tsx:67-89` and `desktop/packages/ui/src/components/work/WorkHome.tsx:142-154`, while the compact variant is used by the session sidebar.

## Step 2 Data and trust boundaries

The only network boundary in the candidates is the GET to `API_ENDPOINTS.projects.discoverExternal` with JSON parsing and an explicit non-2xx branch at `desktop/packages/ui/src/components/projects/ImportProjectsDialog.tsx:62-73`. The URL resolves to `/api/projects/discover-external` at `desktop/packages/ui/src/lib/http.ts:155-163`; the server route reads project settings, checks candidate directories, and returns a controlled JSON result at `desktop/packages/web/server/lib/projects/discover-external.js:234-265`. Candidate roots cross from local configuration into UI text and store input, but React escapes the displayed values and the store validates paths before persistence.

## Step 3 Discovery-state correctness

On success, the dialog normalizes a missing/non-array candidate payload to an empty list, derives source summary text, and selects only existing, not-yet-imported roots at `desktop/packages/ui/src/components/projects/ImportProjectsDialog.tsx:75-90`. Failure clears candidates and selection, exposes a translated or server-provided error, and always releases loading state at `desktop/packages/ui/src/components/projects/ImportProjectsDialog.tsx:91-98`. Opening invokes the memoized loader at `desktop/packages/ui/src/components/projects/ImportProjectsDialog.tsx:101-106`; closing does not cancel an in-flight request, so a close/reopen race remains a low-impact lifecycle risk rather than a data-integrity failure.

## Step 4 Import mutation correctness

The import handler intersects selection with the current importable set, builds labels only for selected roots, calls the bulk store operation, reports the added count, and closes the dialog at `desktop/packages/ui/src/components/projects/ImportProjectsDialog.tsx:130-155`. Defense in depth exists in `desktop/packages/ui/src/stores/useProjectsStore.ts:370-435`: every raw path is validated, normalized identities are deduplicated, invalid IDs are skipped, one state/persistence update is used, and icon discovery runs only for newly added entries. The behavior is directly exercised by the duplicate-filtering test at `desktop/packages/ui/src/stores/useProjectsStore.test.ts:120-130`.

## Step 5 Project actions and interaction semantics

Opening a card and starting a session both activate the selected project before invoking optional callbacks at `desktop/packages/ui/src/components/projects/ProjectsHome.tsx:46-61`; pinning stops click propagation and delegates to the store at `desktop/packages/ui/src/components/projects/ProjectsHome.tsx:63-69`. The project card is a native button at `desktop/packages/ui/src/components/projects/ProjectsHome.tsx:142-153`, while pin/new-session controls are focusable `role="button"` spans inside it at `desktop/packages/ui/src/components/projects/ProjectsHome.tsx:197-234`. Their Enter/Space handling and propagation control preserve behavior, but nested interactive semantics are a non-Critical accessibility concern worth covering in a future component-level keyboard test.

## Step 6 Rendering and performance

Display ordering is memoized on the project array at `desktop/packages/ui/src/components/projects/ProjectsHome.tsx:40`, and `sortProjectsForDisplay` performs a copied stable sort rather than mutating store state at `desktop/packages/ui/src/lib/projectOrdering.ts:53-62`. Icon failures are keyed by project plus image revision and update a copied `Set` only once per key at `desktop/packages/ui/src/components/projects/ProjectsHome.tsx:128-170`, allowing a later image revision to retry. Candidate filtering and selected counting at `desktop/packages/ui/src/components/projects/ImportProjectsDialog.tsx:108-111,157` are linear in a small local-project list and do not introduce an unbounded background loop.

## Step 7 Maintainability and coverage

State ownership is appropriately split: the components hold dialog/loading/icon-failure presentation state at `desktop/packages/ui/src/components/projects/ImportProjectsDialog.tsx:55-60` and `desktop/packages/ui/src/components/projects/ProjectsHome.tsx:37-38`, while durable project changes stay in `useProjectsStore`. Labels, statuses, empty states, and action copy are translated throughout `desktop/packages/ui/src/components/projects/ProjectsHome.tsx:71-122`. The audit records no auto-matched tests at `docs/module-quality-audit/modules/ui-components-projects/MODULE-AUDIT.md:33-34`; adjacent store and ordering units are tested, but neither component has a direct render, error-state, selection, or keyboard-interaction test.

## Step 8 Findings disposition

The existing register contains no accepted items at `docs/module-quality-audit/modules/ui-components-projects/MODULE-AUDIT.md:48-52`, and there are no files under this unit's `findings/` path. Independent inspection found no Critical security, corruption, or availability defect. The uncancelled discovery request and nested interactive semantics noted above are bounded, non-Critical follow-up risks; neither contradicts the current empty accepted-finding ledger. Because no Critical item exists, the conditional `protocol/reverify.md` is not created.

## Step 9 Verification and exit evidence

The UI package exposes `type-check` and test scripts at `desktop/packages/ui/package.json:14-19`, and its Vitest configuration uses jsdom and includes `src/**/*.test` at `desktop/packages/ui/vitest.config.ts:19-23`. `pnpm --dir desktop/packages/ui run type-check` passed. `pnpm --dir desktop/packages/ui exec vitest run src/stores/useProjectsStore.test.ts src/lib/projectOrdering.test.ts` passed 10 tests in 2 files, and `pnpm --dir desktop/packages/web exec vitest run server/lib/projects/discover-external.test.js` passed 5 tests. The server assertions cover merged sources, existing imports, and missing directories at `desktop/packages/web/server/lib/projects/discover-external.test.js:69-125`; verification is green with the direct component-test gap retained as an explicit limitation.
