# Review Protocol — desktop-web-github

Unit: `desktop-web-github`  
Reviewer: `codex-sol` (`gpt-5.6-sol-xhigh`)  
Independent verifier: `ax-code-glm`

## Step 1 Scope and public surface

The unit’s facade re-exports auth storage, device-flow, Octokit, and repository helpers from `desktop/packages/web/server/lib/github/index.js:1-16`; HTTP behavior is registered separately by `registerGitHubRoutes` at `desktop/packages/web/server/lib/github/routes.js:60`. The route surface contains auth, PR status and mutation, fork/upstream, branch, issue, and PR-context endpoints (`routes.js:97-310`, `:520-1280`). PR discovery is delegated to `desktop/packages/web/server/lib/github/pr-status.js:435-532`, while URL parsing and local-remote resolution live at `desktop/packages/web/server/lib/github/repo/index.js:3-54`. The module documentation describes the same ownership boundary at `desktop/packages/web/server/lib/github/DOCUMENTATION.md:3-18`.

## Step 2 Trust boundaries and secret handling

The surrounding server protects `/api` through `uiAuthController.requireAuth` before feature routes are registered (`desktop/packages/web/server/lib/ax-code/core-routes.js:423-429`; `desktop/packages/web/server/index.js:1214-1279`) and rate-limits API calls at `desktop/packages/web/server/lib/ax-code/bootstrap-runtime.js:64-67`. GitHub tokens are never returned by the account-list projection (`desktop/packages/web/server/lib/github/auth.js:188-198`) and the final auth file is chmodded to `0600` (`auth.js:71-75`). A Medium local confidentiality defect remains: `writeJsonFile` creates and fills the temporary token file with the process umask before applying `chmodSync` (`auth.js:63-69`). With a permissive/default `022` umask, another local user can read the complete token during that interval. The file should be created with mode `0o600`, not tightened only after content is written.

## Step 3 Control-flow correctness

Remote ranking accounts for explicit, tracking, origin, upstream, and remaining remotes (`desktop/packages/web/server/lib/github/pr-status.js:57-69`, `:439-459`), then expands fork parent/source candidates (`pr-status.js:234-282`). The resulting PR may therefore belong to an upstream repository (`pr-status.js:475-505`). The High defect is that update, merge, and ready handlers discard that resolved repository: each resolves the default local remote again and performs the mutation with only its PR number (`desktop/packages/web/server/lib/github/routes.js:741-755`, `:817-829`, `:860-878`). The web client likewise sends only `directory` and `number` (`desktop/packages/ui/src/components/views/git/PullRequestSection.tsx:1337-1377`, `:1393-1413`). In a fork, an upstream PR number can produce a 404 or, if the fork has the same PR number, mutate or merge the wrong PR.

A separate Medium discovery defect exists in the global fallback: its GitHub search query contains only state and head branch (`pr-status.js:323-341`), and results are filtered by repository name without owner (`pr-status.js:355-380`). An unrelated `other-owner/same-name` repository can therefore be accepted as the current branch’s PR after direct lookup misses. Full normalized `owner/repo` keys or repo-qualified queries are required.

## Step 4 Performance and state lifetime

The route-level PR cache has a 90-second TTL and a 200-entry eviction bound (`desktop/packages/web/server/lib/github/routes.js:1-3`, `:49-58`), and fork metadata has a five-minute TTL with a 200-entry bound (`desktop/packages/web/server/lib/github/repo/fork-detection.js:3-14`). However, the PR cache is read before current auth is checked and its key contains only directory, branch, and remote (`routes.js:320-337`). Neither account activation nor disconnect clears it (`routes.js:227-277`), so a cached `connected: true` result from one account can be served after switching accounts or disconnecting. This is a Medium state-isolation defect.

The heaviest context path can fetch jobs for every one of up to 100 check runs and up to three annotation pages per failed run (`routes.js:1399-1478`), while branch listing paginates until GitHub returns a short page with no server-side cap (`routes.js:989-999`). These are Low resource-amplification advisories. The status resolver also keeps two independent metadata/default-branch caches (`pr-status.js:4-6`, `:152-200`), causing duplicate repository metadata calls on cold resolution.

## Step 5 Module design and ownership

