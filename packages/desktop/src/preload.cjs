const { contextBridge, ipcRenderer } = require("electron")

const menuCommandChannel = "ax-code:menu-command"

const allowedCommands = new Set([
  "platform.capabilities",
  "release.checkUpdate",
  "release.downloadUpdate",
  "release.openDownloadedUpdate",
  "external.open",
  "dialog.chooseDirectory",
  "path.reveal",
  "editor.open",
  "notification.show",
  "diagnostics.exportLogs",
  "diagnostics.read",
  "app.config",
  "backend.attach",
  "backend.start",
])

const allowedMenuCommands = new Set([
  "session.new",
  "composer.focus",
  "composer.run",
  "composer.queue",
  "diagnostics.refresh",
])

contextBridge.exposeInMainWorld("axCodeDesktop", {
  invoke(name, payload = {}) {
    if (!allowedCommands.has(name)) {
      return Promise.reject(new Error(`Unsupported desktop bridge command: ${name}`))
    }
    return ipcRenderer.invoke("ax-code:bridge", { name, payload })
  },
  onMenuCommand(callback) {
    if (typeof callback !== "function") {
      throw new Error("Desktop menu command callback must be a function")
    }
    const listener = (_event, payload) => {
      const command = payload && typeof payload === "object" ? payload.command : undefined
      if (typeof command === "string" && allowedMenuCommands.has(command)) callback(command)
    }
    ipcRenderer.on(menuCommandChannel, listener)
    return () => ipcRenderer.removeListener(menuCommandChannel, listener)
  },
})
