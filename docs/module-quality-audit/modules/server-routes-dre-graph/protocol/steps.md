# Protocol Steps — server-routes-dre-graph

Reviewer: ax-code-glm · Model: zai-coding-plan/glm-5.2[1m] · Date: 2026-08-11

Unit: `server-routes-dre-graph`
Resolved root: `packages/ax-code/src/server/routes/dre-graph.ts` (224 LOC, single export `DreGraphRoutes`).

## Step 1 Scope and inventory

`packages/ax-code/src/server/routes/dre-graph.ts:163` exposes a single `DreGraphRoutes` export built via `lazy(() => new Hono()...)`. The router registers four GET endpoints: `/` (line 165), `/fingerprint` (line 172), `/session/:sessionID` (line 177), and `/session/:sessionID/fingerprint` (line 202). Module imports cluster into three concerns: routing primitives (`withSessionID`, `SESSION_ID_PARAM`, `requireCurrentProjectSession`, `QueryBoolean`, `validator`), session-data loaders (`Session`, `SessionGraph`, `SessionDre`, `SessionRisk`, `SessionBranchRank`, `SessionRollback`), and rendering helpers from `../../quality/dre-graph-*`. No unrelated cross-layer imports; the file is a pure composition layer.

## Step 2 Threat and failure surface

The module's risk tags are network/api. The two HTML-rendering routes (`/` line 165, `/session/:sessionID` line 177) emit `text/html` (lines 169, 188). All user-controlled strings rendered into the page pass through `esc()` from `dre-graph-format.ts:21` — confirmed at `dre-graph.ts:87` (`title`), `:88` (`dir`), and inside `link()` at `:94`. Query parsing uses a zod schema `DRE_GRAPH_QUALITY_QUERY` (`dre-graph.ts:34`) via `validator("query", ...)` (`:180`, `:205`), so unexpected query values are rejected by `invalidRequest` (`validation.ts:11`) rather than reaching rendering. The `/session/:sessionID` param is validated against `SessionID.zod` (`SESSION_ID_PARAM`, `route-params.ts:21`).

## Step 3 Correctness — authorization and control flow

Both session-scoped routes call `requireCurrentProjectSession(sessionID)` (`dre-graph.ts:182` and `:207`) before any data is loaded, so a session belonging to a different project directory is rejected with HTTP 409 (`session-lookup.ts:16-22`). This guard is applied to both the HTML and the JSON/fingerprint variant, so the fingerprint endpoint cannot leak cross-project data. `loadSessionGraphContext` (`:47`) calls `Session.get(sessionID)` first; `requireCurrentProjectSession` calls `Session.get` again internally (`session-lookup.ts:17`), so the session row is fetched twice on the hot path — functionally correct but wasteful (noted in Step 4).

## Step 4 Performance

`loadSessionGraphContext` (`:47-63`) fans out the five independent loaders with `Promise.all` (`:49`), which is the right pattern. Two softer concerns: (a) `Session.get` is awaited at `:48` and then again inside `requireCurrentProjectSession` before the context loads — two sequential DB reads of the same row per request. (b) `loadSessionSummaries` (`:69-72`) maps over up to 50 sessions and calls `Risk.fromSession(session.id)` synchronously per row; with 50 sessions that is 50 sequential risk scorings, not parallelized. Neither blocks a single-session page but the index page scales O(n) with DB round-trips.

## Step 5 Design and boundaries

The `SessionGraphContext` type (`:38-45`) cleanly groups the snapshot bundle so `page()` and `sessionFingerprint()` share one shaped argument. Helpers are delegated to the `quality/dre-graph-*` modules, keeping this file a thin route layer rather than a rendering kitchen sink — good cohesion. The `disableClientCache` helper (`:74`) is deliberately small and reused across all four routes. One minor smell: the `page()` builder inlines nav/hero markup (`:108-139`) while every other section is extracted (`verdictSection`, `summary`, `changesSection`, etc.), so the route file mixes one chunk of raw HTML with otherwise delegated rendering.

## Step 6 Hygiene and error handling

There are zero empty catches. The two `.catch` handlers in `Promise.all` (`:53-60`) both log a structured warning via `log.warn` and return a safe fallback (`undefined` for rank, `[]` for rollback), so a rank/rollback failure degrades the page gracefully rather than 500-ing the whole snapshot. `log` is created with a stable service tag `server.dre-graph` (`:32`). No `any` types in the route handlers; `withSessionID` carries the `SessionID` brand through to the loaders.

## Step 7 Tests

The MODULE-AUDIT test list for this unit centers on the rendering sections (`packages/ax-code/test/quality/dre-graph-activity-section.test.ts`) and shared routing/session plumbing, not the `dre-graph.ts` router itself. There is no direct test exercising the four Hono routes end-to-end (e.g. asserting `requireCurrentProjectSession` is invoked on `/session/:sessionID/fingerprint`). Given the cross-project guard is the security-critical behavior, a route-level test asserting a foreign-project session returns 409 on both session-scoped paths would close the highest-value gap.

## Step 8 Findings register

No findings were accepted into `findings/` for this run. The duplicated `Session.get` read (Step 3) and the O(n) sequential `Risk.fromSession` on the index (Step 4) are observations worth tracking but are LOW severity and do not warrant a blocking finding entry.

## Step 9 Verification and exit

Typecheck scope for this unit is `pnpm --dir packages/ax-code run typecheck`; script-layer tests run via `pnpm run test:scripts`. No Critical findings exist in `findings/`, so no `reverify.md` second-pass is triggered for `server-routes-dre-graph`. Reviewer sign-off: ax-code-glm, secondary confirmation complete.
