# patch — 9-step review (ax-code-glm)

Unit: `patch` (single file, `packages/ax-code/src/patch/index.ts`, 786 LOC).
Reviewer: ax-code-glm. Verifier (other lane): codex-sol.
Evidence is taken from a direct read of `packages/ax-code/src/patch/index.ts`
plus the tool-layer consumer in `packages/ax-code/src/tool/apply_patch.ts` and
the parser tests in `packages/ax-code/test/patch/patch.test.ts`.

## Step 1 Scope and inventory

The `patch` unit is exactly one file: `packages/ax-code/src/patch/index.ts`
(786 lines, namespace `Patch`, 18 exported symbols). The MODULE-AUDIT map
lists the same 18 exports and confirms `Source files / LOC = 1 / 787`; that
tally matches what I read (the extra line is the trailing newline). The unit
exposes two distinct surfaces that this review treats separately:

1. A parser + diff engine (`parsePatch`, `stripHeredoc`,
   `parsePatchHeader`, `parseUpdateFileChunks`, `parseAddFileContent`,
   `deriveNewContentsFromChunks`, `computeReplacements`,
   `applyReplacements`, `seekSequence`, `tryMatch`, `normalizeUnicode`,
   `generateUnifiedDiff`).
2. Two parallel apply paths: the verified path
   (`maybeParseApplyPatch` + `maybeParseApplyPatchVerified`) and the
   unverified legacy path (`applyHunksToFiles` + `applyPatch`).

The tool layer in `packages/ax-code/src/tool/apply_patch.ts:39` is the real
production consumer; it imports `Patch.parsePatch` and
`Patch.deriveNewContentsFromChunks` but deliberately _reimplements_ file
writing (apply_patch.ts:357–479) instead of calling `Patch.applyHunksToFiles`.
That divergence is the single most important structural fact about this
module and drives several findings below.

## Step 2 Threat and failure model

The trust boundary is "patch text produced by a model or CLI argv" →
"filesystem writes inside the project worktree". The defence-in-depth chain
the unit _intends_ to provide is: `assertNoNullByte` (index.ts:78–80) →
`resolvePatchPath` containment via `Filesystem.contains` (index.ts:82–89) →
workdir containment (index.ts:697–704) → tool-layer symlink/external-directory
guards (apply_patch.ts:89–100) → FileTime locking + conflict re-read
(apply_patch.ts:384–392). I traced each link:

- `Filesystem.contains` (util/filesystem.ts:203–213) is _lexical_: its own
  comment says "does NOT resolve symlinks — callers that need the stronger
  guarantee must realpath() first." The patch module never realpath()s
  before calling it, so the containment check is correct only against
  lexical escapes (e.g. `../`) and can be fooled by a symlink that points
  out of the worktree. The tool layer compensates with
  `assertSymlinkInsideProject` (apply_patch.ts:90); the in-module
  `applyHunksToFiles` path does **not**.
- `assertNoNullByte` is invoked for the path (index.ts:83) and for
  `args.workdir` (index.ts:697), but never for `hunk.contents`
  (index.ts:622) nor for chunk `old_lines`/`new_lines`. A model-emitted
  NUL inside file content would be written verbatim.
- The implicit-invocation detector (index.ts:680–690) swallows
  `parsePatch` failures into the `NotApplyPatch` bucket. That is correct
  behaviour but means the boundary between "raw patch the model forgot to
  wrap" and "ordinary bash argv" is decided entirely by whether
  `parsePatch` throws, which in turn depends on the fragile
  Begin/End-marker search (index.ts:236–241).

There are no empty catches in this file (MODULE-AUDIT row confirms 0). The
two `.catch(() => undefined)` sites (apply_patch.ts:321, 341, 464) are in
the _tool_ layer, not in this unit, and are intentional ENOENT suppressions
on rollback/unlink.

## Step 3 Correctness — read the control flow for the real surfaces

`parsePatch` (index.ts:222–282): trims, strips heredoc, splits on `/\r?\n/`
so CRLF input does not leave a trailing `\r` (regression-tested at
patch.test.ts:35–45). The Begin/End marker search uses
`lines.findIndex((line) => line.trim() === beginMarker)` — the `.trim()`
means leading whitespace on the marker is tolerated but _any_ whitespace
inside the literal `"*** Begin Patch"` defeats it. Header parsing
(index.ts:92–123) is prefix-based; a path of `" "` after `*** Add File:`
falsy-checks to `null` (index.ts:100, 105, 119) and the outer loop silently
`i++; continue`'s past it (index.ts:248–251), so a malformed `*** Add File:`
line with no path is dropped without an error. That is a real correctness
hole: the patch is reported as applying fewer hunks than the model wrote and
the user gets no signal.