The facade and helper split is generally coherent: auth persistence stays in `auth.js`, device HTTP exchange in `device-flow.js:14-49`, Octokit creation in `octokit.js:4-9`, and git-remote parsing in `repo/index.js:3-54`. Route registration lazily loads GitHub libraries once (`desktop/packages/web/server/lib/github/routes.js:60-67`), which avoids eagerly loading Octokit for unrelated Desktop traffic. Requested issue/PR context repositories are constrained to the local repo or its fork network by `resolveRepoForRequest` (`routes.js:25-47`), a sound ownership check.

The main design inconsistency is repository identity: read/status operations carry a resolved `{owner, repo, resolvedRemoteName}`, but mutation input types contain only `directory` and PR number (`desktop/packages/ui/src/lib/api/types.ts:940-955`). This schema loss directly enables the fork mutation defect from Step 3. Check-summary construction is also duplicated between status and context (`routes.js:386-447`, `:1394-1606`), making conclusion classification and fallback behavior liable to drift.

## Step 6 Failure handling and maintainability

Expected gaps are usually narrowed correctly: fork metadata treats only 403/404 as unavailable and rethrows other failures (`desktop/packages/web/server/lib/github/repo/fork-detection.js:33-47`), and pull listing does the same (`desktop/packages/web/server/lib/github/pr-status.js:285-294`). Auth-file reads log malformed or unexpected failures while treating only `ENOENT` as absence (`desktop/packages/web/server/lib/github/auth.js:20-39`). Best-effort catches around email scope, checks, permissions, and upstream metadata are intentional degradation points (`desktop/packages/web/server/lib/github/routes.js:69-82`, `:386-466`, `:920-952`).

One maintainability risk is broader suppression in `getRepoDefaultBranch`, which converts every API error to `null` (`pr-status.js:152-176`) while the adjacent metadata helper distinguishes unavailable resources from operational errors (`pr-status.js:179-210`). Another is that issue and pull network list helpers catch every per-repo error and return empty arrays (`routes.js:1036-1071`, `:1218-1261`), so a 401 can be presented as an empty connected result instead of reaching outer auth cleanup. No TODO/FIXME or commented-out implementation was found in the reviewed source.

## Step 7 Test coverage and gaps

Focused tests pass, but their coverage is narrow. `desktop/packages/web/server/lib/github/auth.test.js:48-149` has four cases for direct reads/removal and settings lookup without existence preflights; it does not cover multi-account normalization, activation, atomic permissions, corrupt JSON, or concurrent updates. `desktop/packages/web/server/lib/github/routes.test.js:31-56` has only two negative activation cases and manually installs JSON parsing at `routes.test.js:24-28`. There are no unit tests for device-flow errors, remote URL variants, fork-network caching, PR candidate ranking, auth-aware cache invalidation, fallback search ownership, or any PR mutation route. In particular, no test combines an origin fork with an upstream PR and a colliding PR number, so the High defect is unguarded.

## Step 8 Findings and severity disposition

This evidence-bearing pass accepts one High finding: fork-aware discovery can be followed by a mutation against the wrong repository (`desktop/packages/web/server/lib/github/pr-status.js:456-505`; `desktop/packages/web/server/lib/github/routes.js:741-878`). It accepts three Medium findings: token temp files receive restrictive permissions only after their contents are written (`auth.js:63-69`), PR status cache entries survive account changes because keys omit auth identity (`routes.js:320-337`), and fallback search matches repository names without owners (`pr-status.js:323-380`). Low advisories cover check-detail/branch-list amplification and broad error suppression. The earlier static register still reports no accepted items at `docs/module-quality-audit/modules/desktop-web-github/MODULE-AUDIT.md:79-83`; no `findings/` files exist for this unit, and no Critical item was identified, so the conditional `protocol/reverify.md` artifact is not created.

## Step 9 Verification and exit result

The final focused command was `pnpm --dir desktop/packages/web exec vitest run server/lib/github/auth.test.js server/lib/github/routes.test.js`; it passed 2 files and 6 tests. Source evidence was also cross-checked through the production registration order (`desktop/packages/web/server/index.js:1214-1279`) and web API calls (`desktop/packages/web/src/api/github.ts:108-180`) rather than relying on the isolated Express test harness alone. The requested nine sections are complete for `desktop-web-github`; reviewer identity is `codex-sol`, the declared independent verifier is `ax-code-glm`, and the High/Medium items above remain open for implementation and regression coverage.
