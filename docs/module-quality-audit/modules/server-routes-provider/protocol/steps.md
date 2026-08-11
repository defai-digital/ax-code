# Review Protocol — server-routes-provider

- Unit: `server-routes-provider`
- Primary reviewer: `ax-code-glm` (model `zai-coding-plan/glm-5.2[1m]`)
- Independent verifier (other lane): `codex-sol`
- Source under review: `packages/ax-code/src/server/routes/provider.ts` (728 lines)
- Baseline commit: `ad9a854c3f8f6cc3ffc48c356a2546d3f23e9945`

## Step 1 Scope and source map

The unit is a single Hono route module mounted under `/provider`. It exposes one
public non-route helper (`shouldShowProviderInList` at
`packages/ax-code/src/server/routes/provider.ts:53`), four exported request-body
schemas (`AxEnginePrepareBody:64`, `AxEngineStartBody:76`,
`AxEngineModelActionBody:87`, `AxEngineConnectionBody:94`), and the lazy route
registry `ProviderRoutes` at `:186`. The registry wires 13 operations: provider
list (`:188`), six ax-engine lifecycle endpoints, two download-job endpoints,
the auth-methods listing (`:633`), and the two OAuth endpoints
(`authorize :655`, `callback :691`). I cross-read the validation wrapper at
`packages/ax-code/src/server/validation.ts:4`, the error envelope mapping at
`packages/ax-code/src/server/error.ts:260`, and the redaction helpers in
`packages/ax-code/src/server/routes/config.ts:125` to confirm how the route
handlers compose with shared server infrastructure.

## Step 2 Threat and failure model

The module touches three sensitive asset classes: (a) outbound network calls to
a user-supplied endpoint (`probeAxEngineConnection` invoked at
`packages/ax-code/src/server/routes/provider.ts:325`), (b) credential storage
via `Auth.set` / `Auth.remove` (`:289`, `:330`, `:183`), and (c) long-lived
download jobs that hold an `AbortController` (started through `startDownloadJob`
at `:400`). I traced the SSRF boundary into
`packages/ax-code/src/provider/ax-engine/connection.ts:39`, where
`normalizeAxEngineEndpointBaseURL` rejects non-local hostnames, embedded
userinfo, query strings, fragments, and `0.0.0.0` — so the attach probe at
`:325` cannot be redirected at an arbitrary LAN host with the bearer key. The
credential flow stores the attach key only in encrypted `Auth` storage
(`:330`) and writes an empty `apiKey` into plaintext config via
`axEngineAttachProviderConfig` (`connection.ts:106`), which the test at
`packages/ax-code/test/server/provider-routes.test.ts:254` asserts. No empty
catches exist in the route file; the three `.catch` blocks at `:346`, `:524`,
`:565`, `:603`, `:627` all route failures into a `log.warn` and continue, which
is correct because they are best-effort invalidation/cleanup calls that must not
mask the primary response.

## Step 3 Correctness of control flow

I traced the two non-trivial handlers in detail. The PUT
`/ax-engine/connection` handler (`packages/ax-code/src/server/routes/provider.ts:261`)
implements an auth rollback: it snapshots `previousAuth` at `:285`, and on
either managed (`:294`) or attach (`:338`) `Config.updateGlobal` failure it
calls `restoreAxEngineAuth(previousAuth)` (`:178`) which re-sets or removes the
auth entry to its prior state. The attach path additionally probes the endpoint
before committing (`:325`), guards against aliasing the managed server it still
owns (`:312`), and after a successful attach stops the previously-managed
process (`:345`) so the external server is not left competing for model memory.
This ordering is correct. However the `/ax-engine/prepare` (`:552`) and
`/ax-engine/start` (`:590`) handlers call `prepareAxEngine` **without** the
`try { … } catch (error) { return axEngineInvalidRequest(c, error) }` wrapper
that download (`:399`), delete (`:473`), and install (`:522`) all use. The
`axEngineInvalidRequest` helper at `:122` maps `AX_ENGINE_*` domain errors to
400; without it, domain failures from prepare/start (insufficient memory, binary
missing, disk full) escape as 500 and are re-wrapped by `error.ts:180` into a
generic "Internal server error" envelope, discarding the actionable message.
This is a correctness/consistency defect (see Step 8, F1).

