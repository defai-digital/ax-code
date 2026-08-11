# Protocol Steps — cli-cmd-init

Reviewer: ax-code-glm (model `zai-coding-plan/glm-5.2[1m]`)
Unit: `cli-cmd-init` — resolved root `packages/ax-code/src/cli/cmd/init.ts`
Verifier lane: codex-sol
Date: 2026-08-11

This is a real 9-step pass over the unit. Evidence is cited as `file:line`
from files I actually opened: `packages/ax-code/src/cli/cmd/init.ts`,
`packages/ax-code/src/cli/bootstrap.ts`, `packages/ax-code/src/cli/boot.ts`,
`packages/ax-code/src/context/index.ts`, `packages/ax-code/src/wiki/index.ts`,
`packages/ax-code/src/wiki/config.ts`, `packages/ax-code/src/wiki/native.ts`,
`packages/ax-code/src/util/filesystem.ts`, and
`docs/module-quality-audit/modules/cli-cmd-init/MODULE-AUDIT.md`.

## Step 1 Scope and map

The unit is a single TypeScript module:
`packages/ax-code/src/cli/cmd/init.ts`. My read ended at line 132 (the
MODULE-AUDIT header records 133 — a one-line drift, logged below as INFO, not
a defect). It exports one yargs `CommandModule` named `InitCommand`
(`init.ts:8`), registered globally in the command list at `boot.ts:96`
(imported at `boot.ts:29`). The command surface is `ax-code init` with six
options: `--depth` (`init.ts:23`, choices `basic|standard|full|security`,
default `standard`), `--force` (`:29`, default false), `--dry-run` (`:34`,
default false), `--directory` (`:39`, optional), `--wiki` (`:43`, default
false), and `--wiki-only-agents` (`:48`, default false). The handler
(`:53-131`) is one ~80-line async function that delegates domain work to
`Context.init` (`context/index.ts:36`), the wiki façade re-exported from
`../../wiki` (`wiki/index.ts:1-3`), and `bootstrap` from `../bootstrap`
(`bootstrap.ts:4`). Shape is the same thin CLI adapter pattern as the other
`cli-cmd-*` units: parse args, format console output, set `process.exitCode`,
hand everything else off.

## Step 2 Threat and failure model

Process-level side effects in this module are limited to one
`process.exitCode = 1` assignment at `init.ts:128` (AX Wiki generation
failure). The module writes `AGENTS.md` to disk, but the write happens inside
`Context.init` (`context/index.ts:73`, `writeFile(outputPath, content,
"utf-8")`), not in this file — the adapter only passes `root` through. The
`--directory` option is user-controlled and flows into
`path.resolve(caller, args.directory)` at `init.ts:55` and then
`Filesystem.resolve` (`util/filesystem.ts:167`), which canonicalizes via
`realpathSync` and normalizes Windows/MSYS/Cygwin/WSL drive prefixes
(`util/filesystem.ts:186-198`). Writing `AGENTS.md` into an arbitrary
caller-chosen directory is the explicit purpose of the command, so there is
no traversal vulnerability — the target root _is_ the user intent. No shell
`exec`/`spawn` is reached from this file; the only git invocation in the
wiki path is `gitHeadCommit` (`wiki/native.ts:100`) with a static literal
argv `["rev-parse", "HEAD"]`, 10s timeout, and `windowsHide: true`, and it
is only reached in the `--wiki` branch. No secrets are read, logged, or
forwarded. The empty catch at `init.ts:91-93` is intentional and carries
the comment "A soft pointer refresh must never fail init." — it is policy,
not a swallow. Residual risk for cli-cmd-init is low.

## Step 3 Correctness of public command surfaces

