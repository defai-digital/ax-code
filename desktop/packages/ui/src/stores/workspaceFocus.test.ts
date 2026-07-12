import { beforeEach, describe, expect, test } from "vitest"
import { useUIStore } from "./useUIStore"

describe("workspace focus (Ma layout)", () => {
  beforeEach(() => {
    useUIStore.setState({
      isMobile: false,
      isWorkspaceFocus: false,
      workspaceFocusSnapshot: null,
      isSidebarOpen: true,
      isRightSidebarOpen: true,
      isBottomTerminalOpen: true,
      splitPaneEnabled: true,
      isExpandedInput: false,
      activeMainTab: "git",
    })
  })

  test("enter collapses chrome, switches to chat, and snapshots prior state", () => {
    useUIStore.getState().enterWorkspaceFocus()
    const state = useUIStore.getState()

    expect(state.isWorkspaceFocus).toBe(true)
    expect(state.isSidebarOpen).toBe(false)
    expect(state.isRightSidebarOpen).toBe(false)
    expect(state.isBottomTerminalOpen).toBe(false)
    expect(state.splitPaneEnabled).toBe(false)
    expect(state.isExpandedInput).toBe(true)
    expect(state.activeMainTab).toBe("chat")
    expect(state.workspaceFocusSnapshot).toEqual({
      isSidebarOpen: true,
      isRightSidebarOpen: true,
      isBottomTerminalOpen: true,
      splitPaneEnabled: true,
      isExpandedInput: false,
      activeMainTab: "git",
    })
  })

  test("exit restores snapshot", () => {
    useUIStore.getState().enterWorkspaceFocus()
    useUIStore.getState().exitWorkspaceFocus({ restore: true })
    const state = useUIStore.getState()

    expect(state.isWorkspaceFocus).toBe(false)
    expect(state.workspaceFocusSnapshot).toBeNull()
    expect(state.isSidebarOpen).toBe(true)
    expect(state.isRightSidebarOpen).toBe(true)
    expect(state.isBottomTerminalOpen).toBe(true)
    expect(state.splitPaneEnabled).toBe(true)
    expect(state.isExpandedInput).toBe(false)
    expect(state.activeMainTab).toBe("git")
  })

  test("opening a sidebar while focused ends focus without restoring other chrome", () => {
    useUIStore.getState().enterWorkspaceFocus()
    useUIStore.getState().setSidebarOpen(true)
    const state = useUIStore.getState()

    expect(state.isWorkspaceFocus).toBe(false)
    expect(state.workspaceFocusSnapshot).toBeNull()
    expect(state.isSidebarOpen).toBe(true)
    expect(state.isRightSidebarOpen).toBe(false)
    expect(state.isBottomTerminalOpen).toBe(false)
  })

  test("switching to a non-chat tab ends focus without restore", () => {
    useUIStore.getState().enterWorkspaceFocus()
    useUIStore.getState().setActiveMainTab("diff")
    const state = useUIStore.getState()

    expect(state.isWorkspaceFocus).toBe(false)
    expect(state.activeMainTab).toBe("diff")
    expect(state.isSidebarOpen).toBe(false)
  })

  test("toggleWorkspaceFocus is a no-op on mobile", () => {
    useUIStore.setState({ isMobile: true })
    useUIStore.getState().toggleWorkspaceFocus()
    expect(useUIStore.getState().isWorkspaceFocus).toBe(false)
  })
})
