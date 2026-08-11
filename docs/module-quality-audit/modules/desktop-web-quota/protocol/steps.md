# Protocol Steps — desktop-web-quota

Unit: `desktop-web-quota` · Reviewer: `ax-code-glm` · Verifier: `codex-sol`
Scope root: `desktop/packages/web/server/lib/quota`
Model: `zai-coding-plan/glm-5.2[1m]`

This document is an independent 9-step review produced by reading every file
under `desktop/packages/web/server/lib/quota/` (providers, google subtree,
utils, routes, index) plus the wiring at
`desktop/packages/web/server/lib/ax-code/feature-routes-runtime.js` and the
auth reader at `desktop/packages/web/server/lib/ax-code/auth.js`. Each step
cites concrete file:line evidence rather than the static inventory map.

## Step 1 Scope and inventory reconciliation

The module under review is `desktop-web-quota`, a registry-based quota fetcher
invoked by the desktop web server. The real public boundary is narrower than
the export count in MODULE-AUDIT suggests. Two entry points are actually wired:
`registerQuotaRoutes` (`desktop/packages/web/server/lib/quota/routes.js:1`) is
registered exactly once from
`desktop/packages/web/server/lib/ax-code/feature-routes-runtime.js:277`, and
that route handler only ever destructures `listConfiguredQuotaProviders`
(`routes.js:4`) and `fetchQuotaForProvider` (`routes.js:19`). The 16 per-provider
named exports (`fetchClaudeQuota` … `fetchWaferQuota`) declared in
`desktop/packages/web/server/lib/quota/providers/index.js:154-169` and
re-exported through `desktop/packages/web/server/lib/quota/index.js:11-25` have
no importer anywhere under `desktop/` (verified by content search). The
`DOCUMENTATION.md:38` note that `providers/openai.js` is "intentionally not
registered" is consistent with the registry at `providers/index.js:25-110`,
which has no `openai` key.

## Step 2 Contract and entrypoint analysis

Every provider funnels through `buildResult`
(`desktop/packages/web/server/lib/quota/utils/formatters.js:56-64`) which emits
`{ providerId, providerName, ok, configured, usage, fetchedAt }` plus an
optional `error`. Window payloads are normalized by `toUsageWindow`
(`utils/formatters.js:40-54`), which derives `remainingPercent`,
`resetAfterSeconds`, and formatted reset strings. The dispatcher
`fetchQuotaForProvider` (`providers/index.js:128-152`) returns a stable
`{ ok:false, configured:false, error:"Unsupported provider" }` for unknown IDs
and catches throws from `provider.fetchQuota()` (`providers/index.js:141-151`),
so the HTTP layer in `routes.js:13-26` always receives a result object. The
contract holds for the registry path; the named-export path bypasses the
dispatcher entirely and is therefore not part of the live contract.

## Step 3 Control flow and correctness

The dispatcher's try/catch in `providers/index.js:141-151` correctly isolates
per-provider failures from the route. The most significant correctness defect
is in the MiniMax pair. `desktop/packages/web/server/lib/quota/providers/minimax-coding-plan.js:81-86`
sets `intervalUsed = intervalUsage` then computes
`intervalUsedPercent = (intervalUsed / intervalTotal) * 100`. The China twin
`desktop/packages/web/server/lib/quota/providers/minimax-cn-coding-plan.js:82-85`
instead sets `intervalUsed = intervalTotal - intervalUsage` and derives the
percentage from that. Both read the same payload field
`current_interval_usage_count`, so the two files publish `usedPercent` values
that sum to 100 — one of them is displaying remaining-as-used. The same
inversion appears at `minimax-cn-coding-plan.js:83,90` for the weekly window.
This is silent (no error is thrown) and reaches the UI. A secondary issue:
`desktop/packages/web/server/lib/quota/providers/openai.js:56-59` passes raw
`primary.used_percent` / `primary.reset_at * 1000` without the `toNumber` /
`toTimestamp` coercion that its registered twin `codex.js:71-83` uses, so the
two would behave differently on the same `chatgpt.com` payload; openai.js is
unregistered so this is latent rather than live.

## Step 4 Error handling and resource robustness

Non-2xx handling is mostly consistent: providers cancel the body and return a
`buildResult` error (e.g. `claude.js:38-47`, `codex.js:50-62`, `copilot.js:67-76`).
Two gaps stand out. First, `desktop/packages/web/server/lib/quota/providers/zai.js:48-56`
returns the error result without calling `response.body?.cancel()`, leaking the
underlying connection on every non-ok Google-adjacent response — every other
provider cancels. Second, only `desktop/packages/web/server/lib/quota/providers/wafer.js:41`
(`AbortSignal.timeout(15_000)`) and the Google API helper
`desktop/packages/web/server/lib/quota/providers/google/api.js:53,79` enforce a
timeout. The other eleven live providers (`claude`, `codex`, `copilot`,
`kimi`, `nanogpt`, `openrouter`, `zai`, both `minimax-*`, `zhipuai`,
`ollama-cloud`) issue `fetch` with no abort signal, so a stalled upstream hangs
the desktop web request indefinitely. `routes.js` has no per-request timeout
either.

## Step 5 Design and ownership boundaries

