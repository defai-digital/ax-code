# Review Protocol: ui-contexts

Reviewer: `ax-code-glm` (model `zai-coding-plan/glm-5.2[1m]`)
Independent verifier: `codex-sol`
Scope root: `desktop/packages/ui/src/contexts`
Baseline commit: `994f9287e497666e104644eccea299595a35b39a`
Date: 2026-08-11

Primary-reviewer pass over unit `ui-contexts`. Every claim below is anchored
to a concrete file and line range I opened during this pass.

## Step 1 Scope and public surface

The unit is seven files under `desktop/packages/ui/src/contexts`, matching the
inventory in `docs/module-quality-audit/modules/ui-contexts/MODULE-AUDIT.md:24-32`.
They split into three independent concerns plus their thin plumbing:

- Theme system — `ThemeSystemContext.tsx:1-721` exports `ThemeSystemProvider`
  (`:203`); `theme-system-context.ts:1-21` exports the `ThemeSystemContext`
  (`:21`) and `ThemeContextValue` type (`:5`); `useThemeSystem.ts:1-15` exports
  `useThemeSystem` (`:5`) and `useOptionalThemeSystem` (`:13`).
- Runtime API — `RuntimeAPIProvider.tsx:1-170` exports `RuntimeAPIProvider`
  (`:161`) plus the private `withContentCache` wrapper (`:13`);
  `runtimeAPIContext.ts:1-4` exports the bare `RuntimeAPIContext` (`:4`);
  `runtimeAPIRegistry.ts:1-9` exports the process-global escape hatch
  `registerRuntimeAPIs` (`:5`) and `getRegisteredRuntimeAPIs` (`:9`).
- Diff worker pool — `DiffWorkerProvider.tsx:1-241` exports `DiffWorkerProvider`
  (`:183`) and `useWorkerPool` (`:223`).

Consumers I traced: `ThemeSystemProvider` mounts at `desktop/packages/ui/src/main.tsx:96`
and `apps/renderElectronMiniChatApp.tsx:47`; `RuntimeAPIProvider` mounts at
`App.tsx:913` and `:956` and `apps/ElectronMiniChatApp.tsx:265`;
`DiffWorkerProvider` mounts at `components/layout/MainLayout.tsx:403`;
`useWorkerPool` is consumed at `components/views/PierreDiffViewer.tsx:23`;
`registerRuntimeAPIs`/`getRegisteredRuntimeAPIs` are wired in `App.tsx:37,295`
and exercised by `lib/persistence.test.ts:25,73,91` and
`stores/useQuotaStore.test.ts:44`. The two `.test.ts` files are the only
repository test coverage that touches this unit's surface.

## Step 2 Trust and failure boundaries

The three providers have distinct trust surfaces. `RuntimeAPIProvider` wraps a
`FilesAPI` with an in-memory cache and is the only provider that mediates file
content. Its `readFreshFile` does a deliberate stat→read→stat sequence
(`RuntimeAPIProvider.tsx:64-101`) to defeat TOCTOU, retrying once when the file
changes mid-read (`:82-97`). Stat failures are coerced to `null` via
`.catch(() => null)` at `:70,74,82,84,112`; each null path degrades safely
(either to an uncached re-read or to a never-matching `statMatches` at `:31-41`
that forces revalidation).

`ThemeSystemProvider` fetches custom themes from the desktop server
(`ThemeSystemContext.tsx:260-293`). Credentials are correctly omitted for the
local desktop origin (`:269`), a 401 short-circuits silently to let the UI auth
gate handle it (`:275-278`), and the response is validated field-by-field by
`isValidCustomTheme` (`:73-135`) which checks ~50 required nested paths and
narrows `metadata.variant` to `light|dark` (`:133-134`). The other failure
boundary is cross-window theme sync: the `message` listener rejects any event
whose `event.origin !== window.location.origin` (`:484`) before applying a
payload that is re-validated in `applyIncomingThemeSync` (`:425-458`). The
postMessage path is origin-checked; the sibling `window.__openchamberApplyThemeSync`
global registered at `:465-475` is not, but any same-page caller already has
full page access, so this is defense-in-depth only (see Step 6).

`DiffWorkerProvider` touches no secrets or filesystem; its boundary is worker
lifecycle. Pool creation is SSR-guarded (`DiffWorkerProvider.tsx:49-51,80-82`),
and the dynamic `@pierre/diffs/worker` import is wrapped so an import failure
clears the cached promise (`:93-99,111-115`) rather than permanently rejecting,
allowing a later retry. No empty catch swallows an unexpected error here.

## Step 3 State and correctness review

