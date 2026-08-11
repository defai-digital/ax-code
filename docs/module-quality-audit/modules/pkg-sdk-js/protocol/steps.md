# 9-Step Review: pkg-sdk-js

Reviewer: ax-code-glm (zai-coding-plan/glm-5.2[1m])
Unit slug: pkg-sdk-js
Scope: `packages/sdk/js` (handwritten entrypoints + generated `@hey-api/openapi-ts` clients under `src/gen/` and `src/v2/gen/`)
Baseline commit: `994f9287e497666e104644eccea299595a35b39a`

This pass read the candidate source files directly (e.g. `packages/sdk/js/src/client.ts`, `packages/sdk/js/script/build.ts`, and the generated core under `packages/sdk/js/src/gen/core/`) plus the existing MODULE-AUDIT and the single finding note. Step-by-step evidence is cited as `file:line`.

## Step 1 Scope and inventory

pkg-sdk-js is the consumer-facing JavaScript SDK for the AX Code runtime. The handwritten surface is small and explicit:

- `packages/sdk/js/src/client.ts:10` exposes `createAxCodeClient` (v1) and `packages/sdk/js/src/client.ts:30` aliases it as `createOpencodeClient`. The v2 equivalent lives at `packages/sdk/js/src/v2/client.ts:15`, which adds an `experimental_workspaceID` branch (`src/v2/client.ts:31-39`).
- The generated transport is vendored twice — `src/gen/` and `src/v2/gen/` — both produced by `@hey-api/openapi-ts` from the same OpenAPI document. `packages/sdk/js/package.json:13-29` publishes each subtree as its own export condition (`./v2/client`, `./v2/gen/client`, etc.).
- The generator is driven by `packages/sdk/js/script/build.ts:248-281`, which calls `generateClient("./src/gen")` then `generateClient("./src/v2/gen")` (build.ts:276-277) off a single `openapi.json`.
- Handwritten glue shared by both versions lives in `packages/sdk/js/src/protocol.ts` (header constants, loopback guard, no-timeout fetch).

The dual-generation means the v1/v2 trees are intentionally duplicated; this is reviewed in Step 5 rather than treated as drift.

## Step 2 Threat and failure model

The dominant boundary is "this client must only talk to a local loopback server." That policy is enforced at two layers:

- Client side: `packages/sdk/js/src/protocol.ts:12-42` (`assertLocalAxCodeBaseUrl`) parses the URL, allows same-origin relative paths via a `http://localhost` resolution fallback (`protocol.ts:26-28`), and rejects anything whose hostname is not `localhost`/`::1`/`127.x`/`opencode.internal`/`opentui.internal` (`protocol.ts:32-41`). The v1 factory calls it unconditionally on a provided `baseUrl` (`src/client.ts:13`); v2 does the same (`src/v2/client.ts:18`).
- Server-spawn side: `packages/sdk/js/src/internal/server-shared.ts:192-199` (`assertSdkHttpLoopbackBind`) refuses non-loopback binds regardless of caller flags, and `server-shared.ts:41-57` folds caller options through that check before spawn.

A second boundary is prototype pollution through query/header/body params. The shipped `packages/sdk/js/src/gen/core/params.gen.ts:105-117` defines `isUnsafeParamKey` (blocking `__proto__`, `prototype`, `constructor`) and `setParamValue`, which replaces every raw `params[...][name] = ...` assignment with `Object.defineProperty`. This guard is not upstream in `@hey-api/openapi-ts`; it is injected by the build script (see Step 5). Its existence in the committed tree was verified at `params.gen.ts:107-117` and `params.gen.ts:145-170`.

Process/IO failures from spawned servers and SSE readers are the remaining hotspot. These map to the per-site empty-catch ledger in `findings/AUDIT-pkg-sdk-js-empty-catch.md` and are dispositioned in Step 8.

## Step 3 Correctness

The request lifecycle in `packages/sdk/js/src/gen/client/client.gen.ts` is sound for the SDK's use. Key control-flow points checked:

