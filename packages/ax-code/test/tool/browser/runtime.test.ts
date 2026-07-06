/**
 * BrowserRuntime tests with injected mocks.
 *
 * Since Playwright is loaded via createRequire at module load time,
 * we inject mock browser objects directly into the runtime's internal
 * state rather than trying to mock the module loading. This tests all
 * the runtime's logic (page management, UID resolution, buffering,
 * action dispatch) without requiring a real browser binary.
 */
import { describe, expect, test, vi, beforeEach } from "vitest"
import { BrowserRuntime, _resetPlaywrightCache } from "../../../src/tool/browser/runtime"

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockLocator() {
  return {
    click: vi.fn().mockResolvedValue(undefined),
    dblclick: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    press: vi.fn().mockResolvedValue(undefined),
    hover: vi.fn().mockResolvedValue(undefined),
    selectOption: vi.fn().mockResolvedValue(undefined),
    setInputFiles: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(Buffer.from("element-png-data")),
    evaluate: vi.fn().mockResolvedValue(undefined),
    dragTo: vi.fn().mockResolvedValue(undefined),
    count: vi.fn().mockResolvedValue(1),
    boundingBox: vi.fn().mockResolvedValue({ x: 0, y: 0, width: 200, height: 100 }),
  }
}

function createMockPage() {
  const locator = createMockLocator()
  return {
    locator: vi.fn().mockReturnValue(locator),
    _locator: locator,
    goto: vi.fn().mockResolvedValue(undefined),
    title: vi.fn().mockResolvedValue("Test Page"),
    viewportSize: vi.fn().mockReturnValue({ width: 1440, height: 900 }),
    evaluate: vi.fn().mockResolvedValue([]),
    screenshot: vi.fn().mockResolvedValue(Buffer.from("png-data")),
    keyboard: { press: vi.fn().mockResolvedValue(undefined) },
    on: vi.fn(),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    goBack: vi.fn().mockResolvedValue(undefined),
    goForward: vi.fn().mockResolvedValue(undefined),
    reload: vi.fn().mockResolvedValue(undefined),
  }
}

function createMockContext() {
  return {
    close: vi.fn().mockResolvedValue(undefined),
  }
}

function createMockBrowser() {
  return {
    close: vi.fn().mockResolvedValue(undefined),
  }
}

// ---------------------------------------------------------------------------
// Helpers to inject mock state into the runtime
// ---------------------------------------------------------------------------

type RuntimeInternal = {
  browser: unknown
  pages: Map<string, unknown>
  consoleBuffers: Map<string, unknown[]>
  networkBuffers: Map<string, unknown[]>
  uidRegistry: Map<string, unknown>
  latestPageID: string | undefined
  pageCounter: number
}

function getInternals(rt: BrowserRuntime): RuntimeInternal {
  return rt as unknown as RuntimeInternal
}