`RuntimeAPIProvider.withContentCache` correctness depends on the caller
passing a stable `apis` reference. The provider computes `cachedApis` via
`React.useMemo(() => ({ ...apis, files: withContentCache(apis.files) }), [apis])`
(`RuntimeAPIProvider.tsx:162-168`), and `App` receives `apis` as a plain prop
(`App.tsx:221` `function App({ apis }: AppProps)`). When the parent hands down
a fresh object, the memo rebuilds the wrapper: a brand-new `cache = new Map()`
is created inside `withContentCache` (`:14`), but the bytes for every entry the
old Map inserted still live in the shared module-level LRU at
`sync/content-cache.ts:14-15` (`lru` / `total`). Those orphaned entries are
only removed when `removeContentBytes` is invoked — and that call lives on the
now-discarded closure (`:16-19,132,139,146`). The shared LRU is bounded at
`MAX_FILE_CONTENT_BYTES = 20MB` / `MAX_FILE_CONTENT_ENTRIES = 40`
(`content-cache.ts:10-11`) and `evictContentLru` runs on every `syncCacheEntry`
(`RuntimeAPIProvider.tsx:56-59`), so growth is not unbounded — but a stale
`resetContentLru` (`content-cache.ts:66-69`) is never called by the provider,
so orphaned entries linger in the shared budget and crowd out the live cache
until pressure eviction kicks in. This is a Medium correctness/efficiency
issue (Step 8).

`ThemeSystemProvider` state is large but internally consistent. The
`storage`-event handler (`ThemeSystemContext.tsx:382-423`) only updates
preferences, and the localStorage-write effect (`:359-380`) does not re-fire a
storage event in the same window, so there is no self-perpetuating loop. The
`applyIncomingThemeSync` path uses `flushSync` (`:445-457`) to avoid a themed
flash; this is intentional but forces a synchronous render on every incoming
sync message. `buildInitialPreferences` (`:137-196`) reads six localStorage
keys including three legacy ones (`useSystemTheme`, `selectedThemeId`,
`selectedThemeVariant`) and migrates them into the `themeMode`/`lightThemeId`/
`darkThemeId` triple — backward-compatible and idempotent.

## Step 4 Performance characteristics

`DiffWorkerProvider` is the performance-sensitive surface and its design is
sound. Pool creation is deferred off the cold-start critical path via
`requestIdleCallback` with a 2s timeout and a 1s `setTimeout` fallback
(`DiffWorkerProvider.tsx:150-173`); pools are memoized per style at module scope
(`:43-46,79-117`); and `syncPoolRenderTheme` (`:119-133`) only reconfigures pools
that already exist rather than recreating them. `useWorkerPool`
(`:223-241`) is a cheap subscribe-on-style-change hook. The one cost worth
noting is that the two pools (unified poolSize 1, split poolSize 2, per
`WORKER_POOL_CONFIG` at `:27-41`) are both warmed on idle regardless of whether
the split pool is ever requested — a minor eager-allocation tradeoff that is
explicit and acceptable.

`RuntimeAPIProvider`'s cache validation does a stat on every hit
(`RuntimeAPIProvider.tsx:111-120`), so a cached read still pays one stat round
trip; this is the correctness/performance tradeoff for TOCTOU safety and is
reasonable. The cache Map is local to each `withContentCache` invocation
(`:14`), so lookups are O(1) and eviction delegates to the bounded shared LRU.

`ThemeSystemProvider` runs several effects on every preference change:
`cssGenerator.apply` + DOM chrome update inside a `useIsomorphicLayoutEffect`
(`ThemeSystemContext.tsx:329-342`), a synchronous localStorage write block
(`:359-380`), and a `updateDesktopSettings` IPC (`:504-526`). These are each
O(1) but they fire together on every theme toggle; the localStorage writes are
synchronous and could be batched, though the volume is low (user-driven).

## Step 5 Design and ownership

The three concerns are cleanly separated into their own files with no cross-
dependency except the single deliberate `useOptionalThemeSystem` call from
`DiffWorkerProvider.tsx:184` to read theme ids for render-theme sync. The
context/hook split is idiomatic: `theme-system-context.ts` holds the type +
`createContext` (`:1-21`), `useThemeSystem.ts` holds the consumer hooks with a
throw guard for the required variant (`:7-9`) and a non-throwing optional
variant (`:13-15`), and `ThemeSystemContext.tsx` holds only the provider
implementation. `runtimeAPIContext.ts` + `runtimeAPIRegistry.ts` mirror this
pattern, with the registry acting as a documented escape hatch for non-React
code paths (`App.tsx:295` registers, `lib/persistence.test.ts:25` reads).

One design redundancy: `ThemeSystemContext.tsx:359-380` writes a `splash*` set
of localStorage keys derived from theme objects, and `:504-526` writes the same
values via `updateDesktopSettings` IPC. Both are keyed off the same preference
state and are independently idempotent, so this is mild duplication rather than
a defect — both sinks serve different consumers (splash HTML vs. Electron
settings) and neither can subsume the other.

## Step 6 Hygiene and dead code

I read every export and every helper. No dead code: all of
`runtimeAPIRegistry.ts` is consumed (`App.tsx:295`, the two test files);
`runtimeAPIContext.ts:4` is consumed by `RuntimeAPIProvider.tsx:169`; the
`ThemeContextValue` fields at `theme-system-context.ts:5-19` are all populated
by the provider value object at `ThemeSystemContext.tsx:704-718` and read by
consumers. The module-level singletons in `DiffWorkerProvider.tsx:43-46` and
`runtimeAPIRegistry.ts:3` are intentional and SSR-guarded where relevant.

