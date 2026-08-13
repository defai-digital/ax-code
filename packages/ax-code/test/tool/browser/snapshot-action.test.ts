import { afterEach, describe, expect, test } from "vitest"
import { BrowserActionTool } from "../../../src/tool/browser/action"
import { BrowserSnapshotTool } from "../../../src/tool/browser/snapshot"
import { BrowserRuntime } from "../../../src/tool/browser/runtime"
import { MessageID, SessionID } from "../../../src/session/schema"
import type { Tool } from "../../../src/tool/tool"

function createMockLocator() {
  return {
    click: async () => undefined,
    dblclick: async () => undefined,
    fill: async () => undefined,
    press: async () => undefined,
    hover: async () => undefined,
    selectOption: async () => undefined,
    setInputFiles: async () => undefined,
    screenshot: async () => Buffer.from("element-png-data"),
    evaluate: async () => undefined,
    dragTo: async () => undefined,
    count: async () => 1,
    boundingBox: async () => ({ x: 0, y: 0, width: 200, height: 100 }),
  }
}

function createMockPage() {
  const locator = createMockLocator()
  return {
    locator: () => locator,
    goto: async () => undefined,
    title: async () => "Test Page",
    viewportSize: () => ({ width: 1440, height: 900 }),
    evaluate: async () => [{ uid: "uid_1", role: "button", name: "Go", depth: 0 }],
    screenshot: async () => Buffer.from("png-data"),
    keyboard: { press: async () => undefined },
    on: () => undefined,
    waitForSelector: async () => undefined,
    waitForLoadState: async () => undefined,
    goBack: async () => undefined,
    goForward: async () => undefined,
    reload: async () => undefined,
  }
}

function inject(runtime: BrowserRuntime, pageID: string, page: ReturnType<typeof createMockPage>) {
  const internals = runtime as unknown as {
    pages: Map<string, unknown>
    latestPageID: string | undefined
  }
  internals.pages.set(pageID, {
    pageID,
    pwPage: page,
    context: { close: async () => undefined },
    url: "http://localhost:3000",
    title: "Test Page",
    viewport: { width: 1440, height: 900 },
  })
  internals.latestPageID = pageID
}

function ctx(sessionID: string): Tool.Context {
  return {
    sessionID: SessionID.make(sessionID),
    messageID: MessageID.make("msg_browser_snap"),
    agent: "build",
    abort: new AbortController().signal,
    messages: [],
    metadata() {},
    ask: async () => {},
  }
}

afterEach(() => {
  BrowserRuntime._reset()
})

describe("shipped browser snapshot/action tools", () => {
  test("session A cannot act on session B snapshot; consumed id fails closed", async () => {
    const a = BrowserRuntime.forSession("ses_tool_a")
    const b = BrowserRuntime.forSession("ses_tool_b")
    inject(a, "page_a", createMockPage())
    inject(b, "page_b", createMockPage())

    const snapA = await (await BrowserSnapshotTool.init()).execute({ verbose: false }, ctx("ses_tool_a"))
    const snapshotID = snapA.metadata.snapshotID as string
    expect(snapshotID).toBeTruthy()

    await expect(
      (await BrowserActionTool.init()).execute({ action: "click", snapshotID, uid: "uid_1" }, ctx("ses_tool_b")),
    ).rejects.toThrow(/BROWSER_STALE_SNAPSHOT/)

    const first = await (await BrowserActionTool.init()).execute(
      { action: "click", snapshotID, uid: "uid_1" },
      ctx("ses_tool_a"),
    )
    expect(first.metadata.consumedSnapshotID).toBe(snapshotID)

    await expect(
      (await BrowserActionTool.init()).execute({ action: "click", snapshotID, uid: "uid_1" }, ctx("ses_tool_a")),
    ).rejects.toThrow(/BROWSER_STALE_SNAPSHOT/)
  })
})
