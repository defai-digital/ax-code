/**
 * CDP attach mode tests (browser.cdpUrl config).
 *
 * Playwright is injected via the runtime's _setPlaywrightForTest seam, so no
 * real browser or CDP endpoint is needed. Config comes from the tmpdir
 * fixture inside Instance.provide because the runtime reads Config.get() at
 * launch time.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { BrowserRuntime, _resetPlaywrightCache, _setPlaywrightForTest } from "../../../src/tool/browser/runtime"
import { Instance } from "../../../src/project/instance"
import { tmpdir } from "../../fixture/fixture"

function createMockPage() {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    title: vi.fn().mockResolvedValue("Example"),
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    viewportSize: vi.fn().mockReturnValue({ width: 1440, height: 900 }),
  }
}

function createMockContext(page: ReturnType<typeof createMockPage>) {
  return {
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined),
  }
}

function createMockBrowser(contexts: ReturnType<typeof createMockContext>[] = []) {
  return {
    contexts: vi.fn().mockReturnValue(contexts),
    newContext: vi.fn().mockImplementation(async () => createMockContext(createMockPage())),
    close: vi.fn().mockResolvedValue(undefined),
  }
}

function createMockPlaywright(attachBrowser: unknown, launchedBrowser: unknown = createMockBrowser()) {
  return {
    chromium: {
      launch: vi.fn().mockResolvedValue(launchedBrowser),
      connectOverCDP: vi.fn().mockResolvedValue(attachBrowser),
    },
  }
}

function getInternals(rt: BrowserRuntime) {
  return rt as unknown as { attached: boolean; pages: Map<string, unknown> }
}

beforeEach(() => {
  BrowserRuntime._reset()
  _resetPlaywrightCache()
})

afterEach(() => {
  BrowserRuntime._reset()
  _resetPlaywrightCache()
  vi.restoreAllMocks()
})

describe("browser runtime CDP attach mode", () => {
  test("cdpUrl configured: attaches via connectOverCDP and opens in the existing context", async () => {
    await using tmp = await tmpdir({ config: { browser: { cdpUrl: "http://localhost:9222" } } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const page = createMockPage()
        const context = createMockContext(page)
        const browser = createMockBrowser([context])
        const pw = createMockPlaywright(browser)
        _setPlaywrightForTest(pw as never)

        const rt = BrowserRuntime.forSession("ses_cdp")
        const opened = await rt.open("https://example.com", { width: 1440, height: 900 })

        expect(pw.chromium.connectOverCDP).toHaveBeenCalledWith("http://localhost:9222")
        expect(pw.chromium.launch).not.toHaveBeenCalled()
        // user's existing context, not a fresh isolated one
        expect(context.newPage).toHaveBeenCalled()
        expect(browser.newContext).not.toHaveBeenCalled()
        expect(getInternals(rt).attached).toBe(true)
        expect(opened.pageID).toBe("page_1")
        expect(page.goto).toHaveBeenCalledWith("https://example.com", { waitUntil: "domcontentloaded" })
      },
    })
  })

  test("cdpUrl configured but no existing context: falls back to newContext", async () => {
    await using tmp = await tmpdir({ config: { browser: { cdpUrl: "http://localhost:9222" } } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const browser = createMockBrowser([])
        const pw = createMockPlaywright(browser)
        _setPlaywrightForTest(pw as never)

        const rt = BrowserRuntime.forSession("ses_cdp")
        await rt.open("https://example.com", { width: 1440, height: 900 })

        expect(browser.newContext).toHaveBeenCalledWith({ viewport: { width: 1440, height: 900 } })
      },
    })
  })

  test("cdpUrl unset: unchanged headless launch path", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const launched = createMockBrowser()
        const pw = createMockPlaywright(createMockBrowser(), launched)
        _setPlaywrightForTest(pw as never)

        const rt = BrowserRuntime.forSession("ses_headless")
        await rt.open("https://example.com", { width: 1440, height: 900 })

        expect(pw.chromium.launch).toHaveBeenCalledWith({ headless: true })
        expect(pw.chromium.connectOverCDP).not.toHaveBeenCalled()
        expect(launched.newContext).toHaveBeenCalledWith({ viewport: { width: 1440, height: 900 } })
        expect(getInternals(rt).attached).toBe(false)
      },
    })
  })

  test("close in attach mode closes only created pages and disconnects — never the user's context", async () => {
    await using tmp = await tmpdir({ config: { browser: { cdpUrl: "http://localhost:9222" } } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const page = createMockPage()
        const context = createMockContext(page)
        const browser = createMockBrowser([context])
        _setPlaywrightForTest(createMockPlaywright(browser) as never)

        const rt = BrowserRuntime.forSession("ses_cdp")
        await rt.open("https://example.com", { width: 1440, height: 900 })
        await rt.close()

        // only the tab this runtime created is closed
        expect(page.close).toHaveBeenCalled()
        expect(context.close).not.toHaveBeenCalled()
        // browser.close() on a CDP connection is a safe disconnect in
        // playwright-core 1.51 (transport close only; the user's browser
        // process is never signaled to exit)
        expect(browser.close).toHaveBeenCalled()
        expect(getInternals(rt).pages.size).toBe(0)
        expect(getInternals(rt).attached).toBe(false)
      },
    })
  })

  test("closePage in attach mode closes the page, not the context", async () => {
    await using tmp = await tmpdir({ config: { browser: { cdpUrl: "http://localhost:9222" } } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const page = createMockPage()
        const context = createMockContext(page)
        _setPlaywrightForTest(createMockPlaywright(createMockBrowser([context])) as never)

        const rt = BrowserRuntime.forSession("ses_cdp")
        const opened = await rt.open("https://example.com", { width: 1440, height: 900 })
        await rt.closePage(opened.pageID)

        expect(page.close).toHaveBeenCalled()
        expect(context.close).not.toHaveBeenCalled()
      },
    })
  })

  test("connection failure throws an actionable error and allows retry", async () => {
    await using tmp = await tmpdir({ config: { browser: { cdpUrl: "http://localhost:9222" } } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const browser = createMockBrowser([createMockContext(createMockPage())])
        const pw = createMockPlaywright(browser)
        pw.chromium.connectOverCDP.mockRejectedValueOnce(new Error("ECONNREFUSED"))
        _setPlaywrightForTest(pw as never)

        const rt = BrowserRuntime.forSession("ses_cdp")
        await expect(rt.open("https://example.com", { width: 1440, height: 900 })).rejects.toThrow(
          /http:\/\/localhost:9222.*--remote-debugging-port=9222/,
        )

        // launchPromise is reset on failure, so a later attempt can connect
        await expect(rt.open("https://example.com", { width: 1440, height: 900 })).resolves.toMatchObject({
          pageID: "page_1",
        })
      },
    })
  })
})
