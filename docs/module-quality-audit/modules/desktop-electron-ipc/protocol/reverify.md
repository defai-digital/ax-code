# Verifier: ax-code-glm

- Unit: `desktop-electron-ipc`
- Finding: `AUDIT-desktop-electron-ipc-001`
- Date: `2026-08-11`
- Verdict: `verified-fixed`

The Critical evidence was independently re-read from the renderer boundary. `desktop/packages/electron/src/preload.js:48-55` refuses a command before invoking Electron unless `isAllowedDesktopInvokeCommand` approves it. `desktop/packages/electron/src/preload-ipc-policy.js:6-60` contains the finite reviewed capability set, and lines 62-64 accept only string values present through exact `Set.has` membership. There is no prefix, regular-expression, prototype-property, or fallback authorization path, so a newly registered main-process command remains unreachable until the preload policy is separately edited.

The main-process path supplies a second check. `desktop/packages/electron/src/main.js:601-617` parses the sender through the loopback/dev-origin policy and rejects privileged handlers for non-local senders unless the individual registration is explicitly remote-safe. The trusted window blocks navigation away from its approved origin (`main.js:454-473`), and attached webviews lose renderer-provided preloads while Node integration is disabled and sandboxing is enabled (`desktop/packages/electron/src/webview-policy.js:30-50`).

Bypass cases in `desktop/packages/electron/src/preload-ipc-policy.test.mjs:13-24` reject unrelated channels, `__proto__`, non-string input, and plausible newly named privileged commands. The focused policy run passed 13 files and 59 tests, the full Electron run passed 32 files and 162 tests, type/runtime syntax checking passed 67 files, and lint passed. A separate comparison found identical 53-command sets in `main.js`, `preload-ipc-policy.js`, and `desktop-ipc-contract.json`. The capability-boundary remediation remains effective.
