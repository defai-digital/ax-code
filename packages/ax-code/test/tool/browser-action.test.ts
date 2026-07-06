import { describe, expect, test } from "vitest"
import { BrowserActionTool } from "../../src/tool/browser/action"

describe("browser_action tool", () => {
  test("navigate with file:// URL is rejected", async () => {
    const tool = await BrowserActionTool.init()
    await expect(
      tool.execute(
        { action: "navigate", url: "file:///etc/passwd" },
        {
          sessionID: "ses_test" as never,
          messageID: "msg_test" as never,
          agent: "test",
          abort: new AbortController().signal,
          messages: [],
          metadata: () => {},
          ask: async () => {},
        },
      ),
    ).rejects.toThrow()
  })
})
