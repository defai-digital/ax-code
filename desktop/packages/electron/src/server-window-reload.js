"use strict"

const { isLoopbackDesktopHostname } = require("./desktop-hosts")

function resolveServerRestartReloadUrl(rawUrl, { oldPort, newPort } = {}) {
  const previousPort = Number(oldPort)
  const nextPort = Number(newPort)
  if (!Number.isInteger(previousPort) || previousPort <= 0) return null
  if (!Number.isInteger(nextPort) || nextPort <= 0) return null

  try {
    const url = new URL(typeof rawUrl === "string" ? rawUrl : "")
    if (url.protocol !== "http:") return null
    if (!isLoopbackDesktopHostname(url.hostname)) return null
    if (url.port !== String(previousPort)) return null

    url.port = String(nextPort)
    return url.toString()
  } catch {
    return null
  }
}

async function reloadLocalRendererWindowsAfterServerRestart(windows, { oldPort, newPort } = {}) {
  const tasks = []
  for (const win of Array.isArray(windows) ? windows : []) {
    if (!win || typeof win.isDestroyed !== "function" || win.isDestroyed()) continue
    if (!win.webContents || typeof win.webContents.getURL !== "function" || typeof win.loadURL !== "function") {
      continue
    }

    const nextUrl = resolveServerRestartReloadUrl(win.webContents.getURL(), { oldPort, newPort })
    if (!nextUrl) continue
    tasks.push(
      Promise.resolve()
        .then(() => win.loadURL(nextUrl))
        .then(
          () => ({ status: "fulfilled", url: nextUrl }),
          (error) => ({ status: "rejected", url: nextUrl, reason: error }),
        ),
    )
  }

  const results = await Promise.all(tasks)
  return {
    attempted: results.length,
    failed: results.filter((result) => result.status === "rejected").length,
    urls: results.map((result) => result.url),
  }
}

module.exports = {
  reloadLocalRendererWindowsAfterServerRestart,
  resolveServerRestartReloadUrl,
}
