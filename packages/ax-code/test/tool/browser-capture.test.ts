import { afterEach, describe, expect, test, vi } from "vitest"
import { BrowserCaptureTool } from "../../src/tool/browser/capture"
import { BrowserRuntime } from "../../src/tool/browser/runtime"

describe("browser_capture tool", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test("returns screenshots as file attachments with data URLs", async () => {
    vi.spyOn(BrowserRuntime, "get").mockReturnValue({
      screenshot: vi.fn(async () => ({
        pageID: "page-1",
        data: Buffer.from("png-data"),
        format: "png" as const,
        width: 800,
        height: 600,
      })),
    } as unknown as BrowserRuntime)

    const tool = await BrowserCaptureTool.init()
    const result = await tool.execute(
      { fullPage: false, format: "png" },
      {
        sessionID: "ses_test" as never,
        messageID: "msg_test" as never,
        agent: "test",
        abort: new AbortController().signal,
        messages: [],
        metadata: vi.fn(),
        ask: vi.fn(),
      },
    )

    expect(result.attachments).toEqual([
      {
        type: "file",
        filename: "screenshot.png",
        mime: "image/png",
        url: `data:image/png;base64,${Buffer.from("png-data").toString("base64")}`,
      },
    ])
  })
})