- Error-body handling at `client.gen.ts:186-195`: the failure path reads `response.text()`, attempts `JSON.parse`, and falls back to the raw text if parsing throws — so a non-JSON 500 surfaces as a string error rather than a secondary `SyntaxError`.
- Empty-204 handling at `client.gen.ts:117-141`: a 204 or `Content-Length: 0` short-circuits to a typed empty value instead of calling `.json()` on an empty body.
- The 200-with-empty-body edge case is handled at `client.gen.ts:152-157` (`const text = await response.text(); data = text ? JSON.parse(text) : {}`).
- SSE retry/backoff in `packages/sdk/js/src/gen/core/serverSentEvents.gen.ts`: `attempt` is reset to `0` on each successful connect (`serverSentEvents.gen.ts:134`), the backoff exponent is clamped via `Math.max(attempt - 2, 0)` (`serverSentEvents.gen.ts:236`), and the reader is only `cancel()`-ed when the stream did not complete normally (`serverSentEvents.gen.ts:219-221`). This is the patched variant — the stock generator form would double-count attempts and leak the reader on abort.
- `packages/sdk/js/src/gen/core/utils.gen.ts:111-137` (`getValidRequestBody`) distinguishes serialized vs raw bodies and returns `null` for an empty serialized body so `Content-Type` is stripped (`client.gen.ts:63-65`), avoiding `Content-Type: application/json` on bodyless POSTs.

One correctness gap worth noting (not blocking): `packages/sdk/js/src/gen/core/auth.gen.ts:37` uses `btoa(token)` for `basic` scheme auth. `btoa` throws on code points outside Latin-1, so a Unicode password would surface a confusing `InvalidCharacterError`. This is generated code and the project relies on bearer tokens in practice (no `basic` security requirement is exercised by the examples), so it is logged here as Low rather than filed.

## Step 4 Performance

No N+1 or unbounded-loop concerns in the read surface. The generated serializers iterate parameter sets once:

- `packages/sdk/js/src/gen/client/utils.gen.ts:10-56` (`createQuerySerializer`) walks `queryParams` a single pass; arrays/objects route to the path serializers in `packages/sdk/js/src/gen/core/pathSerializer.gen.ts:67-166`, each of which is O(n) in entries with no nested recursion.
- `packages/sdk/js/src/gen/core/queryKeySerializer.gen.ts:53-72` (`serializeSearchParams`) sorts URLSearchParams entries for deterministic cache keys — a per-request sort of a typically tiny param map, acceptable.
- `createNoTimeoutFetch` at `packages/sdk/js/src/protocol.ts:79-86` wraps `fetch` to disable Bun's per-request timeout. This is necessary for SSE/long sessions, but the wrapper is installed by default for every client (`src/client.ts:15-17`, `src/v2/client.ts:20-22`) even for short request/response calls. The cost is negligible (one extra closure + object spread), but embedders that pass their own `fetch` bypass it, which is the intended escape hatch.

Build-time performance is guarded by a cross-process lock at `packages/sdk/js/script/build.ts:166-197` (`acquireBuildLock`) with a 20-minute staleness window (`build.ts:19`, `build.ts:185-187`) so two concurrent SDK builds do not clobber the shared `openapi.json`. No runtime performance defect observed.

## Step 5 Design and ownership

The clearest architectural signal is the post-generation patching in `packages/sdk/js/script/build.ts`:

- `patchGeneratedSseClient` (`build.ts:46-108`) rewrites `serverSentEvents.gen.ts` with five regex replacements and throws if any fail to match (`build.ts:101-103`).
- `patchGeneratedParamsClient` (`build.ts:110-164`) prepends the prototype-pollution helper (`build.ts:113-127`) and rewrites four assignment sites to call `setParamValue` (`build.ts:137-154`), again throwing if neither the before nor after form is found (`build.ts:157-159`).

This creates a hard, version-pinned coupling to `@hey-api/openapi-ts` `0.97.3` (`packages/sdk/js/package.json:37`). Bumping the generator is a deliberate, review-required change because a shape change either (a) trips the loud throw and fails the build, or (b) silently matches and must be re-eyeballed. The throw-on-mismatch design is good — it fails closed. The risk is that the security-critical pollution guard (`params.gen.ts:105-117`) lives in generated, patched code rather than in a handwritten wrapper; if a future generator emits a new assignment pattern not covered by the four replacements at `build.ts:137-154`, that site would be unprotected. The mitigation is the dedicated test `packages/sdk/js/test/params-security.test.ts` (see Step 7).

v1 vs v2 ownership is clean: `src/client.ts` and `src/v2/client.ts` are near-duplicates by intent (v2 adds the workspace header path), both delegating to `src/protocol.ts`. The internal server helpers are correctly consolidated in `packages/sdk/js/src/internal/server-shared.ts:1-15` ("Both v1 ... and v2 ... import from here to avoid duplicating ..."), which is the right place for the shared loopback/proc logic. No layer violation found: generated code never imports handwritten code; handwritten code imports generated code only through the stable `./gen/...` entrypoints.

