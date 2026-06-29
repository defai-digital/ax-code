"use strict"

const { isLoopbackDesktopHostname } = require("./desktop-hosts")

const normalizeDevRendererUrl = (raw) => {
  const value = typeof raw === "string" ? raw.trim() : ""
  if (!value) return null

  try {
    const parsed = new URL(value)
    if (parsed.protocol !== "http:" || !isLoopbackDesktopHostname(parsed.hostname)) {
      return null
    }
    return parsed.toString().replace(/\/$/, "")
  } catch {
    return null
  }
}

const isTrustedRendererNavigationUrl = (raw, { serverPort = 0, devRendererUrl = "" } = {}) => {
  try {
    const parsed = new URL(String(raw || ""))
    const isServerUrl =
      parsed.protocol === "http:" &&
      serverPort > 0 &&
      isLoopbackDesktopHostname(parsed.hostname) &&
      parsed.port === String(serverPort)

    const normalizedDevRendererUrl = normalizeDevRendererUrl(devRendererUrl)
    const isDevRendererUrl =
      normalizedDevRendererUrl !== null && parsed.origin === new URL(normalizedDevRendererUrl).origin

    return Boolean(isServerUrl || isDevRendererUrl)
  } catch {
    return false
  }
}

module.exports = {
  isTrustedRendererNavigationUrl,
  normalizeDevRendererUrl,
}
