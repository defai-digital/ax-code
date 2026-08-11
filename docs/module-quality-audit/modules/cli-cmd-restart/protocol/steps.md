# Review Protocol — cli-cmd-restart

Reviewer: `codex-sol` (`gpt-5.6-sol-xhigh`)  
Independent verifier: `ax-code-glm`

## Step 1 Scope and entry point

The `cli-cmd-restart` unit is the compatibility entry point at `packages/ax-code/src/cli/cmd/restart.ts:1`, which re-exports `RestartCommand` from `./runtime/restart`. The implementation is therefore part of the behavioral review: `packages/ax-code/src/cli/cmd/runtime/restart.ts:11-34` defines the yargs descriptor and handler. The command is live, not orphaned: `packages/ax-code/src/cli/boot.ts:37` imports the shim and `packages/ax-code/src/cli/boot.ts:85` places it in the registered command array.

## Step 2 Input and trust boundaries

The only caller-controlled value used in I/O is `--port`. `packages/ax-code/src/cli/cmd/runtime/restart.ts:4-8` accepts only integer TCP ports from 1 through 65535, and the yargs builder repeats that validation before dispatch at `runtime/restart.ts:15-22`. The destination host is fixed to loopback and only the validated port is interpolated at `runtime/restart.ts:24-26`, preventing arbitrary-host requests through this command. No credentials, request body, file path, or shell command crosses this boundary.

## Step 3 Command correctness

The command name and default are coherent: `packages/ax-code/src/cli/cmd/runtime/restart.ts:12-18` declares `restart`, a numeric port, and `DEFAULT_SERVER_PORT`; the value resolves to 4096 at `packages/ax-code/src/constants/server.ts:1` through the re-export in `packages/ax-code/src/server/constants.ts:1`. The handler validates again at `runtime/restart.ts:23-25`, which is appropriate because handlers can be invoked directly in tests or code without yargs running the builder. It issues the expected `POST` at `runtime/restart.ts:25-26`.

## Step 4 Server and failure contracts

The client path matches the server route exactly: `packages/ax-code/src/server/routes/app.ts:58-63` registers `POST /instance/restart`, and `app.ts:75-80` reloads the current directory with `InstanceBootstrap` before returning JSON `true`. On the CLI side, only an HTTP success status prints confirmation (`packages/ax-code/src/cli/cmd/runtime/restart.ts:27-28`); rejected fetches and non-2xx responses share the actionable error message and exit status 1 at `runtime/restart.ts:26,29-31`. Collapsing the detailed cause is acceptable for this local control command, though it limits diagnostics.

## Step 5 Resource and performance behavior

The handler performs one bounded validation and one network request (`packages/ax-code/src/cli/cmd/runtime/restart.ts:24-26`), with no loops, retries, buffered response body, or persistent resources. Runtime cost is dominated by the server reload at `packages/ax-code/src/server/routes/app.ts:75-80`, not by this CLI adapter. There is no client timeout, so a loopback server that accepts the connection but never responds can leave the command pending; this is a Low robustness observation rather than a Critical issue for the present local-server contract.

## Step 6 Ownership and coupling

The one-line shim at `packages/ax-code/src/cli/cmd/restart.ts:1` preserves the established import path while runtime-specific behavior stays in `packages/ax-code/src/cli/cmd/runtime/restart.ts:1-34`. The implementation depends only on the shared command-typing identity helper (`packages/ax-code/src/cli/cmd/cmd.ts:1-6`) and the server port constant, while actual lifecycle ownership remains in `packages/ax-code/src/server/routes/app.ts:75-80`. This direction avoids pulling instance bootstrap logic into the CLI.

## Step 7 Hygiene and maintainability

The shim contains no duplicate implementation: `packages/ax-code/src/cli/cmd/restart.ts:1` is solely a named re-export. The runtime implementation has no unused branches or suppression comments, and its network rejection handler at `packages/ax-code/src/cli/cmd/runtime/restart.ts:26` intentionally converts failure to `null` that is consumed by the explicit error branch at lines 29-31; it is not a swallowed failure. The validation helper at lines 4-9 gives the range rule one source of truth for both builder and handler.

## Step 8 Coverage and record reconciliation

Focused tests cover the lower and upper valid boundaries plus a representative port at `packages/ax-code/test/cli/runtime-restart.test.ts:4-9`, and reject zero, negatives, overflow, fractions, non-finite numbers, strings, and `undefined` at `runtime-restart.test.ts:11-15`. They do not exercise the handler's success, non-2xx, network-rejection, console, or exit branches at `packages/ax-code/src/cli/cmd/runtime/restart.ts:23-32`; that is the principal non-Critical coverage gap. The static audit currently reports no export at `docs/module-quality-audit/modules/cli-cmd-restart/MODULE-AUDIT.md:24-29`, while the actual named re-export is visible at `packages/ax-code/src/cli/cmd/restart.ts:1`; this protocol records the corrected source evidence. No `findings/` files exist for the unit and no Critical evidence was found, so `reverify.md` is not required.

## Step 9 Verification outcome

The focused command `AX_TEST_FILES=test/cli/runtime-restart.test.ts pnpm exec vitest run` from `packages/ax-code` passed one file and two tests, directly exercising `packages/ax-code/test/cli/runtime-restart.test.ts:4-15`. `pnpm --dir packages/ax-code run typecheck` also passed, confirming the re-export at `packages/ax-code/src/cli/cmd/restart.ts:1`, command registration at `packages/ax-code/src/cli/boot.ts:85`, and runtime descriptor remain type-compatible. The primary review accepts no Critical issue; it records Low observations for the missing request timeout and handler-branch tests, pending independent verifier lane `ax-code-glm`.
