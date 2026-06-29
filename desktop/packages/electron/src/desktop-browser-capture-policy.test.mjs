import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { isDesktopBrowserCaptureTargetForSender } = require("./desktop-browser-capture-policy.js")

const createWebContents = ({ hostWebContents = null, type = "webview", destroyed = false } = {}) => ({
  hostWebContents,
  getType: () => type,
  isDestroyed: () => destroyed,
})

describe("isDesktopBrowserCaptureTargetForSender", () => {
  test("allows a webview hosted by the sender", () => {
    const sender = createWebContents({ type: "window" })
    const target = createWebContents({ hostWebContents: sender })

    expect(isDesktopBrowserCaptureTargetForSender(target, sender)).toBe(true)
  })

  test("rejects the sender's own webContents", () => {
    const sender = createWebContents({ type: "window" })

    expect(isDesktopBrowserCaptureTargetForSender(sender, sender)).toBe(false)
  })

  test("rejects a webview hosted by a different renderer", () => {
    const sender = createWebContents({ type: "window" })
    const otherSender = createWebContents({ type: "window" })
    const target = createWebContents({ hostWebContents: otherSender })

    expect(isDesktopBrowserCaptureTargetForSender(target, sender)).toBe(false)
  })

  test("rejects non-webview targets", () => {
    const sender = createWebContents({ type: "window" })
    const target = createWebContents({ hostWebContents: sender, type: "window" })

    expect(isDesktopBrowserCaptureTargetForSender(target, sender)).toBe(false)
  })

  test("rejects destroyed senders or targets", () => {
    const sender = createWebContents({ type: "window" })
    const target = createWebContents({ hostWebContents: sender, destroyed: true })
    const destroyedSender = createWebContents({ type: "window", destroyed: true })

    expect(isDesktopBrowserCaptureTargetForSender(target, sender)).toBe(false)
    expect(
      isDesktopBrowserCaptureTargetForSender(createWebContents({ hostWebContents: destroyedSender }), destroyedSender),
    ).toBe(false)
    expect(isDesktopBrowserCaptureTargetForSender(createWebContents({ hostWebContents: sender }), null)).toBe(false)
  })
})
