import { beforeEach, describe, expect, test, vi } from "vitest"

vi.doMock("@/lib/ax-code/client", () => ({
  axCodeClient: {
    getDirectory: vi.fn(() => "/workspace/current"),
    getFilesystemHome: vi.fn(async () => "/Users/Alice"),
    getSystemInfo: vi.fn(async () => ({ homeDir: "/Users/Alice" })),
    setDirectory: vi.fn(),
  },
}))

vi.doMock("@/lib/persistence", () => ({
  updateDesktopSettings: vi.fn(),
}))

vi.doMock("@/stores/utils/streamDebug", () => ({
  streamDebugEnabled: vi.fn(() => false),
}))

const { useProjectsStore } = await import("./useProjectsStore")

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })

describe("useProjectsStore path identity", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ skipped: true })))
    useProjectsStore.setState({ projects: [], activeProjectId: null })
  })

  test("does not add duplicate Windows drive projects that differ only by case", () => {
    const first = useProjectsStore.getState().addProject("C:\\Users\\Alice\\Repo")
    const second = useProjectsStore.getState().addProject("c:/users/alice/repo/")

    expect(first).not.toBeNull()
    expect(second?.id).toBe(first?.id)
    expect(useProjectsStore.getState().projects).toHaveLength(1)
  })

  test("allows POSIX projects that differ by case", () => {
    const first = useProjectsStore.getState().addProject("/Users/Alice/Repo")
    const second = useProjectsStore.getState().addProject("/users/alice/repo")

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(second?.id).not.toBe(first?.id)
    expect(useProjectsStore.getState().projects).toHaveLength(2)
  })
})
