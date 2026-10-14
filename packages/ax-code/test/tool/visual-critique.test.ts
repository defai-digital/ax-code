import { afterEach, describe, expect, test, vi } from "vitest"

vi.mock("@/visual/router", () => ({
  checkVisualRouting: vi.fn(async () => ({ ok: true, model: { id: "test-model" } })),
  sessionModelFromMessages: vi.fn(() => undefined),
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

  test("ignores a summary artifact path outside the run directory", async () => {
    const fs = await import("fs/promises")
    const path = await import("path")
    const os = await import("os")
    const { VisualArtifactStore } = await import("../../src/visual/artifact")
    const { Instance } = await import("@/project/instance")

    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "visual-critique-test-"))
    const restore = (Instance as { directory: string }).directory
    try {
      ;(Instance as { directory: string }).directory = projectDir
      const runDir = VisualArtifactStore.runDir(projectDir, "run_escape")
      await fs.mkdir(runDir, { recursive: true })
      const secret = path.join(projectDir, "secret.txt")
      await fs.writeFile(secret, "do not attach")
      await fs.writeFile(
        path.join(runDir, "visual-run.json"),
        JSON.stringify({ artifacts: [{ kind: "screenshot", path: secret, label: "x" }] }),
      )

      const { VisualCritiqueTool } = await import("../../src/tool/visual/critique")
      const tool = await VisualCritiqueTool.init()
      await expect(
        tool.execute(
          { runID: "run_escape" },
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
      ).rejects.toThrow(/No screenshots found/)
    } finally {
      ;(Instance as { directory: string }).directory = restore
      await fs.rm(projectDir, { recursive: true, force: true })
    }
  })
})
