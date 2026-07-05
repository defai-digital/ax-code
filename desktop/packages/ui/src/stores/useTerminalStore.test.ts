import { beforeEach, describe, expect, test } from "vitest"

import { useTerminalStore } from "./useTerminalStore"

describe("useTerminalStore", () => {
  beforeEach(() => {
    useTerminalStore.setState({
      sessions: new Map(),
      projectActionRuns: {},
      nextChunkId: 1,
      nextTabId: 1,
      hasHydrated: true,
    })
  })

  test("normalizes Windows directory variants to the same terminal state", () => {
    useTerminalStore.getState().ensureDirectory("c:\\Repo\\")

    const firstState = useTerminalStore.getState().getDirectoryState("C:/Repo")
    expect(firstState?.tabs).toHaveLength(1)

    const secondTabId = useTerminalStore.getState().createTab("C:/Repo/")
    const normalizedState = useTerminalStore.getState().getDirectoryState("c:/Repo")

    expect(useTerminalStore.getState().sessions).toHaveLength(1)
    expect(normalizedState?.tabs.map((tab) => tab.id)).toEqual(["tab-1", secondTabId])
  })
})
