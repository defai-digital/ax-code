import { afterEach, describe, expect, test, vi } from "vitest"

vi.mock("@/visual/router", () => ({
  checkVisualRouting: vi.fn(async () => ({ ok: true, model: { id: "test-model" } })),
}))

vi.mock("@/project/instance", () => ({
  Instance: { directory: "/tmp/test-project" },
}))

describe("visual_critique tool", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test("throws when routing check fails", async () => {
    const { checkVisualRouting } = await import("@/visual/router")
    vi.mocked(checkVisualRouting).mockResolvedValueOnce({
      ok: false,
      diagnostic: 'Model "test" does not support: vision_input.',
    })

    const { VisualCritiqueTool } = await import("../../src/tool/visual/critique")
    const tool = await VisualCritiqueTool.init()

    await expect(
      tool.execute(
        { runID: "run_1" },
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
    ).rejects.toThrow(/vision_input/)
  })

  test("throws when no artifacts found for run", async () => {
    const { VisualCritiqueTool } = await import("../../src/tool/visual/critique")
    const tool = await VisualCritiqueTool.init()

    await expect(
      tool.execute(
        { runID: "nonexistent_run" },
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
    ).rejects.toThrow(/No artifacts found/)
  })
})
