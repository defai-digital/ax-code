import { beforeEach, describe, expect, test } from "vitest"

import { useUIStore } from "./useUIStore"

describe("useUIStore canvas context panel", () => {
  beforeEach(() => {
    useUIStore.setState({ contextPanelByDirectory: {} })
  })

  test("opens a deduped canvas tab for a directory", () => {
    const directory = "/workspace/project"

    useUIStore.getState().openContextCanvas(directory)
    useUIStore.getState().openContextCanvas(directory)

    const panel = useUIStore.getState().contextPanelByDirectory[directory]
    expect(panel?.isOpen).toBe(true)
    expect(panel?.activeTabId).toBe("canvas")
    expect(panel?.tabs).toHaveLength(1)
    expect(panel?.tabs[0]).toMatchObject({
      id: "canvas",
      mode: "canvas",
      dedupeKey: "canvas",
      label: "Canvas",
    })
  })

  test("normalizes Windows directory variants before storing context panel state", () => {
    useUIStore.getState().openContextCanvas("c:\\Repo\\")
    useUIStore.getState().openContextCanvas("C:/Repo")

    expect(Object.keys(useUIStore.getState().contextPanelByDirectory)).toEqual(["C:/Repo"])
    expect(useUIStore.getState().contextPanelByDirectory["C:/Repo"]?.tabs).toHaveLength(1)
  })
})
