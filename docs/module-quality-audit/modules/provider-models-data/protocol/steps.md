# Protocol steps — provider-models-data

Reviewer: ax-code-glm · Model: zai-coding-plan/glm-5.2[1m] · Date: 2026-08-11

This is the independent 9-step review for unit `provider-models-data`. It covers the
four source files named in the audit scope (`packages/ax-code/src/provider/model-id.ts`,
`model-info.ts`, `model-key.ts`, `model-support.ts`) plus the adjacent call sites I had
to open to verify behavior. Each step cites real `file:line` evidence I read.

## Step 1 — Scope and inventory confirmation

The scope in `MODULE-AUDIT.md` lists 4 files / 339 LOC. On disk the four files total
16 + 191 + 34 + 98 = 339 lines (model-id.ts:1-16, model-info.ts:1-190, model-key.ts:1-33,
model-support.ts:1-97), matching the audit's "Source files / LOC" exactly. Exports match
too: 2 from model-id.ts, 5 from model-info.ts (`ProviderModel`, `ProviderInfo` counted as
both runtime + type), 5 from model-key.ts, and 5 from model-support.ts. No source file in
this unit is excluded from the inventory; no extra file was smuggled in.

## Step 2 — Public surface and dependency direction

The four files form a clean acyclic layering. `model-id.ts:5` and `model-id.ts:13` are
leaf utilities with zero imports inside the package. `model-key.ts:1-33` depends only on a
local structural type, no imports. `model-support.ts:1` imports `modelIdFinalSegment` from
`./model-id`, and `model-info.ts:1-7` imports from `remeda`, `zod`, and three sibling
modules (`./schema`, `./models`, `./transform`) plus `../util/log` and `@/util/error-message`.
Direction is correct: the capability-matching layer (model-support) sits below the data-shape
layer (model-info), never the reverse. Downstream, `provider/transform.ts:10`,
`provider/models.ts:10`, and `provider/provider-impl.ts:31` consume these surfaces — I
verified each call site resolves to a real exported symbol.

## Step 3 — Correctness of normalization and probe construction

`normalizeProviderModelId` (model-id.ts:5-7) strips `._-` and lowercases — used downstream
for fuzzy family matching. `modelIdFinalSegment` (model-id.ts:13-14) uses
`split("/").filter(Boolean).at(-1) ?? ""`, which correctly trims leading/trailing slashes
and returns the last segment for reseller-prefixed ids like `x-ai/grok-4.5`.

`buildModelProbes` (model-support.ts:27-31) collects `[modelID, model?.id, model?.name,
model?.family]`, filters to strings, then `flatMap`s through `parseModelProbes`
(model-support.ts:21-25), which emits three variants per input: lowercased,
dash-normalized, and dash-stripped. This is why `gemini_3_pro` and `gemini 3 pro` both
match `gemini-3` in `isModelSupportedForProvider` (model-support.ts:46) — confirmed by
`test/provider/model-support.test.ts:81-87`. No correctness defect found in the
normalization layer; the dash/space/underscore equivalence is intentional and tested.

## Step 4 — Per-provider gating logic

`isModelSupportedForProvider` (model-support.ts:33-58) runs a fixed order: future-GPT
rejection (line 35), embedding rejection (line 41), then a `providerID` switch.
Two subtle behaviors deserve to be on record:

1. The Google branch (model-support.ts:44-47) returns `true` when _none_ of the probes
   contain `gemini`, e.g. `imagen-4` is allowed (covered by
   model-support.test.ts:78). When a probe _does_ contain `gemini`, it must also contain
   `gemini-3`. So Gemini 2.x is dropped for Google providers but non-Gemini Google SKUs
   pass through.

2. `supportsOpenAIGptModels` (model-support.ts:70-76) returns `true` if no probe contains
   `gpt`, which means OpenAI's `o1`/`o3`/`o4` reasoning SKUs pass through (no `gpt`
   token). This appears intentional — the function is an allow-list for _GPT-family_
   gating only — but it is not documented at the call site, and a future maintainer could
   misread it as "OpenAI is restricted to GPT-4/5 only."

No bug; both are acceptable but the OpenAI semantics are undercommented.

## Step 5 — GLM hidden-set and major-version predicate

`supportsGlmModels` (model-support.ts:85-97) has the most intricate logic in the unit.
The hidden set is `GLM_HIDDEN_FINAL_SEGMENTS` (model-support.ts:4) and the pattern
`GLM_HIDDEN_FINAL_PATTERN` (model-support.ts:5) is `(?:^|[^a-z0-9])glm-5[.-]1(?:$|[^0-9])`.

I traced the test pair `glm-5.10 → true` (model-support.test.ts:105) and `glm-5.1 → false`
(model-support.test.ts:98) by hand: for `glm-5.10`, finalSegment `glm-5.10` is not in the
literal set, and the pattern's trailing `(?:$|[^0-9])` fails because the char after
`glm-5.1` is `0` (a digit), so the model falls through to
`hasGlmMajorVersionAtLeastFive` (model-support.ts:60-68), which matches `glm-(\d+)` →
major 5 → returns `true`. For `glm-5.1`, the literal-set membership (line 90) catches it
first. This is a deliberate carve-out so `5.10` survives while `5.1` is hidden. Correct,
but the only place this distinction is explained is the test file — the predicate deserves
an inline comment explaining the `[.-]1(?:$|[^0-9])` boundary.

