# Nine-step review: provider-xai

Unit slug: `provider-xai`  
Reviewer: `codex-sol`  
Verifier lane: `ax-code-glm`

## Step 1 Define Scope and Entry Points

The unit exposes one built-in authentication plugin and two Live Search helpers. `xaiAuthPlugin` returns the `xai` auth hook and its single device-code method at `packages/ax-code/src/provider/xai/auth-plugin.ts:26-33`, with the named plugin export at line 119. `LiveSearchConfig`, `supportsLiveSearch`, and `buildSearchParameters` are declared at `packages/ax-code/src/provider/xai/server-tools.ts:32-39` and `:56-75`. Production integration is direct: the plugin registry includes the auth hook at `packages/ax-code/src/plugin/index.ts:32-33`, provider request shaping calls `buildSearchParameters` at `packages/ax-code/src/provider/transform.ts:539-549`, and the system-prompt path separately calls `supportsLiveSearch` at `packages/ax-code/src/session/system.ts:78-91`.

## Step 2 Inspect Authentication Trust Boundaries

The browser/device boundary posts the public OAuth client identifier and scopes to xAI at `packages/ax-code/src/provider/xai/auth-plugin.ts:3-6` and `:34-38`; the device code then crosses back to the token endpoint at `:70-79`. Access and refresh tokens remain in local variables and are returned through the typed auth result at `:96-107`; this module does not log either token. The initial non-success branch includes the remote response text in an exception at `:40-42`, which is useful diagnostic context but could relay arbitrary service text into upper-layer error reporting. The persisted credential boundary is explicit in `packages/ax-code/src/cli/cmd/providers-impl.ts:111-130`: refresh-shaped results become OAuth records and key-shaped results become API-key records. `CLIENT_ID` is an OAuth public identifier, not a client secret.

## Step 3 Trace Polling and Credential Correctness

Cancellation is handled both before sleeping and through a one-shot abort listener at `packages/ax-code/src/provider/xai/auth-plugin.ts:11-23`; the callback polls only while before `expiresAt`, sleeps between attempts, honors `authorization_pending`, and increases the interval for `slow_down` at `:53-66` and `:86-90`. A High correctness defect exists in the refresh-token success path: lines `96-102` return OAuth credentials, but the hook at `:26-117` defines no `loader`. Core provider initialization loads API records directly at `packages/ax-code/src/provider/provider-impl.ts:504-514`, while OAuth records are applied only when a plugin loader exists at `:526-540`. Thus an xAI device flow that returns the requested offline refresh token can report success and persist credentials that never configure `@ai-sdk/xai`; the access-only fallback at `auth-plugin.ts:104-107` avoids this because it is saved as an API key.

## Step 4 Evaluate Timing and Resource Bounds

The callback performs at most one token fetch at a time, and its lifetime is bounded by the server expiry or the five-minute fallback computed at `packages/ax-code/src/provider/xai/auth-plugin.ts:9` and `:53-54`. Each retry passes through the timer at `:64-66`, while xAI's `slow_down` response adds five seconds at `:87-89`, so ordinary pending authorization cannot spin. The response fields are asserted rather than runtime-validated at `:44-51`; a negative or non-finite `interval` could therefore collapse the timer delay and cause unnecessarily rapid polling, a resilience gap at a remote-data boundary. The Live Search helpers do only lowercase and substring checks plus a small object spread at `packages/ax-code/src/provider/xai/server-tools.ts:56-59` and `:68-74`, so their per-request CPU and allocation cost is constant.

## Step 5 Check Integration and Representation Design

`server-tools.ts` keeps provider-specific eligibility and defaults together: multi-agent IDs are rejected before the broad `grok-4` match at `packages/ax-code/src/provider/xai/server-tools.ts:56-60`, and user values override defaults at `:68-75`. The transform correctly omits the option for unsupported models or explicit `mode: "off"` through the call at `packages/ax-code/src/provider/transform.ts:545-549`. A separate Medium correctness inconsistency appears in the prompt integration: `SystemPrompt.environment` decides only from npm package and model ID at `packages/ax-code/src/session/system.ts:78-91`, despite provider options being available elsewhere in request setup at `packages/ax-code/src/session/llm-impl.ts:133-159` and `:241-249`. Consequently a user who disables Live Search still receives the claim that it is enabled and that citations arrive automatically (`system.ts:90-104`).

## Step 6 Review Failure Handling and Maintenance Signals

Neither candidate contains TODO/FIXME markers, suppression directives, unsafe casts to `any`, or dead exported branches. The only catch is the polling recovery at `packages/ax-code/src/provider/xai/auth-plugin.ts:69-84`; it rethrows cancellation but treats network failures and JSON-decoding failures as transient. That policy remains expiry-bounded, although it erases the distinction between a temporary transport error and a persistent malformed token response. Device authorization failures are surfaced immediately at `:40-42`, while terminal OAuth errors and missing access tokens return a typed failure at `:91`. The comments at `packages/ax-code/src/provider/xai/server-tools.ts:1-15` clearly distinguish Live Search from the unsupported Agent Tools endpoint, reducing the risk of sending the documented configuration to the wrong xAI API.

## Step 7 Assess Focused Test Coverage

The auth suite proves already-aborted cancellation, the access-token-as-key fallback, and the refresh-shaped result at `packages/ax-code/test/provider/xai/auth-plugin.test.ts:8-106`. It does not continue through provider initialization, so it misses the absent-loader defect; it also lacks `authorization_pending`, `slow_down`, expiry, non-JSON, non-2xx token, and invalid interval cases. Eligibility examples cover supported Grok 4.5, multi-agent exclusion, and a retired SKU at `packages/ax-code/test/provider/model-support.test.ts:114-126`. Transform tests exercise defaults, unsupported IDs, explicit off, and overrides at `packages/ax-code/test/provider/transform.test.ts:1141-1212`. The environment tests do not include xAI (`packages/ax-code/test/session/system.test.ts:74-101`), leaving the disabled-search prompt contradiction unguarded.

## Step 8 Reconcile Audit Records and Severity

The module register currently lists no accepted finding at `docs/module-quality-audit/modules/provider-xai/MODULE-AUDIT.md:64-68`, and the unit's `findings/` directory is empty. This pass records the unusable refresh-token path as High and the false disabled-search prompt as Medium in the protocol because the requested output set does not include new finding records. Neither issue permits secret disclosure, remote code execution, privilege escalation, or irreversible data loss, so neither meets Critical severity and `protocol/reverify.md` is not required. The register's role table still names ax-code-glm as reviewer and codex-sol as verifier at `MODULE-AUDIT.md:11-16`; these artifacts follow the explicit unit assignment naming codex-sol as reviewer and ax-code-glm as verifier without modifying the pre-existing audit file.

## Step 9 Run Verification and Determine Handoff

The focused command `AX_TEST_FILES=test/provider/xai/auth-plugin.test.ts,test/provider/model-support.test.ts,test/provider/transform.test.ts,test/session/system.test.ts pnpm exec vitest run` completed with four files and 176 tests passing. `pnpm --dir packages/ax-code run typecheck` also completed successfully. These results cover the tests cited above and the exported types, but they do not negate the two integration defects established by the production call paths in Steps 3 and 5. The `provider-xai` review is complete for ax-code-glm handoff with no Critical secondary-confirmation artifact.
