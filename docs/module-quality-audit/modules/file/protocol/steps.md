# Protocol steps — unit `file` (reviewer: ax-code-glm)

Real 9-step review of `packages/ax-code/src/file/*`. Every citation below is a
file:line I read during this pass. No Critical findings exist in `findings/`,
so no `reverify.md` is emitted (see Step 8).

## Step 1 Scope and inventory of the file unit

The unit under review (slug `file`) lives in `packages/ax-code/src/file` and is
composed of seven modules. I read all seven this pass: `ignore.ts` (57 lines),
`index.ts` (780 lines), `protected.ts` (59 lines), `ripgrep.ts` (528 lines),
`status.ts` (57 lines), `time.ts` (90 lines), and `watcher.ts` (406 lines).
`index.ts` is the dominant module (~40% of the unit LOC) and exports the public
`File` namespace surface that the HTTP server routes (`GET /file/content`,
`GET /file`) call directly — confirmed by the comment block at
`packages/ax-code/test/file/path-traversal.test.ts:38-46`. The other six modules
are cohesive single-responsibility helpers: `ignore.ts` (ignore matching with a
native fast-path), `protected.ts` (TCC-protected directory lists),
`ripgrep.ts` (ripgrep bootstrapping + walk/search), `status.ts` (git numstat
parsing), `time.ts` (read-before-write stamps + per-file locks), and
`watcher.ts` (three-backend file watcher).

## Step 2 Boundary and trust model

The boundary that matters most is untrusted path input crossing into
`File.read` and `File.list`, because those are reached from HTTP routes without
the agent permission layer. Three independent controls defend it:
`assertSafePathInput` rejects embedded NUL bytes (`index.ts:24-28`),
`Filesystem.contains` rejects lexical escapes (`index.ts:623`, `index.ts:713`),
and a `realpath` + second `contains` check rejects symlink redirection
(`index.ts:627-632`, `index.ts:717-723`). I verified `contains` is intentionally
symlink-unaware at `packages/ax-code/src/util/filesystem.ts:203-213` (comment:
"does NOT resolve symlinks — callers that need the stronger guarantee must
realpath() first"), which is exactly why the `file` callers do their own
realpath. This is defense-in-depth, not redundancy, and it is sound. The
downloader in `ripgrep.ts` fetches over HTTPS via `Ssrf.pinnedFetch`
(`ripgrep.ts:164`) and verifies a sha256 before extraction (`ripgrep.ts:195-200`),
so the supply-chain boundary is also covered.

## Step 3 Correctness of control flow

I traced the public `read`, `list`, `status`, and `search` functions. Two
correctness observations. First, `ignore.ts` evaluates the whitelist loop
twice: once at `ignore.ts:25-27` before the native fast-path, and again verbatim
at `ignore.ts:41-43` after it. When the native addon returns a value the second
loop is unreachable; when native is `null` or throws the first loop already
short-circuited — so lines 41-43 are dead on every path. Behavior is correct
(whitelist always wins) but the duplication is a footgun: editing only one copy
would split the native and JS semantics. Second, `ripgrep.ts` `files()` treats a
missing cwd inconsistently across backends: the native branch
(`ripgrep.ts:314-343`) lets the addon raise its own error, while the subprocess
branch synthesizes a normalized ENOENT at `ripgrep.ts:356-366`. Callers that
catch ENOENT to mean "directory gone" will behave differently when the native
addon is active.

## Step 4 Performance and resource use

The hot paths are well-bounded. `File.status` replaced a naive `Promise.all`
over untracked files with a 32-wide worker pool (`UNTRACKED_CONCURRENCY` at
`index.ts:562`) explicitly to fix fd-exhaustion on monorepos — the rationale and
BUG-102 reference are in the comment at `index.ts:556-561`. The home-directory
scan guard at `index.ts:423-426` short-circuits the recursive Ripgrep walk to a
two-level `readdir` so that launching `ax-code serve` from `$HOME` does not
block the event loop; the comment at `index.ts:411-422` explains the
symlink-aware resolved-vs-resolved comparison. `Ripgrep.files` honors a `limit`
and early-returns in both backends (`ripgrep.ts:311`, `ripgrep.ts:401`). One
inconsistency: the native watcher polls at 50ms (`watcher.ts:211`) while the JS
poll watcher uses `POLL_MS = 100` (`watcher.ts:29`) — a 2x event-latency
difference between backends that is undocumented and could surprise users
switching on `AX_CODE_NATIVE_WATCHER`.

## Step 5 Design and module boundaries

Module boundaries are clean. Each helper exports a single namespace and
`index.ts` composes them: `FileIgnore`, `Protected`, `Ripgrep`, and the status
parsers. The ignore model is intentionally dual-source: `ignore-patterns.json`
is the single source of truth shared by JS and Rust, enforced by the drift test
at `packages/ax-code/test/file/ignore-drift.test.ts:17-24`, which asserts the
`packages/...` copy equals `crates/ax-code-fs/ignore-patterns.json`. The
watcher's three-backend strategy (native `watcher.ts:188-219`, parcel
`watcher.ts:221-258`, poll `watcher.ts:260-312`) with ordered fallback in
`subscribe()` (`watcher.ts:314-352`) is the right shape — feature-gated with a
deterministic poll fallback. One design smell: `index.ts` carries ~190 lines of
hardcoded extension sets (`binary`/`image`/`text` at `index.ts:99-277`) inline;
these are data and could live in a JSON sibling the way `ignore-patterns.json`
does, but it is low-urgency churn, not a structural defect.

