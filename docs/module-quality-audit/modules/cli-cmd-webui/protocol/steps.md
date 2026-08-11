# Review Protocol — cli-cmd-webui

Unit: `cli-cmd-webui`  
Reviewer: `codex-sol` (`gpt-5.6-sol-xhigh`)  
Independent verifier: `ax-code-glm`

## Step 1 Map the command surface

The unit is the single command adapter `packages/ax-code/src/cli/cmd/webui.ts`. It exports `WebUiCommand` at line 7, registers the shell syntax `webui [action]` at line 8, and exposes the `start`, `status`, `stop`, and `logs` actions through the positional declaration at lines 12-16. The command is imported and placed in the root command array at `packages/ax-code/src/cli/boot.ts:47` and `:83`, so it is reachable from the shipped `ax-code` CLI. Its only runtime dependency is the Desktop bridge imported at `webui.ts:2`; the local `cmd` helper at `packages/ax-code/src/cli/cmd/cmd.ts:5-7` is a typing identity function and adds no runtime behavior.

## Step 2 Model trust and failure boundaries

The positional action and the `--port`, `--ui-password`, and `--open` values originate at the shell boundary (`packages/ax-code/src/cli/cmd/webui.ts:12-29`). The root parser is strict at `packages/ax-code/src/cli/boot.ts:218-231`, and the action choices reject values outside the four declared literals before the handler. The password is deliberately forwarded to a child process by `launchWebUi` (`packages/ax-code/src/desktop/webui.ts:212-216`), so it remains command-line material visible under the local process-inspection threat model; the adapter does not log it. Spawn, nonzero exit, and invalid JSON failures are converted to thrown errors in `desktop/webui.ts:155-187`, while `boot.ts:258-268` catches command failures and sets a nonzero process exit code.

## Step 3 Trace correctness and edge paths

The handler defaults a missing action to `start` at `packages/ax-code/src/cli/cmd/webui.ts:31`. Management actions branch at lines 32-35, await `runWebUiDesktopCommand`, and return without printing a duplicate result; `start` converts only correctly typed parser values, maps dashed `--ui-password` to `args.uiPassword`, treats only explicit `--no-open` as false, awaits the launch, and prints its message at lines 37-42. The delegated launcher reuses an existing instance or starts one and validates the reported port (`packages/ax-code/src/desktop/webui.ts:202-240`). A small validation weakness remains: the CLI accepts fractional, zero, or negative numeric ports at `webui.ts:17-20`; the bridge truncates positive fractions and silently ignores nonpositive values at `desktop/webui.ts:212-218` instead of rejecting an invalid explicit request.

## Step 4 Evaluate performance and lifecycle cost

There is no loop, cache, listener, or retained state in `packages/ax-code/src/cli/cmd/webui.ts:30-43`; one handler invocation performs exactly one awaited bridge operation. For `start`, the bridge spawns a status process and only spawns a serve process when no running port exists (`packages/ax-code/src/desktop/webui.ts:207-220`). For management actions it spawns one inherited-stdio process and resolves or rejects on close (`desktop/webui.ts:244-260`). The adapter adds only constant-time type guards and one console write, so no module-local performance finding is supported. Child lifetime, output bounds, and browser-launch cost belong to the Desktop bridge rather than this command wrapper.

## Step 5 Assess design and ownership

The 44-line adapter keeps CLI vocabulary and yargs concerns local while delegating executable discovery, process IO, port reuse, and browser opening to `packages/ax-code/src/desktop/webui.ts:113-261`. That split is cohesive: `WebUiCommand` owns parsing and user-facing dispatch, and the Desktop bridge owns runtime mechanics. The `WebUiAction` alias at `packages/ax-code/src/cli/cmd/webui.ts:5` duplicates the choices at line 14 and requires the cast at line 31; deriving the type from a shared constant would remove a minor drift opportunity, but the lists agree in the reviewed revision. No circular dependency or cross-package layering violation is present.

## Step 6 Check reachability and hygiene

`WebUiCommand` is live because the boot composition imports and registers it (`packages/ax-code/src/cli/boot.ts:47,83`). Both imported bridge functions are reached by distinct handler branches at `packages/ax-code/src/cli/cmd/webui.ts:32-41`. The candidate contains no catch block, suppression directive, TODO/FIXME/HACK marker, commented-out implementation, timer, or disposal obligation. The explicit `return` after management dispatch at line 34 is necessary to prevent falling through to `launchWebUi`; the console output at line 42 is the sole output owned by the wrapper.

## Step 7 Map tests to risks

`packages/ax-code/test/desktop/webui.test.ts:12-76` covers packaged-mac discovery, PATH precedence, and missing/legacy Desktop diagnostics, but it imports only `resolveDesktopInvocation` and `__internal` at line 3. `packages/ax-code/test/cli/boot.test.ts:17-214` exercises boot environment and parser-adjacent behavior but does not assert `WebUiCommand` dispatch. Consequently there is no direct regression for the default action, all three management actions, `--no-open`, port/password forwarding, invalid action rejection, or error propagation from either bridge function. The bridge coverage is useful but does not pin this adapter's argument mapping.

## Step 8 Define the finding disposition and fix plan

The current register contains no accepted issue at `docs/module-quality-audit/modules/cli-cmd-webui/MODULE-AUDIT.md:60-64`, and no `findings/` directory exists for this unit. This pass accepts no Critical, High, or release-blocking defect. The proportionate follow-up is a focused command test using mocked bridge exports to assert each dispatch branch and option mapping, plus a parser check requiring an integer port in the range 1-65535 before launch. Those are bounded quality improvements; they do not justify source changes during this evidence-only protocol run. With no Critical record, `protocol/reverify.md` is not created.

## Step 9 Verify exit criteria

The focused command `AX_TEST_FILES=test/desktop/webui.test.ts pnpm --dir packages/ax-code exec vitest run` passed one file and all four tests. `pnpm --dir packages/ax-code run typecheck` also completed successfully, covering the yargs handler types and bridge call signatures used at `packages/ax-code/src/cli/cmd/webui.ts:30-41`. I independently re-read the candidate, its boot registration, the delegated bridge, the closest tests, and the audit register after the checks. The review evidence is complete for primary lane `codex-sol`; independent non-Critical sign-off remains assigned to `ax-code-glm` by `MODULE-AUDIT.md:12-16`.
