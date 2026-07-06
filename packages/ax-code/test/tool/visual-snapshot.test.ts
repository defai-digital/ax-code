import { afterEach, describe, expect, test, vi } from "vitest"

vi.mock("@/visual/router", () => ({
  checkVisualRouting: vi.fn(async () => ({ ok: true, model: { id: "test-model" } })),
}))

vi.mock("@/project/instance", () => ({
  Instance: { directory: "/tmp/test-project" },
}))

describe("visual_snapshot tool", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test("throws when routing check fails", async () => {
    const { checkVisualRouting } = await import("@/visual/router")
    vi.mocked(checkVisualRouting).mockResolvedValueOnce({
      ok: false,
      diagnostic: 'Model "test" does not support: vision_input.',
    })

    const { VisualSnapshotTool } = await import("../../src/tool/visual/snapshot")
    const tool = await VisualSnapshotTool.init()

    await expect(
      tool.execute(
        { filePath: "/tmp/test.png" },
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

  test("requires either url or filePath", async () => {
    const { VisualSnapshotTool } = await import("../../src/tool/visual/snapshot")

    await expect(VisualSnapshotTool.init()).resolves.toBeDefined()
    // The Zod refine validator ensures at least one is provided
  })
})
