import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { createElectronWindowOptions } from "../src/electron/config"
import {
  applyWindowState,
  attachWindowStatePersistence,
  captureWindowState,
  createWindowStateStore,
  readWindowStateFile,
  sanitizeWindowState,
  type DesktopWindowState,
  type WindowBounds,
} from "../src/electron/window-state"

describe("desktop window state", () => {
  test("applies valid stored bounds without weakening security options", () => {
    const options = createElectronWindowOptions("/workspace/preload.cjs")
    const recovered = applyWindowState(options, {
      bounds: { x: 40, y: 50, width: 1440, height: 900 },
      maximized: true,
    })

    expect(recovered).toMatchObject({ x: 40, y: 50, width: 1440, height: 900 })
    expect(recovered.webPreferences).toEqual(options.webPreferences)
    expect(recovered.show).toBe(false)
  })

  test("ignores invalid or undersized stored bounds", () => {
    const options = createElectronWindowOptions("/workspace/preload.cjs")

    expect(applyWindowState(options, { bounds: { width: 200, height: 100 } })).toEqual(options)
    expect(sanitizeWindowState({ bounds: { width: Number.NaN, height: 900 } })).toEqual({})
    expect(readWindowStateFile(path.join(tmpdir(), `missing-window-state-${Date.now()}.json`))).toEqual({})
  })

  test("reads and writes window state from the user data directory", () => {
    const root = path.join(tmpdir(), `ax-code-window-state-${Date.now()}`)
    const store = createWindowStateStore(root)

    store.write({ bounds: { x: 20, y: 30, width: 1320, height: 860 }, maximized: false, updatedAt: 123 })

    expect(store.read()).toEqual({
      bounds: { x: 20, y: 30, width: 1320, height: 860 },
      maximized: false,
      updatedAt: 123,
    })
    expect(JSON.parse(readFileSync(path.join(root, "window-state.json"), "utf8"))).toMatchObject({
      bounds: { width: 1320, height: 860 },
    })
  })

  test("recovers from corrupt window state files", () => {
    const root = path.join(tmpdir(), `ax-code-window-state-corrupt-${Date.now()}`)
    mkdirSync(root, { recursive: true })
    const file = path.join(root, "window-state.json")
    writeFileSync(file, "{not-json")

    expect(readWindowStateFile(file)).toEqual({})
  })

  test("persists bounds on resize, move, and close events", () => {
    const writes: DesktopWindowState[] = []
    const handlers = new Map<string, () => void>()
    let bounds: WindowBounds = { x: 1, y: 2, width: 1200, height: 800 }
    const win = {
      on(event: "resize" | "move" | "close", callback: () => void) {
        handlers.set(event, callback)
      },
      getBounds() {
        return bounds
      },
      isMaximized() {
        return true
      },
    }

    attachWindowStatePersistence(
      win,
      {
        read: () => ({}),
        write: (state) => writes.push(state),
      },
      () => 456,
    )

    handlers.get("resize")?.()
    bounds = { x: 10, y: 20, width: 1400, height: 920 }
    handlers.get("move")?.()
    handlers.get("close")?.()

    expect(writes).toHaveLength(3)
    expect(writes[0]).toEqual({
      bounds: { x: 1, y: 2, width: 1200, height: 800 },
      maximized: true,
      updatedAt: 456,
    })
    expect(writes[2]?.bounds).toEqual({ x: 10, y: 20, width: 1400, height: 920 })
  })

  test("captures a sanitized window state snapshot", () => {
    expect(
      captureWindowState(
        {
          getBounds: () => ({ width: 1500, height: 1000 }),
          isMaximized: () => false,
        },
        () => 789,
      ),
    ).toEqual({
      bounds: { width: 1500, height: 1000 },
      maximized: false,
      updatedAt: 789,
    })
  })
})
