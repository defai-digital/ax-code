# Picomatch repeated-extglob backport

The locked `picomatch` versions 2.3.2 and 4.0.7 are affected by
GHSA-fc5q-39xc-vjpf / CVE-2026-112366. A bounded child-process reproduction
of `+(*a)` against 35 `a` characters followed by `b` exceeded 1.5 seconds
for both unmodified versions. No patched registry version was available
when this backport was prepared on 2026-11-17.

The pinned pnpm patches combine the repeated-branch detection from
[upstream PR 235](https://github.com/micromatch/picomatch/pull/235), commit
`0150ed18b7971894bfd1824c8f96d6b63c70ad1f`, with the flat-branch collapse
from [upstream PR 237](https://github.com/micromatch/picomatch/pull/237), commit
`1bf0d04563cb9ce568cf36efc5f6b7187d9911d5`. Both proposals are unmerged.
The original MIT license and copyright notices remain in the installed
packages; the patches retain attribution.

For flat path-segment patterns containing a star, repetition is redundant:
`+(*a)` becomes `(?:[^/]*?a)`, and `*(*a)` uses an optional group. Complex
wildcard-bearing repeated extglobs use Picomatch's existing risky-pattern
literal fallback. This intentionally treats those patterns as literals;
ordinary glob stars, braces, character classes, and literal alternatives
remain available. The existing explicit `maxExtglobRecursion: false`
opt-out remains intended for trusted callers only.

The collapse is restricted further than PR 237: path separators, escapes,
character classes, nested groups, alternation, and globstars cannot take the
collapse path. The original proposal changed matching for `+([/]*)`, because
a path-segment star cannot absorb the slash introduced by another repetition.
That case now takes the existing literal fallback instead of an incorrect
rewrite. Independent review also found a divisor-only overlap regression
(`aa|aaa`), overlapping non-literal alternatives (`a|[a]`, `ab|a?`), and a
literal-opening-bracket bypass (`[[]*`). Local probing also reproduced ambiguity
involving three alternatives (`a|ab|b` and `foo|foobar|bar`). The patches use
Sardinas-Patterson suffix analysis to detect ambiguous literal repetitions,
reject uncertain non-literal alternatives, and track bracket state without
nesting. Comparison honors case-insensitive matching, including Unicode case
variants, using the regular expression engine's actual case semantics.
Analysis exceeding 256 suffix states or 4,096 comparisons takes the literal
fallback. Ordinary uniquely decodable alternatives such as `js|jsx` remain
available. Each defect has a bounded-process regression case.

`node script/check-picomatch-security.mjs` verifies that the lockfile contains
only these two Picomatch versions, that both versions have pinned patches,
and that the actual runtime glob and watcher consumers finish malicious
matching within a killed child-process deadline. It also checks ordinary
matching and the literal fallback. CI runs this guard before OSV scanning.

OSV currently reports the original package version even when pnpm applies
a backport. The scanner configuration remains unchanged until a separate
decision authorizes any temporary advisory exception. A backport is not an
upstream patched release, and the advisory must not be dismissed as fixed
upstream.