## Step 6 Dead code and hygiene

The committed generated tree contains one inline TODO at `packages/sdk/js/src/gen/client/client.gen.ts:211` (`// TODO: we probably want to return error and improve types`). This is upstream generator noise, not actionable in this package.

Empty-catch sites for pkg-sdk-js are tracked in the existing Medium finding. Cross-checking against the code actually read in this pass:

- `packages/sdk/js/src/protocol.ts:29` (`} catch {}`) sits inside the same-origin URL resolution fallback. A throw here means the relative path did not resolve to `http://localhost`, so the outer block rethrows a clear error (`protocol.ts:30`). This is defensible control flow, not a swallowed fault — disposition `review-needed` is appropriate but low priority.
- `packages/sdk/js/src/internal/server-shared.ts:92` swallows `accessSync` failures during PATH probing (`resolveSpawnCommand`). An `EACCES`/`ENOENT` here correctly means "candidate not executable; try next entry", so this is best-effort-by-design, not a silent error.
- `packages/sdk/js/src/internal/server-shared.ts:149` and `:256` wrap `proc.kill(...)` in the error-path and force-kill timers of `closeProcGracefully`. A throw here means the process is already dead, which is the desired terminal state — best-effort.

The remaining ledger entries (`grpc.ts:2327`, `headless/lifecycle.ts:450/463/469`) are outside the candidate file set read here and are left to the grpc/headless unit dispositions already recorded.

## Step 7 Tests

pkg-sdk-js ships a focused test suite under `packages/sdk/js/test/`. Coverage relevant to the boundaries identified above:

- `packages/sdk/js/test/params-security.test.ts` exercises the prototype-pollution guard injected by `build.ts:110-164`. This is the single most important test for this unit because it pins the security patch that does not exist upstream.
- `packages/sdk/js/test/server-sent-events.test.ts` covers the patched SSE retry/backoff/reader-cleanup behavior in `src/gen/core/serverSentEvents.gen.ts`.
- `packages/sdk/js/test/client.test.ts` and `packages/sdk/js/test/internal-error.test.ts` cover the request lifecycle and error-body fallbacks read in Step 3.
- Cross-package contract tests in the runtime — `packages/ax-code/test/sdk/programmatic.test.ts` and `packages/ax-code/test/acp/sdk-client-naming.test.ts` (both listed in MODULE-AUDIT §1) — exercise the SDK from the consumer side.

Run locally with `pnpm --dir packages/sdk/js run test`. No skipped or quarantined test files were observed in this package's suite. The recommendation in Step 5 (treat generator bumps as review events) should be reinforced by adding a test that asserts every `params[field.in][...] = ` assignment site in the generated tree has been rewritten to `setParamValue`; today that invariant is only checked at build time by the throw in `build.ts:157-159`.

## Step 8 Finding register

One finding exists for pkg-sdk-js and was independently re-read in this pass.

- `AUDIT-pkg-sdk-js-empty-catch` (silent-error, Medium, deferred) — `findings/AUDIT-pkg-sdk-js-empty-catch.md`. The nine per-site dispositions were checked against the source: the `protocol.ts:29` and `server-shared.ts:92/149/256` sites are best-effort-by-design (Step 6), the test-file site is test-only, and the `grpc.ts`/`headless/lifecycle.ts` sites belong to adjacent units. The Medium severity and `deferred` status remain appropriate. Expiry is `2026-09-11` per the finding note.

No Critical findings exist for this unit. The prototype-pollution guard (`params.gen.ts:105-117`) and the loopback-only policy (`protocol.ts:12-42`, `server-shared.ts:192-199`) were verified present and are tested, so they do not escalate to findings. The `btoa` basic-auth note from Step 3 is informational and not filed because no caller exercises the `basic` scheme.

## Step 9 Verification and exit

- Static extract fingerprint `33ca4abf6277714b` (from MODULE-AUDIT §9) is consistent with the source tree read here.
- This dual-agent 9-step protocol is now complete on the ax-code-glm lane; independent verifier is codex-sol.
- Verification for this documentation pass is JSON well-formedness of `reviewer-run.json` and `agent-protocol.json` plus a re-read of the cited `file:line` evidence. No code mutation was made, so no runtime test run is required for the protocol artifacts themselves.
- Exit: the unit remains at overall status REVIEWING pending codex-sol's independent verification pass. No reverify.md is required because no Critical findings were raised or confirmed in this pass.
