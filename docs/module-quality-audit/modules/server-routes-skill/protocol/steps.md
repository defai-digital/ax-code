# Nine-step review: server-routes-skill

## Step 1 Surface inventory and boundary

The unit exports one lazy Hono router at `packages/ax-code/src/server/routes/skill.ts:24`. Its five public handlers are list (`packages/ax-code/src/server/routes/skill.ts:26`), validate (`packages/ax-code/src/server/routes/skill.ts:48`), doctor (`packages/ax-code/src/server/routes/skill.ts:69`), trigger testing (`packages/ax-code/src/server/routes/skill.ts:90`), and creation (`packages/ax-code/src/server/routes/skill.ts:113`). The application mounts that router at `/skill` in `packages/ax-code/src/server/server.ts:326`. This agrees with the declared server-routes-skill scope in `docs/module-quality-audit/modules/server-routes-skill/MODULE-AUDIT.md:5-7`.

## Step 2 Trust boundaries and abuse cases

The read endpoints expose discovered skill metadata, including the `content` and `location` fields defined at `packages/ax-code/src/skill/index.ts:28-44`; the list response deliberately resolves that complete schema at `packages/ax-code/src/server/routes/skill.ts:33-39`. The mutating endpoint validates JSON at `packages/ax-code/src/server/routes/skill.ts:131`, while skill names exclude traversal syntax at `packages/ax-code/src/skill/authoring.ts:55-68` and the target is required to remain under the worktree or home at `packages/ax-code/src/skill/authoring.ts:110-119`. At the server boundary, runtime/basic authentication is applied at `packages/ax-code/src/server/server.ts:166-182`, cross-origin mutations are checked at `packages/ax-code/src/server/server.ts:183-195`, and hostile project roots are rejected at `packages/ax-code/src/server/request-directory.ts:39-69`.

## Step 3 Request and response correctness

Each diagnostic handler awaits `Skill.all()` once and returns the corresponding report: validation at `packages/ax-code/src/server/routes/skill.ts:65-67` and doctor at `packages/ax-code/src/server/routes/skill.ts:86-88`. Trigger input is obtained from the validated body and empty strings are removed before matching at `packages/ax-code/src/server/routes/skill.ts:107-110`; matching itself requires at least one file and at least one skill path pattern at `packages/ax-code/src/skill/index.ts:376-381`. Creation returns the created path, maps duplicates to 409, maps path/input problems to 400, and propagates unexpected failures at `packages/ax-code/src/server/routes/skill.ts:132-141`. The generated contract exposes the same list and create operations at `packages/sdk/openapi.json:33818-34024`.

## Step 4 Cost and concurrency behavior

The route layer performs no unbounded internal retry or polling. Validation report construction is a single pass over skills at `packages/ax-code/src/skill/authoring.ts:121-135`; doctor builds name counts, issues, and source counts in bounded passes at `packages/ax-code/src/skill/authoring.ts:138-161`. Trigger matching is proportional to skills, configured globs, and submitted file paths at `packages/ax-code/src/skill/index.ts:376-381`. Creation uses a temporary file followed by rename at `packages/ax-code/src/util/filesystem.ts:83-115`, limiting partial-file exposure. The request schema at `packages/ax-code/src/skill/authoring.ts:50-52` does not cap the file-array length, but global rate limiting at `packages/ax-code/src/server/server.ts:196` reduces repeated HTTP abuse; no accepted performance finding exists for this unit.

## Step 5 Layering and ownership

HTTP-specific responsibilities stay in the router: OpenAPI descriptions, status codes, validators, and `HTTPException` conversion are in `packages/ax-code/src/server/routes/skill.ts:24-143`. Domain schemas and reusable report/create functions are intentionally shared with the CLI, as documented at `packages/ax-code/src/skill/authoring.ts:11-13`, and actual skill discovery/matching remains owned by `packages/ax-code/src/skill/index.ts:21-45` and `packages/ax-code/src/skill/index.ts:376-381`. Lazy router construction through `lazy` at `packages/ax-code/src/server/routes/skill.ts:21-25` follows the surrounding server composition without introducing a second state owner.

## Step 6 Error handling and maintainability

The sole catch in the scoped source is purposeful: it distinguishes `SkillExistsError`, `SkillPathError`, and `SkillInputError`, then rethrows every other error at `packages/ax-code/src/server/routes/skill.ts:133-140`. Schema failures are converted to the standard invalid-request envelope by `packages/ax-code/src/server/validation.ts:4-13`, and declared 400/409 responses reuse the shared error schema at `packages/ax-code/src/server/routes/skill.ts:128`. Names, summaries, response schemas, and handlers are colocated for all five operations, and the scoped file contains no TODO/FIXME markers or abandoned branches.

## Step 7 Test adequacy

Direct integration coverage exercises validation and doctor responses at `packages/ax-code/test/server/skill.test.ts:23-69`, trigger matching at `packages/ax-code/test/server/skill.test.ts:71-94`, duplicate creation at `packages/ax-code/test/server/skill.test.ts:96-115`, name traversal at `packages/ax-code/test/server/skill.test.ts:117-127`, and an absolute out-of-policy target at `packages/ax-code/test/server/skill.test.ts:129-144`. A focused run passed all six tests. The main remaining coverage gap is a direct assertion for `GET /skill` and malformed trigger JSON; existing handler simplicity and shared validator coverage make that a test-improvement opportunity rather than an accepted defect.

## Step 8 Finding disposition

The unit register contains no accepted item at `docs/module-quality-audit/modules/server-routes-skill/MODULE-AUDIT.md:60-64`, and no finding file exists beneath this unit. Review of exposure, validation, error propagation, path policy, algorithmic cost, and direct tests found no Critical issue requiring a secondary confirmation document. The stale audit test inventory at `docs/module-quality-audit/modules/server-routes-skill/MODULE-AUDIT.md:31-46` omits the direct route suite, but the suite itself is present and passing; this is audit-document metadata, not a product defect.

## Step 9 Verification and exit

`AX_TEST_FILES=test/server/skill.test.ts pnpm --dir packages/ax-code exec vitest run` completed successfully with one file and six tests passing. The exercised assertions are anchored at `packages/ax-code/test/server/skill.test.ts:23-144`. Generated SDK methods also align with the route operation IDs and URLs at `packages/sdk/js/src/gen/sdk.gen.ts:6979-7110`. The review is complete for the requested source and related control paths; no production source or other audit unit was modified.
