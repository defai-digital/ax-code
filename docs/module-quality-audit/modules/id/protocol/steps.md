# Protocol Steps — `id`

Reviewer: codex-sol (model `gpt-5.6-sol-xhigh`)
Unit slug: `id` · Independent verifier: ax-code-glm

## Step 1 Scope and dependency map

The `id` unit consists of `packages/ax-code/src/id/id.ts` (118 lines) and
`packages/ax-code/src/id/branded.ts` (45 lines). `Identifier` owns the closed prefix
registry and the generation, validation, and timestamp functions (`id.ts:5-38,
46-117`); `branded.ts:7-44` layers nominal TypeScript brands and zod schemas over
that runtime. Representative consumers show the breadth of this leaf module:
`packages/ax-code/src/session/schema.ts:3-16` defines five durable session-domain ID
types, while `packages/ax-code/src/workflow/state.ts:11-43` defines five workflow ID
types directly from `Identifier`. The unit itself has no persistence, network,
filesystem, subprocess, config, event, or disposal behavior. Its generated strings
become database keys and ordering tokens downstream; for example,
`packages/ax-code/src/session/message-v2-impl.ts:980-983` orders parts by ID and
`:1013-1023` queries messages lexicographically after an ID.

## Step 2 Trust and failure model

The important asset is identifier integrity at input and ordering boundaries.
Cryptographic suffix bytes originate locally through `randomBytes` (`id.ts:2,
65-80`), so this code does not expose secrets, but external route parameters reach
the branded schemas: `packages/ax-code/src/server/routes/route-params.ts:21-35`
uses `SessionID.zod`, `PtyID.zod`, `QuestionID.zod`, and `PermissionID.zod`.
`Identifier.schema` checks only `startsWith(prefixes[prefix])` (`id.ts:36-38`), and
the supplied-ID path repeats that same condition (`id.ts:54-63`). Consequently the
probe `Identifier.schema("session").safeParse("sesame")` returned `success: true`
even though generated session IDs begin `ses_`. Downstream exact-key lookups limit
this to malformed-input acceptance rather than an authorization bypass, but the
declared validation boundary is weaker than the generated format. Crash paths are
limited to synchronous crypto failure and malformed input to `timestamp`, whose
unguarded `BigInt("0x" + hex)` conversion is at `id.ts:105-116`.

## Step 3 Correctness and ordering invariants

The central invariant is that ascending IDs compare in creation order and descending
IDs compare in reverse order. The implementation packs `timestamp * 0x1000 +
counter` (`id.ts:83-94`) into only six bytes (`id.ts:96-101`), leaving 36 timestamp
bits after the 12 counter bits. The encoded clock therefore wraps every
68,719,476,736 ms. A deterministic probe at the next boundary produced
`msg_fffffffff001...` for 2026-08-14T11:19:55.135Z and
`msg_000000000001...` one millisecond later, so `beforeID < afterID` was false.
That is reachable in normal operation and affects ID comparisons in
`packages/ax-code/src/session/revert.ts:76,115-120`, incremental message retrieval
in `packages/ax-code/src/session/message-v2-impl.ts:1013-1021`, and part display
order in `message-v2-impl.ts:980-983`.

Two further monotonicity failures are visible in `id.ts:83-101`. A probe calling
`create(..., 200)` then `create(..., 100)` returned IDs in decreasing order because
the clock is not clamped. Also, after 4,097 calls at timestamp 500, the encoded
time/counter prefix equaled the next call at timestamp 501; order then depended on
the random suffix. This contradicts the module's monotonic-state comment at
`id.ts:42-44`. Supplied IDs do throw on a wrong token (`id.ts:59-61`), but an empty
supplied string takes the generation branch because `id.ts:55` uses a truthiness
check.

## Step 4 Performance and resource behavior

Generation is constant-space and performs a fixed six-byte buffer fill
(`id.ts:96-101`). The suffix loop (`id.ts:71-80`) uses unbiased rejection sampling:
bytes at or above 248 are discarded, and each pass requests twice the remaining
nominal length (`id.ts:73-77`). For the 14-character suffix, the expected rejection
rate is only 8/256, so repeated crypto reads are extremely unlikely; no performance
finding is justified without a workload benchmark. `randomBytes` is synchronous
(`id.ts:2,74`), which keeps the API simple but places crypto work on the Node event
loop. The only module-level state is two numbers (`id.ts:43-44`), so there is no
unbounded cache or listener growth. The 4,096-per-millisecond threshold discussed
in Step 3 is a correctness boundary, not evidence of a throughput regression.

## Step 5 Design and ownership

