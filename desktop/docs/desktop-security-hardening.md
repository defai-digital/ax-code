# Desktop Security Hardening Plan

AX Code Desktop is moving toward a thin Electron shell. The renderer should stay a browser client for the local AX Code Desktop server, with Electron privileges exposed only through small, typed preload APIs.

## Current First Slice

- Main-window popup navigation is restricted to the local desktop server or the dev renderer origin.
- Main-window top-level navigation is now blocked with the same trusted-origin check; external URLs are opened with `shell.openExternal`.
- Startup diagnostics use a dedicated `recordStartupEvent` preload method instead of adding another generic renderer capability.

## Next Slices

1. Register a privileged `app://ax-code` protocol for packaged renderer assets.
2. Keep API, SSE, and WebSocket traffic on the loopback server until the protocol migration has parity tests.
3. Add a CSP for packaged renderer pages:
   - default to self
   - allow loopback `connect-src` for local API/SSE/WS
   - keep images/fonts/styles limited to local packaged assets and explicit data/blob cases already used by the app
4. Replace the Tauri-compatible generic Electron IPC shim with a typed allowlist once every Electron-supported command has a main-process handler or an explicit unsupported response.
5. Keep `contextIsolation: true` and `nodeIntegration: false`; do not expose Node or Electron modules to the renderer.
6. Add regression coverage for:
   - external navigation opens outside the trusted window
   - untrusted `window.open` is denied
   - preload rejects unknown Electron commands after the allowlist lands
   - packaged app loads under `app://ax-code` with CSP enabled
