# Protocol 9-Step Review — unit `import`

Reviewer: ax-code-glm (model `zai-coding-plan/glm-5.2[1m]`)
Unit: `import` · Source root: `packages/ax-code/src/import`
Primary file: `packages/ax-code/src/import/compatibility.ts` (162 lines, single file in the unit)
Verifier lane: codex-sol

This review was produced by reading the actual source and its dependencies
(`src/util/filesystem.ts`, `src/util/glob.ts`, `src/config/markdown.ts`) plus the
three test files (`test/import-compatibility.test.ts`, `test/cli/import.test.ts`,
and the edges test referenced in MODULE-AUDIT). Every claim below cites a real
file:line.

## Step 1 Scope and map of the import unit

The entire `import` unit is one file: `packages/ax-code/src/import/compatibility.ts`.
It exports a single namespace `CompatibilityImport` (compatibility.ts:7) with two
public async entry points — `plan` (compatibility.ts:38) and `run`
(compatibility.ts:59) — and three Zod schemas (`Source` at :8, `Candidate` at :11,
`Report` at :22) that double as the public type contract. There are no other
modules under `src/import/`. The function of the unit is to migrate slash-commands,
skills, agents, and one instruction file from rival agent config trees
(`.opencode`, `.claude`, `.codex` — ROOTS map at compatibility.ts:32-36) into the
local `.ax-code` tree. The surface is small and self-contained, which is
appropriate for the scope.

## Step 2 Threat and failure model for import

The trust boundary is the rival config directory on disk (`.opencode` etc.) which
is treated as untrusted input and re-emitted into `.ax-code`. Two concrete failure
modes dominate. (1) Silent loss: `scan` at compatibility.ts:134-142 ends with
`.catch(() => [] as string[])`, so an ENOENT root, an EACCES permission denial, or
an ELOOP caused by `symlink: true` (compatibility.ts:139) all collapse to an empty
candidate list with zero signal — the user sees "Import opencode: 0 candidates" and
cannot distinguish a genuinely empty source from a broken one. (2) Path integrity:
`run` writes to `item.targetPath` (compatibility.ts:65) where `targetPath` is built
from a relative path derived from the source tree; there is no final containment
assertion that the resolved target stays inside `.ax-code`. These are the two
shapes the rest of the steps drill into. Secrets-in-files are out of scope for this
unit (it copies markdown verbatim and never parses for credentials), so the
secrets axis is not a finding here.

## Step 3 Public-function behavior and correctness

`plan` (compatibility.ts:38-57) joins `input.directory` with the per-source ROOT,
then dispatches to `commandCandidates` (:71), `skillCandidates` (:83), and
`agentCandidates` (:94), and conditionally appends a codex `AGENTS.md` instruction
candidate (:47-54). Each candidate factory calls `candidate` (:105), which sets
`action: "copy"` unless the target already exists (`Filesystem.exists` at :112), in
which case it sets `skip` + `reason: "target_exists"` (:116-119). This skip logic is
verified by `test/cli/import.test.ts:51-67`, which proves an existing
`.ax-code/commands/review.md` is preserved and reported with `skipped: 1`.
`run` (compatibility.ts:59-69) re-invokes `plan` internally and, when `write` is
true, performs `Filesystem.readText(source) → Filesystem.write(target)` per copy
candidate (:65). The dry-run path is verified by `test/cli/import.test.ts:9-49`,
which confirms `write:false` leaves `.ax-code/commands/snapshot.md` absent (:47).
The control flow is internally consistent; the correctness concerns are not in the
happy path but in the error and warning paths detailed in steps 5–7.

## Step 4 Performance and I/O shape of plan/run

`plan` issues four `Glob.scan` calls in sequence (one per kind, plus the conditional
instruction stat). Each scan is `await`ed independently rather than `Promise.all`'d
(compatibility.ts:44-46), so for a large source tree the scans serialize on
filesystem I/O when they could overlap. This is low-impact because globs over a
markdown config tree are sub-millisecond, but it is a missed concurrency
opportunity worth noting. `run` does sequential `await Filesystem.write` in a `for`
loop (:63-66) with no parallelism; `Filesystem.write` itself writes via a temp file

- rename (`src/util/filesystem.ts:83-116`), which is safe and crash-atomic. No N+1
  pattern, no unbounded memory growth — candidate lists are small. No performance
  finding is raised; the serialisation is noted as informational only.

## Step 5 Coupling, ownership, and design of import

