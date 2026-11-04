# Provider and model contracts

Status: Active
Scope: current-state
Last reviewed: 2026-11-04
Owner: AX Code runtime

Provider integration follows a shared resolution and preparation boundary:

Configuration, catalog and discovery -> resolved model -> request compiler -> SDK adapter -> transport.

## Model identities

`provider/model` remains the exact user selection, including configured aliases. `resolveModelIdentity` separately resolves the upstream deployment, adapter package, protocol profile revision and normalized endpoint. Endpoint paths and routing queries participate in identity, including deployments on the same host. Credentials and query values are hashed rather than exposed in diagnostic identities.

The context window store and token ledger use the deployment key. Language caches additionally include connection configuration, callback identity, model options, headers, limits and capability evidence because the cached request compiler captures that contract. Changing an alias alone does not invalidate deployment calibration. Changing a deployment path, upstream model or protocol does. Connection credentials invalidate the language/SDK configuration without exposing them in cache keys. Endpoint templates are resolved consistently for model reads, snapshots, cache lookup and SDK construction.

## Capability evidence and eligibility

Resolved capabilities contain a state (`supported`, `unsupported`, `unknown`) and source (`catalog`, `config`, `deployment`, `heuristic`, `unknown`). Family-based hints are reported separately from declarations. A missing field remains unknown; a generic `/models` response cannot establish tool or reasoning support.

The public compatibility DTO retains boolean fields. Missing tool support is represented as false in that DTO and unknown in the internal evidence. Custom model configuration must explicitly declare `tool_call: true` before tools are sent, or discovery must report support. Existing explicit provider/model pins remain exact. Declaring `tool_call: false` prevents a request containing tools before it reaches the SDK transport.

Deployment restrictions override positive family hints. Long-agent policy also preserves explicit registered restrictions: a positive capability claim cannot grant cache transport or bypass policy. UI eligibility, context policy and final request compilation use the same declarations, with policy-specific restrictions applied explicitly.

Display names do not determine model support or protocol dialects. Catalog family metadata can establish a family. Product model restrictions remain enforced and expose exclusion reasons through the registry snapshot and `ax-code debug routing`.

## Protocol profiles and request compilation

`protocol-profile.ts` owns provider option namespaces, reasoning dialect classification and schema dialects. Repository-prefixed model IDs do not automatically grant a native provider contract. For an explicitly qualified deployment, `model.options.protocolProfile` may select `qwen3.8`, `glm5.3`, `deepseek-v4`, `minimax-m3`, or `minimax-m2.7`. `openai-compatible` opts out of these native reasoning profiles. These local controls never become API body fields.

`Provider.getLanguage()` prepares every V3 language model with the final request compiler. Primary sessions and auxiliary generation therefore pass through the same boundary after their options and middleware have been applied. The compiler normalizes history and schemas, applies the profile's required-tool/reasoning constraints, rejects undeclared tool use and invalid output budgets, and caps output at the deployment's declared output limit. `model.options.structuredOutput: false` explicitly rejects JSON output requests. Compilation preserves caller data and is idempotent.

Existing `ProviderTransform` functions remain compatible preparation helpers. The final compiler is authoritative at dispatch. Provider-specific transforms should consume the resolved profile rather than add new display-name or gateway-name guesses at a call site.

## Registry and lifecycle

`Provider.list()`, `getProvider()` and `getModel()` return detached data. Mutating the returned model cannot change registry state. `Provider.snapshot()` returns a deeply immutable, credential-free view with resolved models, revision, exclusions, discovery phase and diagnostics. Discovery publishes a new revision; live contract or resolved endpoint changes also change the content-based revision. Snapshots already returned to callers remain stable.

Discovery phases are `pending`, `ready`, `partial`, and `failed`. `Provider.ready()` retains its completion-waiting behavior. Inspect the snapshot to distinguish completion from successful discovery. `ax-code debug routing` includes discovery and exclusion diagnostics; they describe catalog initialization rather than proving a model request will succeed.

SDK setup is shared and bounded by its existing install/load deadlines. Cancelling one subscriber stops its wait without aborting shared setup. Cancellable model preparation belongs to that caller and does not share another caller's cancellation signal. AX Engine retains its readiness and process cleanup ownership before returning or failing.

## Context calibration state

Positive and unknown calibration records have catalog fingerprints and freshness timestamps. Both expire after 30 days and are invalidated when the catalog window changes. Version 2 persistence stores provenance for unknown entries; legacy string-only negative entries are discarded. Valid legacy positive entries remain readable, while deployment key versioning prevents old ambiguous endpoint identities from being reused.

The store bounds positive and unknown entries, serializes writes, and preserves clear operations against late older writes. Observed calibration remains project-scoped and best-effort. Only token context overflow evidence calibrates token windows; byte-size failures do not.

## Adding or changing a provider

1. Keep connection/auth configuration separate from model selection and capability declarations.
2. Normalize the discovery response and attach evidence with `withCapabilityEvidence`; preserve unknown fields as unknown.
3. Declare a protocol profile only when the deployment contract supports it. Keep family hints separate from observed support.
4. Return model records through the Provider facade so identity, snapshots and final compilation apply uniformly.
5. Add offline SDK wire fixtures covering generation and streaming, tools, JSON output and reasoning history as relevant.
6. Add metamorphic cases for display-name/alias changes, endpoint changes, capability restrictions and repeated compilation.
7. Verify cancellation, discovery failure and concurrent refresh behavior. Preserve explicit fallback grants and local-inference route restrictions.

Relevant regression suites live in `test/provider/model-identity.test.ts`, `capability-evidence.test.ts`, `registry-contract.test.ts`, `request-compiler.test.ts`, `prepared-language-wire.test.ts` and `observed-window.test.ts`.
