import { afterEach, describe, expect, test, vi } from "vitest"

import { getDesktopBridge, hasDesktopBridge } from "./desktopBridge"

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window
})

describe("getDesktopBridge", () => {
  test("prefers the canonical AX Code desktop global", async () => {
    const canonicalInvoke = vi.fn(async () => "canonical")
    ;(globalThis as Record<string, unknown>).window = {
      __AX_CODE_DESKTOP__: { runtime: "electron", invoke: canonicalInvoke },
      __TAURI__: { core: { invoke: vi.fn(async () => "tauri") } },
    }
    await expect(getDesktopBridge()?.invoke?.("desktop_get_app_version")).resolves.toBe("canonical")
    expect(hasDesktopBridge()).toBe(true)
  })

  test("falls back to the Tauri-shaped compatibility global", async () => {
    const tauriInvoke = vi.fn(async () => "tauri")
    ;(globalThis as Record<string, unknown>).window = { __TAURI__: { core: { invoke: tauriInvoke } } }
    await expect(getDesktopBridge()?.invoke?.("desktop_get_app_version")).resolves.toBe("tauri")
  })
})
