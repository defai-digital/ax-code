# ui-lib — 9-Step Review Protocol

| Field                | Value                                                                |
| -------------------- | -------------------------------------------------------------------- |
| Unit slug            | `ui-lib`                                                             |
| Reviewer             | ax-code-glm                                                          |
| Model                | zai-coding-plan/glm-5.2[1m]                                          |
| Scope                | `desktop/packages/ui/src/lib` (candidate set + `ax-code/` subfolder) |
| Baseline commit      | `994f9287e497666e104644eccea299595a35b39a`                           |
| Independent verifier | codex-sol                                                            |

## Step 1 Scope and Inventory

The unit under review is `ui-lib`, the shared `lib/` layer of the Desktop UI package
(`@openchamber/ui`). It mixes pure type contracts, small parsing helpers, persistence
glue, and the sizeable ax-code SDK client wrapper. Files actually read for this pass:

- `desktop/packages/ui/src/lib/agentColors.ts` (34 lines) — hash-based palette selection.
- `desktop/packages/ui/src/lib/api/types.ts` (1241 lines) — pure TypeScript interface/type contracts for the runtime API surface (terminal, git, files, settings, github, skills).
- `desktop/packages/ui/src/lib/appOpenEvents.ts` (105 lines) + its test (164 lines) — custom-event parsers and store adapters.
- `desktop/packages/ui/src/lib/appearanceAutoSave.ts` (234 lines) — debounced store-subscription persistence.
- `desktop/packages/ui/src/lib/appearancePersistence.ts` (88 lines) — localStorage save/load with sanitization.
- `desktop/packages/ui/src/lib/asyncTimeout.ts` (37 lines) + test (62 lines) — promise race helper.
- `desktop/packages/ui/src/lib/ax-code/ascending-id.test.ts` (125 lines) — client/server id ordering regression guard.
- `desktop/packages/ui/src/lib/ax-code/axEngineDownloadToasts.ts` (159 lines) + test (154 lines) — download toast tracker.
- `desktop/packages/ui/src/lib/ax-code/axEngineModelsApi.ts` (289 lines) — AX Engine REST wrappers.
- `desktop/packages/ui/src/lib/ax-code/baseUrl.ts` (47 lines) + test (29 lines) — SDK base URL normalization.
- `desktop/packages/ui/src/lib/ax-code/client.ts` (2023 lines) + test (180 lines) — `AxCodeService` singleton and `axCodeClient`.
- `desktop/packages/ui/src/lib/ax-code/currentDirectory.ts` (6 lines) + test (30 lines) — thin accessor.
- `desktop/packages/ui/src/lib/ax-code/provider-tracker.ts` (134 lines) + test (47 lines) — circuit breaker.

The largest file, `client.ts`, is the structural outlier (~2023 lines). Everything else is
under ~300 lines, and the type contract file (`api/types.ts`) carries zero runtime logic.

## Step 2 Threat and Failure Model

The module sits entirely inside the renderer/UI trust boundary; it does not spawn
processes, touch the filesystem directly, or hold secrets. The realistic failure modes are:

- **Silent data loss on persistence paths.** `appearanceAutoSave.ts:93` swallows
  `updateDesktopSettings` rejections into a `toast.error` and `console.warn`; the in-memory
  store already mutated, so the UI and persisted state can diverge. `appearancePersistence.ts:53`
  returns `false` on a `localStorage.setItem` throw — intentional, but undocumented at call sites.
- **Network-best-effort reads that mask real failures.** `client.ts` has many
  `catch { return [] }` / `catch { return null }` sites (e.g. `getSessionTodos:655`,
  `listToolIds:1273`, `getAutonomousEnabled:1289`, `getIsolation:1346`). Several are
  explicitly justified (`getSessionStatusForDirectory:1186` documents the `null` vs `{}`
  distinction for reconnect resync); others (`getSessionTodos`, `listToolIds`) swallow
  without context, which is correct for resilience but degrades debuggability.
