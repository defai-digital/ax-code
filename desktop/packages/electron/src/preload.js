"use strict"

const { contextBridge, ipcRenderer } = require("electron")

// Bridge main-process desktop events to DOM CustomEvents. Several UI consumers
// listen via window.addEventListener('openchamber:...') (e.g. open-session,
// open-draft-session, installed-apps-updated, system-resume) rather than the
// __TAURI__.event.listen shim below, so the main process sends an envelope on
// 'ax-code:dom-event' that we re-dispatch on window. Scoped to the openchamber:
// namespace so the page cannot be fed arbitrary event names.
ipcRenderer.on("ax-code:dom-event", (_event, payload) => {
  const name = payload && typeof payload.event === "string" ? payload.event : ""
  if (!name.startsWith("openchamber:")) return
  try {
    window.dispatchEvent(new CustomEvent(name, { detail: payload.detail }))
  } catch {
    // window may not be ready yet; the event is best-effort.
  }
})

window.addEventListener(
  "openchamber:app-ready",
  () => {
    ipcRenderer.send("ax-code:renderer-app-ready")
  },
  { once: true },
)

// Signal to the UI that it's running inside the Electron shell.
// Detected by isElectronShell() in packages/ui/src/lib/desktop.ts.
contextBridge.exposeInMainWorld("__AX_CODE_DESKTOP_ELECTRON__", {
  runtime: "electron",
  recordStartupEvent: (name, details) =>
    ipcRenderer.invoke("desktop_record_startup_event", { name, details: details ?? {} }),
})

// Tauri-compatible IPC shim.
// The existing desktop.ts helpers call window.__TAURI__.core.invoke(cmd, args).
// We map those calls to Electron ipcRenderer.invoke() so the same code path
// works in both Tauri and Electron without changes to the shared UI package.
contextBridge.exposeInMainWorld("__TAURI__", {
  core: {
    invoke: (command, args) => ipcRenderer.invoke(command, args ?? {}),
  },
  dialog: {
    open: (options) => ipcRenderer.invoke("desktop_dialog_open", options ?? {}),
  },
  // Bridges Tauri's event.listen(name, cb) → Promise<unlisten>. The shared UI
  // uses this to receive 'openchamber:update-progress' from the main process.
  // Scoped to the openchamber: namespace so the renderer cannot subscribe to
  // arbitrary main-process channels.
  event: {
    listen: (channel, handler) => {
      if (typeof channel !== "string" || !channel.startsWith("openchamber:")) {
        return Promise.resolve(() => {})
      }
      const wrapped = (_event, payload) => handler({ payload })
      ipcRenderer.on(channel, wrapped)
      return Promise.resolve(() => ipcRenderer.removeListener(channel, wrapped))
    },
  },
})