`parseUpdateFileChunks` (index.ts:125–192): the context-line dispatch at
index.ts:132 accepts both `@@` (empty context) and `@@ <ctx>`. The
unprefixed-line fallback at index.ts:167–175 deliberately pushes the line
into _both_ `old_lines` and `new_lines` so a blank line the model emitted
without its leading space does not corrupt `seekSequence`. This is a
forgiveness heuristic that can mask a genuine missing-prefix error; the
comment is explicit about the trade-off.

`computeReplacements` (index.ts:383–438) sorts replacements ascending by
start index (index.ts:435) and `applyReplacements` (index.ts:440–457)
applies them descending. This is correct _if and only if_ replacements do
not overlap. There is no overlap assertion. Because `seekSequence` does
fuzzy matching (rstrip → trim → Unicode-normalised), two chunks can resolve
to overlapping or even identical regions, in which case the descending
splice produces silently corrupt output (the second splice operates on
indices that the first splice has already shifted). Reproducer: a file of
`[a, a, a]` with two chunks both matching `["a"]` from startIndex 0 — the
second replacement's `[startIdx, oldLen]` no longer points at the intended
bytes after the first splice mutates `result`. This is a real defect; I am
classifying it HIGH (not Critical) because the model-emitted chunk stream
is usually monotonic and the fuzzy passes rarely collide in practice.

`seekSequence` (index.ts:502–539): when `NativeAddon.diff()` is present the
native `seekSequence` is called and its return is used directly
(index.ts:506–510). The four JS fallback passes (exact → rstrip → trim →
normalised, index.ts:519–538) run **only** when the native call throws
(index.ts:511–513). A native `seekSequence` that returns `-1` (not found)
is _not_ retried in JS. If the Rust implementation's matching rules differ
from the JS chain in any way (notably Unicode-normalisation, which the JS
pass 4 does explicitly), a patch that applies cleanly on a JS-only build
will fail to apply on a native build, or vice versa. The fallback is also
asymmetric: a _thrown_ native error degrades to the richer JS matcher, but
a native "not found" does not. This is a real cross-environment correctness
risk for the `patch` unit; HIGH.

`generateUnifiedDiff` (index.ts:541–601): JS fallback emits a single
`@@ -1,N +1,M @@` header spanning the whole file (index.ts:600), not a
proper minimal unified diff. Native `unifiedDiff` (index.ts:545–547)
presumably produces real hunks. Cosmetic only — content is correct — so LOW.

