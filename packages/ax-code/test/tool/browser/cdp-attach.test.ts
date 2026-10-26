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
    url: vi.fn().mockReturnValue("https://example.com"),
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
    isConnected: vi.fn().mockReturnValue(true),
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

  test("open reports the page URL after redirects, not the requested URL", async () => {
    await using tmp = await tmpdir({ config: { browser: { cdpUrl: "http://localhost:9222" } } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const page = createMockPage()
        page.url = vi.fn().mockReturnValue("https://example.com/final")
        const context = createMockContext(page)
        const browser = createMockBrowser([context])
        const pw = createMockPlaywright(browser)
        _setPlaywrightForTest(pw as never)

        const rt = BrowserRuntime.forSession("ses_redirect")
        const opened = await rt.open("https://example.com", { width: 1440, height: 900 })

        expect(opened.url).toBe("https://example.com/final")
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

  test("goto failure in attach mode closes the orphan page, not the user's context", async () => {
    await using tmp = await tmpdir({ config: { browser: { cdpUrl: "http://localhost:9222" } } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const page = createMockPage()
        page.goto.mockRejectedValueOnce(new Error("net::ERR_ABORTED"))
        const context = createMockContext(page)
        _setPlaywrightForTest(createMockPlaywright(createMockBrowser([context])) as never)

        const rt = BrowserRuntime.forSession("ses_cdp")
        await expect(rt.open("https://example.com", { width: 1440, height: 900 })).rejects.toThrow(/ERR_ABORTED/)

        // the page was never registered, so without explicit cleanup it
        // would leak as an orphan tab in the user's real browser
        expect(page.close).toHaveBeenCalled()
        expect(context.close).not.toHaveBeenCalled()
        expect(getInternals(rt).pages.size).toBe(0)
      },
    })
  })

  test("goto failure in launch mode closes the created context", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const page = createMockPage()
        page.goto.mockRejectedValueOnce(new Error("net::ERR_ABORTED"))
        const context = createMockContext(page)
        const launched = createMockBrowser()
        launched.newContext.mockResolvedValueOnce(context)
        _setPlaywrightForTest(createMockPlaywright(createMockBrowser(), launched) as never)

        const rt = BrowserRuntime.forSession("ses_headless")
        await expect(rt.open("https://example.com", { width: 1440, height: 900 })).rejects.toThrow(/ERR_ABORTED/)

        expect(context.close).toHaveBeenCalled()
        expect(getInternals(rt).pages.size).toBe(0)
      },
    })
  })

  test("attach-mode fallback context is owned by the runtime and closed on close()", async () => {
    await using tmp = await tmpdir({ config: { browser: { cdpUrl: "http://localhost:9222" } } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const page = createMockPage()
        const fallback = createMockContext(page)
        const browser = createMockBrowser([])
        browser.newContext.mockResolvedValueOnce(fallback)
        _setPlaywrightForTest(createMockPlaywright(browser) as never)

        const rt = BrowserRuntime.forSession("ses_cdp")
        await rt.open("https://example.com", { width: 1440, height: 900 })
        await rt.close()

        // the runtime created this context, so it must close it — otherwise
        // it leaks in the user's browser past the CDP disconnect
        expect(fallback.close).toHaveBeenCalled()
        expect(browser.close).toHaveBeenCalled()
      },
    })
  })

  test("closePage in attach mode closes the owned fallback context", async () => {
    await using tmp = await tmpdir({ config: { browser: { cdpUrl: "http://localhost:9222" } } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const page = createMockPage()
        const fallback = createMockContext(page)
        const browser = createMockBrowser([])
        browser.newContext.mockResolvedValueOnce(fallback)
        _setPlaywrightForTest(createMockPlaywright(browser) as never)

        const rt = BrowserRuntime.forSession("ses_cdp")
        const opened = await rt.open("https://example.com", { width: 1440, height: 900 })
        await rt.closePage(opened.pageID)

        expect(fallback.close).toHaveBeenCalled()
        expect(getInternals(rt).pages.size).toBe(0)
      },
    })
  })

  test("reconnects when the CDP connection has dropped", async () => {
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
        await rt.open("https://example.com", { width: 1440, height: 900 })
        expect(pw.chromium.connectOverCDP).toHaveBeenCalledTimes(1)

        // user closed their Chrome; the runtime must re-attach instead of
        // failing with "Target closed" on every subsequent call
        browser.isConnected.mockReturnValue(false)
        await rt.open("https://example.com", { width: 1440, height: 900 })
        expect(pw.chromium.connectOverCDP).toHaveBeenCalledTimes(2)
      },
    })
  })
  test("a session released while its browser launches closes the late browser instead of leaking it", async () => {
    await using tmp = await tmpdir({ config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const browser = createMockBrowser()
        let finishLaunch!: (value: unknown) => void
        const pw = {
          chromium: {
            launch: vi.fn(() => new Promise((resolve) => (finishLaunch = resolve))),
            connectOverCDP: vi.fn(),
          },
        }
        _setPlaywrightForTest(pw as never)

        const rt = BrowserRuntime.forSession("ses_release_race")
        const opening = rt.open("https://example.com", { width: 1440, height: 900 })
        await vi.waitFor(() => expect(pw.chromium.launch).toHaveBeenCalled())
        const releasing = BrowserRuntime.release("ses_release_race")
        expect(BrowserRuntime.forSession("ses_release_race")).not.toBe(rt)

        finishLaunch(browser)
        await expect(opening).rejects.toThrow("released")
        await releasing
        expect(browser.close).toHaveBeenCalledOnce()
        expect(getInternals(rt).pages.size).toBe(0)
        await expect(rt.open("https://example.com", { width: 1440, height: 900 })).rejects.toThrow("released")
      },
    })
  })

  test("a session released while launching still closes the browser when navigation then fails", async () => {
    await using tmp = await tmpdir({ config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const page = createMockPage()
        page.goto = vi.fn().mockRejectedValue(new Error("net::ERR_NAME_NOT_RESOLVED"))
        const context = createMockContext(page)
        const browser = createMockBrowser()
        browser.newContext = vi.fn().mockResolvedValue(context)
        let finishLaunch!: (value: unknown) => void
        _setPlaywrightForTest({
          chromium: {
            launch: vi.fn(() => new Promise((resolve) => (finishLaunch = resolve))),
            connectOverCDP: vi.fn(),
          },
        } as never)

        const rt = BrowserRuntime.forSession("ses_release_launch_fail")
        const opening = rt.open("https://missing.invalid", { width: 1440, height: 900 })
        await vi.waitFor(() => expect(finishLaunch).toBeDefined())
        const releasing = BrowserRuntime.release("ses_release_launch_fail")
        finishLaunch(browser)
        await expect(opening).rejects.toThrow("ERR_NAME_NOT_RESOLVED")
        await releasing
        expect(context.close).toHaveBeenCalled()
        expect(browser.close).toHaveBeenCalledOnce()
      },
    })
  })

  test("a session released during attach-mode navigation closes the tab before dropping the transport", async () => {
    await using tmp = await tmpdir({ config: { browser: { cdpUrl: "http://localhost:9222" } } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const page = createMockPage()
        let finishGoto!: () => void
        page.goto = vi.fn(() => new Promise<undefined>((resolve) => (finishGoto = () => resolve(undefined))))
        const context = createMockContext(page)
        const browser = createMockBrowser([context])
        _setPlaywrightForTest(createMockPlaywright(browser) as never)

        const rt = BrowserRuntime.forSession("ses_release_goto")
        const opening = rt.open("https://example.com", { width: 1440, height: 900 })
        await vi.waitFor(() => expect(page.goto).toHaveBeenCalled())
        const releasing = BrowserRuntime.release("ses_release_goto")
        // The transport stays up until the in-flight open settles.
        await Promise.resolve()
        expect(browser.close).not.toHaveBeenCalled()

        finishGoto()
        await expect(opening).rejects.toThrow("released")
        await releasing
        // The tab lives in the user's own browser: closed before the CDP
        // transport is dropped, since browser.close() only disconnects.
        expect(page.close).toHaveBeenCalled()
        expect(page.close.mock.invocationCallOrder[0]!).toBeLessThan(browser.close.mock.invocationCallOrder[0]!)
        expect(context.close).not.toHaveBeenCalled()
        expect(getInternals(rt).pages.size).toBe(0)
      },
    })
  })

  test("release closes anyway when an in-flight open never settles", async () => {
    await using tmp = await tmpdir({ config: { browser: { cdpUrl: "http://localhost:9222" } } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const page = createMockPage()
        const context = createMockContext(page)
        context.newPage = vi.fn(() => new Promise(() => {}))
        const browser = createMockBrowser([context])
        _setPlaywrightForTest(createMockPlaywright(browser) as never)
        const previous = BrowserRuntime.releaseSettleMs
        BrowserRuntime.releaseSettleMs = 20
        try {
          const rt = BrowserRuntime.forSession("ses_release_stalled")
          void rt.open("https://example.com", { width: 1440, height: 900 }).catch(() => {})
          await vi.waitFor(() => expect(context.newPage).toHaveBeenCalled())
          await BrowserRuntime.release("ses_release_stalled")
          expect(browser.close).toHaveBeenCalledOnce()
        } finally {
          BrowserRuntime.releaseSettleMs = previous
        }
      },
    })
  })

  test("an open that outlives the release wait closes the browser it launched", async () => {
    await using tmp = await tmpdir({ config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const browser = createMockBrowser()
        let finishLaunch!: (value: unknown) => void
        _setPlaywrightForTest({
          chromium: {
            launch: vi.fn(() => new Promise((resolve) => (finishLaunch = resolve))),
            connectOverCDP: vi.fn(),
          },
        } as never)
        const previous = BrowserRuntime.releaseSettleMs
        BrowserRuntime.releaseSettleMs = 20
        try {
          const rt = BrowserRuntime.forSession("ses_release_late_launch")
          const opening = rt.open("https://example.com", { width: 1440, height: 900 })
          await vi.waitFor(() => expect(finishLaunch).toBeDefined())
          await BrowserRuntime.release("ses_release_late_launch")
          expect(browser.close).not.toHaveBeenCalled()

          finishLaunch(browser)
          await expect(opening).rejects.toThrow("released")
          expect(browser.close).toHaveBeenCalledOnce()
          expect(getInternals(rt).pages.size).toBe(0)
        } finally {
          BrowserRuntime.releaseSettleMs = previous
        }
      },
    })
  })

  test("a release that stops waiting during attach-mode navigation still closes the tab first", async () => {
    await using tmp = await tmpdir({ config: { browser: { cdpUrl: "http://localhost:9222" } } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const page = createMockPage()
        let failGoto!: (error: Error) => void
        page.goto = vi.fn(() => new Promise((_resolve, reject) => (failGoto = reject)))
        const context = createMockContext(page)
        const browser = createMockBrowser([context])
        _setPlaywrightForTest(createMockPlaywright(browser) as never)
        const previous = BrowserRuntime.releaseSettleMs
        BrowserRuntime.releaseSettleMs = 20
        try {
          const rt = BrowserRuntime.forSession("ses_release_goto_stall")
          const opening = rt.open("https://example.com", { width: 1440, height: 900 })
          await vi.waitFor(() => expect(page.goto).toHaveBeenCalled())
          await BrowserRuntime.release("ses_release_goto_stall")
          expect(page.close).toHaveBeenCalled()
          expect(page.close.mock.invocationCallOrder[0]!).toBeLessThan(browser.close.mock.invocationCallOrder[0]!)
          expect(context.close).not.toHaveBeenCalled()
          failGoto(new Error("Target closed"))
          await expect(opening).rejects.toThrow("Target closed")
        } finally {
          BrowserRuntime.releaseSettleMs = previous
        }
      },
    })
  })

  test("an owned context is closed when its first page cannot be created", async () => {
    await using tmp = await tmpdir({ config: { browser: { cdpUrl: "http://localhost:9222" } } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const context = createMockContext(createMockPage())
        context.newPage = vi.fn().mockRejectedValue(new Error("Target crashed"))
        const browser = createMockBrowser([])
        browser.newContext = vi.fn().mockResolvedValue(context)
        _setPlaywrightForTest(createMockPlaywright(browser) as never)

        const rt = BrowserRuntime.forSession("ses_owned_context_fail")
        await expect(rt.open("https://example.com", { width: 1440, height: 900 })).rejects.toThrow("Target crashed")
        expect(context.close).toHaveBeenCalledOnce()
      },
    })
  })
})
