# 9-Step Protocol Review — unit `global`

Reviewer: ax-code-glm (model `zai-coding-plan/glm-5.2[1m]`)
Primary source: `packages/ax-code/src/global/index.ts` (148 lines)
Supporting reads: `packages/ax-code/src/flag/flag.ts`, `packages/ax-code/test/global/cache-cleanup.test.ts`, `docs/module-quality-audit/modules/global/MODULE-AUDIT.md`

## Step 1 Scope and Boundaries

The `global` unit is a single-file module: `packages/ax-code/src/global/index.ts`. It exposes two surfaces — the `Global` namespace (`src/global/index.ts:37`) and the nested `Global.Path` object (`src/global/index.ts:38`). External dependencies are `fs/promises`, `xdg-basedir`, `path`, `os`; internal dependencies are `../util/error-message` (`toErrorMessage`, imported at `src/global/index.ts:5`), `../util/filesystem` (`Filesystem`, line 6), and `../flag/flag` (`Flag`, line 7). No subdirectories exist under `src/global`. The MODULE-AUDIT inventory (line 26) reports 149 LOC and 2 exports, matching what was read (148 content lines + trailing newline).

## Step 2 Threat and Failure Model

This module mutates the filesystem at process startup and on every cache-version bump. Concrete risk surface:

- Filesystem mutation sites: `fs.mkdir` block at `src/global/index.ts:55-61`, `fs.mkdir` inside cleanup at `:101`, `fs.rename` at `:114`, fallback `fs.rm` at `:117`, version-stamp `Filesystem.write` at `:129`, and the trash-sweep `fs.rm` at `:145`.
- TOCTOU window between `fs.readdir` at `:102` and `fs.rename` at `:114`: a concurrent process could add or remove entries. The rename failure path falls through to `fs.rm(..., { force: true })` at `:117`, which swallows `ENOENT`, so concurrent removal is safe.
- Partial-failure handling: the `cleaned` flag (`:99`, `:128`) gates version stamping so a failed wipe does not advance the marker — comment at `:88-98` documents the prior regression.
- No network, no secret material, no `eval`, no user-input parsing. Risk tag `config` per MODULE-AUDIT line 10 is appropriate.
- Empty catch at `src/global/index.ts:147` (`.catch(() => {})`) on the trash-sweep `fs.readdir`. This is the only empty catch in the file and contradicts MODULE-AUDIT line 26 which reports `Empty catches | 0`.

## Step 3 Correctness of Public Surfaces

`Global.Path.home` is a lazy getter (`src/global/index.ts:40-42`) that re-reads `Flag.AX_CODE_TEST_HOME || os.homedir()` on every access. However `Path.data`, `Path.cache`, `Path.config`, and `Path.state` are computed once at module load via `fallback(xdgData, ...)` at `:26-29` using `testHome` captured at `:18`. `Flag.AX_CODE_TEST_HOME` is itself a runtime getter (defined in `src/flag/flag.ts:280` via `defineStringFlag`), so if a test or wrapper mutates `process.env.AX_CODE_TEST_HOME` after the first import of `global/index.ts`, `Path.home` updates but the other four paths stay frozen at the original module-load value — a split-brain. The cache-version cleanup control flow is correct: `version !== CACHE_VERSION` (`:87`), `readdir` + filter (`:102`, `:108`) preserves `ax-engine`, the rename-then-fallback chain (`:113-119`) is awaited inside the outer try (`:100-121`), and stamping happens only when `cleaned` is true (`:128-134`). The `Promise.allSettled` pre-warm at `:55-77` independently reports each mkdir failure rather than aborting on the first.

## Step 4 Performance and Resource Use

The trash-rename strategy at `src/global/index.ts:110-121` is the deliberate performance optimization — comments at `:94-98` explain that `rename` is O(1) per entry while a recursive `fs.rm` of a large cache stalls startup. Background deletion of the trash directory happens in the sweep at `:139-147`, keeping it off the startup hot path. All filesystem calls are async; no synchronous `fs.*Sync` calls. The IIFE wrapper at `:84-136` keeps the module free of top-level await so esbuild's Node build does not deadlock on TLA init (comment at `:82-83`). Minor inefficiency: the cache directory is read three times on a version mismatch — `mkdir` at `:101`, `readdir` at `:102`, and `readdir` again in the sweep at `:140`. The cost is one extra syscall and is acceptable.

## Step 5 Design and Ownership

