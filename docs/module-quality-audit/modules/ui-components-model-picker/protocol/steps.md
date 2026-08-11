# Protocol Steps — `ui-components-model-picker`

Reviewer: `codex-sol` (model `gpt-5.6-sol-xhigh`)
Scope root: `desktop/packages/ui/src/components/model-picker`
Baseline recorded by the audit: `994f9287e497666e104644eccea299595a35b39a`

This primary-review pass covers the current component, the pure helpers that determine its selection and availability behavior, three production call sites, and the existing audit record. Every conclusion below is tied to a location opened during the review.

## Step 1 Scope and source map

The audited unit contains `desktop/packages/ui/src/components/model-picker/ModelPickerList.tsx`, listed as one 862-line source file in `docs/module-quality-audit/modules/ui-components-model-picker/MODULE-AUDIT.md:20-33`. It exports four structural types at `ModelPickerList.tsx:17-31` and the React component at `ModelPickerList.tsx:339`. The component contract spans provider/model input, controlled search, selection callbacks, visibility filters, favorites, drag ordering, keyboard extension hooks, and footer rendering (`ModelPickerList.tsx:285-337`). The three production consumers I traced are `ModelMultiSelect.tsx:287-308`, `ModelControls.tsx:1537-1579`, and `ModelSelector.tsx:103-122`.

## Step 2 Threat and failure boundaries

This is a presentation module: it does not read credentials, files, processes, network responses, or persistent storage directly. Its input boundary is caller-supplied provider/model records and callbacks. IDs and names are rendered as React text (`ModelPickerList.tsx:634-650`), so React escaping remains in force; there is no HTML injection API or dynamic code execution. User actions cross back to owners only through `onSelect`, `onToggleFavorite`, and `onReorderFavorite` after disabled and lookup checks (`ModelPickerList.tsx:596-605`, `:658-676`, `:690-700`). Disabled reasons are derived from narrowed record fields in `providerModelAvailability.ts:62-84`. The tooltip timer is cleared on effect cleanup (`ModelPickerList.tsx:94-103`), avoiding a stale delayed state update after deactivation or unmount.

## Step 3 Correctness and interaction flow

Allowed-provider, hidden-model, and case-insensitive query constraints are applied consistently to favorites, recents, and provider sections (`ModelPickerList.tsx:385-445`). Only expanded-section entries enter `flatModelList` (`:447-456`), so row indexes agree with what is rendered. Whenever that list changes, selection normalizes to the first selectable entry and reports the active entry (`:480-485`); arrow navigation wraps and skips blocked models through `getNextSelectableModelPickerIndex` (`:487-503`, helper implementation `modelPickerSelection.ts:10-28`). Enter rechecks availability before selection, while Escape delegates closing (`ModelPickerList.tsx:505-535`). Drag completion ignores missing/same targets and resolves both entries from the current filtered-favorites map before invoking the owner (`:690-700`). One subtle behavior is intentional but deserves future test coverage: search is performed against `getModelDisplayName`, which truncates names longer than 40 characters (`:58-63`, used at `:408-445`), so matching follows the visible label rather than hidden suffix text.

## Step 4 Performance and render behavior

Provider maps, filtered sections, the flat list, and favorite lookup are memoized (`ModelPickerList.tsx:385-456`, `:461-466`). The index store targets notifications to only the old and new highlighted rows (`:158-194`), while the footer separately subscribes to global selection changes (`:214-226`). Filtering is linear in the normal catalog size, although `hiddenModels.some` at `:392-397` makes the worst case proportional to hidden entries times candidate models; this is a low-risk optimization opportunity if catalogs grow substantially. Tooltip metadata is computed per rendered row (`:553-563`) and tooltip content is not mounted until the 450 ms activation completes (`:94-117`). Drag sensing uses an eight-pixel activation threshold (`:383`), reducing accidental sorting work.

## Step 5 Design and ownership

The component owns UI composition and transient interaction state, while policy stays in dedicated pure modules: selection traversal in `desktop/packages/ui/src/lib/modelPickerSelection.ts:10-44`, availability decisions in `providerModelAvailability.ts:40-90`, and live/static metadata merging in `modelMetadata.ts:11-35`. That separation lets callers retain domain ownership: chat supplies variants and favorite reordering (`ModelControls.tsx:1550-1576`), multirun supplies selection counts and capacity disabling (`ModelMultiSelect.tsx:294-303`), and agent settings supplies provider restrictions plus the unselected option (`ModelSelector.tsx:103-121`). At 862 lines the component is large, but its extracted tooltip, selection-store, footer, sortable-row, and scrolling helpers (`ModelPickerList.tsx:88-283`) keep the main render path locally understandable without moving caller policy into the shared picker.

## Step 6 Hygiene and maintainability

The source has no `TODO`, `FIXME`, `HACK`, or catch block, and no commented-out implementation. Helpers and exported types have live uses in the component or its callers. `MODEL_COST_DISPLAY_ENABLED` is deliberately fixed to `false` at `ModelPickerList.tsx:35`, leaving the cost formatter and cost tooltip branch dormant at `:72-75` and `:142-150`; keeping that feature gate should be an explicit product choice because the compiler cannot exercise the UI branch in current builds. Disabled checks are repeated in normalization, row rendering, and sortable setup (`:476`, `:562-563`, `:800`), but all call the same policy function, avoiding rule drift. Formatting follows the repository's semicolon-free functional React style.

## Step 7 Test coverage

The pure navigation suite covers initial normalization, forward/backward skipping, the all-blocked result, and favorite cycling (`desktop/packages/ui/src/lib/modelPickerSelection.test.ts:15-65`). The availability suite covers image-only output, memory restrictions, context-fit blocking for remote and local providers, and large-context success (`providerModelAvailability.test.ts:6-69`). These tests support the component's most consequential guard paths. There is no direct `ModelPickerList` render or interaction test, so controlled search/filter combinations, collapsed-section reindexing, pointer-versus-keyboard ownership (`ModelPickerList.tsx:565-576`), drag callbacks, the delayed tooltip, and the unselected button (`:757-770`) remain uncovered at component level. That is a meaningful coverage gap, though the reviewed flow did not expose a release-blocking defect.

## Step 8 Findings review

`MODULE-AUDIT.md:64-68` records no accepted item, and the unit's `findings/` path contains no files. The independent source pass likewise found no Critical-severity security or correctness defect. The long-label search behavior, nested hidden-model scan, dormant cost branch, and missing component-level interaction tests are bounded follow-up observations rather than Critical findings. Because there is no Critical evidence item to confirm, the protocol does not require or create `reverify.md` for this primary `codex-sol` pass.

## Step 9 Verification and exit

Two focused helper suites passed with 9 tests total using `pnpm exec vitest run --config desktop/vitest.config.ts desktop/packages/ui/src/lib/modelPickerSelection.test.ts desktop/packages/ui/src/lib/providerModelAvailability.test.ts`. The package type check also passed with `pnpm --dir desktop/packages/ui run type-check`. I verified that the evidence paths and cited lines exist, that only the requested `ui-components-model-picker` artifact paths are added, and that the reviewer/verifier roles match `MODULE-AUDIT.md:11-16`. Primary-review status: all nine steps complete; independent verifier remains `ax-code-glm`.
