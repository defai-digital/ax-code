# Protocol Steps — cli-cmd-wiki

Reviewer: ax-code-glm (model `zai-coding-plan/glm-5.2[1m]`)
Unit: `cli-cmd-wiki` — resolved root `packages/ax-code/src/cli/cmd/wiki.ts`
Verifier lane: codex-sol
Date: 2026-08-11

This is a real 9-step pass over the unit. Evidence is cited as `file:line`
from files I actually opened: `packages/ax-code/src/cli/cmd/wiki.ts`,
`packages/ax-code/src/cli/cmd/cmd.ts`, `packages/ax-code/src/cli/bootstrap.ts`,
`packages/ax-code/src/wiki/index.ts`, `packages/ax-code/src/wiki/config.ts`,
`packages/ax-code/src/wiki/native.ts`, `packages/ax-code/src/cli/boot.ts`, and
`packages/ax-code/src/util/filesystem.ts`.

## Step 1 Scope and map

The unit is a single TypeScript module: `packages/ax-code/src/cli/cmd/wiki.ts`.
My read ended at line 321 (the MODULE-AUDIT header records 322 — a one-line
fingerprint drift, logged below as INFO, not a defect). It exports ten yargs
command modules via the identity helper `cmd` from `cmd.ts:5`:

- `WikiStatusCommand` (`wiki.ts:67`), `WikiDoctorCommand` (`:81`),
  `WikiPlanCommand` (`:116`), `WikiEnsureAgentsCommand` (`:134`),
  `WikiGenerateCommand` (`:214`), `WikiUpdateCommand` (`:221`),
  `WikiLintCommand` (`:228`), `WikiCardsCommand` (`:255`),
  `WikiRelatedCommand` (`:277`), and the aggregator `WikiCommand` (`:305`).

The aggregator is registered globally at `boot.ts:101` (re-exported from
`./cmd/wiki` at `boot.ts:32`). Five private helpers carry the shared logic:
`rootFromArgs` (`:25`), `withWiki` (`:30`), `printStatus` (`:35`),
`commonOptions` (`:63`), `generationOptions` (`:206`), and
`runGenerateOrUpdate` (`:167`). The shape is a classic thin CLI adapter: parse
args, format output, set `process.exitCode`, delegate everything else.

## Step 2 Threat and failure model

The only process-level side effects in this module are `process.exitCode = 1`
assignments on unhealthy/stale state (`wiki.ts:76`, `:111`, `:250`, `:298`).
There are no direct filesystem writes from this file; the one write path
(`writeWikiCards` at `:270`) is delegated to the wiki runtime. The module
shells out to git indirectly via `gitHeadCommit` (`native.ts:100`), but the
argv there is a static literal `["rev-parse", "HEAD"]` with a 10s timeout and
`windowsHide: true` — no user-controlled tokens reach the argv, so there is no
command-injection surface here. The `--model` string flows to
`Provider.parseModel` (`native.ts:91`) which is the validated parser, not a
raw shell. No secrets are read, logged, or forwarded by this command. Net
residual risk for cli-cmd-wiki is low.

## Step 3 Correctness of public command surfaces

I traced each subcommand's handler. `WikiRelatedCommand` declares a demanded
positional (`wiki.ts:282`) and the handler defensively normalizes with
`String(args.symbol ?? "").trim()` (`:286`); an empty-after-trim value falls
through to the "No matching wiki pages" branch (`:296-299`) and sets exitCode
1 — correct, no throw. `WikiDoctorCommand` computes `head` once (`:88`) and
reuses it for both `getWikiStatus` (`:89`) and `lintWiki` (`:93`), avoiding a
double git call. `WikiEnsureAgentsCommand` gates on
`!config.autoInjectAgents && args.force !== true` (`:143`); the `--force`
option is declared at `:140` and the skip message is accurate. One loose spot:
`withWiki` types `args` as `CommonArgs` (`:23`, only `directory?/dir?/model?`),
but handlers also read `args.json`, `args["dry-run"]`, `args.force`,
`args.skip-agents`, `args.quiet`, `args.output`, `args.stdout`, `args.exact`
— these resolve at runtime via yargs inference through the identity `cmd`
helper (`cmd.ts:5`). Functionally correct, but the static type under-describes
the real arg shape (see Step 6).

## Step 4 Performance and resource use

Every handler is I/O- or model-bound; nothing in this file is hot enough to
matter for CPU. `bootstrap` (`bootstrap.ts:4`) is invoked once per CLI
invocation via `withWiki` (`:30-33`) and disposes `Instance` in a `finally`
(`bootstrap.ts:13`), so there is no Instance leak across commands. For
`status`/`plan`/`cards` the bootstrap is arguably heavier than strictly needed
(it pulls full project config so `resolveWikiRuntimeConfig` can read the
`wiki` slice via `Config.get` at `config.ts:23`), but that is the established
pattern for all subcommands and is not worth diverging. `printStatus`
(`:35-51`) is O(recommendations) and trivial. `runGenerateOrUpdate`
(`:167-204`) streams progress through an `onProgress` callback
(`native.ts:150`) and is suppressed cleanly under `--quiet` (`:185-193`). No
N+1 or unbounded loop concerns in this adapter layer.

