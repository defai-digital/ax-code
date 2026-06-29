"use strict"

function isDesktopBrowserCaptureTargetForSender(targetWebContents, senderWebContents) {
  if (!targetWebContents || !senderWebContents) return false
  if (targetWebContents === senderWebContents) return false
  if (typeof targetWebContents.isDestroyed === "function" && targetWebContents.isDestroyed()) return false
  if (typeof senderWebContents.isDestroyed === "function" && senderWebContents.isDestroyed()) return false
  if (typeof targetWebContents.getType === "function" && targetWebContents.getType() !== "webview") return false

  return targetWebContents.hostWebContents === senderWebContents
}

module.exports = {
  isDesktopBrowserCaptureTargetForSender,
}
