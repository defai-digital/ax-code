# Protocol review: cli-cmd-serve

Reviewer: codex-sol · Verifier: ax-code-glm · Date: 2026-08-11

## Step 1 Scope and Public Contract

The `cli-cmd-serve` unit is the lazy CLI facade at `packages/ax-code/src/cli/cmd/serve.ts:4-15`. Its sole export is `ServeCommand`, whose public yargs contract is the `serve` name, headless-server description, shared network flags, and an optional string-valued `ipc-socket` flag (`serve.ts:5-11`). The command is imported into the process registry at `packages/ax-code/src/cli/boot.ts:39` and registered in the command array at `boot.ts:84`; server lifecycle behavior belongs to the deferred runtime module, not this facade.

## Step 2 Inputs, Trust Boundaries, and Failure Paths

The facade accepts network arguments supplied by `withNetworkOptions` (`packages/ax-code/src/cli/network.ts:5-38`) and exposes the IPC filesystem path as an unrestricted string (`packages/ax-code/src/cli/cmd/serve.ts:8-11`). The delegate applies local-only hostname, mDNS, and CORS policy in `network.ts:71-84`, then the runtime resolves and removes a pre-existing socket path before listening (`packages/ax-code/src/cli/cmd/runtime/serve.ts:38-49`). The facade neither logs sensitive values nor catches import/handler errors: `serve.ts:13-14` lets both failures reject into the CLI's central fatal-error path at `boot.ts:258-268`.

## Step 3 Delegation Correctness

The duplicated facade and runtime metadata currently agree exactly: `serve.ts:5-11` matches `packages/ax-code/src/cli/cmd/runtime/serve.ts:24-30` for command, description, network builder, IPC type, and help text. At execution, `serve.ts:13-14` awaits the runtime module and returns `real.handler(args)`, preserving the handler's promise and error result rather than fire-and-forgetting it. The runtime then resolves policy before opening the HTTP listener (`runtime/serve.ts:31-35`) and only enables IPC when the parsed option is truthy (`runtime/serve.ts:37-50`). No correctness defect was found in the facade.

## Step 4 Startup and Runtime Cost

CLI boot eagerly imports this small facade (`packages/ax-code/src/cli/boot.ts:39`) but does not load the server implementation during registry construction. The costly imports of `Server`, IPC transport, project bootstrap, filesystem utilities, and signal handling live in `packages/ax-code/src/cli/cmd/runtime/serve.ts:1-10` and are reached only by the dynamic import at `packages/ax-code/src/cli/cmd/serve.ts:13`. This materially protects help and unrelated commands from server initialization cost. The facade itself contains no loop, allocation growth, polling, or synchronous filesystem operation.

## Step 5 Boundary and Maintainability Review

The facade/runtime split is a coherent ownership boundary: `serve.ts:7-11` supplies parse-time option metadata without importing the heavy module, while `runtime/serve.ts:31-62` owns network resolution, listeners, prewarming, shutdown, and the intentionally pending server lifetime. The tradeoff is duplicated command metadata across `serve.ts:5-11` and `runtime/serve.ts:24-30`; it is in sync today but can drift because no shared descriptor enforces parity. This is a non-blocking maintainability/test observation, not a present functional finding.

## Step 6 Hygiene and Reachability

The only exported symbol is reachable from `packages/ax-code/src/cli/boot.ts:39,84`, and every facade member is consumed by yargs or by the delegate call. `packages/ax-code/src/cli/cmd/serve.ts:1-15` has no TODO, empty catch, stale branch, global mutation, or cleanup obligation. Its `args: any` at `serve.ts:12` weakens compile-time coupling to the runtime handler, but the value is forwarded unchanged at `serve.ts:14` and the runtime command is typed through the `cmd` passthrough declared at `packages/ax-code/src/cli/cmd/cmd.ts:5-6`; no dead code was identified.

## Step 7 Test Evidence and Gaps

Adjacent network-policy coverage exercises explicit flag precedence, remote-host rejection, local CORS filtering, and middleware-attached raw argv in `packages/ax-code/test/cli/network.test.ts:22-116`. IPC coverage verifies request routing and socket-path canonicalization in `packages/ax-code/test/server/ipc-transport.test.ts:104-130`. The audit's listed tests at `docs/module-quality-audit/modules/cli-cmd-serve/MODULE-AUDIT.md:31-46` contain no serve-specific facade test, so lazy-import timing, argument forwarding, and metadata parity remain untested directly. The focused network and IPC files nevertheless passed 18/18 tests during this review.

## Step 8 Finding Disposition

The existing register explicitly records no accepted finding at `docs/module-quality-audit/modules/cli-cmd-serve/MODULE-AUDIT.md:60-64`, and the unit's `findings/` directory contains no finding file. Independent source review found no Critical, High, or behavior-breaking issue in the facade. The duplicated metadata and missing direct facade test from Steps 5 and 7 are coverage-hardening opportunities only. Because there is no Critical item to confirm, no `protocol/reverify.md` is required for ax-code-glm.

## Step 9 Verification and Exit

The protocol contract requiring nine completed steps, distinct lanes, and non-empty evidence paths is stated at `docs/module-quality-audit/STATUS.md:13-20`. Verification performed here was `pnpm --dir packages/ax-code run typecheck` (exit 0) plus `AX_TEST_FILES=test/cli/network.test.ts,test/server/ipc-transport.test.ts pnpm --dir packages/ax-code exec vitest run` (2 files, 18 tests, all passed; the Unix-socket suite required a non-sandboxed rerun). Only the three requested `cli-cmd-serve` protocol artifacts were written; production code and other audit units were not edited. The reviewer pass is complete and ready for ax-code-glm's independent lane check.
