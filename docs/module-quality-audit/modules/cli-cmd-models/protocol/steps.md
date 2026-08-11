# Review protocol — cli-cmd-models

Reviewer: `codex-sol` (`gpt-5.6-sol-xhigh`)  
Independent verifier: `ax-code-glm`

## Step 1 Scope and command registration

The `cli-cmd-models` unit is the single command module `packages/ax-code/src/cli/cmd/models.ts`. It exports `ModelsCommand` at `packages/ax-code/src/cli/cmd/models.ts:11`, declares the `models [provider]` surface at lines 12-13, and defines the positional provider plus `--verbose` and `--refresh` switches at lines 14-29. The production CLI imports this command at `packages/ax-code/src/cli/boot.ts:33` and includes it in the yargs command array at `packages/ax-code/src/cli/boot.ts:60-86`. This agrees with the resolved root and one-export inventory in `docs/module-quality-audit/modules/cli-cmd-models/MODULE-AUDIT.md:5-7,24-29`.

## Step 2 Trust boundary and metadata exposure

User-controlled input is limited to a provider string and two booleans (`packages/ax-code/src/cli/cmd/models.ts:16-28`); no shell command is assembled. Normal output contains only the provider/model key (`models.ts:48-50`), but `--verbose` serializes the complete model object without redaction (`models.ts:51-53`). That object explicitly permits arbitrary `options` and string `headers` (`packages/ax-code/src/provider/model-info.ts:48-57`), and configured model values are merged into those fields at `packages/ax-code/src/provider/provider-impl.ts:470-476`. This is a Medium local disclosure concern: configured authorization headers or secret-bearing options can be copied into terminals or CI logs. The verbose serializer should omit or redact sensitive header/option keys.

## Step 3 Provider discovery and selection correctness

The handler enters the current working directory through `Instance.provide` (`packages/ax-code/src/cli/cmd/models.ts:35-37`), whose implementation resolves the directory, boots or reuses its instance, and restores scoped context (`packages/ax-code/src/project/instance.ts:196-213`). It then awaits discovery before reading providers (`models.ts:38-41`). That sequencing matches the provider contract: `Provider.list()` intentionally returns current state immediately, while `Provider.ready()` awaits the background discovery promise for complete CLI/local model lists (`packages/ax-code/src/provider/provider-impl.ts:722-733`). Each provider's entries are filtered through `modelSelectableForProvider` and sorted by model ID before emission (`models.ts:43-55`); the filter rejects unavailable-memory, explicitly non-text, and disallowed non-tool-call models (`packages/ax-code/src/provider/model-selectability.ts:26-53`).

## Step 4 Output ordering and failure status

A provider argument is branded and looked up before printing; an absent key produces a diagnostic and stops that branch (`packages/ax-code/src/cli/cmd/models.ts:58-67`). Without a filter, provider IDs are deterministic: `ax-code*` IDs precede the remaining locale-sorted IDs (`models.ts:70-80`), and `providerModelKey` produces the stable `provider/model` form (`packages/ax-code/src/provider/model-key.ts:1-8`). The diagnostic is written to stderr by `UI.error` (`packages/ax-code/src/cli/ui.ts:26-33,72-77`), but the missing-provider branch never assigns `process.exitCode`. Unlike other CLI failure paths, it therefore completes successfully. This is a Medium automation-contract defect: `ax-code models does-not-exist` can be mistaken for a successful empty result and should set a non-zero exit status.

## Step 5 Latency, memory, and concurrency

The command buffers the provider map but streams each selected model directly to stdout (`packages/ax-code/src/cli/cmd/models.ts:43-55`), so it does not build a second output-sized string except for one verbose JSON object at a time. Sorting costs are bounded by one provider-key sort and one model-key sort per provider (`models.ts:45-47,70-80`). Discovery loaders run concurrently under `Promise.all`, with each loader capped at ten seconds (`packages/ax-code/src/provider/provider-impl.ts:633-653`); the command deliberately pays that completion latency via `Provider.ready()` so its one-shot listing is complete. No unbounded retry or serial network loop is introduced in this module.

## Step 6 Responsibility and dependency design

The command remains a thin CLI adapter: instance scoping belongs to `Instance`, provider initialization/listing belongs to `Provider`, eligibility belongs to `modelSelectableForProvider`, and key formatting belongs to `providerModelKey` (`packages/ax-code/src/cli/cmd/models.ts:2-8,35-50`). `ProviderID.make` is a branding constructor exposed from `packages/ax-code/src/provider/schema.ts:3-14`; runtime existence is correctly established by the subsequent provider-map lookup at `models.ts:59-64`. The local `printModels` closure captures one provider snapshot and only owns presentation (`models.ts:43-56`), which is appropriate for this small command. Redaction, however, should occur at this presentation boundary before verbose serialization rather than changing the provider-domain object.

## Step 7 Maintenance and code hygiene

The 84-line implementation has no catch block, suppression directive, TODO/FIXME marker, commented-out branch, or mutable module-level state; failures from instance/provider setup propagate to the CLI bootstrap. Both early returns are purposeful: one ends the missing-provider path and the other prevents falling through to print all providers after a filtered listing (`packages/ax-code/src/cli/cmd/models.ts:61-68`). The `--refresh` compatibility message is emitted to stderr and execution intentionally continues into the bundled listing (`models.ts:31-35`; `packages/ax-code/src/cli/ui.ts:26-33`). The names `aIsOpencode` and `bIsOpencode` at `models.ts:71-72` are stale terminology for an `ax-code` prefix, a minor readability issue with no behavioral effect.

## Step 8 Test evidence and findings reconciliation

The shared eligibility tests exercise non-tool-call rejection, CLI-provider allowance, unknown text capability, non-text rejection, and AX Engine catalog selection at `packages/ax-code/test/provider/model-selectability.test.ts:5-56`. Key formatting and validation are covered at `packages/ax-code/test/provider/model-key.test.ts:10-54`. There is no direct `ModelsCommand` test for discovery waiting, provider/model ordering, refresh output, verbose framing/redaction, or unknown-provider exit status; the broad test inventory in `docs/module-quality-audit/modules/cli-cmd-models/MODULE-AUDIT.md:31-46` does not identify such coverage. The audit register currently contains no accepted item (`MODULE-AUDIT.md:60-64`), and `findings/` contains no files. This evidence-bearing pass records the two Medium issues from Steps 2 and 4; no Critical item exists, so `protocol/reverify.md` is not created.

## Step 9 Verification and reviewer outcome

Focused verification ran `AX_TEST_FILES=test/provider/model-selectability.test.ts,test/provider/model-key.test.ts pnpm --dir packages/ax-code exec vitest run`; both files passed, with 14 tests total. `pnpm --dir packages/ax-code run typecheck` also passed. These checks exercise the exact filter invoked at `packages/ax-code/src/cli/cmd/models.ts:45-47` and the formatter invoked at `models.ts:48-50`, while the untested command-level branches remain explicitly documented in Step 8. The primary nine-step review is complete for `cli-cmd-models`; independent verifier lane `ax-code-glm` remains responsible for its separate sign-off.