- **Stale/corrupt local state.** `appearancePersistence.ts:80` defends against malformed
  JSON in `localStorage` and sanitizes to known booleans — good. `client.ts:530-533`
  reads `lastDirectory`/`homeDirectory` from `localStorage` defensively inside a try/catch.
- **Unbounded module-level state.** `provider-tracker.ts:29` keeps a module-level `providers`
  Map evicted only after a 1-hour idle window with zero errors (`PROVIDER_EVICTION_TTL_MS:16`);
  a provider stuck in `circuitOpen` is never evicted. `client.ts:124-125` keeps
  `lastIdTimestamp`/`idCounter` module globals for `ascendingId`.

No secrets, process, or raw IO cross this boundary; the desktop runtime APIs are injected
via `window.__AX_CODE_DESKTOP_RUNTIME_APIS__` (`client.ts:279`) and are the actual privileged surface.

## Step 3 Correctness

Spot-checked the control flow of the non-trivial public surfaces:

- **`asyncTimeout.withTimeout` (`asyncTimeout.ts:1-37`)** — clean `settled` flag guards both
  resolve/reject paths; the operation's `timeoutHandle` is cleared on early settle
  (`asyncTimeout.ts:24,32`). The timeout branch does not cancel the underlying operation
  (no `AbortSignal` plumbed in), but late results are dropped via the `settled` check
  (`asyncTimeout.ts:20,28`). The test at `asyncTimeout.test.ts:47-61` exercises exactly that
  late-settle case. Correct for its contract.
- **`ascendingId` (`client.ts:144-163`)** — encodes `timestamp * 0x1000 + counter` into 6 bytes.
  `idCounter` is incremented per call (`client.ts:150`) with no upper bound; if more than
  `0x1000` (4096) ids were minted within the same millisecond the counter would overflow into
  the timestamp byte and break lexicographic ordering vs server ids. Not reachable from the UI
  in practice; flagged INFO only.
- **`formatPromptSendError` (`client.ts:81-107`)** — correctly handles three stale-model
  envelope shapes (`name === "ProviderModelNotFoundError"`, `details.resource === "providerModel"`,
  and the bare message fallback) and falls through to the generic suffix otherwise. The four
  test cases in `client.test.ts:13-71` pin each branch.
- **`getAgentColor` (`agentColors.ts:12-30`)** — the `"build"` short-circuit returns palette
  index 0 (`agentColors.ts:17-19`); other names hash into indices `1..length-1`
  (`agentColors.ts:28`). `hash & hash` (`agentColors.ts:25`) coerces to Int32, which is the
  intent. Correct, but uncovered by tests (see Step 7).
- **`normalizeAxCodeSdkBaseUrl` / `buildAxCodeApiUrl` (`baseUrl.ts`)** — strips a trailing
  `/api/config` suffix and de-duplicates the `/api` prefix on join; `baseUrl.test.ts:20-28`
  pins both branches. Correct.
- **Circuit breaker (`provider-tracker.ts`)** — `recordProviderSuccess` closes an open circuit
  immediately (`provider-tracker.ts:72-74`); cooldown doubles on natural expiry
  (`provider-tracker.ts:101-104`). `shouldRetry` honours `DEFAULT_RETRY_MAX_ATTEMPTS - 1`
  (`provider-tracker.ts:113`). Logic matches the tests at `provider-tracker.test.ts`.

## Step 4 Performance

- **`appearanceAutoSave.ts` debounce** — subscriptions coalesce into a 150 ms `setTimeout`
  (`appearanceAutoSave.ts:107`) and merge into a single `pending` payload (`appearanceAutoSave.ts:102-108`),
  so rapid store mutations produce one `updateDesktopSettings` call. Reasonable.
