# 9-Step Review — `server-routes-smart-llm`

- **Reviewer lane:** `ax-code-glm` (primary)
- **Cross-lane verifier:** `codex-sol`
- **Model:** `zai-coding-plan/glm-5.2[1m]`
- **Date:** 2026-08-11
- **Scope file:** `packages/ax-code/src/server/routes/smart-llm.ts` (78 LOC)

This is a primary review of the `server-routes-smart-llm` unit. Each step below is
backed by lines I read in the source and its direct dependencies; no template
boilerplate is used.

## Step 1 Scope and boundary map

The unit is a single 78-line module exporting one symbol, `SmartLlmRoutes`
(`packages/ax-code/src/server/routes/smart-llm.ts:16`). It is a `lazy()`-wrapped
`Hono` instance (lazy helper at `packages/ax-code/src/util/lazy.ts:7`) exposing
exactly two routes on `/`: a GET that reports state and a PUT that toggles it.

Mounting happens exactly once, at `packages/ax-code/src/server/server.ts:304`
(`.route("/smart-llm", SmartLlmRoutes())`), sitting between `autonomous` and
`super-long`. A repo-wide grep for `SmartLlmRoutes` returned only that mount site
and the definition itself, so there is a single consumer and no hidden fan-out.
The module is therefore correctly scoped as a leaf route with one public export.

## Step 2 Input boundaries and surface exposure

The PUT body is validated by `validator("json", BooleanFeatureState)` at line 60,
where `BooleanFeatureState` is `z.object({ enabled: JsonBoolean })`
(`packages/ax-code/src/server/routes/project-config.ts:20`). The custom
`validator` wrapper (`packages/ax-code/src/server/validation.ts:4`) routes schema
failure to `invalidRequest(c)`, so malformed bodies are rejected before the
handler runs rather than leaking into the persistence path.

No per-route authentication lives here; the route relies on the server-level
authn/authz applied in `server.ts`. That is the right layering for a feature
toggle — the unit does not need to re-derive identity. No secrets are read or
logged in this module: `log.info("smart LLM routing changed", { enabled })`
(line 74) emits only the boolean flag, never credentials or file contents.

## Step 3 Correctness of the GET read path

The handler at lines 35–41 calls `readProjectConfigFeatureState({ featureFlag:
"AX_CODE_SMART_LLM", read: (config) => config?.routing?.llm ??
Flag.AX_CODE_SMART_LLM })`. Tracing into `project-config.ts:82`, this reads the
project config file, applies the caller's `read` function, then side-effects
`FeatureFlag.set(...)` and `ScopedFlag.recordCurrent(...)` before returning
`{ enabled }`.

The fallback chain is sound: persisted config wins (`config.routing.llm`), and
only when that is absent does it defer to `Flag.AX_CODE_SMART_LLM`. That flag is
declared as an access-time getter via `defineBooleanFlag("AX_CODE_SMART_LLM")`
(`packages/ax-code/src/flag/flag.ts:244`), so a PUT that calls `FeatureFlag.set`
is immediately visible to a subsequent GET even before disk re-read. Read/write
precedence is consistent.

## Step 4 Correctness of the PUT write path and error discrimination

The PUT handler (lines 61–76) destructures `c.req.valid("json")` into `enabled`,
then calls `persistProjectConfigBooleanFeatureResponse` (defined at
`project-config.ts:66`). That helper returns either `{ error: string }` or
`{ enabled: boolean }`, and the handler discriminates with `if ("error" in state)
return c.json(state, 500)` (line 73). The discriminated-union check is the
correct narrowing technique here and avoids a misleading 200 on persist failure.

The mutation closure `config.routing ??= {}; config.routing.llm = enabled`
(lines 68–71) is applied inside `updateProjectConfig`, which guards concurrency
with `Lock.write(file)` and `FileLock.acquire(file)`
(`project-config.ts:140-141`). So concurrent PUTs from multiple sessions cannot
interleave and corrupt the JSON. On the success path the env flag and scoped
record are updated (`project-config.ts:57-62`), keeping runtime state aligned
with the persisted file.

## Step 5 Performance and I/O behavior

