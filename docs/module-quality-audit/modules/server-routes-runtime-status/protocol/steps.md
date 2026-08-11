# Review protocol: server-routes-runtime-status

## Step 1 Scope and public surface

The reviewed unit is `server-routes-runtime-status`. Its sole export is the lazy `RuntimeStatusRoutes` factory at `packages/ax-code/src/server/routes/runtime-status.ts:15`, which defines four GET endpoints: `/lsp` at line 18, `/debug-engine/pending-plans` at line 39, `/formatter` at line 148, and `/debug-engine/correlated-diagnostics` at line 169. The audit inventory identifies the same one-file scope at `docs/module-quality-audit/modules/server-routes-runtime-status/MODULE-AUDIT.md:5-7`. The factory is mounted at the API root by `packages/ax-code/src/server/server.ts:327`, so these paths are externally reachable without an additional prefix.

## Step 2 Trust boundaries and data exposure

The route group inherits process-token or Basic authentication from `packages/ax-code/src/server/server.ts:166-182`, rate limiting and request logging at lines 196-197, and project-directory validation plus `Instance.provide` scoping at lines 258-277. This matters because the pending-plan handler reads `Instance.project.id` at `packages/ax-code/src/server/routes/runtime-status.ts:108`. Plan queries remain project constrained by the `project_id` predicate in `packages/ax-code/src/debug-engine/query.ts:42-53`. The correlated-diagnostics endpoint accepts a `file` query but only performs an instance-local cache lookup; its cache key includes `Instance.project.id` at `packages/ax-code/src/debug-engine/diagnostic-correlation.ts:170-172`, limiting cross-project disclosure.

## Step 3 API contracts and schemas

Every handler declares a 200 JSON contract. `/lsp` resolves `LSP.Status.array()` at `packages/ax-code/src/server/routes/runtime-status.ts:23-30`, backed by the id/name/root/status schema at `packages/ax-code/src/lsp/index-impl.ts:251-261`. `/formatter` similarly uses `Format.Status.array()` at `runtime-status.ts:153-160`, matching name/extensions/enabled at `packages/ax-code/src/format/index.ts:16-25`. The pending-plan contract enumerates the projected plan fields and graph state at `runtime-status.ts:50-79`; the returned object at lines 121-144 supplies all of them, including nullable timestamps and errors. Correlated diagnostics use the shared schema at `runtime-status.ts:175-181`, whose provenance and confidence fields are defined at `packages/ax-code/src/debug-engine/index.ts:43-57`.

## Step 4 Control-flow correctness

When DRE is disabled, pending plans return a structurally complete zero-value response at `packages/ax-code/src/server/routes/runtime-status.ts:92-106`, and correlations return `[]` at lines 187-189. In the enabled path, pending plans are limited to 25 pending rows at lines 108-110; count derives from that same array at line 122, and the mapping computes file/symbol counts from the public plan at lines 123-133. Graph fields are copied from project-scoped live status and auto-index state at lines 111-120 and 135-143. The correlation path treats a missing `file` as an empty result at lines 190-194, consistent with its description rather than raising an undocumented error.

## Step 5 Performance and failure behavior

The polled pending-plan endpoint caps plan materialization at 25 (`packages/ax-code/src/server/routes/runtime-status.ts:109`) and only schedules auto-index for a zero-node graph at lines 112-119. `AutoIndex.maybeStart` returns synchronously and runs indexing in the background as documented at `packages/ax-code/src/code-intelligence/auto-index.ts:227-236`; its in-flight and tried-project guards at lines 278-285 prevent polling from launching duplicate scans. The route intentionally catches only synchronous scheduling failure at `runtime-status.ts:113-118`, while async failures are converted into observable state by the auto-index subsystem. Graph counts use indexed project queries at `packages/ax-code/src/code-intelligence/index.ts:362-382`. No unbounded response collection was found.

## Step 6 Ownership and composition

The route is a thin adapter: LSP constructs status records in `packages/ax-code/src/lsp/index-impl.ts:263-281`, Format determines formatter enablement in `packages/ax-code/src/format/index.ts:189-200`, CodeIntelligence owns graph health at `packages/ax-code/src/code-intelligence/index.ts:350-383`, and ToolRegistry owns the debug-tool inventory at `packages/ax-code/src/tool/registry.ts:80-94`. `runtime-status.ts` composes those values into HTTP contracts without duplicating their storage logic. Project identity comes from the request-scoped Instance established by `server.ts:258-277`, so the adapter does not introduce a second project-selection mechanism.

## Step 7 Maintainability and code hygiene

All imports in `packages/ax-code/src/server/routes/runtime-status.ts:1-13` are exercised by a handler or schema, and the single exported lazy route value avoids eager subsystem initialization. The response projection at lines 123-133 deliberately reduces markdown summaries to two lines and converts the branded plan id to its wire string; both transformations are local and visible. The best-effort catch at lines 113-118 is documented and narrowly scoped rather than hiding the database reads or response construction. No TODO marker, unreachable branch, unused endpoint, or abandoned compatibility path was observed in the reviewed route.

## Step 8 Tests and finding disposition

Public mounting for `/formatter` and `/lsp` is asserted at `packages/ax-code/test/server/server.test.ts:236-248`. Auto-index duplicate suppression and state transitions are covered in `packages/ax-code/test/code-intelligence/auto-index.test.ts:33-308`, while instance-scoped diagnostic caching and provenance are exercised at `packages/ax-code/test/debug-engine/diagnostic-correlation.test.ts:354-429`. The TUI consumer verifies the pending-plans URL, directory headers, and response normalization at `packages/ax-code/test/cli/tui/sync-runtime-sync.test.ts:220-274`. The unit's `findings/` directory contains no files and the audit register records no accepted item at `MODULE-AUDIT.md:60-64`. A non-blocking coverage gap remains: no test directly invokes both flag branches of the two debug-engine HTTP handlers.

## Step 9 Verification and exit decision

`AX_TEST_FILES=test/server/server.test.ts,test/code-intelligence/auto-index.test.ts,test/debug-engine/diagnostic-correlation.test.ts pnpm --dir packages/ax-code exec vitest run` completed with 3 files and 38 tests passing. `pnpm --dir packages/ax-code run typecheck` also completed successfully. The reviewed contracts, request scoping, bounded work, and producer behavior support reviewer sign-off with no Critical finding; therefore `reverify.md` is not required for this unit. The noted direct-handler coverage gap is suitable follow-up test hardening and does not contradict the exercised producer and consumer contracts.
