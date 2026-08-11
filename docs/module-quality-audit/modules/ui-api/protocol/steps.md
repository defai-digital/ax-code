# ui-api Review Protocol

## Step 1 Public Surface and Scope

The `ui-api` surface is three deliberate compatibility barrels: `desktop/packages/ui/src/api/endpoints.ts:1` forwards the HTTP catalog, `desktop/packages/ui/src/api/gitApiHttp.ts:1-2` forwards both the browser Git client and its shared types, and `desktop/packages/ui/src/api/types.ts:1` forwards the runtime contracts. This is a real public surface because `desktop/packages/ui/package.json:10-13` exposes every `src/*` subpath through the package export map. The reviewed implementation owners are therefore the three corresponding files under `src/lib`, not independent copies in `src/api`.

## Step 2 Trust Boundaries and Sensitive Data

The barrels add no parsing or authority of their own, but they expose network-capable Git mutations to package consumers. `desktop/packages/ui/src/lib/gitApiHttp.ts:62-79` constructs URLs with `URL`/`URLSearchParams`, so directory and option values are encoded rather than concatenated into query text; `desktop/packages/ui/src/lib/gitApiHttp.ts:222-260` trims bulk file paths, rejects an empty request, and sends JSON to fixed API routes. The contract includes identity metadata, including an optional SSH-key path at `desktop/packages/ui/src/lib/api/types.ts:292-302`, but no credential values, tokens, or embedded secrets are present in the reviewed sources.

## Step 3 Behavioral Correctness and Failure Semantics

The HTTP owner consistently propagates unsuccessful responses: for example, status requests reject at `desktop/packages/ui/src/lib/gitApiHttp.ts:133-143`, while stage and unstage requests preserve a server error or fall back to `statusText` at `desktop/packages/ui/src/lib/gitApiHttp.ts:229-260`. Repository/status request coalescing is cleaned in `finally` blocks at `desktop/packages/ui/src/lib/gitApiHttp.ts:109-116` and `desktop/packages/ui/src/lib/gitApiHttp.ts:146-153`, preventing rejected promises from remaining permanently in flight. Parameter substitution also encodes inserted values at `desktop/packages/ui/src/lib/http.ts:195-199`.

## Step 4 Performance and Resource Lifetime

Importing the `src/api` files adds only ESM re-export evaluation; `desktop/packages/ui/src/api/endpoints.ts:1` and `desktop/packages/ui/src/api/types.ts:1` create no new objects or listeners. The network implementation bounds freshness with 1.2-second status and 5-second repository TTLs at `desktop/packages/ui/src/lib/gitApiHttp.ts:50-57`, and shares concurrent requests through the in-flight maps at `desktop/packages/ui/src/lib/gitApiHttp.ts:82-116` and `desktop/packages/ui/src/lib/gitApiHttp.ts:119-153`. Type-only consumers of the contracts erase the imports at build time, as illustrated by `desktop/packages/web/src/api/git.ts:2`.

## Step 5 Architecture and Ownership

The compatibility layer correctly centralizes endpoint ownership. `desktop/packages/ui/src/lib/http.ts:1-12` defines the base paths and `desktop/packages/ui/src/lib/http.ts:14-193` derives the endpoint catalog from them. The web package consumes the supported barrel at `desktop/packages/web/src/api/constants.ts:1`, then selects its runtime-specific grouping at `desktop/packages/web/src/api/constants.ts:8-30`; it does not duplicate URL literals. Likewise, `desktop/packages/web/src/api/git.ts:1-4` imports the public Git and type subpaths and builds the web `GitAPI` adapter, keeping cross-package callers out of `src/lib` internals.

## Step 6 Maintainability and Dead Surface

All three scoped files are live: endpoint and Git barrels are imported by `desktop/packages/web/src/api/constants.ts:1` and `desktop/packages/web/src/api/git.ts:1`, while the type barrel is imported at `desktop/packages/web/src/api/git.ts:2`. The broad star export in `desktop/packages/ui/src/api/gitApiHttp.ts:1-2` intentionally makes the functions and their signatures available together, although it means future exports from either owner automatically become public and should be reviewed as API changes. Constants remain immutable literal contracts through `as const` at `desktop/packages/ui/src/lib/http.ts:12`, `desktop/packages/ui/src/lib/http.ts:193`, and `desktop/packages/ui/src/lib/http.ts:243`; no TODO/FIXME marker or unreachable local declaration exists in the three shims.

## Step 7 Test Evidence and Gaps

The public Git subpath is exercised as an import boundary by `desktop/packages/web/src/api/git.test.ts:3-62`, and the adapter assertion at `desktop/packages/web/src/api/git.test.ts:64-71` confirms bulk stage/unstage exposure. Runtime forwarding has five focused cases in `desktop/packages/ui/src/lib/gitApi.test.ts:34-111`. The focused web test passed (1 test), the UI Git test passed (5 tests), and `pnpm --dir desktop/packages/ui run type-check` passed; the relevant commands are available through `desktop/packages/ui/package.json:17-19`. There is no dedicated snapshot test for the complete star-export name set, so accidental API expansion remains a review-time concern rather than a release blocker.

## Step 8 Finding Disposition

The existing register reports no accepted item at `docs/module-quality-audit/modules/ui-api/MODULE-AUDIT.md:49-53`, and the unit's `findings/` directory contains no finding document. Independent review found no Critical condition in the compatibility barrels. A potentially confusing `includeUntracked` option in `desktop/packages/ui/src/lib/api/types.ts:545` is not a behavioral defect in this web path: the server always invokes Git with `--include-untracked` at `desktop/packages/web/server/lib/git/service.js:2241-2253`, matching the UI's stated behavior. Because there is no Critical item, no `reverify.md` is required.

## Step 9 Verification and Reviewer Exit

All nine reviewer steps for `ui-api` are complete. The old audit state still identifies the assigned roles at `docs/module-quality-audit/modules/ui-api/MODULE-AUDIT.md:11-16` and previously marked the protocol outstanding at `docs/module-quality-audit/modules/ui-api/MODULE-AUDIT.md:55-67`; these new artifacts supply the reviewer evidence without changing that source ledger. Final checks confirmed the three requested path locations, valid JSON structure, nine numbered sections, the required slug, and no unintended unit edits. Reviewer conclusion: pass for the scoped public barrels; independent lane ownership remains `ax-code-glm` as recorded at `docs/module-quality-audit/modules/ui-api/MODULE-AUDIT.md:12-14`.
