import { beforeEach, describe, expect, test } from "vitest"
import { useDesktopSurfaceStore } from "./useDesktopSurfaceStore"

describe("useDesktopSurfaceStore", () => {
  beforeEach(() => {
    useDesktopSurfaceStore.setState({ surface: "code" })
  })

  test("defaults to code", () => {
    expect(useDesktopSurfaceStore.getState().surface).toBe("code")
  })

  test("setSurface switches to work", () => {
    useDesktopSurfaceStore.getState().setSurface("work")
    expect(useDesktopSurfaceStore.getState().surface).toBe("work")
  })

  test("ignores invalid surfaces", () => {
    useDesktopSurfaceStore.getState().setSurface("code")
    // @ts-expect-error intentional invalid
    useDesktopSurfaceStore.getState().setSurface("chat")
    expect(useDesktopSurfaceStore.getState().surface).toBe("code")
  })

  test("toggleSurface flips between code and work", () => {
    useDesktopSurfaceStore.getState().toggleSurface()
    expect(useDesktopSurfaceStore.getState().surface).toBe("work")
    useDesktopSurfaceStore.getState().toggleSurface()
    expect(useDesktopSurfaceStore.getState().surface).toBe("code")
  })
})
