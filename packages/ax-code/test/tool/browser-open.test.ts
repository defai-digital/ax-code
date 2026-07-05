import { afterEach, describe, expect, test, vi } from "vitest"
import { BrowserOpenTool } from "../../src/tool/browser/open"
import { BrowserRuntime } from "../../src/tool/browser/runtime"

describe("browser_open tool", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test("asks for origin-scoped durable permission", async () => {
    vi.spyOn(BrowserRuntime, "get").mockReturnValue({
      open: vi.fn(async (url: string, viewport: { width: number; height: number }) => ({
        pageID: "page-1",
        url,
        title: "Example",
        viewport,
      })),
    } as unknown as BrowserRuntime)
    const ask = vi.fn(async () => {})

    const tool = await BrowserOpenTool.init()
    await tool.execute(
      {
        url: "https://example.com:8443/app/index.html",
        viewport: { width: 1024, height: 768 },
      },
      {
        sessionID: "ses_test" as never,
        messageID: "msg_test" as never,
        agent: "test",
        abort: new AbortController().signal,
        messages: [],
        metadata: vi.fn(),
        ask,
      },
    )

    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({
        permission: "browser_open",
        patterns: ["https://example.com:8443/app/index.html"],
        always: ["https://example.com:8443", "https://example.com:8443/*"],
      }),
    )
  })
})
