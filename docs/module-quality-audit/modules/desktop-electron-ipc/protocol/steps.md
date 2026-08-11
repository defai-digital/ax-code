# Protocol Steps: desktop-electron-ipc

- Slug: `desktop-electron-ipc`
- Lane: `codex-sol`
- Date: `2026-08-11`

## Step 1 Map

The renderer bridge in `desktop/packages/electron/src/preload.js:3-74` exposes fixed desktop boot/event/dialog surfaces and routes Tauri-compatible invokes through `isAllowedDesktopInvokeCommand`; the reviewed capability set is declared in `preload-ipc-policy.js:6-69`. `desktop/packages/electron/src/main.js:601-2673` registers every command through an origin-aware helper and delegates URL, host, file, dialog, capture, webview, process-lifecycle, restart, diagnostics, and update invariants to the adjacent policy modules listed in the audit inventory.

## Step 2 Threat model

The decisive boundary is untrusted renderer/web content versus Electron main-process capabilities that open files/apps, read files, capture pixels, change native state, launch updates, or stop the app (`desktop/packages/electron/src/main.js:609-717`, `main.js:2082-2673`). Threats include arbitrary IPC channel selection, trusted-window navigation to a remote origin, hostile webview preload/partition inheritance, cross-window capture, unsafe external protocols, symlink/path escape, credential-bearing host state, oversized captures/reads, and server or renderer crash loops; `preload.js`, `webview-policy.js`, and the focused policies address these independently.

## Step 3 Correctness

The Critical invariant now holds: `preload.js:48-55` calls a type-and-exact-membership check, and `preload-ipc-policy.js:6-64` cannot authorize a newly named handler by prefix or pattern. Main then rejects privileged calls unless the sender URL is an active loopback origin, with only explicitly low-impact window commands marked `safeForRemote` (`desktop/packages/electron/src/main.js:601-617`, `desktop-ipc-contract.json:1-57`). File reads resolve symlinks, restrict canonical targets to home/tmp, deny credential locations, cap files at 50 MiB, and capture commands bind target contents to the sender and cap window capture area (`main.js:2239-2290`, `main.js:2371-2420`, `desktop-read-file-policy.js:27-59`, `desktop-browser-capture-policy.js:3-11`).

## Step 4 Performance

Crash recovery uses bounded restart/reload counters and stability windows, installed-app discovery has a one-day cache, file search caps results at 1,000 and recursion depth at 12, reads cap at 50 MiB, and rectangle capture caps at four million pixels (`desktop/packages/electron/src/main.js:182-213`, `main.js:2162-2189`, `main.js:2239-2399`). Settings mutation is serialized and geometry writes are debounced (`main.js:901-929`, `main.js:1549-1622`); remaining unbounded work is installed-app input enumeration and whole-page webview capture, both gated to the trusted local renderer.

## Step 5 Design

Security-sensitive predicates are mostly extracted into small CommonJS policy modules, allowing tests to exercise them without booting Electron—for example navigation, external URLs, read-file containment, sender-owned capture, and webview hardening (`renderer-navigation-policy.js`, `external-url.js`, `desktop-read-file-policy.js`, `desktop-browser-capture-policy.js`, `webview-policy.js`). `main.js` remains a 2,766-line composition root spanning server lifecycle, menus, app discovery, settings, IPC, and windows; extracting command groups would reduce review surface and make handler/contract parity mechanically testable.

## Step 6 Dead code/hygiene

The empty catches in `desktop/packages/electron/src/main.js:1642-1656` suppress optional window geometry/vibrancy failures, and `main.js:2165-2169` treats an unreadable installed-app cache as a miss; these are best-effort paths, though the first two still lack diagnostic logging as recorded by the Low finding. `server-process.js:51` ignores a failed parent diagnostic post during teardown and `startup-diagnostics.js:47` ignores log-append failure, while no TODO/FIXME marker or clearly orphaned policy module was found in the 50-file directory.

## Step 7 Tests

The 32 Electron test files cover exact IPC denial, origin/host matching, navigation, external protocols, canonical read restrictions, capture ownership/area, webview partition/preload stripping, dialogs, process shutdown/restart, window reload, updates, caches, paths, and diagnostics; key security regressions include `preload-ipc-policy.test.mjs:7-24`, `desktop-read-file-policy.test.mjs:8-75`, and `webview-policy.test.mjs:26-105`. Static source tests additionally confirm rectangle capture stays local-only (`desktop-capture-page-policy.test.mjs:40-54`). A remaining gap is an automated equality check across `desktop-ipc-contract.json`, the preload `Set`, and all `handleCommand` registrations, plus a BrowserWindow integration test that attempts IPC after a navigation attack.

## Step 8 Findings

`docs/module-quality-audit/modules/desktop-electron-ipc/findings/AUDIT-desktop-electron-ipc-001.md` is Critical and verified-fixed: the former name-pattern authorization is now the exact reviewed set in `desktop/packages/electron/src/preload-ipc-policy.js:6-64`, with negative regression cases in `preload-ipc-policy.test.mjs:13-24`. `AUDIT-desktop-electron-ipc-empty-catch.md` remains a deferred Low hygiene record for best-effort paths, and no new finding was accepted because the parity/integration observations are testability gaps rather than a demonstrated bypass. As the assigned `codex-sol` verifier for the Critical finding, I recorded the independent proof in `protocol/reverify.md`.

## Step 9 Verification

I ran `pnpm --dir desktop/packages/electron run test`; all 32 files and 162 tests passed, and the narrower seven-file security selection passed 41 tests. I also ran `pnpm --dir desktop/packages/electron run type-check`, which passed its 67-file runtime syntax check; a future security gate should add exact contract/preload/handler parity before relying on the JSON contract as exhaustive evidence.