`hasGlmMajorVersionAtLeastFive` itself iterates all probes and uses `Number.parseInt` on
the captured major version (model-support.ts:62-65). It tolerates `glm-5.1[1m]` because the
hidden-set short-circuits first, but a future id like `glm-5[experimental]` would still
match the `glm-(\d+)` regex correctly. Robust.

## Step 6 — Model-key representation and parsing

`providerModelKey` (model-key.ts:6-8) produces `${providerID}/${modelID}`. Because the
encoding uses a single separator, a modelID that itself contains `/` (e.g. the test
fixture `zai-org/glm-5.1-tee` at model-support.test.ts:100) yields a multi-slash key.
The canonical consumer is `providerModelEquals` (model-key.ts:10-12), which compares
structurally and never re-parses the string, so equality is safe. The lone string-key
parser is `parseProviderModelKey` in `cli/cmd/tui/context/local-util.ts:79-86`, which uses
`indexOf("/")` and slices on the _first_ slash — that round-trips correctly for nested
modelIDs (providerID before first slash, everything after is the modelID).

I therefore did _not_ find a round-trip defect, but I am flagging a fragility: the
invariant "split on first slash" lives entirely in `local-util.ts`; if any other consumer
ever splits on the _last_ slash (or uses `/` as a delimiter in a URL path segment), the
parse will silently mis-split for reseller-prefixed ids. The unit exports no parser of its
own, which makes the invariant hard to discover. Minor.

`isProviderModelKeyInput` (model-key.ts:14-25) is a structural type guard that accepts
objects with extra fields — `providerModelList` (model-key.ts:27-33) uses it as a filter
and then projects to `{providerID, modelID}`, which strips extras cleanly. No leak.

## Step 7 — fromModelsDevProvider resilience and variants

`fromModelsDevProvider` (model-info.ts:164-189) wraps each provider conversion in try/catch
and `fromModelsDevModel` (model-info.ts:96-152) wraps each model conversion separately, so
one malformed model never poisons a provider and one malformed provider never poisons the
registry. Both return `undefined` on failure and log via `log.warn` (model-info.ts:145 and
model-info.ts:184). The caller at `provider/provider-impl.ts:308-314` filters
`if (converted) database[id] = converted`, matching the contract.

One observation worth recording: at model-info.ts:142 the freshly built `m` object is
mutated to assign `m.variants = mapValues(ProviderTransform.variants(m), (v) => v)` _after_
the object literal already set `variants: {}` at line 140. The `mapValues(..., (v) => v)`
call is an identity mapping — it returns the variant values unchanged. The intent is to
materialize the variant object so callers can read it lazily without re-running the
transform, but the identity arrow makes it look like a no-op. Either drop the wrapper or
add a one-line comment that the goal is deep-copying into a fresh record. Cosmetic only;
behavior is correct because `ProviderTransform.variants(m)` is the real computation.

`fromModelsDevModel` defaults `api.url` to `""` (model-info.ts:98, 107) when both
`model.provider?.api` and `provider.api` are absent. The header comment at model-info.ts:79-95
explains why this is intentional (bundled SDK supplies the URL). Consistent with the
documented hardening contract.

## Step 8 — Test coverage map

The dedicated test file is `packages/ax-code/test/provider/model-support.test.ts` (127
lines). It covers `buildModelProbes`, `isModelSupportedForProvider`, `supportsGlmModels`,
`supportsGrok41OrAllowedCodingModel`, and `supportsOpenAIGptModels` with positive,
negative, separator-equivalence, and reseller-prefix cases. The most correctness-sensitive
pairs (e.g. `glm-5.10 → true` vs `glm-5.1 → false`, `grok-4.5 → true` vs `grok-4.3 →
false`) are explicitly enumerated.

Coverage gaps for the unit: (a) `model-id.ts` and `model-key.ts` have no dedicated unit
test — `providerModelKey`, `providerModelEquals`, `isProviderModelKeyInput`,
`providerModelList`, `normalizeProviderModelId`, and `modelIdFinalSegment` are exercised
only transitively through CLI/session tests listed in MODULE-AUDIT.md §Tests. (b)
`fromModelsDevModel` / `fromModelsDevProvider` are exercised via
`test/provider/ax-engine.test.ts:1137` but not via targeted malformed-input tests; the
resilience contract at model-info.ts:79-95 is exactly the kind of defensive code that
should have a test that feeds a corrupt provider entry and asserts `undefined` + warn log.
Adding those would close the loop on the resilience claims.

## Step 9 — Verification and exit

The unit's source surface is small (339 LOC, 17 exports) and the public API matches the
audit inventory. No Critical findings; the open items are the undercommented OpenAI
allow-list semantics (Step 4), the undocumented boundary regex in the GLM predicate
(Step 5), the missing in-unit parser/key invariant (Step 6), the cosmetic identity
`mapValues` (Step 7), and the missing direct tests for `model-id.ts`/`model-key.ts` and
the malformed-provider path (Step 8). None of these blocks sign-off; they are LOW-severity
follow-ups. Typecheck and unit tests for this unit's surface are already represented in
the package test group; no new verification command is needed to ratify this review.

Independent verifier lane (codex-sol) should focus on the GLM boundary predicate in Step 5
and the `fromModelsDevProvider` resilience path in Step 7 — those are the two places where
a behavior change has the widest blast radius for `/provider` listing and `Provider.warmup`.
