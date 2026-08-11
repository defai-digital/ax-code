# tool-mutation — 9-Step Dual-Agent Review (ax-code-glm)

Unit slug: `tool-mutation`
Reviewer: ax-code-glm (model `zai-coding-plan/glm-5.2[1m]`)
Independent verifier (other lane): codex-sol
Baseline commit: `8a38b90b950855545c6b2479220274357904f111`

This review is grounded in the seven source files under
`packages/ax-code/src/tool/` (`apply_patch.ts`, `edit-helpers.ts`,
`edit-impl.ts`, `edit.ts`, `multiedit.ts`, `notebook_edit.ts`, `write.ts`).
All line references below point at those files unless stated otherwise.

## Step 1 Scope & Inventory

`tool-mutation` is the surface a model uses to mutate the filesystem: it owns
seven files totalling ~2018 LOC. The barrel re-export
`packages/ax-code/src/tool/edit.ts:1` deliberately keeps `EditTool`,
`parseNativeEditReplaceResult`, `trimDiff`, and `replace` reachable from a
single import so `multiedit.ts:10` and `write.ts:9` both pull `replace`/`trimDiff`
from the same facade. The two largest bodies are `edit-impl.ts` (849 LOC of
fuzzy-match replacers plus the `EditTool.execute` flow) and `apply_patch.ts`
(540 LOC of multi-hunk apply/rollback). `edit-helpers.ts` (66 LOC) is the
small line-ending utility module that both consumers depend on for CRLF-safe
splicing. The shape is appropriate for the unit — one orchestrator per
mutation primitive, shared helpers factored into `edit-helpers.ts`.

## Step 2 Boundary & Threat Surface

The mutation tools are the highest-stakes surface in the agent: they write,
delete, and move files under `Instance.directory`. The boundary guards are
applied consistently across the family:

- `assertExternalDirectory` + `assertSymlinkInsideProject` —
  `apply_patch.ts:89-90`, `edit-impl.ts:62-63`, `multiedit.ts:59-60`,
  `notebook_edit.ts:84`, `write.ts:58`.
- `Isolation.assertWrite(ctx.extra?.isolation, …)` — every tool, gating
  workspace-write vs read-only sandboxes.
- `BlastRadius.assertWritable(ctx.sessionID, relativePath)` —
  `apply_patch.ts:93`, `edit-impl.ts:65`, `multiedit.ts:66`, `notebook_edit.ts:86`,
  `write.ts:60`. This is the autonomous-mode block on protected paths
  (dotenv, secrets).
- `FileTime.assert(ctx.sessionID, file)` — staleness check so an unread file
  cannot be silently clobbered.

I traced each guard across all five tools; coverage is uniform with two
gaps noted in Step 4. No secrets/credential handling lives in this unit —
the tools treat content as opaque text — so the secret-leak vector is
out-of-scope here and handled by `BlastRadius` upstream.

## Step 3 Correctness — Control Flow

I read each `execute()` body end to end. The single-edit path in
`edit-impl.ts:52-256` runs its entire read → diff → permission →
re-check → write inside `FileTime.withLock` (line 70), and the
`assertUnchangedBeforeWrite` closure at lines 75-83 re-reads the file after
the approval UI returns so a concurrent editor cannot swap bytes mid-flow.
The `oldString === ""` overwrite branch (lines 85-119) explicitly calls
`FileTime.assert` when the file already exists (line 94), closing the
bypass documented in the inline comment at lines 87-92.

`apply_patch.ts` splits verification (lines 86-265) from application
(lines 357-496). Between the two phases it re-reads each target inside the
lock and throws `apply_patch conflict: …` if bytes drifted
(`apply_patch.ts:370-375`, `388-389`, `408-411`, `432-438`, `458-461`). The
rollback path at lines 305-355 collects failures into `rollbackErrors`
instead of swallowing them, and the outer catch at lines 480-496 rewrites
the thrown error when rollback was incomplete (BUG-107 fix). This is the
correct shape for partial-failure reporting.

`multiedit.ts` resolves all edits in memory (lines 80-129) and only commits
to disk inside a second per-file lock pass (lines 131-154), with a conflict
check at line 147 (`latest !== prev`) and a parallel rollback in
lines 159-190 that mirrors `apply_patch.ts`'s error-surfacing pattern.

`notebook_edit.ts:92-197` reuses the same lock-then-revalidate pattern,
re-checking the symlink (line 179), the FileTime (line 180), and the raw
bytes (line 181) before `fs.writeFile` at line 185.

## Step 4 Correctness — Edge Cases & Gaps

(a) `apply_patch.ts` "add" hunk path (lines 103-145): when the hunk targets
a file that already exists, `existed` flips to `true` and `oldContent` is
captured, but unlike the "update" branch at line 148 the "add" branch never
calls `FileTime.assert(ctx.sessionID, filePath)`. This is a MEDIUM-severity
gap: a session that never read a file can still overwrite it via an
`add` hunk, bypassing the staleness gate that `edit-impl.ts:93-94` now
enforces for the `oldString === ""` case. Recommendation: call
`await FileTime.assert(ctx.sessionID, filePath)` inside the `case "add"`
block when `existed` is true.

(b) `edit-helpers.ts:11-14` `convertToLineEnding`: when the detected ending
is CRLF, it does `text.replaceAll("\n", "\r\n")`. If the input already
contains lone `\r\n` pairs, each `\n` of those pairs is replaced again,
producing `\r\r\n`. In practice `edit-impl.ts:134-135` normalizes to `\n`
first, so the double-conversion does not bite on the edit path — but the
helper is exported and a caller that passes pre-CRLF text would corrupt
it. Worth a guard or a doc comment.

