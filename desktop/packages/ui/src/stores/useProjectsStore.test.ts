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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ skipped: true })),
    )
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

  test("keeps state unchanged when settings projects are unchanged", () => {
    const projects = [
      {
        id: "project-1",
        path: "/Users/Alice/Repo",
        label: "Repo",
        color: "blue",
      },
    ]

    useProjectsStore.getState().synchronizeFromSettings({
      projects,
      activeProjectId: "project-1",
    })
    const firstState = useProjectsStore.getState()

    useProjectsStore.getState().synchronizeFromSettings({
      projects: [...projects],
      activeProjectId: "project-1",
    })

    expect(useProjectsStore.getState()).toBe(firstState)
  })

  test("normalizes project icon backgrounds from settings", () => {
    useProjectsStore.getState().synchronizeFromSettings({
      projects: [
        {
          id: "project-1",
          path: "/Users/Alice/Repo",
          label: "Repo",
          iconBackground: " #AABBCC ",
        },
        {
          id: "project-2",
          path: "/Users/Alice/Other",
          label: "Other",
          iconBackground: "blue",
        },
      ],
      activeProjectId: "project-1",
    })

    expect(useProjectsStore.getState().projects).toEqual([
      expect.objectContaining({ path: "/Users/Alice/Repo", iconBackground: "#aabbcc" }),
      expect.not.objectContaining({ iconBackground: expect.anything() }),
    ])
  })

  test("pins a project and moves it to the front", () => {
    useProjectsStore.getState().addProject("/Users/Alice/One")
    useProjectsStore.getState().addProject("/Users/Alice/Two")
    useProjectsStore.getState().addProject("/Users/Alice/Three")

    const projects = useProjectsStore.getState().projects
    expect(projects).toHaveLength(3)
    const middle = projects[1]
    useProjectsStore.getState().setProjectPinned(middle.id, true)

    const next = useProjectsStore.getState().projects
    expect(next[0]?.id).toBe(middle.id)
    expect(next[0]?.pinned).toBe(true)
  })

  test("addProjects imports many roots without duplicates", () => {
    useProjectsStore.getState().addProject("/Users/Alice/Existing")
    const added = useProjectsStore.getState().addProjects(
      ["/Users/Alice/Existing", "/Users/Alice/NewA", "/Users/Alice/NewB"],
      { labels: { "/Users/Alice/NewA": "Alpha" }, activateFirst: false },
    )

    expect(added).toHaveLength(2)
    expect(added[0]?.label).toBe("Alpha")
    expect(useProjectsStore.getState().projects).toHaveLength(3)
  })

  test("preserves pinned flag from settings", () => {
    useProjectsStore.getState().synchronizeFromSettings({
      projects: [
        {
          id: "project-1",
          path: "/Users/Alice/Repo",
          label: "Repo",
          pinned: true,
          lastOpenedAt: 42,
        },
      ],
      activeProjectId: "project-1",
    })

    expect(useProjectsStore.getState().projects[0]).toEqual(
      expect.objectContaining({ path: "/Users/Alice/Repo", pinned: true, lastOpenedAt: 42 }),
    )
  })
})