I traced the handler top to bottom. `caller = Filesystem.callerCwd()`
(`init.ts:54`) honors `AX_CODE_ORIGINAL_CWD` → `$PWD` → `process.cwd()`
(`util/filesystem.ts:182-184`), so a global CLI launched with `--cwd` at
the package root still resolves the user's real project directory — correct.
The `depth` value is cast `as DepthLevel` at `:56`, but yargs `choices`
(`:27`) already constrains the runtime value to the four valid literals
matching `DepthLevel`, so the cast is safe even if redundant. The `--dry-run`
branch returns at `:61-66` _before_ the `bootstrap()` block at `:79`, which
correctly skips both AGENTS.md writes (handled inside `Context.init` at
`context/index.ts:63-71`) and all wiki side effects — consistent with the
`Context.init` dry-run contract. When the file already exists and `--force`
is not set, `Context.init` returns `created: false`
(`context/index.ts:49-54`) and the adapter prints the "already exists"
hint at `:68` — accurate. The wiki soft-refresh branch (`:81-94`) only
runs when `status.exists && config.autoInjectAgents`. One real loose spot:
`getWikiStatus({ root, wikiDir: config.dir })` at `init.ts:83` omits the
`repositoryHead` field that the sibling call in `wiki.ts:74` passes
(`repositoryHead: await gitHeadCommit(root)`). Downstream staleness logic
that keys off the git head will see `undefined` here and may treat an
up-to-date wiki as fresh (or vice versa) — but the whole block is inside
the swallow-all catch at `:91`, so blast radius is limited to a missed
pointer refresh. Flagged as LOW in Step 8.

## Step 4 Performance and resource use

Nothing in this adapter is CPU-hot; every expensive operation is delegated.
`Context.init` (`:59`) calls `analyze(root)` (`context/index.ts:48,60`)
which scans the project tree, but that cost is fixed by the analyzer, not
this file. `bootstrap(root, …)` (`:79` / `bootstrap.ts:4`) wraps the wiki
post-processing in `Instance.provide` and disposes `Instance` in a `finally`
(`bootstrap.ts:13`), so there is no Instance leak across invocations even
when wiki generation throws. The dry-run path returns before `bootstrap`
(`:65`), so a preview never pays the project-bootstrap cost — good.
`bootstrap` _is_ entered even when `result.created === false` (i.e.
AGENTS.md already existed), so a no-op `init` still spins up the Instance
to run the soft pointer refresh at `:83-89`. For the default `--wiki=false`
path the extra work is one `getWikiStatus` plus a conditional
`ensureAgentsWikiPointers`, which is cheap; for `--wiki` it is required
anyway. `runNativeWiki` at `:114` streams progress through `onProgress`
(`:119-121`) and reports elapsed seconds at `:124` — bounded and clean.
No N+1 or unbounded loop concerns in this layer.

## Step 5 Design and ownership boundaries

Boundary discipline is clean. CLI-only concerns (yargs wiring, `console.log`
formatting, `process.exitCode`) live here; all domain behavior is imported.
AGENTS.md analysis/generation comes from `../../context`
(`context/index.ts:17` namespace `Context`). Wiki behavior comes from
`../../wiki` (`wiki/index.ts:1-3`), itself a re-export of `@ax-code/ax-wiki`
plus `./config` and `./native`. The Instance lifecycle comes from
`../bootstrap` (`bootstrap.ts:4`). The adapter does not reach into
provider, graph, or storage internals directly — wiki config is read
through `resolveWikiRuntimeConfig()` (`wiki/config.ts:35`) which itself
goes through `Config.get()` (`wiki/config.ts:23`). The handler is long
(~80 lines) and mixes four phases (normalize args → generate AGENTS.md →
log result → wiki bootstrap with two sub-branches), which is borderline
but still readable; the only structural duplication is the
`ensureAgentsWikiPointers` call appearing at both `:85` (soft refresh) and
`:98` (full `--wiki`), with slightly different option objects. Not worth
extracting for two call sites. No layering violations observed.

## Step 6 Dead code and hygiene

No TODOs and no unintended dead code. The empty catch at `init.ts:91-93`
is deliberate policy ("A soft pointer refresh must never fail init.") and
is the only catch in the file — the MODULE-AUDIT header's "empty catches =
0" count is consistent with that, since this block has a comment and is
not a silent swallow. One minor typing nit: `depth: string` is declared in
the args type at `:11` and then cast `as DepthLevel` at `:56`. The yargs
`choices` array at `:27` already enumerates the legal values, so the cast
is correct but the static type could be tightened (e.g. derive from the
choices tuple) to remove the assertion. A second cosmetic nit: kebab-case
options are read with bracket access (`args["dry-run"]` at `:61`,
`args["wiki-only-agents"]` at `:106`) while camel-case options use dot
access (`args.force`, `args.wiki`, `args.directory`) — this is forced by
yargs naming convention, not a real inconsistency, so no action needed.
The `if (complexity)` guard at `:75` is defensive against an optional
`result.info.complexity` and is appropriate.