- **`client.ts` list-directory caching** — `listDirectoryInFlight` dedupes concurrent requests
  for the same path and `listDirectoryCache` serves a 400 ms TTL (`FS_LIST_CACHE_TTL_MS:273`);
  `invalidateListDirectoryCacheForPath` (`client.ts:361-392`) bumps a generation counter and
  evicts by prefix. The cache test at `client.test.ts:118-150` confirms invalidation fires
  after `createDirectory`.
- **`withDirectory` queue (`client.ts:447-477`)** — serializes directory-scoped calls on a
  shared promise chain, but a 15 s safety timeout (`DIRECTORY_CONTEXT_QUEUE_TIMEOUT_MS:43`)
  guarantees one hung caller cannot block the queue indefinitely. The resilience test at
  `client.test.ts:153-179` confirms the second call runs after the timeout while the hung
  caller stays pending. Good.
- **`fetchProviderJsonWithRetry` retries** — `sendMessage` retries transient fetch failures up
  to 3× with exponential backoff via `getRetryDelayMs` (`client.ts:984-1023`,
  `provider-tracker.ts:123-125`); the response body is explicitly cancelled before retry
  (`client.ts:1018`) to avoid leaking the stream. Correct.
- **No obvious N+1 or hot-path allocations** in the candidate set; `getAgentColor` allocates
  nothing per call beyond the hash loop.

## Step 5 Design and Ownership

- **`AxCodeService` is a god-class.** `client.ts:287-2016` holds session, message, permission,
  question, file, isolation, autonomous, super-long, and tool concerns behind one singleton
  exported at `client.ts:2019`. Decomposition is possible (e.g. `SessionShard`, `PermissionShard`)
  but the blast radius is large and every method funnels through the same `currentDirectory`
  - `client`/`getScopedApiClient` plumbing, so splitting would duplicate that context wiring.
    Leaving as-is is a defensible trade-off for this layer; flagged but not actionable now.
- **Dependency injection is used where it pays off.** `createDownloadToastTracker`
  (`axEngineDownloadToasts.ts:38`) takes a `DownloadToastDeps` object (toast, fetchJobs,
  setInterval, clearInterval, now) so the test harness in `axEngineDownloadToasts.test.ts:7-46`
  can drive fake timers and observe toast calls without touching `window`. This is the right
  pattern; the module-level `downloadToastTracker` singleton (`axEngineDownloadToasts.ts:153`)
  is the only production binding.
- **Adapter typing keeps `appOpenEvents` decoupled.** `OpenProjectStoreAdapter` /
  `OpenSessionUiAdapter` / `OpenSessionStoreAdapter` (`appOpenEvents.ts:21-35`) are narrow
  ports, so the helpers are testable with hand-rolled fakes (`appOpenEvents.test.ts:76-164`).
- **Type-only `api/types.ts`** is a clean contract surface; the `[key: string]: unknown`
  index on `SettingsPayload` (`api/types.ts:712`) is an intentional extensibility escape
  hatch that the rest of the module narrows via sanitization (e.g. `appearancePersistence.ts:13`).

## Step 6 Dead Code and Duplication

- **The most concrete maintainability cost is `appearanceAutoSave.ts`.** The same 27-field
  `AppearanceSlice` shape is enumerated three times: the initial `previous` snapshot
  (`appearanceAutoSave.ts:55-83`), the per-tick `current` snapshot (`appearanceAutoSave.ts:111-139`),
  and the per-field `!==` diff block (`appearanceAutoSave.ts:143-226`). A new appearance field
  must be added in all three places or it will render in the UI but never persist — a silent
  failure that no test currently guards. `notificationTemplatesKey` (`appearanceAutoSave.ts:45`)
  shows the JSON-stringify trick already in use and could generalise the diff. This is a
  real duplication/drift hazard, not cosmetic.
- **`formatSdkError` (`client.ts:51-67`)** overlaps in spirit with `formatPromptSendError`
  (`client.ts:81-107`) but they handle distinct shapes (opaque SDK error vs HTTP body); not
  worth merging.
- **`normalizeCandidatePath` (`client.ts:334-359`)** and `normalizeFsPath` (`client.ts:272`)
  are localised; no cross-file duplication observed in the candidate set.
