# Protocol Steps — server-routes-prompt-history

Reviewer: codex-sol (`gpt-5.6-sol-xhigh`)
Unit slug: `server-routes-prompt-history`

## Step 1 Scope and route surface

The reviewed unit exports one lazy Hono application, `PromptHistoryRoutes`, at `packages/ax-code/src/server/routes/prompt-history.ts:15`. It declares `GET /` at lines 17-40 and `POST /` at lines 41-64; `packages/ax-code/src/server/server.ts:306` mounts that sub-application at `/prompt-history`. The two OpenAPI operation IDs are `promptHistory.list` and `promptHistory.append` (`prompt-history.ts:22,46`). Related reads covered validation, persistence, storage schema, mounting middleware, the TUI consumer, generated SDK types, and the direct route test.

## Step 2 Trust and failure boundaries

Prompt text and structured parts may be sensitive, so project selection and listener exposure are the important boundaries. `packages/ax-code/src/server/server.ts:258-277` validates a request directory before establishing `Instance`, while `packages/ax-code/src/server/request-directory.ts:40-69` rejects null bytes, relative or missing directories, dangerous roots, and sensitive home subtrees. Persistence scopes reads and writes with `Instance.project.id` (`packages/ax-code/src/prompt-history/index.ts:36,60-66`). Network listening is restricted to loopback by `packages/ax-code/src/runtime/listen-security.ts:27-31`; optional runtime-token and Basic Auth checks precede routes at `server.ts:166-182`, and POST origin checks occur at `server.ts:183-195`. No route-local secret logging or exception swallowing was found.

## Step 3 Request and response correctness

The list query accepts only a positive integer no greater than `PromptHistory.MAX_ENTRIES` (`packages/ax-code/src/server/routes/prompt-history.ts:11-13`), and the shared number preprocessor rejects non-numeric and unsafe-integer strings (`packages/ax-code/src/server/routes/query.ts:15-27`). Missing `limit` reaches the storage default of 50 (`packages/ax-code/src/prompt-history/index.ts:19-22,29-31`). The GET handler returns the validated project list (`prompt-history.ts:35-39`). POST validates JSON against `PromptHistoryEntry` before append (`prompt-history.ts:59-63`); the schema requires `input`, constrains `mode`, and supplies an empty `parts` default (`packages/ax-code/src/prompt-history/schema.ts:9-15`). Response schemas match the returned entry/list at `prompt-history.ts:23-33,47-57`.

## Step 4 Ordering, retention, and duplicate invariants

Storage queries newest-first by creation time and ID, limits the result, then reverses it so callers receive chronological order (`packages/ax-code/src/prompt-history/index.ts:32-42`). Append validates again, compares the newest row with the incoming input/mode/parts, and skips consecutive duplicates (`index.ts:58-75`). Insertion and pruning share one transaction (`index.ts:62-98`); rows beyond `MAX_ENTRIES` are deleted at lines 88-97. IDs combine timestamp, an in-process sequence, and UUID (`index.ts:10-17`), which provides deterministic tie ordering without relying on timestamps alone. The route suite confirms oldest-to-newest retention after 55 writes at `packages/ax-code/test/server/prompt-history.test.ts:65-86` and duplicate suppression at lines 106-125.

## Step 5 Performance and resource bounds

GET is bounded to at most 50 rows by both route validation and `normalizeListLimit` (`packages/ax-code/src/server/routes/prompt-history.ts:12`; `packages/ax-code/src/prompt-history/index.ts:19-23,38`). The database index covers project, creation time, and ID (`packages/ax-code/src/prompt-history/prompt-history.sql.ts:23`), matching list and newest-row ordering. Each append reads the newest row, inserts once, then scans the project IDs for pruning (`index.ts:63-96`); under the maintained 50-row invariant this is small bounded work. The entry schema leaves `input` and arbitrary part values without size maxima (`packages/ax-code/src/prompt-history/schema.ts:3-15`), so payload-size hardening remains a system-level consideration, but the server is loopback-only and POSTs are rate-limited to 120 per minute per resolved client/path (`packages/ax-code/src/server/middleware.ts:54-80`).

## Step 6 Design and ownership

The route stays thin: HTTP/OpenAPI concerns live in `packages/ax-code/src/server/routes/prompt-history.ts:11-64`, reusable validation lives in `packages/ax-code/src/prompt-history/schema.ts:3-17`, and storage policy lives in `packages/ax-code/src/prompt-history/index.ts:7-100`. This division prevents the TUI from owning persistence; it calls the two HTTP surfaces at `packages/ax-code/src/cli/cmd/tui/component/prompt/history.tsx:35-51`. Generated SDK declarations expose the same optional `directory`/`limit`, body, and response shape at `packages/sdk/js/src/gen/types.gen.ts:4680-4766`. The duplicated client/server value 50 (`history.tsx:15` and `prompt-history/index.ts:9`) is currently consistent, while the server remains authoritative for validation and retention.

## Step 7 Error handling and test adequacy

Shared validation converts unsuccessful query or JSON parsing into a 400 response (`packages/ax-code/src/server/validation.ts:4-13`), matching the documented 400 responses at `packages/ax-code/src/server/routes/prompt-history.ts:32,56`. Unexpected storage failures flow to the server-wide error envelope at `packages/ax-code/src/server/server.ts:155-165`; there is no local catch that could convert failure into false success. Direct behavioral tests cover project separation (`packages/ax-code/test/server/prompt-history.test.ts:27-63`), retention/order (lines 65-86), non-finite direct-list normalization (lines 88-104), and duplicate suppression (lines 106-125). A non-blocking gap remains: no direct route test asserts 400 for malformed body, zero/fractional/greater-than-50 limits, or verifies an explicit valid `limit` subset.

## Step 8 Finding decisions

The existing register records no accepted items at `docs/module-quality-audit/modules/server-routes-prompt-history/MODULE-AUDIT.md:60-64`, and the requested `findings/` directory contains no files. This pass found no Critical, High, Medium, or Low correctness issue in the route. One informational test-gap note is retained from Step 7, and the unbounded per-entry payload observation in Step 5 is defense-in-depth rather than a unit defect because local-only listener policy is enforced at `packages/ax-code/src/runtime/listen-security.ts:27-31`. With no Critical evidence, this primary review does not create `protocol/reverify.md`.

## Step 9 Executed verification and exit

The focused command `AX_TEST_FILES=test/server/prompt-history.test.ts pnpm --dir packages/ax-code exec vitest run` passed one file and all four tests; those tests exercise the mounted route through `Server.Default().request` at `packages/ax-code/test/server/prompt-history.test.ts:32-85`. `pnpm --dir packages/ax-code run typecheck` also completed successfully, covering the route export, schema, and handler types at `packages/ax-code/src/server/routes/prompt-history.ts:11-64`. The evidence supports reviewer completion of all nine steps for `server-routes-prompt-history`; independent verifier identity remains `ax-code-glm` as assigned.