`Global.Path` is intentionally a singleton — global filesystem locations are process-wide. Ownership is clean: `fallback()` (`:20-24`) and `warnGlobalInit()` (`:31-35`) are module-private helpers, not leaked through the namespace. The `CACHE_VERSION` constant (`:79`) is a string and is compared against `Filesystem.readText` output (string) at `:87`, so the types align. The design wart is the mixed lazy/eager semantics described in Step 3: `home` was deliberately made lazy (`Path.home` getter at `:40-42`, comment "Allow override via AX_CODE_TEST_HOME for test isolation" at `:39`), but the same override was not extended to `data`/`cache`/`config`/`state`. Either all path accessors should be lazy getters that consult `Flag.AX_CODE_TEST_HOME` at access time, or none should be — the current split invites subtle test-isolation bugs.

## Step 6 Hygiene and Dead Code

- The defensive `entries[index] ?? ["unknown", "unknown"]` at `src/global/index.ts:74` is unreachable: the `entries` array (`:63-70`) is hand-maintained in exact 1:1 lockstep with the six `fs.mkdir` calls inside `Promise.allSettled` (`:55-61`). The `?? ["unknown","unknown"]` fallback therefore can never fire. It is harmless but dead.
- Comments at `:11-17`, `:39`, `:52-54`, `:82-83`, `:88-98`, `:103-107`, `:138` are accurate and explain non-obvious decisions (TLA avoidance, partial-failure ordering, `ax-engine` preservation).
- No `TODO`/`FIXME`/`XXX` markers. `TRASH_PREFIX` (`:80`) is reused consistently at `:108`, `:110`, `:144`. No duplicated logic.

## Step 7 Tests

`packages/ax-code/test/global/cache-cleanup.test.ts` is a source-string inspection test: it slices the source between `const CACHE_VERSION` and `// Sweep trash` (lines 6-7 of the test) and asserts that `await fs.mkdir(Global.Path.cache, { recursive: true })` precedes `await fs.readdir(Global.Path.cache)`. This matches `src/global/index.ts:101` (mkdir) coming before `:102` (readdir). The test is functional but brittle — renaming either symbol or the `// Sweep trash` marker silently breaks it. MODULE-AUDIT lines 33-38 also list `test/project/migrate-global.test.ts`, `test/server/global-capabilities.test.ts`, `test/server/global-config.test.ts`, and `test/server/global-session-list.test.ts`, which exercise `Global.Path` through higher-level code. Coverage gaps: no test directly covers the `fallback()` helper, the split-brain behavior between `Path.home` (lazy) and `Path.data` (eager), or the trash-sweep path at `:139-147`.

## Step 8 Findings Register

- **MEDIUM — Split-brain path semantics.** `Path.home` (`src/global/index.ts:40-42`) re-reads `Flag.AX_CODE_TEST_HOME` lazily; `Path.data`/`cache`/`config`/`state` (`:26-29`) are frozen at module load from `testHome` (`:18`). Post-import mutation of `AX_CODE_TEST_HOME` produces inconsistent paths. Recommended fix: make all five accessors lazy getters, or capture `testHome` inside `home` too.
- **LOW — Audit-ledger mismatch.** `src/global/index.ts:147` contains `.catch(() => {})`, an empty catch, but MODULE-AUDIT line 26 reports `Empty catches | 0`. Update the ledger or annotate the catch with a short comment justifying the silent best-effort sweep.
- **INFO — Unreachable fallback.** `entries[index] ?? ["unknown", "unknown"]` at `:74` cannot fire given the lockstep construction at `:55-70`. Either drop the `??` or restructure as a single array of `{label, dir, promise}` tuples.

No Critical findings, so no `reverify.md` is required for this unit.

## Step 9 Verification and Exit

This was a read-only review; no source files were modified, so no typecheck or test re-run is mandated for the `global` unit itself. For an implementer acting on the MEDIUM finding, the validation path is: `pnpm --dir packages/ax-code run typecheck` plus `AX_TEST_FILES=test/global/cache-cleanup.test.ts pnpm --dir packages/ax-code exec vitest run`, and a new test that mutates `process.env.AX_CODE_TEST_HOME` after import to lock in the lazy semantics. Independent verifier codex-sol should re-read `src/global/index.ts:18-29` against `:40-42` to confirm the split-brain claim. Critical-findings reverification: N/A. Sign-off: primary reviewer ax-code-glm complete; verifier codex-sol pending.
