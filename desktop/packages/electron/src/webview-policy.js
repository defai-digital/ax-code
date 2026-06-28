"use strict"

const DESKTOP_BROWSER_WEBVIEW_PARTITION = "persist:openchamber-browser"

function createDesktopRendererWebPreferences(preload) {
  return {
    preload,
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: true,
    webviewTag: true,
  }
}

function isAllowedDesktopBrowserWebviewSrc(value) {
  if (typeof value !== "string" || value.length === 0) return false
  try {
    const parsed = new URL(value)
    if (parsed.protocol === "about:") return parsed.href === "about:blank"
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

function isAllowedDesktopBrowserWebviewPartition(value) {
  return value === DESKTOP_BROWSER_WEBVIEW_PARTITION
}

function applyDesktopBrowserWebviewPolicy(event, webPreferences, params) {
  const src = typeof params?.src === "string" ? params.src : ""
  const partition = typeof params?.partition === "string" ? params.partition : ""

  if (!isAllowedDesktopBrowserWebviewSrc(src) || !isAllowedDesktopBrowserWebviewPartition(partition)) {
    event?.preventDefault?.()
    return false
  }

  if (webPreferences && typeof webPreferences === "object") {
    delete webPreferences.preload
    delete webPreferences.preloadURL
    webPreferences.partition = DESKTOP_BROWSER_WEBVIEW_PARTITION
    webPreferences.contextIsolation = true
    webPreferences.nodeIntegration = false
    webPreferences.nodeIntegrationInSubFrames = false
    webPreferences.nodeIntegrationInWorker = false
    webPreferences.sandbox = true
    webPreferences.webSecurity = true
    webPreferences.allowRunningInsecureContent = false
  }

  return true
}

function attachDesktopBrowserWebviewPolicy(contents) {
  if (!contents || typeof contents.on !== "function") return
  contents.on("will-attach-webview", (event, webPreferences, params) => {
    applyDesktopBrowserWebviewPolicy(event, webPreferences, params)
  })
}

module.exports = {
  DESKTOP_BROWSER_WEBVIEW_PARTITION,
  applyDesktopBrowserWebviewPolicy,
  attachDesktopBrowserWebviewPolicy,
  createDesktopRendererWebPreferences,
  isAllowedDesktopBrowserWebviewSrc,
}
