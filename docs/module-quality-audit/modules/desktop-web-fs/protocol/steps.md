# Nine-step review: desktop-web-fs

## Step 1 Scope and public surfaces

The reviewed unit is `desktop-web-fs`, rooted at `desktop/packages/web/server/lib/fs`. `desktop/packages/web/server/lib/fs/routes.js:427` exposes route registration, while `desktop/packages/web/server/lib/fs/search.js:98` constructs the file-search runtime. The route surface begins with `/api/fs/home` at `routes.js:663` and includes mutation, clone, read, reveal, constrained execution, and listing handlers through `routes.js:1384`. The existing inventory and the sole finding file were also read; related composition and canonical-path cache code were opened to trace ownership across the unit boundary.

## Step 2 Trust boundaries and assets

User-controlled paths cross into local filesystem operations and process working directories. Lexical containment is enforced by `isPathWithinRoot` at `desktop/packages/web/server/lib/fs/routes.js:59-65`; approved external roots come only from migrated settings at `routes.js:89-119`. Workspace resolution additionally admits configured storage and discovered worktrees at `routes.js:122-182`. Existing targets are canonicalized and checked against a canonical base at `routes.js:459-469`, while new write targets are checked through their nearest existing parent at `routes.js:492-513`. These are the central controls protecting local files from traversal and symlink escape.

## Step 3 Functional correctness

Read and raw handlers open a checked canonical file and retain the handle through stat/read/close (`desktop/packages/web/server/lib/fs/routes.js:925-945` and `983-1024`), reducing path-swap exposure during content reads. Writes avoid unnecessary replacement when the prior UTF-8 content matches and otherwise create the parent before writing (`routes.js:1073-1080`). Rename authorizes both paths, requires the same resolved workspace base, and validates the destination parent (`routes.js:1143-1188`). The special missing plans-directory behavior is narrowly gated on `ENOENT` and the normalized suffix predicate at `routes.js:1488-1496`.

## Step 4 Process and security controls

The execution endpoint is not a general shell: parsing accepts only `git rev-parse` with three specific flags (`desktop/packages/web/server/lib/fs/routes.js:26-49`), and the child is spawned with an executable plus argument array at `routes.js:598-606`. The requested working directory is approved, canonicalized, and required to be a directory before a job is created (`routes.js:1287-1324`). Clone likewise passes remote and destination as argv entries (`routes.js:763-816`), disables terminal prompting, and rejects shell metacharacters in SSH-key paths at `routes.js:301-315`. No credential values are returned by these handlers; subprocess stdout and stderr are returned only for the caller-requested operation.

## Step 5 Resource and performance behavior

Execution jobs expire after thirty minutes and are pruned on execution and polling traffic (`desktop/packages/web/server/lib/fs/routes.js:3`, `516-528`, `1283-1284`, `1368-1375`). Git-read results use a 30-second default TTL, in-flight request coalescing, and both 500-entry and 1 MiB limits (`routes.js:15-18`, `54-57`, `545-624`). Search processes at most five directories in a batch and caps collected candidates before sorting (`desktop/packages/web/server/lib/fs/search.js:1`, `107-117`, `207-234`). The search can still traverse many directories when matches are sparse, but it skips common generated trees at `search.js:2-13` and never follows non-file/non-directory entries at `search.js:168-181`.

## Step 6 Ownership and composition

Filesystem policy is localized in the unit: `desktop/packages/web/server/lib/fs/DOCUMENTATION.md:33-40` assigns the composition root only dependency wiring and keeps workspace checks, error mapping, and execution timeouts here. That matches `desktop/packages/web/server/lib/ax-code/feature-routes-runtime.js:290-302`, which injects platform and settings dependencies without duplicating handlers. Search has a separate consumer contract: project-icon discovery creates the runtime at `desktop/packages/web/server/lib/ax-code/project-icon-routes.js:218-238`. One documentation drift remains: the endpoint list in `DOCUMENTATION.md:16-26` omits the implemented clone and stat routes at `routes.js:716` and `routes.js:854`.

## Step 7 Failure handling and hygiene

Most operational failures are translated explicitly: read maps `ENOENT` and `EACCES` before logging other errors (`desktop/packages/web/server/lib/fs/routes.js:946-959`), and list does the same at `routes.js:1485-1501`. Worktree discovery logs degraded resolution at `routes.js:158-180`, and post-clone identity failure is warned without discarding a successful clone at `routes.js:838-844`. The three registered empty catches are real: failed timeout kill at `routes.js:379` and nested gitignore filtering catches at `routes.js:1447` and `routes.js:1449`. They match the deferred Low finding and should gain intentional logging or a local best-effort rationale.

## Step 8 Test evidence and gaps

Authorization tests reject an unapproved external read and accept an explicitly approved one at `desktop/packages/web/server/lib/fs/routes.test.js:209-241`. Symlink escapes for list and write are exercised at `routes.test.js:264-303`; reveal coverage includes workspace, approved-directory, rejection, and Windows argv behavior at `routes.test.js:321-440`. Cache tests cover hits, in-flight deduplication, cwd isolation, allowlist rejection, failures, TTL disable/expiry, and LRU eviction at `routes.test.js:443-588`. The focused command `pnpm --dir desktop/packages/web exec vitest run server/lib/fs/routes.test.js` passed 24 tests. Direct tests for `search.js`, clone, delete, rename, stat, and raw download headers remain coverage opportunities.

## Step 9 Findings and exit assessment

`docs/module-quality-audit/modules/desktop-web-fs/findings/AUDIT-desktop-web-fs-empty-catch.md:5-13` records one deferred Low silent-error item with a 2026-09-11 expiry and codex-sol independent verification. Its per-site table at lines 17-21 agrees with the current source locations: one kill failure needs logging and two gitignore catches need review. No finding under this unit is Critical, so the conditional secondary `reverify.md` artifact is not applicable. The review artifacts capture all nine steps, the focused suite is green, and the residual Low item plus endpoint-documentation drift are explicitly preserved rather than treated as resolved.
