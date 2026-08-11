# Protocol Steps — server-routes-query

Reviewer: ax-code-glm (model `zai-coding-plan/glm-5.2[1m]`)
Unit: `server-routes-query` · Root: `packages/ax-code/src/server/routes/query.ts` (32 LOC, 4 exports)
Verifier lane: codex-sol

## Step 1 Scope and map

The unit under review is a single pure helper module: `packages/ax-code/src/server/routes/query.ts`. It exports four symbols consumed by the Hono `validator("query", …)` layer:

- `QueryBoolean` (`query.ts:4`) — `z.preprocess` turning a query string into a boolean.
- `JsonBoolean` (`query.ts:13`, re-exported from `@/util/schema`) — boolean coercion for JSON-shaped query values.
- `OptionalQueryNumber(schema)` (`query.ts:26`) — factory wrapping a `z.ZodNumber` so bare/empty keys parse as `undefined`.
- `DefaultQueryNumber(schema, defaultValue)` (`query.ts:30`) — same factory, but applies a default when the key is absent or bare.

Ten route modules import from `./query`: `session-impl.ts`, `experimental.ts`, `workflow.ts`, `file.ts`, `audit.ts`, `task-queue.ts`, `scheduled-task.ts`, `prompt-history.ts`, `dre-graph.ts`, plus `project-config.ts` and `isolation.ts` for `JsonBoolean`. Representative call sites: `session-impl.ts:48` (`executionTimeoutMs: OptionalQueryNumber(…)`), `session-impl.ts:213` (`roots: QueryBoolean.optional()`), `audit.ts:22` (`limit: DefaultQueryNumber(…, AUDIT_EXPORT_DEFAULT_LIMIT)`). No dead exports — every symbol has at least one in-tree consumer.

## Step 2 Threat and failure model

Inputs are attacker-controlled HTTP query strings reaching these preprocessors through Zod validators. The failure surface is validation: a malformed value must fail loudly rather than coerce silently into a wrong type. Three risky behaviors were inspected:

1. Unrecognized boolean strings (`query.ts:10` returns `value` unchanged) fall through to `z.boolean()`, which rejects — correct fail-closed behavior, no silent defaulting.
2. Unsafe integer inputs are deliberately rejected instead of rounded: numeric form returns `Number.NaN` (`query.ts:16`), string form returns the original string (`query.ts:22`) so the downstream `.int()` rejects it. Confirmed by `test/server/query.test.ts:34-47`.
3. No secrets, filesystem, process, or network I/O in this module — the `network,api` risk tags come from the consuming route layer, not this file. No empty catch blocks, no `eval`, no dynamic property access.

## Step 3 Correctness of public surfaces

Walked each preprocessor by hand against the test corpus:

- `QueryBoolean` (`query.ts:4-11`): non-string passes through; `""` → `true` (bare-key semantics, `?deep=` means on); `"true"/"1"` → `true`; `"false"/"0"` → `false`; anything else passes through and fails `z.boolean()`. Logic is consistent and order-independent. One semantic note: empty-string-means-true is the one behavior that diverges from `JsonBoolean` and is the only branch of `QueryBoolean` with no direct unit test (see Step 7).
- `normalizeQueryNumberValue` (`query.ts:15-24`): the guard at line 16 handles unsafe integers arriving already as `number`; lines 19–23 handle the string path. The regex `^[+-]?(?:\d+\.?\d*|\.\d+)$` (`query.ts:20`) accepts `"10"`, `"-1.5"`, `".25"`, `"+3"`; rejects `"0x10"`, `"1e3"`, `"abc"` (asserted at `query.test.ts:29-31`). `Number("123.")` yields `123`, so the trailing-dot case is safe. Control flow is correct.
- `OptionalQueryNumber` uses `.optional()).optional()` (`query.ts:27`) — the inner optional lets the number schema accept the `undefined` produced by the preprocessor, the outer optional reflects key-absence. Verified by `optional.isOptional() === true` at `query.test.ts:10`.

## Step 4 Performance