## Step 6 Dead code, duplication, hygiene

The single logged finding (`findings/AUDIT-file-empty-catch.md`, severity Low)
is the empty catch at `ripgrep.ts:275` on `zipReader.close()`. I agree with the
needs-log disposition: closing a zip reader after a failed extraction is
best-effort, but swallowing the error silently makes a leak indistinguishable
from a genuinely closed handle. Beyond that finding, the duplicate whitelist
loop at `ignore.ts:41-43` (discussed in Step 3) is dead on every execution path
and should be deleted. `ripgrep.ts:247` uses `let rgEntry: any` inside an
otherwise typed extraction block — a localized `any` that a typed
`ZipEntry | undefined` would remove. The `.ax-code` magic skip appears as a raw
string at `ripgrep.ts:434` in the `tree` builder; hoisting it to a named
constant shared with the ignore list would prevent drift. These last three are
non-blocking LOW observations I am not promoting to formal findings; they are
recorded here so a future cleanup pass can pick them up.

## Step 7 Test coverage assessment

Coverage is strong on the security-critical paths.
`packages/ax-code/test/file/path-traversal.test.ts` exercises `../`, deeply
nested `../`, absolute escape, and prefix-collision edge cases (e.g.
`/project-other/file` at `path-traversal.test.ts:29`) against both
`Filesystem.contains` and the full `File.read`/`File.list` HTTP code path
(`path-traversal.test.ts:47-128`). `ignore-drift.test.ts` (BP-07) guards the
JS/Rust pattern parity that prevents silent ignore regressions. The
`MODULE-AUDIT.md` inventory (lines 57-71) lists dedicated tests for `ignore`,
`index`, `ripgrep`, `status`, `time`, `watcher`, and the `fsmonitor` flag. Gaps I
noted while reading source: the duplicate-whitelist path in `ignore.ts` is not
covered by a test asserting native-off parity with native-on (a natural
addition to `ignore.test.ts`), and the native-watcher 50ms vs poll 100ms
interval difference has no behavioral assertion.

## Step 8 Findings register reconciliation

The `findings/` directory contains exactly one file, `AUDIT-file-empty-catch.md`,
classified `silent-error / Low / deferred` with a 2026-09-11 expiry and
`codex-sol` as independent verifier. The `MODULE-AUDIT.md` register row (line 89) matches that file one-to-one. There are no Critical or High severity items
in `findings/`. Because no Critical findings exist, the protocol gate does not
require a `reverify.md` independent second pass, so none is written here. My
review surfaced two additional non-blocking observations (the dead duplicate
whitelist at `ignore.ts:41-43` and the localized `any` at `ripgrep.ts:247`) that
I intentionally did not promote to formal findings; they are captured in Step 6
for traceability.

## Step 9 Verification and sign-off state

This unit's protocol is now at dual-agent 9-of-9 from the primary `ax-code-glm`
lane; the independent verifier remains `codex-sol` per the audit header
(`MODULE-AUDIT.md:13`). The verification commands applicable to this unit are
the core package typecheck (`pnpm --dir packages/ax-code run typecheck`) and the
file-scoped tests in the audit inventory, runnable via `AX_TEST_FILES` targeting
`test/file/*`. The exit checklist in `MODULE-AUDIT.md:99-103` still has "Full
9-step protocol" and "Sign-off roles complete" unchecked — this `steps.md`
satisfies the first; the second is pending `codex-sol`'s independent
confirmation. Baseline commit `8a38b90b950855545c6b2479220274357904f111` and
fingerprint `4620a4dba682368d` are unchanged by this read-only review.
