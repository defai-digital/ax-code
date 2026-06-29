import { beforeEach, describe, expect, test } from "vitest"
import { useFilesViewTabsStore } from "./useFilesViewTabsStore"

describe("useFilesViewTabsStore Windows paths", () => {
  beforeEach(() => {
    useFilesViewTabsStore.setState({ byRoot: {} })
  })

  test("removes open paths by prefix case-insensitively for Windows drive paths", () => {
    const root = "C:/Repo"
    const store = useFilesViewTabsStore.getState()

    store.addOpenPath(root, "C:/Repo/src/a.ts")
    store.addOpenPath(root, "C:/Repo/other.ts")
    store.setSelectedPath(root, "C:/Repo/src/a.ts")
    store.removeOpenPathsByPrefix(root, "c:/repo/src")

    const rootState = useFilesViewTabsStore.getState().byRoot[root]
    expect(rootState?.openPaths).toEqual(["C:/Repo/other.ts"])
    expect(rootState?.selectedPath).toBe("C:/Repo/other.ts")
  })

  test("removes a single open path case-insensitively for Windows drive paths", () => {
    const root = "C:/Repo"
    const store = useFilesViewTabsStore.getState()

    store.addOpenPath(root, "C:/Repo/src/a.ts")
    store.addOpenPath(root, "C:/Repo/other.ts")
    store.setSelectedPath(root, "C:/Repo/src/a.ts")
    store.removeOpenPath(root, "c:/repo/src/a.ts")

    const rootState = useFilesViewTabsStore.getState().byRoot[root]
    expect(rootState?.openPaths).toEqual(["C:/Repo/other.ts"])
    expect(rootState?.selectedPath).toBe("C:/Repo/other.ts")
  })

  test("allows open paths under a Windows drive root", () => {
    const root = "C:/"
    const store = useFilesViewTabsStore.getState()

    store.addOpenPath(root, "C:/Users/Alice/Project/src/app.ts")
    store.setSelectedPath(root, "C:/Users/Alice/Project/src/app.ts")
    store.expandPath(root, "C:/Users/Alice/Project/src")

    const rootState = useFilesViewTabsStore.getState().byRoot[root]
    expect(rootState?.openPaths).toEqual(["C:/Users/Alice/Project/src/app.ts"])
    expect(rootState?.selectedPath).toBe("C:/Users/Alice/Project/src/app.ts")
    expect(rootState?.expandedPaths).toEqual(["C:/Users/Alice/Project/src"])
  })
})
