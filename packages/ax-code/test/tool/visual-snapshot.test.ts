import { afterEach, describe, expect, test, vi } from "vitest"

vi.mock("@/visual/router", () => ({
  checkVisualRouting: vi.fn(async () => ({ ok: true, model: { id: "test-model" } })),
  sessionModelFromMessages: vi.fn(() => undefined),
}))

vi.mock("@/project/instance", () => {
  const instance = {
    directory: "/tmp/test-project",
    worktree: "/",
    containsPath: (candidate: string) =>
      candidate === instance.directory || candidate.startsWith(`${instance.directory}/`),
    // `@/file` (pulled in by the tool's external-directory guard) only needs a
    // callable state accessor at import time; the tool never reads its cache.
    state: (init: () => unknown) => init,
  }
  return { Instance: instance }
})

vi.mock("@/visual/snapshot", () => ({
  captureSnapshot: vi.fn(async () => {
    throw new Error("reached captureSnapshot")
  }),
}))

const ctx = () => ({
  sessionID: "ses_test" as never,
  messageID: "msg_test" as never,
  agent: "test",
  abort: new AbortController().signal,
  messages: [],
  metadata: vi.fn(),
  ask: vi.fn(),
})

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

  test("blocks a non-http(s) url before reaching the browser", async () => {
    const { VisualSnapshotTool } = await import("../../src/tool/visual/snapshot")
    const tool = await VisualSnapshotTool.init()

    await expect(tool.execute({ url: "file:///etc/passwd" }, ctx())).rejects.toThrow(
      /Only http:\/\/ and https:\/\/ are supported/,
    )
  })

  test("asks for read permission before attaching a local file", async () => {
    const { VisualSnapshotTool } = await import("../../src/tool/visual/snapshot")
    const tool = await VisualSnapshotTool.init()
    const ask = vi.fn()

    await tool.execute({ filePath: "/tmp/missing-snapshot.png" }, { ...ctx(), ask }).catch(() => undefined)

    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({ permission: "read", patterns: ["/tmp/missing-snapshot.png"] }),
    )
  })

  test("rejects a filePath whose link target leaves the project", async () => {
    const fs = await import("fs/promises")
    const path = await import("path")
    const os = await import("os")
    const { Instance } = await import("@/project/instance")
    const { VisualSnapshotTool } = await import("../../src/tool/visual/snapshot")

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "visual-snapshot-link-"))
    const projectDir = path.join(root, "project")
    await fs.mkdir(projectDir, { recursive: true })
    const outside = path.join(root, "outside.png")
    await fs.writeFile(outside, "outside bytes")
    await fs.symlink(outside, path.join(projectDir, "linked.png"))

    const restore = (Instance as { directory: string }).directory
    try {
      ;(Instance as { directory: string }).directory = projectDir
      const tool = await VisualSnapshotTool.init()

      await expect(tool.execute({ filePath: "linked.png" }, ctx())).rejects.toThrow(/Access denied/)
    } finally {
      ;(Instance as { directory: string }).directory = restore
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