## Step 5 Design and ownership boundaries

Boundary discipline is good. CLI-only concerns (arg wiring, `UI.println`
formatting, exit codes) live here; all domain behavior is imported from
`../../wiki` (`wiki.ts:6-20`), which re-exports `@ax-code/ax-wiki` plus
`./config` and `./native` (`wiki/index.ts:1-3`). The module does not reach
into provider, graph, or storage internals directly — it goes through
`resolveWikiRuntimeConfig` (`config.ts:35`), `engineConfig` (`config.ts:49`),
and the `runNativeWiki`/`lintWiki`/`getWikiStatus` façade. The
`runGenerateOrUpdate` helper (`:167`) is shared between `generate` and
`update` and correctly threads `action` into `runNativeWiki` (`:179-194`),
which is a reasonable dedup given the two commands differ only by that token.
No layering violations observed.

## Step 6 Dead code and hygiene

No empty catch blocks and no TODOs in this file (matches the audit header).
The empty `async handler() {}` at `:320` is required by the yargs
`demandCommand()` aggregator pattern, not dead code. `dirOption` (`:53`) and
`modelOption` (`:58`) are reused module-level consts. One hygiene nit:
`CommonArgs` declares `model?: string` (`:23`) but `commonOptions` (`:63-65`)
registers only `directory` and `dir` — `--model` is registered solely by
`generationOptions` (`:208`). So for seven of the nine leaf commands
`args.model` is always `undefined` at the type level yet the type claims it
exists. A second nit: `runGenerateOrUpdate` mixes bracket access
`args["skip-agents"]` (`:169`, `:195`) with dot access `args.force` (`:184`)
and `args.quiet` (`:185`) for kebab-case options. Both are cosmetic.

## Step 7 Tests

Coverage gap. I grepped `packages/ax-code/test/**` for `wiki` and for
`WikiCommand`/`cli/cmd/wiki` and found zero matches against this command
module. The hits that do exist are unrelated: `test/config/config.test.ts`
exercises an `mcp.wiki` entry, `test/session/instruction.test.ts` covers the
`openwiki` interop, and `test/context/generator.test.ts` only asserts that
generated context text mentions `ax-wiki/`. None of them invoke
`WikiStatusCommand`/`WikiDoctorCommand`/`WikiLintCommand`/etc., and none
verify the exit-code semantics at `:76`, `:111`, `:250`, `:298` or the
`--json`/`--stdout`/`--dry-run` output branches. For a 321-LOC, 10-export
public CLI surface this is the most material weakness found in this unit.

## Step 8 Finding register

- **MEDIUM — No direct test coverage of the cli-cmd-wiki command surface.**
  Exit-code logic (`wiki.ts:76,111,250,298`), the `--json` machine-readable
  branches (`:36-38,96,124,241,266,289`), `--stdout` (`:267`), and
  `--dry-run` previews (`:152-156`) are all unverified. Suggested action: add
  a `test/cli/cmd/wiki.test.ts` that drives the handlers through `withWiki`
  with a temp project fixture and asserts both the human and JSON branches.
- **LOW — `CommonArgs.model` overstates the runtime arg shape.** Declared at
  `wiki.ts:23` but only populated for `generate`/`update` via
  `generationOptions` (`:208`); `commonOptions` (`:63`) never registers
  `--model`. Narrow the type or move `model` to a `GenerationArgs` extension.
- **LOW — Inconsistent kebab-case arg access.** `runGenerateOrUpdate` mixes
  `args["skip-agents"]` with `args.force`/`args.quiet` (`:169,184,185,195`).
  Pick one style for readability.
- **INFO — LOC fingerprint drift.** MODULE-AUDIT records 322 LOC; the file is
  321 lines on disk. No code impact; refresh the header on next extract.

No Critical or High findings, so the Critical-reverify path is not triggered.

## Step 9 Verification and exit

This pass was read-only: I opened the eight files listed at the top and
cross-checked every cited line. No source in `cli-cmd-wiki` was modified, so
no build/typecheck gate applies to this review artifact itself; the
module-level typecheck command for a future fix is
`pnpm --dir packages/ax-code run typecheck`. Static extract fingerprint
`3de233291f45a6ce` from MODULE-AUDIT is consistent with what I read. The
single actionable item is the MEDIUM test-coverage gap in Step 8; the two LOW
nits and the INFO drift are non-blocking. Recommend status move from
REVIEWING to VERIFIED-pending-tests once `test/cli/cmd/wiki.test.ts` lands;
until then the unit is sound on design and correctness but under-verified on
behavior.
