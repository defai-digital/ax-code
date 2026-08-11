# Protocol — provider-registry (9-step review)

Unit slug: `provider-registry`
Reviewer lane: `ax-code-glm` (model `zai-coding-plan/glm-5.2[1m]`)
Independent verifier lane: `codex-sol`
Baseline commit: `5fefa00cdc847667d3ba3d38509a751498ee4180`

This is a real, evidence-backed pass over the nine candidate sources for the
`provider-registry` unit (root: `packages/ax-code/src/provider`). Every claim
below cites a concrete `file:line` that I actually read during this run.

## Step 1 Scope and inventory

The unit is the provider/model registry and routing layer that sits between
`Config`/`Auth`/`ModelsDev` and the agent runtime. The nine files break into
four clear responsibilities:

- **Capability declarations** — `packages/ax-code/src/provider/model-capabilities.ts`
  holds the declarative `MODEL_REGISTRY` array (lines 144–429) plus the
  `getModelCapabilities` first-match resolver (lines 478–485).
- **Identity helpers** — `model-id.ts` (normalize / final-segment),
  `model-key.ts` (`providerModelKey`/`isProviderModelKeyInput`).
- **Snapshot ingestion** — `model-info.ts` (Zod schemas + defensive
  `fromModelsDevProvider`), `models.ts` (`ModelsDev` namespace with file/URL/
  bundled loaders and `sanitize`), `model-support.ts` + `model-selectability.ts`
  (allow/deny rules applied during ingestion).
- **Runtime wiring** — `provider-impl.ts` (`Provider` namespace: state,
  discovery, SDK loading, `getModel`/`getLanguage`/`defaultModel`) and the
  one-line re-export `provider.ts`.

`provider-impl.ts` dominates at 1414 lines; the other eight files total ~1250.
The capability layer (`model-capabilities.ts`) is the second hotspot at 584
lines and is the file most likely to drift as new SKUs ship.

## Step 2 Threat and failure model

The unit handles three untrusted inputs: (a) the bundled `models-snapshot.json`,
(b) `AX_CODE_MODELS_PATH` / `AX_CODE_MODELS_URL` overrides, and (c)
user/plugin `config.provider` entries. Each has a documented defense:

- `models.ts:223` gates `AX_CODE_MODELS_PATH` through `isAllowedModelPath`
  (lines 193–209), which `fs.realpath`s the target and confines it to
  `Global.Path.config|data|home` plus the active worktree/instance dir.
- `models.ts:239` runs `AX_CODE_MODELS_URL` through `Ssrf.assertPublicUrl`
  before `Ssrf.pinnedFetch` with a 10s `AbortSignal.timeout`.
- `provider-impl.ts:963` restricts dynamic SDK install to `@ai-sdk/*` via
  `NPM_ALLOWLIST`, and `provider-impl.ts:1008–1034` re-adds the allowlist for
  `file://` specifiers (resolving `realpath` and confining to worktree/data/
  cache/config). The inline comment at 1010–1014 calls out the prior RCE-via-
  config-injection bug this guards.
- Auth strings are sanitized at `provider-impl.ts:117–121` (CR/LF strip) and
  secrets are redacted from cache keys at `provider-impl.ts:158–169` via
  `isSecretOptionKey` (146–156).

Residual failure modes I checked: `fromModelsDevModel`/`fromModelsDevProvider`
(`model-info.ts:96`, `:164`) swallow errors and return `undefined`, so one bad
snapshot entry cannot kill `Provider.warmup`. `provider-impl.ts:678–681`
wraps `runDiscovery` in `.catch` so an unhandled rejection in the warmup path
cannot surface to TUI callers.

## Step 3 Correctness — registry resolution

The capability resolver at `model-capabilities.ts:478–485` walks
`MODEL_REGISTRY` in order and returns the first
`matchesPattern && matchesProvider` hit, falling back to
`DEFAULT_CAPABILITIES` (127–136). Ordering is therefore load-bearing: every
provider-specific Qwen/GLM entry (e.g. 159–172 for Alibaba 3.7–3.9 Max, 361–374
for GLM 5.x on Z.AI routes) is placed before its provider-agnostic fallback
(206–219, 381–393). I verified there is no case where a fallback precedes a
specific entry.

