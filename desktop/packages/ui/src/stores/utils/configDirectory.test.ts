import { beforeEach, describe, expect, test, vi } from "vitest"

let activeProjectPath: string | null = null
let clientDirectory: string | null = null

vi.doMock("@/stores/useProjectsStore", () => ({
  useProjectsStore: {
    getState: () => ({
      getActiveProject: () => (activeProjectPath === null ? null : { path: activeProjectPath }),
    }),
  },
}))

vi.doMock("@/lib/ax-code/client", () => ({
  axCodeClient: {
    getDirectory: () => clientDirectory,
  },
}))

const { getActiveConfigDirectory } = await import("./configDirectory")

describe("getActiveConfigDirectory", () => {
  beforeEach(() => {
    activeProjectPath = null
    clientDirectory = null
  })

  test("returns the trimmed active project path first", () => {
    activeProjectPath = " /workspace/project "
    clientDirectory = "/fallback"

    expect(getActiveConfigDirectory("TestStore")).toBe("/workspace/project")
  })

  test("falls back to the ax-code client directory", () => {
    activeProjectPath = "  "
    clientDirectory = " /fallback/project "

    expect(getActiveConfigDirectory("TestStore")).toBe("/fallback/project")
  })

  test("returns null when neither source has a directory", () => {
    activeProjectPath = " "
    clientDirectory = " "

    expect(getActiveConfigDirectory("TestStore")).toBeNull()
  })
})
