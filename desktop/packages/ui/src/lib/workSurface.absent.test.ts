import { existsSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"

describe("AX Work surface relocated", () => {
  test("Work tab modules are deleted", () => {
    const ui = path.join(import.meta.dirname, "..")
    expect(existsSync(path.join(ui, "lib/desktopSurface.ts"))).toBe(false)
    expect(existsSync(path.join(ui, "components/layout/DesktopSurfaceToggle.tsx"))).toBe(false)
    expect(existsSync(path.join(ui, "components/work/WorkHome.tsx"))).toBe(false)
    expect(existsSync(path.join(ui, "stores/useDesktopSurfaceStore.ts"))).toBe(false)
  })
})