`matchesPattern` (437–443) tests the RegExp against both the raw and
`normalizeProviderModelId` form. This is required because the registry regexes
use `[\.\-_]?` separators, while the normalized form strips them — e.g.
`qwen-3-7-max` normalizes to `qwen37max` which the pattern
`/qwen[\.\-_]?3[\.\-_]?7[\.\-_]?max/i` would _not_ match without the
double-test. Correct.

`getContextPackBudget` (527–536) and `supportsLongAgent` (506–513) both derive
from `getModelCapabilities`. The long-agent gate requires `contextWindow >= 64000`
_and_ thinking/promptCache to be at least `experimental`. GLM 5.x sets those to
`experimental` (367–368) precisely so the long-agent path activates even before
probe-verification — documented inline at 356–360 (ADR-040). Behaviour matches
intent.

## Step 4 Correctness — provider state and caching

`Provider.state` (`provider-impl.ts:300–710`) builds the in-memory provider map
once per instance directory and is cached by `Instance.state`. Cache
invalidation flows through two primitives: `invalidate()` (749–757) clears the
current directory’s state and bumps `modelCacheGeneration`; `invalidateAll()`
(768–797) walks `Instance.list()` peers, deliberately avoiding nested
`Instance.provide` for the active directory to prevent the Auth.set→init
deadlock documented at 763–767.

`getLanguage` (1136–1205) reads `modelCacheGeneration` after every await and
reroutes through `retryAfterInvalidation` (1144–1149) when the generation
moves. The in-flight dedup at 1156–1161 + 1194 + 1201–1203 is correctly
bracketed: the `modelPending.set` runs synchronously after the loader promise
is constructed (no await between the miss-check and the registration), and the
finally-block only deletes the entry when it still owns it. I traced a
concurrent-invalidation scenario and the retry cap
`MODEL_CACHE_INVALIDATION_RETRY_LIMIT = 8` (line 69) bounds it correctly.

`getModel` (1090–1134) does a discovery-aware retry at 1106–1109: when the
model is missing _and_ the caller hasn’t already awaited this discovery
instance, it awaits `s.discovery` and recurses with the discovery identity as
the sentinel. This means a second `invalidate()` swapping in a fresh
discovery is re-awaited, while a genuinely-missing model terminates after one
wait. Correct and elegant.

## Step 5 Performance and hot paths

The registry is constructed at boot and read on every agent turn, so the
constant-factor work matters. Good decisions observed:

- `ModelsDev.get` (`models.ts:262–268`) memoizes the sanitized view keyed on
  the `Data()` object identity, so `sanitize(withCloudApiKeyAliases(withBuiltIns))`
  only runs once per snapshot load — not once per `Provider.state`.
- `getSDK` deduplicates concurrent installs via `sdkPending` at 879–880 +
  1057–1062, and caches the resolved SDK by `cacheKeyPart` (167–169, 872).
  A 5s negative cache (`PROVIDER_INSTALL_NEGATIVE_CACHE_MS`, line 803) caps
  repeated registry failures.
- Background discovery (`provider-impl.ts:633–671`) is fire-and-forget so the
  TUI is not blocked on the slowest CLI probe; `list()` returns immediately
  while `ready()`/`getModel` await discovery on demand.

One mild concern: `applyModelFilters` (`provider-impl.ts:358–402`) and the
provider sweep at 607–622 delete keys from `provider.models`/`providers` during
iteration. `Object.entries` snapshots the keys first so this is safe, but it is
the kind of pattern that breaks silently if someone refactors to `for (const k
in obj)`. Worth a comment-level note, not a fix.

## Step 6 Design and ownership

The capability layer (`model-capabilities.ts`) and the snapshot/SDK layer
(`models.ts` / `provider-impl.ts`) are deliberately decoupled: selectability
and support filtering (`model-selectability.ts`, `model-support.ts`) operate on
the snapshot-derived `ProviderModel` shape, while capability queries operate
on model-ID strings only. The inline comment at `model-capabilities.ts:376–380`
makes this explicit — a registry match affects only capability bookkeeping,
not which SKUs surface in the picker. This separation is sound.

