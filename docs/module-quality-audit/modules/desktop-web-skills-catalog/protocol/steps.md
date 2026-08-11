# Review protocol: desktop-web-skills-catalog

## Step 1 Scope and entrypoints

The reviewed unit is the web-server catalog boundary described at `docs/module-quality-audit/modules/desktop-web-skills-catalog/MODULE-AUDIT.md:5-17`. Its facade re-exports curated sources, cache operations, Git parsing/scanning/installing, and ClawdHub operations at `desktop/packages/web/server/lib/skills-catalog/index.js:7-28`. The principal consumer is the HTTP route layer: catalog reads dispatch to ClawdHub or Git at `desktop/packages/web/server/lib/ax-code/skill-routes.js:299-345`, while installs dispatch at `desktop/packages/web/server/lib/ax-code/skill-routes.js:404-473`.

## Step 2 Trust boundaries and failure modes

Inputs cross three meaningful boundaries: user-provided repository strings, Git subprocesses, and public-registry responses/archives. Repository URLs are converted to clone URLs at `desktop/packages/web/server/lib/skills-catalog/source.js:94-144`; Git uses `execFile` rather than a shell and disables terminal prompting at `desktop/packages/web/server/lib/skills-catalog/git.js:24-55`. ClawdHub requests retry 429/5xx responses at `desktop/packages/web/server/lib/skills-catalog/clawdhub/api.js:15-50`, and downloaded bytes later become an archive at `desktop/packages/web/server/lib/skills-catalog/clawdhub/install.js:169-184`. Failure cases therefore include authentication, hangs/timeouts, malformed metadata, hostile archive structure, partial pagination, target conflicts, and interrupted replacement.

## Step 3 Behavioral correctness

Git scans validate the source before cloning (`desktop/packages/web/server/lib/skills-catalog/scan.js:9-28`), use sparse checkout with a tree-reading fallback (`scan.js:40-95`), and always remove the temporary clone (`scan.js:153-160`). Git installs validate scope, target, selections, and conflicts before cloning at `desktop/packages/web/server/lib/skills-catalog/install.js:84-167`, then verify each selected `SKILL.md` before copying at `install.js:217-279`. ClawdHub's overwrite ordering is weaker: it removes the existing target at `desktop/packages/web/server/lib/skills-catalog/clawdhub/install.js:165-167` before the download at `clawdhub/install.js:169-170`; a rejected download is caught and reported as skipped at `clawdhub/install.js:219-224`, but the old installation is already gone.

## Step 4 Security and data integrity

Repository-relative paths reject backslashes and dot segments at `desktop/packages/web/server/lib/skills-catalog/shared.js:15-26`; selection containment is enforced at `desktop/packages/web/server/lib/skills-catalog/install.js:121-127`. Git-directory copying rejects symbolic links and checks resolved parents at `install.js:26-68`. ClawdHub validates every ZIP entry before extraction at `desktop/packages/web/server/lib/skills-catalog/clawdhub/install.js:25-31` and `clawdhub/install.js:176-184`, with traversal cases exercised at `clawdhub/install.test.js:55-66`. Resource integrity remains less bounded: `downloadClawdHubSkill` materializes the entire response at `clawdhub/api.js:123-139`, and installation has no archive byte, entry-count, or expanded-size ceiling before `extractAllTo`.

## Step 5 Performance and resilience

The cache has a 30-minute default TTL and evicts expired entries on read at `desktop/packages/web/server/lib/skills-catalog/cache.js:1-24`; route keys include repository, subpath, and identity at `desktop/packages/web/server/lib/ax-code/skill-routes.js:324-345`. Git scanning limits concurrent document workers to ten at `desktop/packages/web/server/lib/skills-catalog/scan.js:102-148`, and sparse checkout avoids a `git show` per skill when supported. Registry enumeration is capped at 20 pages (`desktop/packages/web/server/lib/skills-catalog/clawdhub/scan.js:11-13,52-84`) and can return accumulated results after a later-page failure (`clawdhub/scan.js:61-70`). The registry throttle uses shared timestamp state without serialization at `clawdhub/api.js:13-35`, so concurrent callers can still leave the delay together; this is a resilience limitation rather than a correctness break in a single scan.

## Step 6 Structure and ownership

The provider split is coherent: `source.js` owns source syntax, `git.js` owns process execution, `shared.js` owns validation/path helpers, and each provider owns scan/install orchestration. This matches the contributor map at `desktop/packages/web/server/lib/skills-catalog/DOCUMENTATION.md:7-21`. The facade at `desktop/packages/web/server/lib/skills-catalog/index.js:7-28` is the right dependency point for the route runtime. The main ownership weakness is duplicated conflict and target-resolution flow across Git and ClawdHub installers (`install.js:136-167` and `clawdhub/install.js:92-118`), which makes transactional behavior easier to diverge.

## Step 7 Maintainability and stale surface

Cleanup suppression is explicit and narrow in `desktop/packages/web/server/lib/skills-catalog/shared.js:111-116`, while YAML parse failures become user-visible warnings at `shared.js:54-74`. The documentation is stale where it says curated sources are only Anthropic and ClawdHub at `desktop/packages/web/server/lib/skills-catalog/DOCUMENTATION.md:34-37`; the implementation defines seven sources at `desktop/packages/web/server/lib/skills-catalog/curated-sources.js:1-52`, and the test locks that seven-item list at `curated-sources.test.js:5-15`. The broad facade also exports low-level ClawdHub API methods at `index.js:21-24` although the route consumer uses only scan/install operations, so those exports should be treated as compatibility surface until consumers are confirmed.

## Step 8 Test evidence and finding decisions

Helper tests cover names, language filtering, path containment, target directories, and cleanup at `desktop/packages/web/server/lib/skills-catalog/shared.test.js:19-155`; source formats are covered at `source.test.js:4-83`; registry paging/filtering is covered at `clawdhub/scan.test.js:22-100`. Archive tests cover a non-English package and one traversal spelling at `clawdhub/install.test.js:28-66`. No dedicated test covers Git scan/install orchestration, failed overwrite recovery, archive resource ceilings, or API retry concurrency. The prior register contains no accepted item (`docs/module-quality-audit/modules/desktop-web-skills-catalog/MODULE-AUDIT.md:86-90`). This pass records P-01 High/open for destructive pre-download overwrite, P-02 Medium/open for unbounded registry archive materialization/extraction, and P-03 Low/open for catalog documentation drift. None is Critical, so no secondary Critical confirmation artifact is required.

## Step 9 Verification and exit

The command `pnpm --dir desktop/packages/web exec vitest run server/lib/skills-catalog/curated-sources.test.js server/lib/skills-catalog/git.test.js server/lib/skills-catalog/shared.test.js server/lib/skills-catalog/source.test.js server/lib/skills-catalog/clawdhub/install.test.js server/lib/skills-catalog/clawdhub/scan.test.js` passed all 6 files and 26 tests on 2026-08-11. The result supports the exercised contracts but does not close P-01 or P-02 because their failure paths are absent from the suites. All nine review stages for `desktop-web-skills-catalog` are documented here, with the reviewer identity and read set captured in the adjacent JSON artifacts.
