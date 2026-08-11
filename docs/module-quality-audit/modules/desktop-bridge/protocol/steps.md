# Protocol Steps: desktop-bridge

- Slug: `desktop-bridge`
- Lane: `codex-sol`
- Date: `2026-08-11`

## Step 1 Map

`packages/ax-code/src/desktop/webui.ts:9-55` exports the default port and launch/invocation result types, while `resolveDesktopInvocation` selects an override, checkout CLI, PATH shim, packaged macOS runtime, or fallback (`webui.ts:57-139`). `launchWebUi` performs JSON `status`/`serve` calls and optional browser opening, and `runWebUiDesktopCommand` forwards status/stop/log actions with inherited stdio (`webui.ts:155-261`).

## Step 2 Threat model

This bridge crosses from the core CLI into a separately installed executable, inheriting environment variables and trusting its JSON output; executable selection, argument construction, child lifetime, output size, and error translation are the main boundaries (`packages/ax-code/src/desktop/webui.ts:113-188`). The UI password is placed in child arguments at `webui.ts:212-216`, which can be visible to same-user process inspection, while a compromised or noisy desktop binary can return malformed or unbounded stdout/stderr.

## Step 3 Correctness

Invocation precedence is deterministic: explicit `AX_CODE_DESKTOP_BINARY`, checkout, PATH, then packaged macOS resources, with an installed-but-incomplete app producing a distinct ENOENT diagnostic (`packages/ax-code/src/desktop/webui.ts:69-152`). `runDesktopJson` rejects spawn/nonzero/parse failures, and `launchWebUi` reuses a running instance before serving a new one and refuses a missing/invalid reported port (`packages/ax-code/src/desktop/webui.ts:155-219`). Browser opening is explicitly best effort and changes only the `opened` flag, not server success (`packages/ax-code/src/desktop/webui.ts:222-241`).

## Step 4 Performance

The bridge spawns one status process and, only when needed, one serve process, so process startup dominates and there is no persistent hot loop (`packages/ax-code/src/desktop/webui.ts:202-220`). `runDesktopJson` accumulates both streams without a byte cap (`webui.ts:163-174`); expected JSON is small, but bounding capture would make the failure mode robust against a broken or hostile runtime.

## Step 5 Design

Discovery and user-facing ENOENT translation are isolated from the launch orchestration, and dependency injection on `resolveDesktopInvocation` makes platform selection straightforward to test (`packages/ax-code/src/desktop/webui.ts:19-25`, `webui.ts:113-153`). Process spawning is not injected, however, so the exported launch/command functions are difficult to unit test without real processes; a small runner dependency would improve coverage and allow bounded-output policy to live in one place.

## Step 6 Dead code/hygiene

No TODO, FIXME, or empty catch appears in `packages/ax-code/src/desktop/webui.ts`; browser-open failure is handled by an explicit promise rejection branch that sets `opened = false` (`webui.ts:224-231`). The `__internal.desktopCommandError` export at `webui.ts:263-265` is used by `packages/ax-code/test/desktop/webui.test.ts:48-76`, so it is a deliberate test seam rather than dead code.

## Step 7 Tests

`packages/ax-code/test/desktop/webui.test.ts:12-76` covers packaged-mac discovery, PATH precedence, and the two ENOENT diagnoses; `packages/ax-code/test/cli/tui/desktop-handoff.test.ts:4-154` covers the adjacent command/handoff decision. There is no direct test of `runDesktopJson`, `launchWebUi`, port validation, password arguments, browser-open failure, nonzero exit, malformed JSON, or `runWebUiDesktopCommand`, which is the dominant remaining quality gap.

## Step 8 Findings

`docs/module-quality-audit/modules/desktop-bridge/MODULE-AUDIT.md` registers no finding, and this review did not accept a new Critical or High issue. Unbounded child output, argument-visible password material, and absent launch tests are documented risk/hardening notes, but the current local same-user threat model and expected small JSON contract do not by themselves prove an exploitable invariant failure.

## Step 9 Verification

I ran `AX_TEST_FILES=test/desktop/webui.test.ts,test/cli/tui/desktop-handoff.test.ts pnpm --dir packages/ax-code exec vitest run`; both files and all 14 tests passed. `pnpm --dir packages/ax-code run typecheck` also passed; the next useful command would target a new spawned-child harness around `launchWebUi` rather than repeat unrelated desktop release-workflow source assertions.