function injectPage(
  rt: BrowserRuntime,
  pageID: string,
  page: ReturnType<typeof createMockPage>,
  context: ReturnType<typeof createMockContext>,
) {
  const internals = getInternals(rt)
  internals.pages.set(pageID, {
    pageID,
    pwPage: page,
    context,
    url: "http://localhost:3000",
    title: "Test Page",
    viewport: { width: 1440, height: 900 },
  })
  internals.latestPageID = pageID
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("browser runtime", () => {
  let runtime: BrowserRuntime

  beforeEach(() => {
    BrowserRuntime._reset()
    _resetPlaywrightCache()
    runtime = BrowserRuntime.get()
  })

  test("get() returns singleton instance", () => {
    const a = BrowserRuntime.get()
    const b = BrowserRuntime.get()
    expect(a).toBe(b)
  })

  test("_reset() creates new instance", () => {
    const a = BrowserRuntime.get()
    BrowserRuntime._reset()
    const b = BrowserRuntime.get()
    expect(a).not.toBe(b)
  })

  // -- resolvePage tests --

  test("resolvePage throws when no page is open", async () => {
    await expect(runtime.snapshot("latest", false)).rejects.toThrow(/No browser page/)
  })

  test("resolvePage throws for unknown pageID", async () => {
    const page = createMockPage()
    const ctx = createMockContext()
    injectPage(runtime, "page_1", page, ctx)

    await expect(runtime.snapshot("nonexistent_page", false)).rejects.toThrow(/not found/)
  })

  test("resolvePage resolves 'latest' to most recent page", async () => {
    const page1 = createMockPage()
    const page2 = createMockPage()
    const ctx1 = createMockContext()
    const ctx2 = createMockContext()
    injectPage(runtime, "page_1", page1, ctx1)
    injectPage(runtime, "page_2", page2, ctx2)

    page2.evaluate.mockResolvedValueOnce([])
    const snapshot = await runtime.snapshot("latest", false)
    expect(snapshot.pageID).toBe("page_2")
  })

  // -- snapshot tests --

  test("snapshot returns elements with UIDs and formatted text", async () => {
    const page = createMockPage()
    const ctx = createMockContext()
    injectPage(runtime, "page_1", page, ctx)

    page.evaluate.mockResolvedValueOnce([
      { uid: "uid_1", role: "heading", name: "Welcome", value: undefined, depth: 0 },
      { uid: "uid_2", role: "link", name: "Home", value: undefined, depth: 1 },
      { uid: "uid_3", role: "textbox", name: "Search", value: "", depth: 1 },
    ])

    const snapshot = await runtime.snapshot("latest", false)

    expect(snapshot.pageID).toBe("page_1")
    expect(snapshot.elements).toHaveLength(3)
    expect(snapshot.elements[0]).toEqual({ uid: "uid_1", role: "heading", name: "Welcome", value: undefined })
    expect(snapshot.text).toContain("heading")
    expect(snapshot.text).toContain('"Welcome"')
    expect(snapshot.text).toContain("[uid_1]")
    expect(snapshot.text).toContain("[uid_2]")
    expect(snapshot.text).toContain("[uid_3]")
  })

  test("snapshot returns empty-page message when no elements", async () => {
    const page = createMockPage()
    const ctx = createMockContext()
    injectPage(runtime, "page_1", page, ctx)

    page.evaluate.mockResolvedValueOnce([])
    const snapshot = await runtime.snapshot("latest", false)
    expect(snapshot.elements).toHaveLength(0)
    expect(snapshot.text).toContain("empty page")
  })

  // -- action tests --

  test('action "click" resolves UID and clicks', async () => {
    const page = createMockPage()
    const ctx = createMockContext()
    injectPage(runtime, "page_1", page, ctx)

    const result = await runtime.action("latest", "click", { uid: "uid_1" })
    expect(result).toBe("Clicked element uid_1")
    expect(page.locator).toHaveBeenCalledWith('[data-uid="uid_1"]')
  })

  test('action "click" with dblClick uses dblclick', async () => {
    const page = createMockPage()
    const ctx = createMockContext()
    injectPage(runtime, "page_1", page, ctx)

    const result = await runtime.action("latest", "click", { uid: "uid_1", dblClick: true })
    expect(result).toBe("Clicked element uid_1")
    expect(page._locator.dblclick).toHaveBeenCalled()
  })

  test('action "fill" resolves UID and fills value', async () => {
    const page = createMockPage()
    const ctx = createMockContext()
    injectPage(runtime, "page_1", page, ctx)

    const result = await runtime.action("latest", "fill", { uid: "uid_2", value: "hello" })
    expect(result).toBe('Filled element uid_2 with "hello"')
    expect(page._locator.fill).toHaveBeenCalledWith("hello")
  })

  test('action "press" with uid uses locator.press', async () => {
    const page = createMockPage()
    const ctx = createMockContext()
    injectPage(runtime, "page_1", page, ctx)

    const result = await runtime.action("latest", "press", { key: "Enter", uid: "uid_1" })
    expect(result).toBe("Pressed Enter")
    expect(page._locator.press).toHaveBeenCalledWith("Enter")
  })

  test('action "press" without uid uses keyboard.press', async () => {
    const page = createMockPage()
    const ctx = createMockContext()
    injectPage(runtime, "page_1", page, ctx)

    const result = await runtime.action("latest", "press", { key: "Escape" })
    expect(result).toBe("Pressed Escape")
    expect(page.keyboard.press).toHaveBeenCalledWith("Escape")
  })

  test('action "hover" resolves UID and hovers', async () => {
    const page = createMockPage()
    const ctx = createMockContext()
    injectPage(runtime, "page_1", page, ctx)

    const result = await runtime.action("latest", "hover", { uid: "uid_3" })
    expect(result).toBe("Hovered over element uid_3")
  })

  test('action "scroll" scrolls page', async () => {
    const page = createMockPage()
    const ctx = createMockContext()
    injectPage(runtime, "page_1", page, ctx)

    const result = await runtime.action("latest", "scroll", { direction: "down", amount: 500 })
    expect(result).toBe("Scrolled down by 500px")
    expect(page.evaluate).toHaveBeenCalled()
  })

  test('action "select" resolves UID and selects value', async () => {
    const page = createMockPage()
    const ctx = createMockContext()
    injectPage(runtime, "page_1", page, ctx)

    const result = await runtime.action("latest", "select", { uid: "uid_4", value: "option2" })
    expect(result).toBe('Selected "option2" in element uid_4')
    expect(page._locator.selectOption).toHaveBeenCalledWith("option2")
  })

  test('action "navigate" goes back', async () => {
    const page = createMockPage()
    const ctx = createMockContext()
    injectPage(runtime, "page_1", page, ctx)

    const result = await runtime.action("latest", "navigate", { type: "back" })
    expect(result).toBe("Navigated back")
    expect(page.goBack).toHaveBeenCalled()
  })

  test('action "navigate" goes forward', async () => {
    const page = createMockPage()
    const ctx = createMockContext()
    injectPage(runtime, "page_1", page, ctx)

    const result = await runtime.action("latest", "navigate", { type: "forward" })
    expect(result).toBe("Navigated forward")
    expect(page.goForward).toHaveBeenCalled()
  })

  test('action "navigate" reloads', async () => {
    const page = createMockPage()
    const ctx = createMockContext()
    injectPage(runtime, "page_1", page, ctx)

    const result = await runtime.action("latest", "navigate", { type: "reload" })
    expect(result).toBe("Page reloaded")
    expect(page.reload).toHaveBeenCalled()
  })

  test('action "navigate" goes to URL', async () => {
    const page = createMockPage()
    const ctx = createMockContext()
    injectPage(runtime, "page_1", page, ctx)

    const result = await runtime.action("latest", "navigate", { url: "http://localhost:3000/about" })
    expect(result).toBe("Navigated to http://localhost:3000/about")
    expect(page.goto).toHaveBeenCalledWith("http://localhost:3000/about", {
      waitUntil: "domcontentloaded",
    })
  })

  test('action "waitFor" waits for text', async () => {
    const page = createMockPage()
    const ctx = createMockContext()
    injectPage(runtime, "page_1", page, ctx)

    const result = await runtime.action("latest", "waitFor", { text: "Hello", timeout: 5000 })
    expect(result).toBe('Waited for text "Hello"')
    expect(page.waitForSelector).toHaveBeenCalledWith("text=Hello", { timeout: 5000 })
  })

  test('action "drag" resolves from/to UIDs', async () => {
    const page = createMockPage()
    const ctx = createMockContext()
    injectPage(runtime, "page_1", page, ctx)

    const result = await runtime.action("latest", "drag", { fromUid: "uid_1", toUid: "uid_2" })
    expect(result).toBe("Dragged uid_1 to uid_2")
  })

  test('action "uploadFile" sets input files', async () => {
    const page = createMockPage()
    const ctx = createMockContext()
    injectPage(runtime, "page_1", page, ctx)

    const result = await runtime.action("latest", "uploadFile", {
      uid: "uid_5",
      filePaths: ["/tmp/test.txt", "/tmp/test2.txt"],
    })
    expect(result).toBe("Uploaded 2 file(s) to element uid_5")
    expect(page._locator.setInputFiles).toHaveBeenCalledWith(["/tmp/test.txt", "/tmp/test2.txt"])
  })

  test("action throws for unknown action type", async () => {
    const page = createMockPage()
    const ctx = createMockContext()
    injectPage(runtime, "page_1", page, ctx)

    await expect(runtime.action("latest", "explode", {})).rejects.toThrow(/Unknown browser action/)
  })

  test('action "click" without uid throws', async () => {
    const page = createMockPage()
    const ctx = createMockContext()
    injectPage(runtime, "page_1", page, ctx)

    await expect(runtime.action("latest", "click", {})).rejects.toThrow(/requires a uid/)
  })

  // -- screenshot tests --

  test("screenshot returns buffer and dimensions", async () => {
    const page = createMockPage()
    const ctx = createMockContext()
    injectPage(runtime, "page_1", page, ctx)

    const shot = await runtime.screenshot("latest", { fullPage: false, format: "png" })
    expect(shot.pageID).toBe("page_1")
    expect(shot.format).toBe("png")
    expect(shot.width).toBe(1440)
    expect(shot.height).toBe(900)
    expect(shot.data).toBeInstanceOf(Buffer)
    expect(page.screenshot).toHaveBeenCalledWith(expect.objectContaining({ fullPage: false, type: "png" }))
  })

  test("screenshot with UID captures element and returns element dimensions", async () => {
    const page = createMockPage()
    const ctx = createMockContext()
    injectPage(runtime, "page_1", page, ctx)

    const shot = await runtime.screenshot("latest", { uid: "uid_5", format: "png" })
    expect(shot.pageID).toBe("page_1")
    expect(page.locator).toHaveBeenCalledWith('[data-uid="uid_5"]')
    expect(page._locator.count).toHaveBeenCalled()
    expect(page._locator.boundingBox).toHaveBeenCalled()
    expect(page._locator.screenshot).toHaveBeenCalled()
    // Should return element bounding box dimensions, not viewport
    expect(shot.width).toBe(200)
    expect(shot.height).toBe(100)
  })

  test("screenshot with stale UID throws fast instead of timing out", async () => {
    const page = createMockPage()
    const ctx = createMockContext()
    injectPage(runtime, "page_1", page, ctx)

    // Simulate element not found (stale UID)
    page._locator.count.mockResolvedValueOnce(0)

    await expect(runtime.screenshot("latest", { uid: "uid_stale", format: "png" }))
      .rejects.toThrow(/not found on page/)
  })

  test("screenshot with jpeg format sets quality", async () => {
    const page = createMockPage()
    const ctx = createMockContext()
    injectPage(runtime, "page_1", page, ctx)

    await runtime.screenshot("latest", { format: "jpeg", quality: 60 })
    expect(page.screenshot).toHaveBeenCalledWith(expect.objectContaining({ type: "jpeg", quality: 60 }))
  })

  // -- console buffer tests --

  test("console returns buffered messages", async () => {
    const internals = getInternals(runtime)
    internals.consoleBuffers.set("page_1", [
      { type: "error", text: "TypeError: x is null", timestamp: 1000 },
      { type: "log", text: "hello", timestamp: 1001 },
      { type: "error", text: "RangeError", timestamp: 1002 },
    ])
    const page = createMockPage()
    const ctx = createMockContext()
    injectPage(runtime, "page_1", page, ctx)

    const all = await runtime.console("latest", {})
    expect(all).toHaveLength(3)

    const errors = await runtime.console("latest", { types: ["error"] })
    expect(errors).toHaveLength(2)
    expect(errors[0]!.text).toBe("TypeError: x is null")
  })

  test("console pagination works correctly", async () => {
    const internals = getInternals(runtime)
    const messages = Array.from({ length: 5 }, (_, i) => ({
      type: "log",
      text: `msg-${i}`,
      timestamp: 1000 + i,
    }))
    internals.consoleBuffers.set("page_1", messages)
    const page = createMockPage()
    const ctx = createMockContext()
    injectPage(runtime, "page_1", page, ctx)

    const page0 = await runtime.console("latest", { pageIdx: 0, pageSize: 2 })
    expect(page0).toHaveLength(2)
    expect(page0[0]!.text).toBe("msg-0")

    const page1 = await runtime.console("latest", { pageIdx: 1, pageSize: 2 })
    expect(page1).toHaveLength(2)
    expect(page1[0]!.text).toBe("msg-2")
  })

  // -- network buffer tests --

  test("network returns buffered requests with filtering", async () => {
    const internals = getInternals(runtime)
    internals.networkBuffers.set("page_1", [
      { url: "/api/data", method: "GET", status: 200, resourceType: "fetch", timestamp: 1000 },
      { url: "/missing", method: "GET", status: 404, resourceType: "document", timestamp: 1001 },
    ])
    const page = createMockPage()
    const ctx = createMockContext()
    injectPage(runtime, "page_1", page, ctx)

    const all = await runtime.network("latest", {})
    expect(all).toHaveLength(2)

    const fetches = await runtime.network("latest", { resourceTypes: ["fetch"] })
    expect(fetches).toHaveLength(1)
    expect(fetches[0]!.url).toBe("/api/data")
  })

  test("network pagination works correctly", async () => {
    const internals = getInternals(runtime)
    const requests = Array.from({ length: 7 }, (_, i) => ({
      url: `/api/${i}`,
      method: "GET",
      status: 200,
      resourceType: "fetch",
      timestamp: 1000 + i,
    }))
    internals.networkBuffers.set("page_1", requests)
    const page = createMockPage()
    const ctx = createMockContext()
    injectPage(runtime, "page_1", page, ctx)

    const page0 = await runtime.network("latest", { pageIdx: 0, pageSize: 3 })
    expect(page0).toHaveLength(3)

    const page2 = await runtime.network("latest", { pageIdx: 2, pageSize: 3 })
    expect(page2).toHaveLength(1)
    expect(page2[0]!.url).toBe("/api/6")
  })

  // -- evaluate tests --

  test("evaluate runs function in page context", async () => {
    const page = createMockPage()
    const ctx = createMockContext()
    injectPage(runtime, "page_1", page, ctx)

    page.evaluate.mockResolvedValueOnce("Test Page")
    const result = await runtime.evaluate("latest", "() => document.title")
    expect(result).toBe("Test Page")
    expect(page.evaluate).toHaveBeenCalled()
  })

  test("evaluate with uid arg uses locator.evaluate", async () => {
    const page = createMockPage()
    const ctx = createMockContext()
    injectPage(runtime, "page_1", page, ctx)

    page._locator.evaluate.mockResolvedValueOnce("element text")
    const result = await runtime.evaluate("latest", "(el) => el.innerText", [{ uid: "uid_1" }])
    expect(result).toBe("element text")
    expect(page.locator).toHaveBeenCalledWith('[data-uid="uid_1"]')
  })

  // -- close tests --

  test("close cleans up all state", async () => {
    const page = createMockPage()
    const ctx = createMockContext()
    const browser = createMockBrowser()
    injectPage(runtime, "page_1", page, ctx)
    getInternals(runtime).browser = browser

    await runtime.close()

    expect(ctx.close).toHaveBeenCalled()
    expect(browser.close).toHaveBeenCalled()
    expect(getInternals(runtime).pages.size).toBe(0)
    expect(getInternals(runtime).latestPageID).toBeUndefined()
    expect(getInternals(runtime).browser).toBeUndefined()

    // Subsequent actions should fail
    await expect(runtime.snapshot("latest", false)).rejects.toThrow(/No browser page/)
  })

  test("close is safe when no browser is open", async () => {
    await expect(runtime.close()).resolves.toBeUndefined()
  })

  // -- closePage tests --

  test("closePage removes page and cleans up state", async () => {
    const page = createMockPage()
    const ctx = createMockContext()
    injectPage(runtime, "page_1", page, ctx)
    getInternals(runtime).uidRegistry.set("uid_1", { pageID: "page_1", uid: "uid_1" })
    getInternals(runtime).uidRegistry.set("uid_2", { pageID: "page_1", uid: "uid_2" })
    getInternals(runtime).consoleBuffers.set("page_1", [{ type: "log", text: "hello", timestamp: 1 }])

    await runtime.closePage("page_1")

    expect(ctx.close).toHaveBeenCalled()
    expect(getInternals(runtime).pages.size).toBe(0)
    expect(getInternals(runtime).latestPageID).toBeUndefined()
    expect(getInternals(runtime).uidRegistry.size).toBe(0)
    expect(getInternals(runtime).consoleBuffers.has("page_1")).toBe(false)
  })

  test("closePage is no-op for unknown pageID", async () => {
    await expect(runtime.closePage("nonexistent")).resolves.toBeUndefined()
  })

  test("closePage updates latestPageID to remaining page", async () => {
    const page1 = createMockPage()
    const page2 = createMockPage()
    const ctx1 = createMockContext()
    const ctx2 = createMockContext()
    injectPage(runtime, "page_1", page1, ctx1)
    injectPage(runtime, "page_2", page2, ctx2)

    await runtime.closePage("page_2")

    expect(getInternals(runtime).latestPageID).toBe("page_1")
    expect(getInternals(runtime).pages.size).toBe(1)
  })

  // -- UID clearing on snapshot --

  test("snapshot clears stale UIDs before re-populating", async () => {
    const page = createMockPage()
    const ctx = createMockContext()
    injectPage(runtime, "page_1", page, ctx)

    // Pre-populate with stale UIDs
    getInternals(runtime).uidRegistry.set("uid_99", { pageID: "page_1", uid: "uid_99" })

    page.evaluate.mockResolvedValueOnce([
      { uid: "uid_1", role: "button", name: "Click", value: undefined, depth: 0 },
    ])

    await runtime.snapshot("latest", false)

    // Stale UID should be gone, new UID should exist
    expect(getInternals(runtime).uidRegistry.has("uid_99")).toBe(false)
    expect(getInternals(runtime).uidRegistry.has("uid_1")).toBe(true)
  })

  // -- UID escaping --

  test('action "click" escapes special characters in UID', async () => {
    const page = createMockPage()
    const ctx = createMockContext()
    injectPage(runtime, "page_1", page, ctx)

    await runtime.action("latest", "click", { uid: 'uid_1"; malicious' })
    expect(page.locator).toHaveBeenCalledWith('[data-uid="uid_1\\"; malicious"]')
  })

  // -- evaluate no-args passes string directly --

  test("evaluate without args passes string directly to page.evaluate", async () => {
    const page = createMockPage()
    const ctx = createMockContext()
    injectPage(runtime, "page_1", page, ctx)

    page.evaluate.mockResolvedValueOnce("result")
    const result = await runtime.evaluate("latest", "() => document.title")
    expect(result).toBe("result")
    // Should pass the string directly, not a parsed function
    expect(page.evaluate).toHaveBeenCalledWith("() => document.title")
  })
})