Two design smells worth recording (not blocking):

1. The deprecated `isQwen37MaxModel` / `isQwen37PlusModel` wrappers
   (`model-capabilities.ts:547–573`) delegate to `qwen37-readiness.ts:111–122`,
   which is a _separate_ detection path from the `MODEL_REGISTRY` regexes.
   Two sources of truth for “is this a Qwen 3.7 Max” (the regex at 160 vs the
   normalized `includes("qwen37max")` check) is a migration debt. The
   `@deprecated` JSDoc is present, so callers should drain, but no removal
   date is anchored.
2. `model-selectability.ts` exports two near-neighbor functions,
   `providerModelSelectable` (flat input, 38–41) and
   `modelSelectableForProvider` (nested `SelectableModel`, 43–53). The shapes
   diverge only by `capabilities?.toolcall` resolution and the memory/text
   guards; consolidation would remove ~6 lines and one footgun. Not worth a
   refactor on its own.

## Step 7 Hygiene and dead code

- `model-info.ts:140–141` initialises `variants: {}` and then unconditionally
  overwrites it with `m.variants = mapValues(ProviderTransform.variants(m), …)`.
  The empty assignment is dead.
- `model-support.ts:4` keeps `"glm-5.1[1m]"` in `GLM_HIDDEN_FINAL_SEGMENTS`.
  That bracketed form is a client-side context-window selector
  (`provider-impl.ts:101–110` documents the `[Nm]` convention); the bare id
  form `"glm-5.1-1m"` is also in the set, so this is harmless belt-and-
  braces, but the bracketed entry is unreachable through normalised probes.
- `model-capabilities.ts:582–584` `listRegisteredModels` returns a shallow
  copy of `MODEL_REGISTRY`, so the inner `capabilities` objects are shared by
  reference. Callers treat the result as read-only today, but a defensive
  deep copy (or `structuredClone`) would prevent future registry corruption
  if someone mutates a returned entry.
- `provider-impl.ts:282–290` `BUNDLED_PROVIDERS` maps four SDK packages; the
  inline comment at 285–287 explains why Meta Muse Spark pins
  `@ai-sdk/openai` rather than `-compatible`. No dead entries.

No empty catch blocks anywhere in the unit (MODULE-AUDIT row confirms 0/0).
The defensive catches in `model-info.ts:144` and `models.ts:215` log with
context (`providerID`, `modelID`, `source`, `file`, `error`) and either skip
the entry or fall through — they are intentional, not silent.

## Step 8 Finding register

After reading the nine sources end-to-end I am recording **no Critical or High
findings**. The observations worth tracking are all LOW severity and are
captured inline above (dead `variants: {}` assignment, shallow-copy exposure
of `MODEL_REGISTRY`, dual Qwen-37 detection paths via the deprecated wrappers,
bracketed id in `GLM_HIDDEN_FINAL_SEGMENTS`). None of these block the
`provider-registry` gate; each is a candidate for a follow-up hygiene ticket
rather than a finding-accept action item. The `findings/` directory remains
empty for this run, so the Step 9 critical-reverify gate does not trigger.

## Step 9 Verification and exit

This protocol pass is read-only: no production code was modified, so the
typecheck/test sandwich does not apply to the unit itself. For completeness,
the verification commands a follow-up implementer should run after any change
to this unit are:

- `pnpm --dir packages/ax-code run typecheck` (recursive; uses `tsgo`)
- `pnpm --dir packages/ax-code run test:unit` (registry/selectability tests)
- `pnpm --dir packages/ax-code run test:recovery` (state invalidation paths)

The `provider-registry` unit is structurally sound: trust boundaries are
documented and enforced (SSRF, allowlist, realpath confinement), the
capability resolver and cache invalidation logic are correct under the
concurrency model I traced, and the residual debt is hygiene-level. Reviewer
`ax-code-glm` sign-off on this 9-step pass; independent verifier `codex-sol`
pending its own pass.
