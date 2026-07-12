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

  test("does not rehydrate ephemeral terminal session ids from storage", () => {
    const persistApi = (
      useTerminalStore as unknown as {
        persist: {
          getOptions: () => {
            merge?: (persisted: unknown, current: unknown) => unknown
            partialize?: (state: unknown) => unknown
          }
        }
      }
    ).persist

    const options = persistApi.getOptions()
    const current = useTerminalStore.getState()
    const merged = options.merge?.(
      {
        sessions: [
          [
            "/repo",
            {
              activeTabId: "tab-1",
              tabs: [
                {
                  id: "tab-1",
                  label: "Terminal",
                  iconKey: null,
                  terminalSessionId: "stale-session-from-last-boot",
                  lifecycle: "running",
                  createdAt: 1,
                },
              ],
            },
          ],
        ],
        nextTabId: 2,
      },
      current,
    ) as typeof current

    const tab = merged.sessions.get("/repo")?.tabs[0]
    expect(tab?.terminalSessionId).toBeNull()
    expect(tab?.lifecycle).toBe("idle")

    // partialize must also avoid writing session ids back out
    useTerminalStore.setState({
      sessions: new Map([
        [
          "/repo",
          {
            activeTabId: "tab-1",
            tabs: [
              {
                id: "tab-1",
                label: "Terminal",
                iconKey: null,
                terminalSessionId: "live-session",
                lifecycle: "running",
                createdAt: 1,
                bufferChunks: [],
                bufferLength: 0,
                isConnecting: false,
                previewUrl: null,
                previewAutoOpened: false,
                previewUrlLocked: false,
              },
            ],
          },
        ],
      ]),
    })
    const partial = options.partialize?.(useTerminalStore.getState()) as {
      sessions: Array<[string, { tabs: Array<{ terminalSessionId?: string | null; lifecycle: string }> }]>
    }
    expect(partial.sessions[0][1].tabs[0]).not.toHaveProperty("terminalSessionId")
    expect(partial.sessions[0][1].tabs[0].lifecycle).toBe("idle")
  })
})