(c) `edit-impl.ts:486-499` WhitespaceNormalizedReplacer: the ReDoS cap of
6 words is documented inline (lines 479-484) and the `> 6` branch yields
`find` as a fallback. The fallback is sound; the only cost is a missed
substring match on very long lines, which degrades gracefully to the next
replacer in the chain.

(d) `notebook_edit.ts:144` cell-id generation slices to 8 hex chars
(32 bits). Collision risk is negligible for realistic notebook sizes but
not formally zero — acceptable for this surface.

## Step 5 Performance

`edit-impl.ts:740-768` `replace` prefers the native Rust addon
(`NativeAddon.diff().editReplace`) when the content has no CRLF and the
oldString is directly present, wrapping it in `NativePerf.run` for
instrumentation. The JS fallback (lines 770-847) runs nine replacers in
sequence but short-circuits as soon as a single unambiguous candidate is
found (line 825). `apply_patch.ts` computes per-hunk diffs with `diffLines`
twice (lines 127-130 for add, 171-174 for update) purely to count
additions/deletions — the diff itself is already produced by
`createTwoFilesPatch` one line earlier, so the second `diffLines` pass is
redundant work on large hunks. Not blocking; a future pass could derive
counts from the same structured change objects. `write.ts:122-125` and
`edit-impl.ts:209-212` both compute additions/deletions from `diffLines`,
which is the correct churn-based accounting (the BUG-119 comment at
`write.ts:115-119` documents the prior double-count).

## Step 6 Design & Cohesion

Cohesion is strong: each tool file owns exactly one mutation primitive.
The `edit.ts` re-export barrel (1 line) keeps the public surface stable
while letting `edit-impl.ts` grow without breaking `multiedit.ts`/`write.ts`
imports. Coupling is well-directional: `multiedit.ts:10` and `write.ts:9`
depend on `./edit`, which depends on `./edit-helpers`; no cycle exists.
`apply_patch.ts` is the one file that reaches across into `edit-impl.ts`
for `trimDiff` (`apply_patch.ts:12`) — a reasonable reuse rather than a
duplication. The fuzzy replacers in `edit-impl.ts:279-702` are a chain of
small generator functions sharing one `Replacer` type, which is a clean
strategy pattern with nine concrete implementations; that is justified by
the nine distinct matching strategies, not over-engineering. The biggest
design smell is `apply_patch.ts`'s `execute` body (~460 lines): the
verification loop, the rollback closure, the application switch, and the
event-publishing tail are all inlined. Extracting `verifyHunks`,
`applyChange`, and `rollbackChange` would materially improve readability
without changing behaviour — flagged as a LOW-severity refactor candidate.

## Step 7 Dead Code & Hygiene

I checked for empty catches, unused exports, and stale TODOs. Empty catches:
zero (matches the MODULE-AUDIT inventory). The `.catch(() => undefined)`
swallows at `apply_patch.ts:321,333,341,464-466` are intentional
best-effort unlinks during rollback/delete and are documented by the
surrounding control flow. `readFileIfExists` at `apply_patch.ts:25-30` is a
small private helper used only inside the apply loop — appropriate, not
dead. `edit-helpers.ts` exports `normalizeLineEndings`,
`detectLineEnding`, `convertToLineEnding`, `spliceNormalizedReplacement`,
and the `LineEnding` type; all five are consumed by `edit-impl.ts` and/or
`multiedit.ts`. `trimDiff` is exported from `edit-impl.ts:704` and used by
both `apply_patch.ts:123,167,236` and `write.ts:89`. No orphaned exports
detected. Comment density is high but every comment I sampled documents a
real past bug (BUG-107, BUG-119, the ReDoS cap, the 2-line anchor fix at
`edit-impl.ts:354-356`) — this is signal, not noise.

## Step 8 Tests & Verification

The MODULE-AUDIT ledger lists `packages/ax-code/test/tool/apply_patch.test.ts`
plus rendering/replay/error-pattern coverage in `packages/ax-code/test/session/`
and `packages/ax-code/test/replay/`. I did not re-run the suite in this
review pass — that is the verifier lane's job (codex-sol). What I verified
statically: every error throw in the five tools is reachable on a real
input (no unreachable branches), every rollback path has a paired
`rollbackErrors` collector, and every `FileTime.withLock` critical section
revalidates bytes before writing. The `assertUnchangedBeforeWrite` closure
in `edit-impl.ts:75-83` and the equivalent inline checks in
`notebook_edit.ts:181`, `write.ts:108`, and `multiedit.ts:147` all compare
the exact string the user approved against a fresh read, which is the
correct invariant. I did not find a path where an approved diff could be
substituted with different bytes at write time.

## Step 9 Findings Disposition & Exit

No Critical findings. Two accepted findings:

- MEDIUM — `apply_patch.ts` "add" hunk skips `FileTime.assert` for existing
  targets (Step 4a). Suggested fix: add the assert inside `case "add"` when
  `existed` is true, mirroring the `edit-impl.ts:93-94` precedent.
- LOW — `edit-helpers.ts:11-14` `convertToLineEnding` can corrupt
  pre-CRLF input (Step 4b). Suggested fix: document the precondition or
  guard against `\r\n` → `\r\r\n` expansion.

One refactor candidate: split `apply_patch.ts` `execute` into
verify/apply/rollback helpers (Step 6). No other dispositions are
outstanding; no Critical items exist in `findings/`, so the independent
verifier re-confirmation gate does not fire for this unit. Verification
commands for the verifier lane are the standard core suite
(`pnpm --dir packages/ax-code run typecheck`, `pnpm --dir packages/ax-code
run test:unit` with `AX_TEST_FILES=test/tool/apply_patch.test.ts`); I am
not recording those as STATUS entries, only pointing the next lane at them.
Review complete for `tool-mutation`.
