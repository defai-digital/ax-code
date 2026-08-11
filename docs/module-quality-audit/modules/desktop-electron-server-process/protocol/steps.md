# Nine-step review: desktop-electron-server-process

## Step 1 Scope and runtime entry

The `desktop-electron-server-process` unit is the CommonJS utility-process entry at `desktop/packages/electron/src/server-process.js`. It imports the bundled web server and lifecycle helper at lines 13–16, then starts itself at lines 71–78 rather than exporting an API. The parent resolves and forks this entry at `desktop/packages/electron/src/main.js:228-243`. Production reachability is preserved by the esbuild entry list in `desktop/packages/electron/scripts/bundle-main.mjs:37-50` and the packaged-file list in `desktop/packages/electron/electron-builder.yml:16-25`. The requested run assigns codex-sol as reviewer and ax-code-glm as verifier; that supersedes the reversed, still-pending role labels in `docs/module-quality-audit/modules/desktop-electron-server-process/MODULE-AUDIT.md:11-16` for these protocol artifacts.

## Step 2 Inputs and process boundaries

The child accepts a shutdown timeout, requested port, and serialized startup snapshot from environment variables at `desktop/packages/electron/src/server-process.js:24-40` and lines 43–47. The parent supplies the runtime, web distribution directory, timeout, and snapshot at `desktop/packages/electron/src/main.js:232-242`. Invalid or absent snapshot JSON becomes `null`, and a non-positive or non-finite parsed port becomes `0`, allowing the server to choose a port. The only live command channel is Electron's `parentPort`: lines 61–69 recognize `stop` and `desktop-startup-event`, while unknown messages have no effect. No environment value or diagnostic payload is logged by this entry.

## Step 3 Boot and readiness correctness

`desktop/packages/electron/src/server-process.js:43-54` awaits `startWebUiServer`, stores the resulting handle, and posts `ready` only after reading the bound port; this prevents the parent from directing windows to an uninitialized listener. Startup rejection is converted to an `error` message and a nonzero exit at lines 71–78. The parent independently rejects launches that report an error, exit before readiness, or exceed 30 seconds at `desktop/packages/electron/src/main.js:245-308`. Startup diagnostic forwarding at server-process.js:48-51 is deliberately non-blocking, so loss of that telemetry cannot turn a healthy server start into a failed boot.

## Step 4 Shutdown and event sequencing

A parent `stop` message calls the shared lifecycle at `desktop/packages/electron/src/server-process.js:57-64`; the lifecycle's `stopping` guard at `desktop/packages/electron/src/server-process-lifecycle.js:14-25` prevents duplicate cleanup. The server handle receives `stop({ exitProcess: false })` at lifecycle.js:35-43, leaving the helper responsible for exactly one final exit. Parent shutdown nulls its child reference, waits for the exit event, and force-kills after five seconds at `desktop/packages/electron/src/main.js:380-414`. Desktop startup events received before a handle exists are safely dropped by optional chaining at server-process.js:66-67; earlier state is supplied through the startup snapshot during boot.

## Step 5 Fatal failure and recovery behavior

The verified fix routes both `unhandledRejection` and `uncaughtException` to `stop(1)` at `desktop/packages/electron/src/server-process-lifecycle.js:46-55`. Fatal cleanup arms an unref'd deadline at lines 27–33, logs cleanup failure at lines 35–40, and uses the `exited` guard at lines 17–21 so a late cleanup completion cannot exit twice. This satisfies the invariant documented in `docs/module-quality-audit/modules/desktop-electron-server-process/findings/AUDIT-desktop-electron-server-process-001.md:44-54`. Once the child exits, the parent recovers only a current process that had become ready (`desktop/packages/electron/src/server-restart-policy.js:35-43`) and applies bounded retries in `desktop/packages/electron/src/main.js:312-377`.

## Step 6 Resource and packaging review

The entry performs no polling or collection growth: it awaits one server start, registers one parent message listener, and delegates teardown. Moving server work to the utility process is stated at `desktop/packages/electron/src/server-process.js:3-7`, keeping git scans, SQLite work, file reads, and streaming activity off Electron's main event loop. Fatal timers are cleared after cleanup at `desktop/packages/electron/src/server-process-lifecycle.js:40-43`. Bundle boundaries are coherent: `desktop/packages/electron/scripts/bundle-main.mjs:37-50` leaves `./server.js` external to the child bundle, and `desktop/packages/electron/electron-builder.yml:19-25` packages both sibling files.

## Step 7 Structure and error hygiene

Every local symbol in `desktop/packages/electron/src/server-process.js` is reachable: `parseStartupSnapshot` feeds boot, `stop` serves parent messages, and `serverHandle` joins startup, diagnostics, and cleanup. The entry contains no TODO marker or unused export. The empty catch at lines 49–51 suppresses only a failed best-effort startup-diagnostic post; readiness is posted separately at line 54 and boot failures use the explicit catch at lines 71–78. The missing local explanation remains tracked as a deferred Low item in `docs/module-quality-audit/modules/desktop-electron-server-process/findings/AUDIT-desktop-electron-server-process-empty-catch.md:15-26`, rather than being mistaken for a fatal-path suppression.

## Step 8 Tests and finding reconciliation

Lifecycle tests cover fatal rejection cleanup (`desktop/packages/electron/src/server-process-lifecycle.test.mjs:9-27`), a hung cleanup with one forced exit (lines 29–63), and normal shutdown without a fatal timer (lines 65–80). Restart-policy tests distinguish ready/current crashes from failed starts, stale children, and quitting at `desktop/packages/electron/src/server-restart-policy.test.mjs:49-74`. The packaged smoke script checks startup events and crash recovery at `desktop/packages/electron/scripts/smoke-packaged-app.mjs:348-393`. The findings directory contains one High item marked `verified-fixed` and one deferred Low item; `MODULE-AUDIT.md:60-65` currently lists only the Low item, so this review records both. Neither item is Critical, and no `reverify.md` is called for.

## Step 9 Verification and conclusion

`pnpm --dir desktop/packages/electron exec vitest run src/server-process-lifecycle.test.mjs src/server-restart-policy.test.mjs` passed 2 files and 11 tests. `pnpm --dir desktop/packages/electron run type-check` passed its Electron runtime syntax check across 67 files. Focused ESLint on `src/server-process.js` and `src/server-process-lifecycle.js`, plus direct `node --check` on both files, also exited successfully. The source behavior, parent recovery contract, distribution wiring, and existing finding evidence are consistent; the deferred telemetry-comment issue is non-blocking for completion of this nine-step review.