No hot-path concern. Each preprocessor runs once per request per query field: a `trim()`, a lowercase, a single anchored regex, and at most one `Number()`. All are O(len) with no allocation beyond the result. The regex is literal-anchored (`^…$`) so no catastrophic backtracking on hostile input. No loops, no allocations that could pressure GC under load. No change warranted.

## Step 5 Design and boundaries

`query.ts` owns a coherent responsibility: translating the wire shape of URL query strings (where a bare key is the empty string) into Zod-typed values. It is the right place for the empty-string special-casing, and it correctly diverges from `src/util/schema.ts` whose `JsonBoolean`/`normalizeJsonNumberValue` are built for JSON bodies where empty string is not a sentinel. The two helpers look similar but mean different things; merging them would smuggle query-string semantics into the JSON-body path. The `JsonBoolean` re-export at `query.ts:13` is a deliberate aggregation point — `project-config.ts:14`, `isolation.ts:11`, and `session-impl.ts:36` import route-layer boolean parsing from `./query` rather than reaching across into `@/util/schema`, which keeps the route layer's import graph shallow. This is acceptable layering, not leakage.

## Step 6 Dead code and duplication

No dead code: every export (`query.ts:4`, `13`, `26`, `30`) has live consumers (see Step 1). The structural overlap with `src/util/schema.ts:11-31` is real but intentionally divergent (empty-string handling differs, `JsonNumber` has no query-style `optional`/`default` factory variants). Per the dedup rule this sits below the "3+ identical call sites" threshold — the two implementations are similar, not identical, and the divergence is load-bearing. Documented here; no extraction recommended.

## Step 7 Tests

Direct unit coverage lives in `packages/ax-code/test/server/query.test.ts` (5 tests, all green — verified by running `AX_TEST_FILES=test/server/query.test.ts pnpm exec vitest run`, 5/5 passed, 775ms). The number helpers are well covered: bare/empty-as-omitted (`query.test.ts:6-16`), decimal strings (`18-24`), non-decimal rejection (`26-32`), unsafe-integer-string rejection (`34-40`), unsafe-integer-number rejection (`42-47`). End-to-end coverage of the number helpers through a real Hono route appears at `test/server/route-validation.test.ts:1173-1187` (bare `/find/file?…&limit` returns 200, `limit=1` returns 200).

Gap: `QueryBoolean` has no direct unit test in the test tree (grep for `QueryBoolean` under `packages/ax-code/test` returns no matches). Its empty-string→true branch and its pass-through-on-unknown-string behavior are only exercised indirectly through route integration tests, and the empty-string branch is the one place `QueryBoolean` silently diverges from `JsonBoolean`. A focused unit test would lock that contract.

## Step 8 Finding register

| Finding                                                                     | Category             | Severity | Origin                             | Status                                                                                                       |
| --------------------------------------------------------------------------- | -------------------- | -------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `QueryBoolean` lacks direct unit tests; empty-string→true branch unasserted | missing_verification | MEDIUM   | `query.ts:4-11`                    | open — recommend adding a `query.test.ts` block asserting `""`→true, `"1"`→true, `"0"`→false, `"yes"`→reject |
| Structural overlap with `src/util/schema.ts` boolean/number preprocessors   | (observation)        | LOW      | `query.ts:4` / `util/schema.ts:11` | accepted — intentional divergence, below extraction threshold                                                |
| `JsonBoolean` re-export makes `query.ts` an aggregation shim                | (observation)        | INFO     | `query.ts:13`                      | accepted — shallow import graph benefit                                                                      |

No Critical findings, so no `reverify.md` is emitted for this unit.

## Step 9 Verification and exit

Ran the unit's direct test suite as evidence: `AX_TEST_FILES=test/server/query.test.ts pnpm exec vitest run` → 1 file, 5 tests passed (575ms test time). Static analysis: read `query.ts` end-to-end plus all four consumers' call-site shapes and the `util/schema.ts` sibling; traced every export to at least one import. The module is small, pure, and side-effect-free, so the test run plus the manual control-flow trace in Step 3 constitute sufficient verification for sign-off. Open item before close: the MEDIUM test-gap on `QueryBoolean` should be addressed in a follow-up; it does not block this protocol pass because the behavior is exercised indirectly and the logic is simple, but it is the one residual risk on record for `server-routes-query`.
