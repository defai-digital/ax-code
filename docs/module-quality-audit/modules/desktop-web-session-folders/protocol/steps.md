# Protocol Steps — desktop-web-session-folders

Reviewer: ax-code-glm (model: zai-coding-plan/glm-5.2[1m])
Unit slug: `desktop-web-session-folders`
Scope: `desktop/packages/web/server/lib/session-folders/`
Verifier lane: codex-sol

All line references below were read directly from the working tree at baseline
`cab6c0089e3b7b3410f050bc9d824c06a3c3a814`.

## Step 1 Scope and inventory

The unit under review is `desktop-web-session-folders`, located at
`desktop/packages/web/server/lib/session-folders/`. It contains exactly two
files:

- `desktop/packages/web/server/lib/session-folders/routes.js` (59 lines) —
  exports a single function `registerSessionFoldersRoutes` at line 3.
- `desktop/packages/web/server/lib/session-folders/routes.test.js` (63 lines) —
  two vitest cases, no exports.

The single export is consumed in exactly one place:
`desktop/packages/web/server/lib/ax-code/feature-routes-runtime.js:6` (import)
and `:285-289` (registration call, passing `fsPromises`, `path`,
`openchamberDataDir`). The HTTP path is also whitelisted for JSON body parsing
in `desktop/packages/web/server/lib/ax-code/core-routes.js:495`. The sole client
is the renderer-side zustand store
`desktop/packages/ui/src/stores/useSessionFoldersStore.ts`, which POSTs the full
folder/collapse state via `API_ENDPOINTS.sessionFolders`
(`desktop/packages/ui/src/lib/http.ts:188`).

## Step 2 Route surface and integration

Two routes are registered. `GET /api/session-folders` (routes.js:12) reads
`$openchamberDataDir/sessions-directories.json` (filePath computed at line 6).
`POST /api/session-folders` (routes.js:33) overwrites that file with whatever
object body the client supplied. The express body parser is configured upstream
in `core-routes.js:495-498` with `express.json({ limit: "50mb" })`, and this
module adds a second, tighter ceiling of `MAX_BODY_BYTES = 4 * 1024 * 1024`
(routes.js:1, enforced at line 39). There is no auth, CSRF, or origin check
inside this module — it relies entirely on the desktop local-server assumption
and the outer middleware.

## Step 3 Atomic write correctness