The registry pattern in `providers/index.js:25-110` is the right shape: each
entry binds `{ providerId, providerName, isConfigured, fetchQuota }`, the list
API iterates `isConfigured()` under its own try/catch
(`providers/index.js:112-126`), and `fetchQuotaForProvider` dispatches by exact
ID. Google is correctly split into `auth.js`, `api.js`, `transforms.js`, and an
orchestrating `index.js` because it has two auth sources (Gemini +
Antigravity), token refresh, and multi-endpoint model fanout
(`google/index.js:40-86`, `google/auth.js:92-107`, `google/api.js:66-91`). The
Google branch is the one place `isConfigured` is computed dynamically
(`providers/index.js:41`) instead of referencing the module export, which is a
justified deviation. Ownership is clean: `utils/` holds cross-provider helpers,
providers never reach into each other, and `routes.js` knows nothing about
individual providers. The one leak is that `openai.js` duplicates `codex.js`
against the same `chatgpt.com/backend-api/wham/usage` endpoint with subtly
different coercion (Step 3); DOCUMENTATION.md:38 calls this "logic parity" but
the two have already drifted.

## Step 6 Duplication and dead code

`providers/index.js:154-169` declares 16 named fetch exports; all 16 are
re-exported by `quota/index.js:11-25`; none is imported by any consumer (only
`listConfiguredQuotaProviders` and `fetchQuotaForProvider` are reached via
`feature-routes-runtime.js:23-28`). Additionally
`providers/index.js:163` (`fetchZhipuaiCodingPlanQuota`) and
`providers/index.js:169` (`fetchZhipuaiQuota`) are literal aliases of the same
`zhipuaiCodingPlan.fetchQuota`. That is broad dead public surface. Beyond
exports, the per-provider `fetchQuota` bodies share a near-identical skeleton
(read auth → guard → fetch → non-ok cancel → parse → build windows → catch).
With 13+ instances sharing truly identical control flow (claude, codex,
copilot, kimi, nanogpt, openai, openrouter, zai, both minimax, zhipuai,
ollama-cloud, wafer), this clears the 3+ bar for extraction — a
`fetchQuotaJson({ url, headers, providerId, providerName, mapWindows, timeoutMs })`
helper would remove the Step 4 timeout gap and the Step 3 coercion drift in one
move. `providers/openai.js` itself is fully unregistered dead weight whose
logic already lives in `codex.js`.

## Step 7 Hygiene and conventions

Hygiene is generally strong: no empty catch blocks (each `catch` either returns
a `buildResult` error or has an explanatory comment such as
`providers/index.js:120-122` and `zhipuai-coding-plan.js:61-63`). ESM imports
are consistent and all files are type-module. Numeric/timestamp coercion is
centralized in `utils/transformers.js` (`toNumber`, `toTimestamp`,
`normalizeTimestamp`, `resolveWindowSeconds`). One localized smell:
`utils/transformers.js:37-43` hardcodes `ZAI_TOKEN_WINDOW_SECONDS = { 3: 3600 }`,
so `resolveWindowSeconds` only knows unit 3; the Zhipu TIME_LIMIT (month) path
sidesteps it by hardcoding `30 * 24 * 60 * 60` at
`zhipuai-coding-plan.js:129`, which is correct but fragile — any new window
unit silently maps to `null`. `google/transforms.js:78` computes
`resetAt = new Date(...).getTime()` directly instead of via `toTimestamp`,
diverging from the bucket path on the previous line cluster; for invalid input
this yields `NaN` rather than `null`, which `resolveGoogleWindow`
(`google/transforms.js:32-40`) happens to tolerate but is inconsistent.

## Step 8 Tests and coverage

Coverage is thin and uneven. Dedicated provider tests exist only for
`desktop/packages/web/server/lib/quota/providers/ollama-cloud.test.js` (2
cases: configured detection and cookie fetch, lines 37-88). The utils layer is
covered by `utils/auth.test.js` and `utils/formatters.test.js` (readJsonFile
edge cases and `toUsageWindow` clamping, including the `NaN`/`Infinity` guards
at `formatters.test.js:40-44`). None of the 13 other providers has a unit
test, so the Step 3 MiniMax inversion and the openai/codex coercion drift have
no regression net. The MiniMax divergence in particular would be caught by a
single shared fixture test asserting `usedPercent ∈ [0,100]` and consistent
semantics across the two providers. Adding provider-level tests for the
highest-traffic providers (claude, codex, google, copilot) and a parametrized
MiniMax pair test is the highest-leverage gap to close.

## Step 9 Findings register and verdict

Findings, by severity:

- **HIGH — correctness** MiniMax `usedPercent` inversion between
  `minimax-cn-coding-plan.js:82-85` and `minimax-coding-plan.js:81-86`; one
  provider shows remaining-as-used for both `5h` and `weekly` windows. Fix:
  confirm the upstream semantics of `current_interval_usage_count` and align
  both files; add a parametrized test.
- **MEDIUM — dead code** 16 unconsumed named fetch exports at
  `providers/index.js:154-169` re-exported at `quota/index.js:11-25`, including
  the duplicate alias pair `fetchZhipuaiQuota` / `fetchZhipuaiCodingPlanQuota`.
  Recommend deleting the named re-exports and keeping only the registry +
  dispatcher.
- **MEDIUM — robustness** 11 of 14 live providers have no fetch timeout; only
  `wafer.js:41` and `google/api.js:53,79` do. Add a default
  `AbortSignal.timeout` to the shared fetch helper proposed in Step 6.
- **MEDIUM — correctness (latent)** `openai.js:56-59` diverges from `codex.js`
  on the same endpoint (raw vs coerced fields). Either delete the unregistered
  `openai.js` or bring it to parity.
- **LOW — resource leak** `zai.js:48-56` skips `response.body?.cancel()` on
  non-ok, unlike every other provider.
- **LOW — fragility** `utils/transformers.js:37-43` window-unit map and the
  hardcoded month constant at `zhipuai-coding-plan.js:129`.

No Critical findings were identified, so no `reverify.md` is required for this
unit. Overall the module is well-structured (clean registry, centralized
coercion, no empty catches); the actionable work is the MiniMax correctness
fix, pruning the dead export surface, and closing the timeout/coverage gaps.
