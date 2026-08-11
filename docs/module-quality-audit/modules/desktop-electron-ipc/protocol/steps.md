# Protocol Steps: desktop-electron-ipc

- Reviewer: `codex-sol`
- Verifier: `ax-code-glm`
- Date: `2026-08-11`

## Step 1 Scope and map

The `desktop-electron-ipc` path runs from the isolated renderer bridge to main-process handlers. `desktop/packages/electron/src/preload.js:48-55` exposes the Tauri-compatible invoke function, `desktop/packages/electron/src/preload-ipc-policy.js:6-64` defines its reviewed command capabilities, and `desktop/packages/electron/src/main.js:601-617` applies the sender-origin gate before dispatch. The candidate helpers own narrower decisions for dialogs, file reads and searches, host URLs, external URLs, capture targets, window titles, boot state, and installed-app cache freshness. The contract at `desktop/packages/electron/src/desktop-ipc-contract.json:3-56` records command names and remote-safety intent.

## Step 2 Threat and failure model

The principal adversary is renderer content attempting to turn IPC into native Electron authority. Relevant effects include opening OS paths and URLs (`desktop/packages/electron/src/main.js:2085-2159`), reading local bytes (`main.js:2239-2289`), capturing pixels (`main.js:2371-2420`), and changing native window or application state (`main.js:2443-2673`). Defense therefore needs both capability selection and sender validation. Additional failure cases are credential-bearing host URLs, symlink escape, cross-renderer capture, unsafe protocol dispatch, oversized reads/captures, corrupt caches, destroyed windows, and malformed dialog or title inputs.

## Step 3 Correctness and invariants

Renderer command selection is fail-closed: `desktop/packages/electron/src/preload.js:50-54` rejects before `ipcRenderer.invoke`, while `desktop/packages/electron/src/preload-ipc-policy.js:62-64` requires a string and exact `Set.has` membership. The main helper independently rejects a non-local sender unless `safeForRemote` was deliberately set (`desktop/packages/electron/src/main.js:604-616`). A static comparison found exact parity among 53 `handleCommand` names, 53 preload entries, and 53 contract entries. File reads resolve the canonical path before applying home/tmp and secret-path restrictions (`main.js:2239-2263`; `desktop-read-file-policy.js:27-59`), and browser capture requires the target webview to be hosted by the requesting sender (`desktop-browser-capture-policy.js:3-11`).

## Step 4 Performance and bounds

Potentially expensive work is bounded at the handler layer. File reads reject inputs larger than 50 MiB (`desktop/packages/electron/src/main.js:2254-2263`), recursive search stops after depth 12 and caps caller limits at 1,000 (`main.js:2316-2359`), and rectangular capture constrains coordinates to window bounds and rejects excessive area (`main.js:2373-2402`). Installed-app enumeration uses a timestamped cache and refreshes asynchronously (`main.js:2162-2189`); `desktop/packages/electron/src/installed-apps-cache.js:18-25` treats missing, future-dated, and expired timestamps as stale. The small policy helpers use bounded arrays, sets, URL parsing, or direct property checks, with no accumulating state.

## Step 5 Design and ownership

The extracted CommonJS helpers keep security decisions independently testable without starting Electron: URL normalization lives in `desktop/packages/electron/src/external-url.js:3-23`, read containment in `desktop-read-file-policy.js:27-59`, dialog shaping in `desktop-dialog.js:3-52`, and capture ownership in `desktop-browser-capture-policy.js:3-11`. `main.js:27-57` composes those modules and remains the authoritative effect layer. One ownership wrinkle is that `desktop-lan-address.js:33-85` has complete routed/fallback detection logic but no production importer, while `main.js:688` deliberately returns `null` for `desktop_get_lan_address`; this is dormant code under the current local-only product posture and should be removed or reconnected deliberately if that posture changes.

## Step 6 Security and hygiene

The trusted BrowserWindow uses context isolation, disables Node integration, and retains web security (`desktop/packages/electron/src/webview-policy.js:5-12`); attached browser webviews have renderer-supplied preload fields removed and sandboxing forced (`webview-policy.js:30-50`). External launches accept only HTTP, HTTPS, mail, and telephone schemes and reject control characters or URL credentials (`desktop/packages/electron/src/external-url.js:3-23`). The three empty catches in the reviewed `main.js` paths suppress geometry/vibrancy restoration and an unreadable installed-app cache (`main.js:1642-1656`, `main.js:2165-2169`). Two additional sites are the teardown-time parent diagnostic send (`server-process.js:48-52`) and startup log setup (`startup-diagnostics.js:42-48`); these remain documented by the deferred Low finding rather than being treated as invisible failures.

## Step 7 Test evidence and gaps

Negative tests cover newly invented privileged command names and unrelated channels (`desktop/packages/electron/src/preload-ipc-policy.test.mjs:13-24`), Windows containment and credential locations (`desktop-read-file-policy.test.mjs:8-75`), foreign or destroyed capture targets (`desktop-browser-capture-policy.test.mjs:21-52`), hostile external protocols (`external-url.test.mjs:14-22`), and webview preload/partition hardening (`webview-policy.test.mjs:53-105`). The structural capture test confirms `desktop_capture_page_rect` is not remote-safe (`desktop-capture-page-policy.test.mjs:40-54`). The main residual gap is a real BrowserWindow integration test that navigates away from the trusted origin and attempts a privileged invoke; present unit tests prove the component predicates, not the complete Electron event path.

## Step 8 Findings disposition

`docs/module-quality-audit/modules/desktop-electron-ipc/findings/AUDIT-desktop-electron-ipc-001.md:20-39` describes the former Critical pattern-based authorization. Current exact membership at `desktop/packages/electron/src/preload-ipc-policy.js:6-64`, the rejection cases at `preload-ipc-policy.test.mjs:13-24`, the bridge check at `preload.js:48-55`, and the main sender gate at `main.js:601-617` independently establish that it remains fixed. `AUDIT-desktop-electron-ipc-empty-catch.md:15-31` is still a Low deferred record with per-site dispositions and a 2026-09-11 expiry. This pass found no new demonstrated security or correctness defect; the dormant LAN helper and full-window integration test are maintainability observations rather than proven user impact.

## Step 9 Verification and exit

The package defines its test, runtime syntax/type, and lint entry points at `desktop/packages/electron/package.json:17-19`. The focused command covering the listed policies plus preload/webview controls passed 13 files and 59 tests. `pnpm --dir desktop/packages/electron run test` passed 32 files and 162 tests. `pnpm --dir desktop/packages/electron run type-check` passed the 67-file Electron runtime syntax check, and `pnpm --dir desktop/packages/electron run lint` exited successfully. A read-only parity script also reported no difference among main handler names, preload allowlist entries, and contract command entries (53 each). The Critical evidence received the required second-pass confirmation in `protocol/reverify.md`; no source or finding record was changed.
