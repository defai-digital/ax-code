# Review protocol: cli-cmd-tui-boot

## Step 1 Entry points and review boundary

The reviewed boot surface starts at `packages/ax-code/src/cli/cmd/tui/app.tsx:87`, where `TuiInput` defines the URL, arguments, configuration, directory, transport, headers, and event source accepted by `tui()` at line 98. The two CLI entry paths are distinct: `packages/ax-code/src/cli/cmd/tui/attach.ts:12` validates and assembles a remote attach invocation, while `packages/ax-code/src/cli/cmd/tui/backend.ts:3` exposes the hidden stdio backend command. The dialog layer was followed from the lazy loaders at `packages/ax-code/src/cli/cmd/tui/app.tsx:269` through the provider, model, session, workspace, MCP, status, theme, agent, and effort components named in this unit.

## Step 2 Inputs, credentials, and trust boundaries

Attach rejects non-loopback HTTP targets before changing terminal state at `packages/ax-code/src/cli/cmd/tui/attach.ts:46`; password-derived headers are built at line 70 and passed to the SDK without being rendered or logged. Provider credentials are sent through the auth API at `packages/ax-code/src/cli/cmd/tui/component/dialog-provider.tsx:1072`, and AX Engine endpoint input is normalized before use at lines 269-280. The fatal screen constructs an issue URL containing a bounded stack excerpt at `packages/ax-code/src/cli/cmd/tui/app.tsx:1547-1569`, but only copies it on an explicit action at lines 1571-1580. I found no automatic credential disclosure or external navigation in these paths.

## Step 3 Boot, routing, and state correctness

The context tree is assembled in dependency order around `App` at `packages/ax-code/src/cli/cmd/tui/app.tsx:128-170`, with the top-level error boundary covering render failures. Session-route imports are deduplicated and reset after completion at lines 226-248, while import failure is logged, toasted once, and can return the route home at lines 251-267. Startup arguments distinguish direct session navigation from deferred fork behavior at lines 701-731 and 799-807; `--continue` also performs an unbounded fallback lookup when the bootstrap window is empty at lines 733-773. Session deletion uses a two-trigger confirmation and reports failure at `packages/ax-code/src/cli/cmd/tui/component/dialog-session-list.tsx:210-240`.

## Step 4 Async failure handling and cleanup

Terminal cleanup is guaranteed by `finally` in `packages/ax-code/src/cli/cmd/tui/attach.ts:87-91`, and `tui()` releases its Windows and resize guards both on normal exit and render setup failure at `packages/ax-code/src/cli/cmd/tui/app.tsx:115-119` and `175-179`. Runtime-setting writes use abort forwarding, a ten-second timeout, response-status validation, and listener/timer cleanup at `packages/ax-code/src/cli/cmd/tui/app.tsx:499-538`. Provider actions retain their in-flight promise and convert failures into logs plus user-visible errors at `packages/ax-code/src/cli/cmd/tui/component/dialog-provider.tsx:93-118`; auto OAuth also suppresses late UI advancement after cleanup while still refreshing stored server state at lines 931-966.

## Step 5 Responsiveness and bounded work

Large UI modules are loaded only when invoked by the dialog helpers at `packages/ax-code/src/cli/cmd/tui/app.tsx:269-396`, and the session view is deferred then preloaded through a cancellable startup task at lines 477-497. Diff computation trims shared prefixes and suffixes before allocation at `packages/ax-code/src/cli/cmd/tui/component/dialog-diff-viewer.tsx:26-41`; a one-million-cell ceiling switches to linear add/remove output at lines 43-54, preventing an unbounded matrix on the TUI thread. Session searching is debounced and fetches are abortable at `packages/ax-code/src/cli/cmd/tui/component/dialog-session-list.tsx:48-82`. No new performance blocker was identified.

## Step 6 Boundaries and data normalization

The largest component, `dialog-provider.tsx`, keeps transport/orchestration locally but delegates payload validation, provider grouping, model selectability, and AX Engine presets to `packages/ax-code/src/cli/cmd/tui/component/dialog-provider-options.ts:30-61` and `87-137`. That split provides testable pure seams, although the action dispatcher spanning `packages/ax-code/src/cli/cmd/tui/component/dialog-provider.tsx:398-900` remains a maintainability hotspot. Workspace and global session lists deliberately share the same implementation, documented at `packages/ax-code/src/cli/cmd/tui/component/dialog-session-list.tsx:32-37`, avoiding divergent delete/search behavior. Model options consistently apply the shared selectability rule at `packages/ax-code/src/cli/cmd/tui/component/dialog-model.tsx:71-113`.

## Step 7 Code hygiene and silent-error audit

The only registered empty catch is outside the candidate subset but inside the unit: `packages/ax-code/src/cli/cmd/tui/component/prompt/index.tsx:1590`. It wraps optional pasted-filepath interpretation and then falls through to plain-text paste at lines 1593-1602; the lack of a local rationale still justifies the existing Low deferred record. Other superficially quiet catches preserve explicit fallbacks: invalid local `chdir` passes a remote directory through at `packages/ax-code/src/cli/cmd/tui/attach.ts:60-68`, and failed session deletion becomes `false` followed by an error toast at `packages/ax-code/src/cli/cmd/tui/component/dialog-session-list.tsx:212-226`. No dead export or unexplained disabled branch warranted a new finding.

## Step 8 Tests and finding disposition

Direct tests exercise the most failure-prone pure logic. `packages/ax-code/test/cli/tui/k-diff-viewer-lcs-budget.test.ts:66-118` compares small outputs with the prior LCS behavior and checks both 20,000-line localized edits and the large fully-different fallback. `packages/ax-code/test/cli/tui/dialog-provider-options.test.ts:99-131` rejects malformed provider payloads, and lines 181-220 verify default-model selection and memory blocking. `packages/ax-code/test/cli/tui/dialog-model-options.test.ts:12-40` covers tool-call, unavailable, image-only, hidden, and memory-blocked models. The ledger at `docs/module-quality-audit/modules/cli-cmd-tui-boot/MODULE-AUDIT.md:108-120` contains one Low deferred item; `docs/module-quality-audit/modules/cli-cmd-tui-boot/findings/AUDIT-cli-cmd-tui-boot-empty-catch.md:15-27` matches the inspected site. There are no Critical items, so no secondary reverification artifact is required.

## Step 9 Verification and exit decision

`AX_TEST_FILES=test/cli/tui/dialog-provider-options.test.ts,test/cli/tui/dialog-model-options.test.ts,test/cli/tui/k-diff-viewer-lcs-budget.test.ts,test/cli/tui/s-dialog-session-list-rename-sdk-error.test.ts,test/cli/tui/run-mode-view-model.test.ts pnpm exec vitest run` completed with 5 files and 48 tests passing. `pnpm --dir packages/ax-code run typecheck` also completed successfully. These checks cover the bounded diff at `packages/ax-code/src/cli/cmd/tui/component/dialog-diff-viewer.tsx:14-104`, provider normalization at `packages/ax-code/src/cli/cmd/tui/component/dialog-provider-options.ts:41-61`, and session SDK error handling at `packages/ax-code/src/cli/cmd/tui/component/dialog-session-rename.tsx:31-41`. The cli-cmd-tui-boot review is complete with the existing Low deferred finding and no Critical gate.
