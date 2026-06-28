"use strict"

const UPDATE_PROGRESS_EVENT = "openchamber:update-progress"

const sendUpdateProgressToWindows = (windows, event, data) => {
  const payload = { event, data }
  let sent = 0
  for (const window of Array.isArray(windows) ? windows : []) {
    if (!window || typeof window.isDestroyed !== "function" || window.isDestroyed()) continue
    if (typeof window.webContents?.send !== "function") continue
    window.webContents.send(UPDATE_PROGRESS_EVENT, payload)
    sent += 1
  }
  return sent
}

module.exports = {
  UPDATE_PROGRESS_EVENT,
  sendUpdateProgressToWindows,
}