The split between runtime identity and nominal typing is cohesive: `branded.ts:11-31`
returns one immutable bundle containing `make`, ascending/descending constructors,
schema, tag, and prefix, while `branded.ts:34-44` supplies a deliberately unprefixed
variant for provider/project-style strings. The closed `Prefix` union derives from
the registry (`id.ts:6-34`), preventing callers from inventing tokens accidentally.
The main design risk is duplicated generator policy across packages.
`packages/util/src/identifier.ts:40-65` implements the same timestamp/counter/random
layout, but unlike this unit it clamps a regressing clock and handles the 12-bit
counter boundary at `packages/util/src/identifier.ts:42-54`. Two near-identical
owners have already diverged on core ordering safeguards. Consolidating the shared
packing algorithm, or importing one implementation from the other with prefixing as
a wrapper, would make monotonicity policy single-sourced.

## Step 6 Dead code, casts, and documentation hygiene

No unreachable registration, compatibility flag, TODO/FIXME, empty catch, or
suppression appears in the two source files. The casts in `branded.ts:19-20,
23-26,39-40` are intentional nominal-brand constructors; the test explicitly
asserts that `make` preserves the input at
`packages/ax-code/test/id/branded.test.ts:8-10`. Likewise, `z.custom<ID>()` at
`branded.ts:16,36` contributes the output brand while the preceding string schema
does the runtime work. There is audit-document drift: `MODULE-AUDIT.md:26-27`
reports 46 and 119 LOC rather than the current 45 and 118, and
`MODULE-AUDIT.md:41-42` says no test was auto-matched even though
`packages/ax-code/test/id/branded.test.ts:3-35` directly imports and exercises the
unit. These are evidence-inventory defects, not product dead code.

## Step 7 Test coverage and regression needs

The focused command
`AX_TEST_FILES=test/id/branded.test.ts pnpm exec vitest run` passed all four tests.
Those tests cover an unchecked brand cast (`branded.test.ts:8-11`), ascending
generation plus a supplied value (`:13-17`), prefix-schema success/failure
(`:19-23`), and arbitrary branded strings (`:26-36`). They do not call
`Identifier.create`, `Identifier.descending`, or `Identifier.timestamp`, and do not
exercise clock rollback, the 12-bit counter boundary, the 36-bit epoch wrap, the
required underscore separator, invalid timestamp input, suffix alphabet/length, or
ordering across prefixes. The High wrap defect needs a deterministic regression at
`2 ** 36 - 1` versus `2 ** 36`; rollback and counter-overflow cases should accompany
it. A schema test should assert `ses_...` is accepted while `sesame` is rejected.

## Step 8 Finding severity and fix plan

The existing ledger is empty: `MODULE-AUDIT.md:56-60` records no accepted item, and
there are no files under this unit's `findings/` path. This pass identifies three
actionable findings. (1) **HIGH / correctness:** six-byte packing truncates the Unix
timestamp to 36 bits (`id.ts:92-101`), with the next normal-path wrap on
2026-08-14; it can misorder messages/parts and makes a fresh truncation file compare
older than the seven-day cutoff at `packages/ax-code/src/tool/truncate.ts:80-87`.
Core runtime/session ownership should contain cleanup by using filesystem mtime and
replace raw ID ordering with explicit time/position where available, then introduce
a versioned or widened durable encoding with legacy-read compatibility before the
affected release.

(2) **MEDIUM / correctness:** clock rollback and counter spill break monotonicity
(`id.ts:83-101`); the smallest fix is to port the clamp and bounded-counter behavior
already present at `packages/util/src/identifier.ts:42-54`, with deterministic
tests. (3) **LOW / correctness:** schemas and supplied-ID validation omit the
separator (`id.ts:36-38,54-63`); require `${token}_` while retaining the documented
unchecked `make` escape hatch. Finding 1 meets High, not Critical, because it is a
major common-path ordering/data-retention defect but the reviewed paths do not prove
broad unrecoverable data loss. Therefore no Critical second-pass `reverify.md` is
required from the empty existing ledger.

## Step 9 Verification and exit decision

Two repository checks passed on this source state: the four-test focused Vitest run
described in Step 7 and `pnpm --dir packages/ax-code run typecheck`. Read-only probes
also reproduced malformed-prefix acceptance, clock rollback, counter-prefix reuse,
the epoch-boundary ordering reversal, and immediate post-wrap cleanup eligibility.
The source was reviewed at baseline `5fefa00cdc847667d3ba3d38509a751498ee4180`,
which is now recorded at `MODULE-AUDIT.md:14`. The protocol is complete, but the unit
should not be marked signed off while the High finding in Step 8 remains open.
Independent verification remains assigned to ax-code-glm as stated at
`MODULE-AUDIT.md:12-13`; after remediation, it should rerun the focused ID tests,
the core typecheck, and targeted session/truncation regressions covering
`message-v2-impl.ts:980-1023` and `truncate.ts:80-87`.
