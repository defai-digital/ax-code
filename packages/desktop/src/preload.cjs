const { contextBridge, ipcRenderer } = require("electron")

const allowedCommands = new Set([
  "platform.capabilities",
  "external.open",
  "dialog.chooseDirectory",
  "path.reveal",
  "notification.show",
  "diagnostics.exportLogs",
  "diagnostics.read",
  "app.config",
  "backend.attach",
  "backend.start",
])

contextBridge.exposeInMainWorld("axCodeDesktop", {
  invoke(name, payload = {}) {
    if (!allowedCommands.has(name)) {
      return Promise.reject(new Error(`Unsupported desktop bridge command: ${name}`))
    }
    return ipcRenderer.invoke("ax-code:bridge", { name, payload })
  },
})