## Step 4 Input validation surface

Body validation is consistent: every mutating route registers a `validator(...)`
middleware (`packages/ax-code/src/server/routes/provider.ts:280`, `:394`,
`:467`, `:551`, `:589`, `:673`, `:709`). Path params for OAuth are validated
through `PROVIDER_ID_PARAM` (`:672`, `:708`) sourced from
`packages/ax-code/src/server/routes/route-params.ts:22`. The `method` field on
both OAuth endpoints uses `JsonNumber(z.number().int().min(0))` (`:676`, `:712`),
and the test at `provider-routes.test.ts:134` confirms string values like `"0"`
are coerced while `:161` confirms empty strings are rejected — the coercion
matters because some web clients post form-encoded bodies. The ax-engine model
ID path parameter is validated imperatively via `axEngineModelIDParam` (`:113`)
rather than a path validator; unknown IDs return a 400 with `resource: "model"`
(`:397`, `:470`), covered by `provider-routes.test.ts:309`. The download-cancel
route at `:443` takes a raw `jobID` string without schema validation, but
`cancelDownloadJob` (`packages/ax-code/src/provider/ax-engine/download-job.ts:165`)
does a safe map lookup and the handler returns 400 when no job matches (`:445`),
so unbounded string input cannot cause harm beyond the lookup cost.

## Step 5 Response and error contract

Every route declares its 200 response via `describeRoute`/`resolver`. The list
(`:188`), connection (`:243`, `:262`), auth (`:633`), and OAuth (`:655`, `:691`)
endpoints use concrete zod schemas. By contrast nine ax-engine endpoints declare
`schema: resolver(z.any())` (`:366`, `:387`, `:416`, `:437`, `:460`, `:491`,
`:514`, `:545`, `:582`), so the generated OpenAPI contract and the JS SDK
(`packages/sdk/js`) expose these operations as untyped blobs. This is a real
contract-quality gap for an API surface whose other endpoints are precisely
typed (see Step 8, F2). On the error side, `errors(400)` is declared on the
routes that can actually return a 400 envelope. One contract mismatch: the
prepare (`:548`) and start (`:586`) routes declare `...errors(400)` in OpenAPI
but, because of the missing wrapper noted in Step 3, never actually emit a 400
for domain errors — so the documented 400 shape is unreachable for the most
common failure classes on those two routes.

## Step 6 Design and boundaries

Coupling is appropriate for a route module: it depends on domain modules
(`Provider`, `ModelsDev`, `ProviderAuth`, `Auth`, `Config`), the ax-engine
subsystem (`@/provider/ax-engine`), and shared server helpers (`validation`,
`error`, `route-params`, sibling `config` route). No layer violation is present
— the route never touches SQLite, Drizzle, or LSP internals directly. The
`shouldShowProviderInList` pure helper at `:53` is the right extraction: it is
unit-tested in three files
(`packages/ax-code/test/server/provider-routes.test.ts:88`,
`test/provider/ax-engine.test.ts:1679`,
`test/provider/cloud-api-providers.test.ts:14`) without spinning up the server.
The `lazy(() => new Hono()…)` wrapper at `:186` defers registry construction
until first mount, consistent with the pattern used by `ConfigRoutes` in
`config.ts:134`. One minor cohesion note: `axEngineConnectionView` (`:132`),
`savedAxEngineApiKey` (`:127`), `restoreAxEngineAuth` (`:178`),
`axEngineModelIDParam` (`:113`), `isAxEngineDomainError` (`:118`), and
`axEngineInvalidRequest` (`:122`) are ax-engine-specific module-private helpers;
they are readable here but, at ~70 lines, could live alongside
`packages/ax-code/src/provider/ax-engine/connection.ts` if the ax-engine surface
grows further. Not actionable at the current size.

## Step 7 Hygiene and duplication

