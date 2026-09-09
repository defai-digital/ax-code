# Windows: Chinese text and borders become mojibake after restarting the TUI

## Summary

AX Code 7.14.11 on Windows can render UTF-8 Chinese text and box-drawing borders as unrelated Chinese characters when the shared console output code page is GBK (936). The user observed this after Ctrl+C followed by another `ax-code` launch. The startup guard could report success without correcting that console.

The fix checks and repairs both actual console code pages at bootstrap and immediately before TUI rendering. It is included on `local/v7.14.11-fixes-performance-20260909`, together with the earlier large-session RPC fix and snapshot enumeration optimization.

## Environment and evidence

- Windows PowerShell, native Windows console/ConPTY, installed AX Code 7.14.11, Node 26.8.1 with `--experimental-ffi`.
- Observed failing state: `GetConsoleCP() = 65001`, `GetConsoleOutputCP() = 936`.
- Writing raw UTF-8 `中文边框 ╭─│╯` in that state produced `涓枃杈规 鈺攢鈹傗暞`.
- The old `execFileSync(chcp, ["65001"], { stdio: "ignore", windowsHide: true })` returned successfully, but native getters still reported input 65001 and output 936.

Two ordinary Ctrl+C/restart cycles did not spontaneously reproduce the problem in the independent test terminal. Controlled output-code-page drift did reproduce the same symptom. The process responsible for the initial change in the user's terminal has not been identified; this report does not claim that every Ctrl+C changes the code page.

## Cause

The input and output code pages are independent properties of the shared Windows console. The installed command shim checked the input code page and could skip `chcp` while output remained GBK. The JavaScript bootstrap had two additional weaknesses:

1. `AX_CODE_UTF8_CONSOLE_DONE=1` bypassed initialization without checking the actual console. An inherited environment marker cannot establish the current state of a shared console.
2. A hidden child with redirected output could successfully execute `chcp` without configuring the parent's attached console, as verified with native getters.

The native renderer emits UTF-8 bytes. Decoding those bytes using output code page 936 explains the corrupted Chinese and borders.

## Reproduction

Use an isolated test terminal, recording its initial input and output code pages for restoration. With Node's FFI enabled, load these `kernel32.dll` functions:

```js
const { functions: consoleApi } = require("node:ffi").dlopen("kernel32.dll", {
  GetConsoleCP: { arguments: [], return: "u32" },
  GetConsoleOutputCP: { arguments: [], return: "u32" },
  SetConsoleCP: { arguments: ["u32"], return: "i32" },
  SetConsoleOutputCP: { arguments: ["u32"], return: "i32" },
})
```

1. Set input to 65001 and output to 936 with the native setters.
2. Run the old hidden `chcp` invocation above and read both native getters. Output remains 936 in the reproduced case despite successful child exit.
3. Write the example text using `fs.writeSync(1, Buffer.from("中文边框 ╭─│╯\n"))`; observe mojibake.
4. Invoke the fixed `ensureWindowsUtf8Console` in the attached terminal, including with a stale `AX_CODE_UTF8_CONSOLE_DONE=1` marker. Both getters must return 65001 and the same raw bytes must render correctly.
5. Set output back to 936 and repeat. Also test the explicit `native: null` dependency to exercise the attached-child fallback. Restore the original code pages in `finally`.

For the installed CLI test, set the stale marker in an isolated PowerShell session, inject the same code-page mismatch, launch `ax-code`, wait for the home screen, and exit with Ctrl+C. Repeat in the same terminal. Both launches must render Chinese correctly, and both native getters must return 65001 after each exit.

## Implementation

- `src/cli/bootstrap/windows-console.ts`: lazily load and cache `kernel32.dll` functions through `node:ffi`; independently check and set the input and output code pages; read them back before reporting native success. Already-correct code pages do not cause redundant writes. Ignore the environment marker as a readiness shortcut.
- For runtimes without `node:ffi`, run the TTY-only `chcp` fallback without hiding/detaching its console. Native and fallback paths were tested separately on Windows.
- `src/cli/cmd/tui/renderer.ts`: repeat the check just before rendering to cover drift during backend startup.
- Non-Windows and redirected output remain no-ops; failure to configure a console does not crash startup. This performs startup checks, not periodic polling.

## Validation — 2026-09-09

- Four focused suites passed: **50 tests**, covering Windows console initialization, terminal cleanup, renderer behavior, and keyboard protocol behavior. Console cases cover output-only drift, stale markers, repeated initialization, setter failures/no-effect writes, and absent consoles.
- TypeScript `tsgo --noEmit` passed; Prettier formatted the changed source and tests.
- Actual Windows native validation passed in all three cases: native repair, repeated repair after renewed drift, and attached `chcp` fallback. Each ended with input/output 65001 and readable raw UTF-8 Chinese/borders.
- The installed CLI completed two real launches and Ctrl+C exits in the same terminal, with output reset to 936 before **each** launch and a stale marker present. Chinese text rendered correctly on both home screens; both exit probes reported input/output 65001.
- Installed bundle syntax and `--version` passed (7.14.11). The install replaced only the console bootstrap module and added the pre-render check. The earlier process-wire/session fix and snapshot optimization were preserved byte-for-byte by the scoped bundle transformation.
- Installed bundle SHA-256: `395c29edb6269f480ac891162b6e53b34ddb228918cbee6762f1da112b656271`. A timestamped `before-console-fix` backup was created before replacement.

Focused source test command, from `packages/ax-code` with the bundled Node runtime:

```powershell
$env:AX_TEST_FILES='test/cli/bootstrap/windows-console.test.ts,test/cli/tui/terminal-cleanup.test.ts,test/cli/tui/renderer.test.ts,test/cli/tui/renderer-keyboard-protocol.test.ts'
node --experimental-ffi --disable-warning=ExperimentalWarning ../../node_modules/vitest/vitest.mjs run --retry=0
```

The first sandboxed renderer test run could not create the native-library cache under the user profile; rerunning with that filesystem access passed. The type checker similarly required access to dependency symlinks. These were environment access failures, not suppressed test failures. No new full-suite or end-to-end performance benchmark is claimed for this console-only change.