The `catch { // ignore }` at `ThemeSystemContext.tsx:288` inside
`reloadCustomThemes` is the one hygiene note worth recording: it swallows every
fetch failure for custom themes with no telemetry, no retry, and no user
feedback. The audit map at `MODULE-AUDIT.md:24-32` reports `0` empty catches
for every file including `ThemeSystemContext.tsx`; that count reflects a
scanner that excludes comment-only bodies, so this effectively-swallowed catch
is invisible to the static ledger. I am recording it as a Low finding (Step 8),
not a discrepancy to re-file, because a comment-only catch is a defensible (if
suboptimal) choice for a non-critical fetch.

## Step 7 Test coverage assessment

The audit inventory (`MODULE-AUDIT.md:47-48`) records no auto-matched tests for
this unit, and repository search confirms the only coverage is indirect:
`desktop/packages/ui/src/lib/persistence.test.ts:25,73,91` and
`stores/useQuotaStore.test.ts:44` stub `getRegisteredRuntimeAPIs` to feed the
system under test. None of the three providers has a direct unit test. Specific
gaps I observed against the source:

- The TOCTOU retry path in `RuntimeAPIProvider.tsx:82-97` (stat mismatch →
  one re-read) and the always-fresh `allowOutsideWorkspace` branch (`:105-107`)
  have no test.
- The orphaned-entry behavior described in Step 3 (shared LRU retaining entries
  after the per-provider Map is rebuilt) is not exercised.
- `isValidCustomTheme`'s ~50-path allowlist (`ThemeSystemContext.tsx:78-135`)
  has no test pinning which malformed payloads it rejects.
- `applyIncomingThemeSync` origin checking (`:483-484`) and the
  `__openchamberApplyThemeSync` global (`:465-475`) have no test.
- `DiffWorkerProvider` pool memoization, idle warmup, and
  `syncPoolRenderTheme` reconfiguration have no test.

These are coverage notes for a follow-up implementer, not blocking defects —
the logic that exists is correct by reading, it is simply not pinned by tests
in this package.

## Step 8 Findings register

After reading all seven files in full plus `sync/content-cache.ts` and the
consumer call sites, the existing ledger (`MODULE-AUDIT.md:64-66`) records
`_none accepted_` and `findings/` is empty. This pass identifies no Critical or
High items, so the conditional `protocol/reverify.md` secondary-confirmation
file is not required by the gate. The concerns I record here for follow-up are:

- **Medium** — `RuntimeAPIProvider` couples per-instance cache eviction to a
  shared module-level LRU (`sync/content-cache.ts:14-15`); when the `apis` prop
  identity churns the per-provider Map is rebuilt (`RuntimeAPIProvider.tsx:14,162-168`)
  and orphaned entries linger in the shared 20MB/40-entry budget
  (`content-cache.ts:10-11`) until pressure eviction, because `removeContentBytes`
  is only reachable from the discarded closure and `resetContentLru`
  (`content-cache.ts:66`) is never called by the provider.
- **Low** — `reloadCustomThemes` swallows all custom-theme fetch errors in a
  comment-only catch (`ThemeSystemContext.tsx:288-290`) with no telemetry,
  making transient failures invisible; this is the same site the static
  scanner counted as `0` empty catches.
- **Low** — the `window.__openchamberApplyThemeSync` global
  (`ThemeSystemContext.tsx:465-475`) applies theme-sync payloads without the
  origin check that guards the equivalent `message` listener (`:483-484`); this
  is defense-in-depth only since any same-page caller already has full DOM
  access.

None of these meets the Critical bar, so no `findings/*.md` entry is filed in
this pass and the gate does not require a reverify artifact.

## Step 9 Verification and exit

This is a documentation-only primary-reviewer pass that made no code changes,
so the verification here is the on-disk correctness of the protocol artifacts
and the internal consistency of the evidence above. Concretely:

- Every file:line reference in steps 1–8 resolves to a real location I opened
  during this pass: the seven context files, `desktop/packages/ui/src/sync/content-cache.ts`,
  the consumer sites `App.tsx`, `main.tsx`, `MainLayout.tsx`,
  `PierreDiffViewer.tsx`, `renderElectronMiniChatApp.tsx`,
  `ElectronMiniChatApp.tsx`, and `lib/persistence.test.ts` /
  `stores/useQuotaStore.test.ts`, plus `MODULE-AUDIT.md`.
- No Critical-severity items exist for `ui-contexts` (the `findings/` directory
  is empty and this pass raised none at Critical/High), so `protocol/reverify.md`
  is not created by the gate.
- Recommended live checks for a follow-up implementer editing this unit are
  `pnpm --dir desktop exec vitest run src/lib/persistence.test.ts src/stores/useQuotaStore.test.ts`
  for the only tests that touch this surface, and `pnpm run desktop:typecheck`
  for the provider types; I did not execute them here because this pass made
  no code changes.

Exit status: 9-step protocol complete as primary reviewer (`ax-code-glm`); the
unit remains `REVIEWING` pending the independent verifier (`codex-sol`)
sign-off recorded in `MODULE-AUDIT.md`.