## Step 7 Tests

Coverage gap. I grepped `packages/ax-code/test/**` for `cli/cmd/init`,
`InitCommand`, and the `"init"` command token. Every hit is unrelated: git
`init` invocations in fixtures (`test/fixture/fixture.ts:55`,
`test/worktree/worktree.test.ts:37`, `test/cli/release-check.test.ts:37`),
a `subtype: "init"` JSON literal in `test/provider/cli/connect.test.ts:92`,
and an `init` symbol seed in `test/code-intelligence/api.test.ts:362`.
None of them drive `InitCommand.handler`. That means the following
behaviors are entirely unverified: the dry-run preview branch
(`init.ts:61-66`), the "already exists" message branch (`:68`), the
success-summary logging including the complexity line (`:70-77`), the
soft-pointer refresh path inside `bootstrap` (`:81-94`), the
`--wiki`/`--wiki-only-agents` branches (`:97-129`), and the
`process.exitCode = 1` semantics on wiki generation failure (`:128`).
For a public, user-facing code-generation command this is the most
material weakness in the unit and mirrors the same gap recorded for the
sibling `cli-cmd-wiki` unit.

## Step 8 Finding register

- **MEDIUM — No direct test coverage of the `ax-code init` command surface.**
  The handler's six behavioral branches (`init.ts:61-66,68,70-77,81-94,97-129,128`)
  are all unverified. Suggested action: add `packages/ax-code/test/cli/cmd/init.test.ts`
  driving `InitCommand.handler` against a `tmpdir({ git: true })` fixture
  and asserting (a) AGENTS.md is written on first run, (b) the "already
  exists" path returns without rewriting when `--force` is absent, (c)
  `--dry-run` writes nothing, and (d) `process.exitCode` stays 0 on
  success.
- **LOW — `getWikiStatus` omits `repositoryHead` in the soft-refresh path.**
  `init.ts:83` calls `getWikiStatus({ root, wikiDir: config.dir })` without
  the `repositoryHead` field that the parallel call in `wiki.ts:74`
  supplies. Impact is bounded by the swallow-all catch at `:91` but the
  staleness comparison may be wrong. Either thread `await gitHeadCommit(root)`
  through or document why the head is intentionally skipped here.
- **LOW — `depth: string` + `as DepthLevel` cast.** Declared at
  `init.ts:11`, cast at `:56`. The yargs `choices` at `:27` already
  constrains the value; tightening the declared type (or deriving it from
  the choices tuple) would remove the assertion.
- **INFO — LOC fingerprint drift.** MODULE-AUDIT records 133 LOC; the file
  is 132 lines on disk. No code impact; refresh the header on the next
  extract pass.

No Critical or High findings, so the Critical-reverify path is not
triggered and no `reverify.md` is produced for this unit.

## Step 9 Verification and exit

This pass was read-only: I opened the eight source files listed at the top
plus the MODULE-AUDIT header and cross-checked every cited line number
against the disk content. No source in `cli-cmd-init` was modified, so no
build/typecheck gate applies to this review artifact itself; the
module-level verification command for a future fix is
`pnpm --dir packages/ax-code run typecheck` followed by a targeted
`pnpm --dir packages/ax-code exec vitest run test/cli/cmd/init.test.ts`
once that file lands. Static extract fingerprint `01f0a92e4c7bf06f` from
MODULE-AUDIT is consistent with what I read (modulo the one-line LOC
drift). The single actionable item is the MEDIUM test-coverage gap in
Step 8; the two LOW nits and the INFO drift are non-blocking. Recommend
status move from REVIEWING to VERIFIED-pending-tests once
`test/cli/cmd/init.test.ts` is added; until then the unit is sound on
design and correctness but under-verified on behavior.
