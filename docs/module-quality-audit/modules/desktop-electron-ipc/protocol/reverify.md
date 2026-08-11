# Independent Critical Re-verification: desktop-electron-ipc

- Finding: `AUDIT-desktop-electron-ipc-001`
- Verifier: `codex-sol`
- Date: `2026-08-11`
- Verdict: `verified-fixed`

I independently traced renderer invocation from `desktop/packages/electron/src/preload.js:48-55` into `isAllowedDesktopInvokeCommand` and confirmed that `desktop/packages/electron/src/preload-ipc-policy.js:6-64` uses `Set.has` after a string-type check. There is no namespace regex, prefix acceptance, prototype lookup, or fallback path, so adding a new `handleCommand` in `desktop/packages/electron/src/main.js:609-617` does not expose it to renderer JavaScript without a separate reviewed preload edit.

I also checked the second gate: `handleCommand` derives the sender URL and rejects non-local origins unless a handler is explicitly designated remote-safe (`desktop/packages/electron/src/main.js:601-617`). The trusted main window prevents navigation outside the active loopback/dev origin (`main.js:454-473`), and embedded webviews have their preload removed, Node disabled, sandbox enabled, and a separate partition enforced (`desktop/packages/electron/src/webview-policy.js:30-50`).

Bypass regressions in `desktop/packages/electron/src/preload-ipc-policy.test.mjs:7-24` reject unrelated channels, `__proto__`, non-strings, and plausible newly named privileged commands. I ran the full Electron suite (`pnpm --dir desktop/packages/electron run test`: 32 files, 162 tests passed), a focused seven-file security set (41 tests passed), and the Electron runtime type/syntax check (67 files passed); the Critical capability-boundary fix remains effective.