The POST handler implements the canonical crash-safe pattern: serialize to a
uniquely-named temp file then `rename` atomically (routes.js:46-48). The temp
name is constructed from `process.pid`, `Date.now()`, and
`Math.random().toString(16).slice(2)`, which guarantees uniqueness across
concurrent in-process calls and across processes — the existing test at
routes.test.js:8-36 ("uses unique temp files for concurrent saves") drives two
concurrent handlers and asserts both `tempPaths` are distinct and match the
expected suffix. On failure, if the file was created but not yet committed
(`saved === false`), the handler `unlink`s the temp file and swallows unlink
errors (routes.js:52-54). This swallow is intentional best-effort cleanup, not a
silent bug. The test at routes.test.js:38-62 ("removes the temp file when rename
fails") asserts `unlink` was called with a path containing the expected temp
suffix.

## Step 4 Concurrency model and last-writer-wins

Unlike the sibling module `desktop/packages/web/server/lib/magic-prompts/runtime.js`
which serializes writes through a `writeLock = writeLock.then(run, run)` chain
(runtime.js:38, 65-74), `session-folders/routes.js` has no such mutex. Atomic
`rename` guarantees the file on disk is never half-written, so concurrent POSTs
cannot corrupt the document — but they can interleave such that an older request
overwrites a newer one. The desktop UI mitigates this with a 250 ms debounce
(`DISK_WRITE_DEBOUNCE_MS = 250` at
`desktop/packages/ui/src/stores/useSessionFoldersStore.ts:45`) before issuing the
POST, so in practice the write stream is serialized at the client. This is a
deliberate trade-off (single-user local desktop) and is acceptable, but it
should be documented; if the API is ever exposed to non-debounced callers the
lack of server-side ordering becomes a real correctness bug.

## Step 5 GET read-path fallbacks

The GET handler has three exit branches, all in routes.js:12-31. (a) ENOENT on
read returns a default empty document `{ version: 1, foldersMap: {},
collapsedFolderIds: [], updatedAt: 0 }` (lines 14-20). (b) A thrown `JSON.parse`
returns the same default (lines 21-26). (c) Any other error returns HTTP 500
with the error message (lines 27-30). The notable gap: when `JSON.parse`
_succeeds_ but yields a structurally wrong shape (e.g. `[]`, `null`, or an
object missing `foldersMap`), the parsed value is returned verbatim at line 23
with no schema check. The renderer store defends against this at hydration time
(see `toStringSet`/`toNonEmptyStringSet` in useSessionFoldersStore.ts:68-74),
so this is defense-in-depth territory rather than an active defect, but a schema
guard on the server would make the contract explicit.

## Step 6 Input trust and error surface

The POST body is validated only as "is a non-array object" (routes.js:35).
Whatever keys the client sends — including arbitrary nested data — are
`JSON.stringify`-ed and persisted (line 38). For a localhost-only desktop API
this trust boundary is defensible, but it means the persisted file's shape is
defined by the renderer, not by this server module. The 4 MB ceiling
(routes.js:39-41) is the only size/content guard. Error responses echo the raw
`error.message` from the filesystem layer to the client (lines 28 and 55), which
on a misconfigured system can leak absolute paths from `openchamberDataDir`. For
this deployment context that is LOW severity, but a generic message plus a
server log would be cleaner.

## Step 7 Design and ownership

The module has tight, single-purpose cohesion: persist one JSON document, read
it back. Dependencies (`fsPromises`, `path`, `openchamberDataDir`) are injected
through the `dependencies` parameter at line 4, which is why the test file can
substitute `vi.fn()` mocks (routes.test.js:11-18) without touching disk. The
choice not to factor a `runtime.js` (as `magic-prompts` does) is justified: there
is no read-modify-write loop on the server, only full-state replace, so a
runtime abstraction would add ceremony without benefit. The 4 MB literal at line
1 is a true local constant (not environment-dependent), so per the audit rule
against over-externalizing constants it should stay inline.

## Step 8 Test coverage gaps

The two existing tests cover the most safety-critical POST behaviors
(concurrent temp uniqueness and rename-failure cleanup), but several branches
have zero coverage: (a) the entire GET handler — neither the ENOENT default
(routes.js:14-20), the parse-failure default (21-26), nor the success path
(22-23) is exercised; (b) the 400 "Body must be an object" rejection (35-37);
(c) the 413 "Payload too large" rejection (39-41); (d) the success response
shape `{ success: true }` (50). Adding focused cases through the existing
`createRouteRegistry`/`createMockResponse` harness
(`desktop/packages/web/server/test-helpers/route-harness.js`) would be cheap and
would lock in the read contract. This is the most actionable improvement for
this unit and is recorded as a MEDIUM finding.

## Step 9 Verification and disposition

No Critical findings were identified. The accepted notes are: (1) MEDIUM — GET
handler and POST validation/413 branches are untested; (2) LOW — POST body has
no schema check, returned GET JSON is not shape-validated; (3) LOW — error
responses leak raw filesystem messages. All three are consistent with a
single-user local desktop server and do not block sign-off. The module's atomic
write design is sound and the existing tests cover the highest-risk concurrency
and cleanup paths. Independent verifier `codex-sol` should re-read
`desktop/packages/web/server/lib/session-folders/routes.js` and `routes.test.js`
and confirm or contest the Step 8 coverage gap before the unit exits REVIEWING.