- **No obviously dead exports** in the files read; every sampled export (`getAgentColor`,
  `withTimeout`, `axCodeClient`, the `provider-tracker` functions, `normalizeAxCodeSdkBaseUrl`)
  has a clear consumer pattern.

## Step 7 Tests

- **Strong coverage on the risky primitives.** `ascending-id.test.ts:31-57` pins the
  client↔server id ordering invariant (the issue #325 regression), and `ascending-id.test.ts:77-124`
  adds an end-to-end revert grouping guard. `asyncTimeout.test.ts`, `baseUrl.test.ts`,
  `provider-tracker.test.ts`, and `axEngineDownloadToasts.test.ts` (the harness there is
  exemplary — fake timers, fetch queue, grace-window advance at
  `axEngineDownloadToasts.test.ts:94-115`) all exercise their units' edge cases.
- **`client.test.ts`** covers `formatPromptSendError` branches, Windows drive-root
  normalization, desktop file-op authorization, cache invalidation, and the `withDirectory`
  queue timeout. It does not cover `sendMessage`'s retry loop or the HEIC/MIME normalization
  path (`client.ts:663-799`) — those branches are reachable and untested.
- **Gaps.** `agentColors.ts` has no test file at all (the `"build"` special-case at
  `agentColors.ts:17` and the `Math.abs(hash) % (len - 1) + 1` distribution are unverified).
  Neither `appearanceAutoSave.ts` nor `appearancePersistence.ts` has a test, which combined
  with the Step 6 duplication makes the persistence path the weakest-tested part of the unit.
- `currentDirectory.ts` is trivially covered by its test (`currentDirectory.test.ts`),
  including the blank-string → `null` path.

## Step 8 Finding Register

No Critical or High findings. Accepted from this pass:

| Finding                                                                         | Category         | Severity | Evidence                                              |
| ------------------------------------------------------------------------------- | ---------------- | -------- | ----------------------------------------------------- |
| Triplicated 27-field appearance diff risks silent non-persistence of new fields | Maintainability  | MEDIUM   | `appearanceAutoSave.ts:55-83`, `:111-139`, `:143-226` |
| `console.log` left on a production code path                                    | Hygiene          | LOW      | `client.ts:1982`                                      |
| `getSessionTodos` / `listToolIds` swallow errors with no logging context        | Observability    | LOW      | `client.ts:655`, `:1273`                              |
| `ascendingId` counter has no overflow guard (theoretical only)                  | Correctness      | INFO     | `client.ts:150-156`                                   |
| `agentColors` / `appearanceAutoSave` / `appearancePersistence` untested         | Test coverage    | LOW      | (no test files)                                       |
| Stuck open-circuit providers never evicted from module Map                      | Resource hygiene | LOW      | `provider-tracker.ts:16,29,34`                        |

All items are LOW/MEDIUM/INFO. No reverify gate is triggered.

## Step 9 Verification and Exit

- **No Critical findings** → `protocol/reverify.md` is not required for this unit.
- Findings ledger above is internally consistent with the evidence cited (every row has a
  concrete `file:line` anchor from a file actually opened this pass).
- Independent verifier for this unit is `codex-sol`; the primary reviewer is `ax-code-glm`.
  The companion `reviewer-run.json` records the files read and timestamps; `agent-protocol.json`
  (unit root) records the 9 completed steps.
- Recommended follow-ups (non-blocking): (a) collapse the appearance diff behind a key-list
  or a `JSON.stringify`-based comparator so new fields persist by default; (b) demote the
  `console.log` at `client.ts:1982` to `console.debug` or remove it; (c) add a small
  `agentColors` test for the `"build"` short-circuit and the hash distribution; (d) add a
  persistence test for `appearanceAutoSave`'s debounce + diff path.

Reviewer sign-off: ax-code-glm (primary). Verifier sign-off: pending codex-sol.
