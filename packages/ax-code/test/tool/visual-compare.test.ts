import { afterEach, describe, expect, test, vi } from "vitest"

vi.mock("@/project/instance", () => ({
  Instance: { directory: "/tmp/test-project" },
}))

describe("visual_compare tool", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test("throws when visual run not found", async () => {
    const { VisualCompareTool } = await import("../../src/tool/visual/compare")
    const tool = await VisualCompareTool.init()

    await expect(
      tool.execute(
        { beforeRunID: "missing_run", afterRunID: "also_missing" },
        {
          sessionID: "ses_test" as never,
          messageID: "msg_test" as never,
          agent: "test",
          abort: new AbortController().signal,
          messages: [],
          metadata: vi.fn(),
          ask: vi.fn(),
        },
      ),
    ).rejects.toThrow(/not found/)
  })
})