`maybeParseApplyPatch` heredoc branch (index.ts:312–336): the regex at
index.ts:316 requires the delimiter to be wrapped in `['"]` (mandatory
quotes), while `stripHeredoc` (index.ts:215) treats the quotes as optional
(`['"]?`). A heredoc written as `apply_patch <<EOF` (no quotes) parses
through `stripHeredoc` on the direct-invocation path but is silently
rejected by the `bash -lc` path, returning `NotApplyPatch`. The inline
comment at index.ts:314 ("Simple extraction - in real implementation would
need proper bash parsing") concedes the fragility. MEDIUM correctness.

## Step 4 Performance characteristics

`deriveNewContentsFromChunks` (index.ts:347–381) uses synchronous
`readFileSync` (index.ts:351) despite being called from two async call
sites (`applyHunksToFiles` at index.ts:636 and `maybeParseApplyPatchVerified`
at index.ts:750). On a large file this blocks the event loop and, in the
tool-layer caller (`apply_patch.ts:160`), stalls the TUI render loop for the
duration of the read. The fix is mechanical: switch to `await
fs.readFile`. MEDIUM.

`seekSequence`'s forward scan (index.ts:488–497) is O(lines × pattern) per
pass and runs up to four passes in the JS fallback. For a 10k-line file
with a long pattern this is acceptable; the native implementation is the
hot-path mitigation and is correctly preferred when present. The JS
fallback also re-allocates `Int32Array(n+1 × m+1)` inside
`generateUnifiedDiff` (index.ts:558) — O(n·m) memory for a whole-file LCS.
For a 10k-line file that is ~400 MB of Int32Array; the JS fallback will
OOM before the native path is consulted if the native addon is absent. LOW
on most workloads, but worth flagging because the failure mode is a hard
crash, not a slow result.

`NativePerf.run` wrappers (index.ts:506, 545) record timings with input
shape (`lines`, `pattern`, `startIndex`, `eof`) — that instrumentation is
appropriate and cheap.

## Step 5 Design and ownership boundaries

The unit has two apply paths and the tool layer has a third. The
verified path (`maybeParseApplyPatchVerified`, index.ts:671–785) builds an
`ApplyPatchAction.changes: Map<string, ApplyPatchFileChange>`
(index.ts:40–44) but **does not** apply it — it returns the action for the
caller to persist. No production caller does so; the tool layer
(`apply_patch.ts`) re-derives `fileChanges` itself from `Patch.Hunk[]`
rather than consuming `ApplyPatchAction`. So the entire
`maybeParseApplyPatchVerified` → `ApplyPatchAction` → `ApplyPatchFileChange`
machinery is, in production, unused: it is exercised only by the parser
tests (patch.test.ts:120–154 call `maybeParseApplyPatch`, none call the
verified variant). The ownership boundary is muddled — three functions
(`deriveNewContentsFromChunks`, `seekSequence`, `generateUnifiedDiff`) are
shared infrastructure; everything else in the apply path is parallel to the
tool layer.

`applyHunksToFiles` (index.ts:604–662) and `applyPatch` (index.ts:665–668)
are exported but called only from `packages/ax-code/test/patch/patch.test.ts`
(17 call sites at patch.test.ts:198–437). They bypass every safety check
the tool layer performs: no `FileTime` lock, no conflict re-read, no
symlink assertion, no `BlastRadius` accounting, no atomic rollback. As a
public API surface this is unsafe; as test-only helper code it is fine. The
design problem is that the namespace does not distinguish the two — both
`applyPatch` and `maybeParseApplyPatchVerified` are top-level exports with
no doc comment warning that only the latter participates in the verified
pipeline. HIGH design smell.

## Step 6 Hygiene — dead code, dead enum variants, unused fields

Within `packages/ax-code/src/patch/index.ts` specifically:

- `ApplyPatchArgs.workdir?: string` (index.ts:25) is consumed at
  index.ts:697–704 but never populated — the only producer is
  `maybeParseApplyPatch` (index.ts:285–339), which constructs `args`
  without a `workdir` field (index.ts:299–302, 322–327). The
  null-byte check and containment check at index.ts:697–704 are
  therefore unreachable in practice. Dead.
- `MaybeApplyPatch.ShellParseError = "ShellParseError"` (index.ts:66)
  is never produced by any code in this file and never matched by any
  consumer (grep across `packages/ax-code` confirms zero references
  outside the declaration). Dead enum variant.
- `MaybeApplyPatchVerified.ShellParseError = "ShellParseError"`
  (index.ts:73) — same: zero producers, zero consumers. Dead.
- `ApplyPatchError.ComputeReplacements`,
  `ApplyPatchError.IoError`, `ApplyPatchError.ImplicitInvocation`
  (index.ts:59–61): only `ImplicitInvocation` is ever constructed
  (index.ts:685). `ParseError`, `IoError`, `ComputeReplacements` have
  no producers in this file; whether external callers match them is
  not visible from this unit, so I flag rather than delete.
- `ApplyPatchFileChange` (index.ts:46–49) and `ApplyPatchAction`
  (index.ts:40–44): only ever produced inside
  `maybeParseApplyPatchVerified`, which itself has no production
  caller. Effectively dead.

None of the above are bugs; they are accumulated residue from earlier
iterations where the verified path was going to be the real entrypoint.
Net effect: ~80 lines of namespace surface that a reader has to
reconstruct as "intended but never wired up". MEDIUM.

## Step 7 Tests

`packages/ax-code/test/patch/patch.test.ts` (444 lines) exercises the
parser well: add/delete/update/move, CRLF stripping, multi-hunk, invalid
format, and the no-prefix blank-line forgiveness (lines 60–93 of the
file). It does **not** cover:

- `seekSequence` Unicode-normalisation pass (index.ts:531–537) — no
  test asserts that curly quotes / en-dashes match ASCII equivalents.
- The EOF anchor branch (index.ts:150–153, 472–484) — `*** End of File`
  has parser coverage but no test of `tryMatch`'s end-anchored match.
- The overlap case in `applyReplacements` (index.ts:440–457) — no test
  asserts behaviour when two chunks' fuzzy matches collide.
- The native/JS divergence in `seekSequence` — there is no test that
  forces the JS fallback (e.g. by simulating a native throw) and
  compares against the native result.
- The workdir containment branch (index.ts:697–704) — unreachable in
  code, so untested by construction.

The tool-layer coverage in `packages/ax-code/test/tool/apply_patch.test.ts`
covers the production write path (conflict, rollback, FileTime) and is the
real safety net for what ships; it does not exercise the in-module
`applyHunksToFiles` either. Test gaps here are LOW severity for the
_production_ path (the tool layer is covered) but HIGH for the _legacy_
`applyPatch` path, which would silently corrupt on the overlap and
Unicode cases above.

## Step 8 Findings register (this review)

No `findings/` directory existed; this is the first review pass. Severity
floor used: Critical = exploitable from a current production call site;
HIGH = real defect reachable from a public export or with cross-environment
impact; MEDIUM = correctness/hygiene smell with bounded impact; LOW =
cosmetic.

- HIGH — `applyReplacements` has no overlap check; fuzzy `seekSequence`
  can produce overlapping replacements, and the descending splice
  silently corrupts output. index.ts:440–457 (driven by 415–431).
- HIGH — native `seekSequence` short-circuits the JS fuzzy passes on a
  `-1` return; patches can apply on one build and fail on the other.
  index.ts:502–539.
- HIGH — `applyPatch` / `applyHunksToFiles` are exported as public API
  but skip every safety guard the tool layer enforces; only test code
  calls them today, so the risk is to future consumers. index.ts:604–668.
- MEDIUM — `parsePatch` silently drops any header line whose payload
  is empty (`*** Add File:` with no path). index.ts:100/105/119 + 248–251.
- MEDIUM — `maybeParseApplyPatch` heredoc regex mandates quoted
  delimiter while `stripHeredoc` makes quotes optional; the two paths
  disagree. index.ts:215 vs 316.
- MEDIUM — dead/unused: `ApplyPatchArgs.workdir` field, two
  `ShellParseError` enum variants, three `ApplyPatchError` variants,
  `ApplyPatchAction`/`ApplyPatchFileChange` types. index.ts:25, 59–61,
  66, 73, 40–49.
- MEDIUM — `deriveNewContentsFromChunks` uses `readFileSync` from two
  async call sites. index.ts:351.
- LOW — `generateUnifiedDiff` JS fallback emits a single whole-file
  hunk header; cosmetic divergence from native. index.ts:600.

No Critical findings, so the independent-verify gate is not triggered by
this review. The reverify.md secondary-confirmation path is therefore not
required for `patch`.

## Step 9 Verification and exit

Static extract fingerprint cited by MODULE-AUDIT is `11132bb694b5b7e4`;
the audit row "Source files / LOC = 1 / 787" matches my read exactly (786
lines + trailing newline). The MODULE-AUDIT exit checklist shows the
dual-agent protocol and Critical independent verify as PENDING; this
reviewer-run satisfies the dual-agent 9-step for the `ax-code-glm` lane
and the independent verifier (codex-sol) remains the other lane per the
audit header. Sign-off roles are not yet complete because the second lane
has not run; this is expected and not a blocker for the unit.

Local verification I did _not_ run: typecheck/test execution is the
implementer's responsibility, not the read-only reviewer's; the evidence
above is from reading `packages/ax-code/src/patch/index.ts`,
`packages/ax-code/src/tool/apply_patch.ts`, and
`packages/ax-code/test/patch/patch.test.ts` directly. The `patch` unit is
structurally sound for its production role (parser + diff engine consumed
by the tool layer) and unsound for its legacy exported apply path, which
should either be deleted or rewired through the same guards the tool layer
enforces. Recommended follow-up order: (1) decide the fate of
`applyHunksToFiles`/`applyPatch`; (2) add the overlap assertion to
`applyReplacements`; (3) reconcile native vs JS `seekSequence` matching
semantics (or document the divergence); (4) harvest the dead enum variants
and `workdir` field.
