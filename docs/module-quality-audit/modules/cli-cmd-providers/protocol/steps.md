# Review protocol: cli-cmd-providers

## Step 1 Boundary and entry points

The audited `cli-cmd-providers` surface starts at `packages/ax-code/src/cli/cmd/providers.ts:1`, which re-exports the implementation rather than defining behavior itself. I followed that edge into `packages/ax-code/src/cli/cmd/providers-impl.ts:227-239`, where the `providers`/`auth` command and its four subcommands are assembled. The command becomes reachable through the import at `packages/ax-code/src/cli/boot.ts:36` and registration at `packages/ax-code/src/cli/boot.ts:79`. The wrapper in `packages/ax-code/src/cli/cmd/cmd.ts:5-7` is type-preserving and adds no runtime policy.

## Step 2 Credential and network trust boundaries

Secrets enter through masked prompts at `packages/ax-code/src/cli/cmd/providers-impl.ts:526-531`, `:569-582`, and `:728-736`; none of those paths print the supplied value. Persistence is delegated to `Auth.set`, whose implementation normalizes provider IDs, encrypts sensitive fields, locks concurrent writers, and writes with mode `0600` at `packages/ax-code/src/auth/index.ts:411-426`. User-supplied well-known URLs are restricted to HTTP(S) at `packages/ax-code/src/cli/cmd/providers-impl.ts:20-27` and pass through both the public-address assertion and DNS-pinned fetch at `:539-545`. The underlying redirect and private-address checks are enforced at `packages/ax-code/src/util/ssrf.ts:319-350` and `:465-493`.

## Step 3 Command correctness and failure behavior

The direct-ID path warns before saving an unknown provider and permits cancellation at `packages/ax-code/src/cli/cmd/providers-impl.ts:502-533`. The remote path trims trailing slashes, applies a ten-second timeout, checks HTTP status, rejects invalid JSON, validates the environment-variable name, trims the token, and returns after storage at `:539-585`. Provider filtering honors both allow and deny configuration at `:587-602`; explicit selection rejects unknown IDs/names at `:641-651`; logout avoids interactive prompts when an argument is supplied and refuses a selector on non-TTY input at `:758-795`. One non-blocking hardening gap remains: `wellknown.auth.env` at `:564` assumes `auth` is an object, so JSON such as `{}` reaches the top-level error path instead of the intended friendly validation message.

## Step 4 Performance and resource use

Heavy provider, prompt, and utility dependencies are loaded only inside handlers, for example `packages/ax-code/src/cli/cmd/providers-impl.ts:319-328` and `:493-498`, keeping CLI startup work out of the barrel. The network operation is bounded with `AbortSignal.timeout(10_000)` at `:545`, and provider options are built with linear filtering/sorting at `:593-639`. There is a small avoidable duplicate plugin scan: `Plugin.list()` is awaited for picker construction at `:610-616` and again at `:668-674`, even though the nearby comment says the list is cached for the flow. This is not correctness- or release-critical, but the first result could be reused.

## Step 5 Design and ownership

Responsibilities are mostly separated cleanly: command declaration and interaction stay in `packages/ax-code/src/cli/cmd/providers-impl.ts:227-239`, shared default provider policy comes from `packages/ax-code/src/provider/default-setup-providers.ts:1-9`, credential durability belongs to `packages/ax-code/src/auth/index.ts:227-253`, and URL safety belongs to `packages/ax-code/src/util/ssrf.ts:8-27`. `setProviderAuth` and `removeProviderAuth` at `packages/ax-code/src/cli/cmd/providers-impl.ts:29-39` are thin orchestration helpers. Their extra `Provider.invalidate()` is redundant with the global invalidation performed by `Auth.set/remove` at `packages/ax-code/src/auth/index.ts:426-442`, but the swallowed best-effort refresh does not compromise the committed credential.

## Step 6 Maintainability and code hygiene

The implementation contains no TODO or FIXME markers, and cancellation is handled consistently through `UI.CancelledError`, including `packages/ax-code/src/cli/cmd/providers-impl.ts:63-64`, `:84-93`, and `:664-665`. The invalid-URL catch at `:20-26` intentionally implements a boolean parser, while invalid remote JSON receives an explicit user-facing error at `:556-563`. The broad `any` types on AX Engine status at `:241` and well-known JSON at `:556` weaken structural checking; a schema would also close the missing-`auth` case described in Step 3. The empty command handler at `:238` is appropriate because yargs demands a subcommand at `:231-237`.

## Step 7 Focused test assessment

`packages/ax-code/test/cli/providers.test.ts:32-73` covers the default set and direct API-key login, `:93-193` exercises list labels and interactive/non-interactive logout, and `:201-365` checks manual well-known tokens, refusal to execute remote commands, case-insensitive schemes, and malformed environment names. Plugin filtering, deduplication, enable/disable policy, naming, and empty inputs are covered in `packages/ax-code/test/cli/plugin-auth-picker.test.ts:18-119`. Gaps remain for OAuth/API plugin callback branches (`packages/ax-code/src/cli/cmd/providers-impl.ts:98-195`), AX Engine action handlers (`:318-420`), and a well-known response with no `auth` object.

## Step 8 Finding review and severity decision

The existing register states `_none accepted_` at `docs/module-quality-audit/modules/cli-cmd-providers/MODULE-AUDIT.md:60-64`, and there are no files in this unit's `findings/` directory. Independent inspection found no credential disclosure, arbitrary remote-command execution, SSRF bypass, or destructive credential mix-up in the reviewed paths. The malformed well-known shape and repeated plugin scan recorded above are bounded robustness/efficiency observations, not Critical issues. Therefore this primary review does not create `protocol/reverify.md`; the Critical-only condition is not met.

## Step 9 Verification and exit decision

The exact focused run `AX_TEST_FILES=test/cli/providers.test.ts,test/cli/plugin-auth-picker.test.ts pnpm --dir packages/ax-code exec vitest run` passed 2 files and 22 tests. `pnpm --dir packages/ax-code run typecheck` also completed successfully. These commands exercise the exports imported at `packages/ax-code/test/cli/providers.test.ts:6-12` and `packages/ax-code/test/cli/plugin-auth-picker.test.ts:1-3`. On that evidence, `cli-cmd-providers` passes this nine-step review with the two non-blocking follow-up opportunities documented in Steps 3, 4, 6, and 7.