The `hasApiKey` boolean expression
`Boolean(savedKey || options.apiKey || process.env.AX_ENGINE_API_KEY)` is
repeated verbatim in all three return branches of `axEngineConnectionView`
(`packages/ax-code/src/server/routes/provider.ts:148`, `:163`, `:172`). A single
`const hasApiKey = …` computed once before the branch would remove the
triplication and the risk of the three copies drifting (e.g. if a fourth source
of key is added later). `AxEnginePrepareBody` (`:64`) and `AxEngineStartBody`
(`:76`) are structurally identical except that `Prepare` adds a `start` field;
keeping them separate is defensible because they describe distinct operations
with different semantics, so I would not merge them. The `AxEngineModelActionBody`
schema (`:87`) only permits `quantization: "mlx6bit"` and is reused by both
download and delete; the delete handler then runs it through
`normalizeQuantization(body.quantization, modelID)` (`:472`) while the download
handler passes `body.quantization` straight through (`:400`). Both reach the same
normalization eventually (inside `startDownloadJob` at
`download-job.ts:79`), so this is a readability asymmetry rather than a bug, but
normalizing at the route boundary in both places would make the contract
uniform.

## Step 8 Findings register

**F1 — MEDIUM — prepare/start routes leak domain errors as 500.**
Location: `packages/ax-code/src/server/routes/provider.ts:552` (prepare) and
`:590` (start). Pattern: unlike download (`:399-403`), delete (`:473-477`), and
install (`:522-530`), the prepare and start handlers do not wrap
`prepareAxEngine` in `try/catch → axEngineInvalidRequest`. Impact: AX*ENGINE*\*
failures (insufficient memory, binary missing, disk full) reach the client as a
generic 500 "Internal server error" envelope, hiding the actionable message and
breaking the contract declared by `...errors(400)` at `:548` and `:586`.
Recommendation: wrap the `prepareAxEngine` call in both handlers with the same
`try { return c.json(await prepareAxEngine(...)) } catch (error) { return
axEngineInvalidRequest(c, error) }` shape already used by the install handler.

**F2 — MEDIUM — ax-engine response schemas are `z.any()`.**
Location: `packages/ax-code/src/server/routes/provider.ts:366`, `:387`, `:416`,
`:437`, `:460`, `:491`, `:514`, `:545`, `:582` (nine endpoints). Pattern: these
`describeRoute` blocks declare `schema: resolver(z.any())`, so the generated
`packages/sdk/js/openapi.json` and the typed SDK client cannot model the shape of
model catalogs, download jobs, status objects, prepare/start results, or the
install result. Impact: every SDK consumer (Desktop, headless runner) must
hand-cast these responses, and the OpenAPI drift gate in CI cannot catch shape
changes on these operations. Recommendation: extract the zod shapes already
defined inside `packages/ax-code/src/provider/ax-engine` (e.g. the
`AxEngineModelJobSummary` / status types) into named schemas and reference them
from these `resolver(...)` calls.

**F3 — LOW — `hasApiKey` expression triplicated.**
Location: `packages/ax-code/src/server/routes/provider.ts:148`, `:163`, `:172`.
Pattern: identical boolean expression repeated across the three branches of
`axEngineConnectionView`. Impact: minor drift risk. Recommendation: hoist to a
single `const hasApiKey = …` before the `if (mode === "managed")` branch.

No Critical or High findings. No security finding: the attach SSRF boundary
(`connection.ts:39`) and credential storage path are sound, and
`redactProviderInfo` (`config.ts:125`) is applied to every entry of
`Provider.list()` before it is merged into the list response at `:226` and
returned at `:235`.

## Step 9 Verification and exit

I corroborated the behaviors above against the test suite at
`packages/ax-code/test/server/provider-routes.test.ts`: the list-filter
semantics (`:64-102`), OAuth 400 mapping (`:104-173`), schema coercion
(`:175-207`), the attach→managed credential round-trip including the assertion
that the plaintext config never holds the attach key (`:209-289`), the unknown
download-model 400 (`:309-322`), the delete domain-error 400 mapping (`:324-354`),
and `redactProviderInfo` behaviour (`:356-373`). The prepare/start 500-leak
(F1) and the `z.any()` schema gap (F2) are not currently covered by tests,
which is consistent with their being open defects rather than regressions. The
finding set for `server-routes-provider` is: 0 Critical, 0 High, 2 Medium, 1 Low.
As primary reviewer I recommend this unit proceed to the independent verifier
(`codex-sol`) for a second pass; no `reverify.md` is emitted because no
Critical-severity finding was raised in this lane.