The GET path performs a filesystem read on every request
(`readProjectConfig` → `readProjectConfigTextForUpdate` → `Filesystem.readText`,
`project-config.ts:132-136`). There is no in-memory cache of the parsed config
within this route. For a feature-toggle endpoint that the TUI runtime-sync layer
polls (see `packages/ax-code/test/cli/tui/sync-runtime-adapter.test.ts:87-114`,
which exercises `syncSmartLlm` against `http://localhost/smart-llm`), this is a
disk read per poll. Volume is low (single-user local server), so it is
acceptable, but it is the only meaningful cost in the unit and worth noting if
poll cadence ever increases. Route construction is correctly memoized via
`lazy()`, so the Hono app object is built once per process.

## Step 6 Design, cohesion, and sibling-route similarity

Cohesion is high and coupling is appropriate: the route layer does only HTTP +
OpenAPI wiring and delegates all persistence, flag reconciliation, and locking
to `project-config.ts`. The structure mirrors two siblings —
`packages/ax-code/src/server/routes/autonomous.ts` (uses the same
`readProjectConfigFeatureState` + `persistProjectConfigBooleanFeatureResponse`
pair) and `packages/ax-code/src/server/routes/super-long.ts` (uses
`persistProjectConfigBooleanFeatureResponse` plus a richer read path).

I checked the duplication threshold: only two of the three routes
(`autonomous`, `smart-llm`) are true structural twins; `super-long` carries
extra session-override logic. With just two genuinely identical call sites this
is below the 3+ bar that would justify a shared `booleanFeatureRoute()`
factory, so I am explicitly **not** recommending extraction — an abstraction
here would add indirection for negligible gain. Noting the pattern so a future
fourth twin can trigger the revisit.

## Step 7 Schema naming, dead code, and hygiene

There is no dead code in the unit. One minor naming nuance:
`SmartLlmState = BooleanFeatureState.meta({ ref: "SmartLlmState" })` (line 14)
gives the OpenAPI response schema a distinct, navigable name, while the PUT
**request** validator at line 60 still references the base `BooleanFeatureState`
without the `ref`. Both describe the identical `{ enabled: boolean }` shape, so
behavior is correct, but the generated docs will show the request schema under
the generic name and the response under `SmartLlmState`. This is cosmetic, not a
defect, and matches the established pattern in the sibling routes, so I am
leaving it as-is.

No empty catch blocks, no TODOs, no swallowed errors: the only failure path
flows through the explicit `500` return at line 73 with the structured
`{ error }` body.

## Step 8 Test coverage gap analysis

There is no test that exercises this route handler directly. Searching the test
tree for `smart-llm` / `SmartLlm` / `AX_CODE_SMART_LLM` returns only consumers:
the TUI sync tests (e.g. `packages/ax-code/test/cli/tui/sync-runtime-sync.test.ts:354-390`)
mock `http://localhost/smart-llm` and never instantiate the real Hono route, and
`packages/ax-code/test/agent/router.test.ts:127-141` exercises the
`AX_CODE_SMART_LLM` _env flag_ in the agent router, not this endpoint.

Consequently the two behaviors specific to this file are unverified: (a) the
GET fallback `config?.routing?.llm ?? Flag.AX_CODE_SMART_LLM` when
`routing.llm` is unset, and (b) the PUT `if ("error" in state) return c.json(state,
500)` branch when persistence fails. The shared helpers in `project-config.ts`
carry the real risk and likely have their own coverage, so the gap severity is
low, but a focused route test (persisted file → GET reflects it; simulated write
failure → 500 body) would close it cleanly.

## Step 9 Findings register and verification status

| ID  | Category                        | Severity | Evidence                                                                                                                       | Disposition                                                                         |
| --- | ------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| 1   | missing_verification (test gap) | LOW      | No direct route test; consumers only mock the URL. `smart-llm.ts:35-41` (GET fallback) and `:73` (PUT error branch) uncovered. | Accept as-is; add a route-level test when the sibling suite is built. Not blocking. |

**Critical findings:** none. The `findings/` directory is empty, and this review
found no Critical or High issues. Because there are no Critical items, no
`reverify.md` second-pass artifact is required for this unit.

**Verification status:** static review complete against source + dependencies;
runtime verification (typecheck/test) is owned by the cross-lane verifier
`codex-sol`. This `server-routes-smart-llm` unit is low-risk and ready for
verifier sign-off.
