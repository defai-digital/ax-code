import { beforeEach, describe, expect, test } from "vitest"

import { isContextPanelMode, useUIStore } from "./useUIStore"

const legacyCanvasPanel = {
  isOpen: true,
  expanded: false,
  tabs: [
    {
      id: "canvas",
      mode: "canvas",
      targetPath: null,
      dedupeKey: "canvas",
      label: "Canvas",
      readOnly: false,
      stagedDiff: false,
      touchedAt: 1,
    },
  ],
  activeTabId: "canvas",
  width: 380,
  touchedAt: 1,
}

describe("useUIStore context panel", () => {
  beforeEach(() => {
    useUIStore.setState({ contextPanelByDirectory: {} })
  })

  test("opens a deduped dashboard tab for a directory", () => {
    const directory = "/workspace/project"

    useUIStore.getState().openContextDashboard(directory)
    useUIStore.getState().openContextDashboard(directory)

    const panel = useUIStore.getState().contextPanelByDirectory[directory]
    expect(panel?.isOpen).toBe(true)
    expect(panel?.activeTabId).toBe("dashboard")
    expect(panel?.tabs).toHaveLength(1)
    expect(panel?.tabs[0]).toMatchObject({
      id: "dashboard",
      mode: "dashboard",
      dedupeKey: "dashboard",
      label: "Dashboard",
    })
  })

  test("does not treat legacy canvas tabs as a valid context panel mode", () => {
    expect(isContextPanelMode("canvas")).toBe(false)
    expect(isContextPanelMode("context")).toBe(true)
    expect(isContextPanelMode("dashboard")).toBe(true)
  })

  test("drops legacy canvas tabs before opening another context panel tab", () => {
    const directory = "/workspace/project"
    useUIStore.setState({
      contextPanelByDirectory: {
        [directory]: legacyCanvasPanel as never,
      },
    })

    useUIStore.getState().openContextDashboard(directory)

    const panel = useUIStore.getState().contextPanelByDirectory[directory]
    expect(panel?.isOpen).toBe(true)
    expect(panel?.activeTabId).toBe("dashboard")
    expect(panel?.tabs.map((tab) => tab.mode)).toEqual(["dashboard"])
  })

  test("migration removes legacy canvas-only panel state", async () => {
    const migrate = useUIStore.persist.getOptions().migrate
    expect(migrate).toBeTypeOf("function")

    const migrated = (await migrate?.(
      {
        contextPanelByDirectory: {
          "/workspace/project": legacyCanvasPanel,
        },
      },
      9,
    )) as { contextPanelByDirectory?: Record<string, unknown> }

    expect(migrated.contextPanelByDirectory).toEqual({})
  })

  test("migration clears browser navigation from a previous Desktop session", async () => {
    const migrate = useUIStore.persist.getOptions().migrate

    const migrated = (await migrate?.(
      {
        browserPanel: { isOpen: true, url: "https://example.com/private", focused: true },
        contextPanelByDirectory: {},
      },
      11,
    )) as { browserPanel?: unknown }

    expect(migrated.browserPanel).toEqual({ isOpen: false, url: "", focused: false })
  })

  test("does not persist browser navigation between Desktop sessions", () => {
    const partialize = useUIStore.persist.getOptions().partialize
    expect(partialize).toBeTypeOf("function")

    useUIStore.setState({ browserPanel: { isOpen: true, url: "https://example.com/private", focused: true } })

    expect(partialize?.(useUIStore.getState())).not.toHaveProperty("browserPanel")
  })
})