`compatibility.ts` depends on three siblings: `ConfigMarkdown`
(`src/config/markdown.ts` via compatibility.ts:3), `Filesystem`
(`src/util/filesystem.ts` via :4), and `Glob` (`src/util/glob.ts` via :5). All three
are leaf utilities, so the dependency graph is shallow and acyclic — good. The
design question is the relationship between `plan` and `run`: `run` cannot accept a
pre-built `Report` and instead re-derives one by calling `plan` (:60). That means a
caller cannot review a dry-run report and then ask the system to execute that exact
candidate set; the second plan pass can observe a different filesystem. The `Report`
type already contains everything needed to execute, so `run` accepting an optional
`Report` would close this gap with no new abstraction. This is a small, targeted
design note, not a structural problem — the module is correctly sized at one file.

## Step 6 Error handling, dead code, and the silent-failure site

`commandWarnings` (compatibility.ts:124-132) handles `ConfigMarkdown.parse` failure
defensively: `.catch(() => undefined)` then returns `["invalid_frontmatter"]`
(:125-126). That is intentional and surfaced to the user, so it is not a silent
swallow. The genuine silent-swallow site is `scan` (:134-142): the
`.catch(() => [] as string[])` discards the error object entirely, including
permission errors that a user would want to know about. The MODULE-AUDIT table
records "Empty catches | 0" for this file, but that count evidently misses arrow-form
`.catch(() => …)` handlers; this step flags the discrepancy so the finding ledger
can be corrected. `relativeAfterAny` (:144-150) has a genuine fallback branch: if
neither `agent` nor `agents` root contains the file, it returns `path.basename(file)`
(:149). That branch is reachable only if `Glob` returns a path outside both roots,
which with `cwd: root` should not happen — it is defensive dead-ish code that is also
untested.

## Step 7 Warning semantics and test coverage for import

Warning flags do not gate copying. `commandWarnings` can attach
`unsupported_shell_interpolation` (compatibility.ts:128) and
`workflow_requires_runtime_flag` (:129-130), but `candidate` still sets
`action: "copy"` and `run` still performs the verbatim copy (:65). The test at
`test/cli/import.test.ts:44-46` asserts the `unsupported_shell_interpolation`
warning is present in the report, but nothing asserts the copied command actually
works — and because ax-code drops the `!`backtick` shell interpolation
(`SHELL_REGEX`at`src/config/markdown.ts:8`), the imported command is silently
semi-functional. That is a UX correctness gap. On coverage: the three test files
exercise dotted agent subdirs (`test/import-compatibility.test.ts:8-22`), dry-run +
shell warning, and skip-on-existing. Uncovered branches: the codex `AGENTS.md`instruction path (compatibility.ts:47-54), the`workflow_requires_runtime_flag`warning, the`invalid_frontmatter`warning, the`relativeAfterAny` basename fallback
(:149), and any scan-failure behaviour. The codex instruction branch in particular
is a distinct public behaviour with zero test coverage.

## Step 8 Finding register for the import unit

No Critical findings. Registered items:

1. MEDIUM — `scan` swallows all errors via `.catch(() => [])` at
   `packages/ax-code/src/import/compatibility.ts:141`; a broken/permission-denied
   source root is indistinguishable from an empty one. Recommend surfacing at least
   ENOENT-vs-other to the report.
2. MEDIUM — No target containment check before write at compatibility.ts:65; the
   `..legacy` target preserved by `test/import-compatibility.test.ts:19` shows
   `..`-prefixed segments pass through unchallenged. Recommend a single
   `Filesystem.contains(targetRoot, targetPath)` guard before the write loop.
3. LOW — Warning flags never gate the copy (compatibility.ts:113-121, :124-132);
   `unsupported_shell_interpolation` commands are copied verbatim and will be
   silently degraded at runtime.
4. LOW — `run` re-plans instead of executing a caller-supplied `Report`
   (compatibility.ts:59-69), so dry-run-review-then-execute can observe divergent
   filesystem state.
5. LOW — Coverage gap: codex `AGENTS.md` instruction branch (:47-54),
   `workflow_requires_runtime_flag`, `invalid_frontmatter`, and the `relativeAfterAny`
   basename fallback (:149) are untested.

## Step 9 Verification and exit state for import

Because no Critical findings were identified in step 8, no `reverify.md` is written
and no independent verifier re-pass is required to clear the gate. The findings
above are MEDIUM/LOW and are recorded for the implementer; they do not block
sign-off of the unit's current correctness on its happy path, which is covered by
the two CLI tests. Recommended next actions for the module owner, in priority
order: (a) replace the blanket `.catch(() => [])` at compatibility.ts:141 with
differentiated handling; (b) add a `Filesystem.contains` guard on the write target
in `run`; (c) add a test for the codex instruction branch. Exit checklist: 9-step
protocol complete for the `import` unit; reviewer ax-code-glm; verifier codex-sol
to cross-check on the MEDIUM items during the next pass.
