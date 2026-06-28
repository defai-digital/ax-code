import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const {
  DESKTOP_BROWSER_WEBVIEW_PARTITION,
  applyDesktopBrowserWebviewPolicy,
  createDesktopRendererWebPreferences,
  isAllowedDesktopBrowserWebviewSrc,
} = require("./webview-policy.js")

const mockEvent = () => {
  let prevented = false
  return {
    event: {
      preventDefault: () => {
        prevented = true
      },
    },
    get prevented() {
      return prevented
    },
  }
}

describe("createDesktopRendererWebPreferences", () => {
  test("enables the desktop browser webview without enabling node integration", () => {
    expect(createDesktopRendererWebPreferences("/tmp/preload.js")).toEqual({
      preload: "/tmp/preload.js",
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: true,
    })
  })
})

describe("isAllowedDesktopBrowserWebviewSrc", () => {
  test("allows web pages and about:blank", () => {
    expect(isAllowedDesktopBrowserWebviewSrc("https://example.com")).toBe(true)
    expect(isAllowedDesktopBrowserWebviewSrc("http://127.0.0.1:3000")).toBe(true)
    expect(isAllowedDesktopBrowserWebviewSrc("about:blank")).toBe(true)
  })

  test("rejects non-browser protocols and malformed values", () => {
    expect(isAllowedDesktopBrowserWebviewSrc("file:///Users/test/secret.txt")).toBe(false)
    expect(isAllowedDesktopBrowserWebviewSrc("javascript:alert(1)")).toBe(false)
    expect(isAllowedDesktopBrowserWebviewSrc("about:srcdoc")).toBe(false)
    expect(isAllowedDesktopBrowserWebviewSrc("not a url")).toBe(false)
  })
})

describe("applyDesktopBrowserWebviewPolicy", () => {
  test("hardens allowed browser webviews", () => {
    const webPreferences = {
      preload: "/tmp/unsafe.js",
      preloadURL: "file:///tmp/unsafe.js",
      nodeIntegration: true,
      webSecurity: false,
    }
    const attached = mockEvent()

    expect(
      applyDesktopBrowserWebviewPolicy(attached.event, webPreferences, {
        src: "https://example.com",
        partition: DESKTOP_BROWSER_WEBVIEW_PARTITION,
      }),
    ).toBe(true)

    expect(attached.prevented).toBe(false)
    expect(webPreferences).toEqual({
      partition: DESKTOP_BROWSER_WEBVIEW_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    })
  })

  test("blocks unexpected protocols", () => {
    const attached = mockEvent()

    expect(
      applyDesktopBrowserWebviewPolicy(
        attached.event,
        {},
        { src: "file:///Users/test/secret.txt", partition: DESKTOP_BROWSER_WEBVIEW_PARTITION },
      ),
    ).toBe(false)

    expect(attached.prevented).toBe(true)
  })

  test("blocks unexpected partitions", () => {
    const attached = mockEvent()

    expect(
      applyDesktopBrowserWebviewPolicy(attached.event, {}, { src: "https://example.com", partition: "persist:other" }),
    ).toBe(false)

    expect(attached.prevented).toBe(true)
  })
})
