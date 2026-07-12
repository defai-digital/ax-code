import { describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import {
  TUI_MODE_CHOICES,
  TUI_SUPPORTED_RENDER_BACKEND,
  applyTuiRenderBackendMode,
  isExperimentalTuiRenderBackend,
} from "../../../src/cli/cmd/tui/render-backend"

describe("tui render backend policy (Zig supported; native/yoga experimental)", () => {
  test("supported production backend is zig", () => {
    expect(TUI_SUPPORTED_RENDER_BACKEND).toBe("zig")
    expect(isExperimentalTuiRenderBackend("zig")).toBe(false)
    expect(isExperimentalTuiRenderBackend("native")).toBe(true)
    expect(isExperimentalTuiRenderBackend("yoga")).toBe(true)
  })

  test("zig forces the bundled library and clears any scope", () => {
    const env: Record<string, string | undefined> = {
      AX_CODE_NATIVE_RENDER: "1",
      AX_CODE_NATIVE_RENDER_SCOPE: "yoga",
    }
    applyTuiRenderBackendMode("zig", env)
    expect(env["AX_CODE_NATIVE_RENDER"]).toBe("0")
    expect(env["AX_CODE_NATIVE_RENDER_SCOPE"]).toBeUndefined()
  })

  test("native opts into the full Rust render core (lab)", () => {
    const env: Record<string, string | undefined> = { AX_CODE_NATIVE_RENDER_SCOPE: "yoga" }
    applyTuiRenderBackendMode("native", env)
    expect(env["AX_CODE_NATIVE_RENDER"]).toBe("1")
    expect(env["AX_CODE_NATIVE_RENDER_SCOPE"]).toBeUndefined()
  })

  test("yoga narrows the Rust opt-in to yoga/audio (lab scaffold)", () => {
    const env: Record<string, string | undefined> = {}
    applyTuiRenderBackendMode("yoga", env)
    expect(env["AX_CODE_NATIVE_RENDER"]).toBe("1")
    expect(env["AX_CODE_NATIVE_RENDER_SCOPE"]).toBe("yoga")
  })

  test("no flag leaves the environment untouched (overlay default = zig)", () => {
    const env: Record<string, string | undefined> = {}
    applyTuiRenderBackendMode(undefined, env)
    expect(env["AX_CODE_NATIVE_RENDER"]).toBeUndefined()
    expect(env["AX_CODE_NATIVE_RENDER_SCOPE"]).toBeUndefined()

    // An explicit env opt-in survives when the flag is absent (lab use).
    const optedIn: Record<string, string | undefined> = { AX_CODE_NATIVE_RENDER: "1" }
    applyTuiRenderBackendMode(undefined, optedIn)
    expect(optedIn["AX_CODE_NATIVE_RENDER"]).toBe("1")
  })

  test("choices still include lab backends for escape-hatch mapping", () => {
    expect([...TUI_MODE_CHOICES].sort()).toEqual(["native", "yoga", "zig"])
  })

  test("CLI keeps --tui-mode hidden so it does not appear in normal help", async () => {
    const thread = await fs.readFile(
      path.resolve(import.meta.dirname, "../../../src/cli/cmd/tui/thread.ts"),
      "utf8",
    )
    const optionIdx = thread.indexOf('.option("tui-mode"')
    expect(optionIdx).toBeGreaterThanOrEqual(0)
    const window = thread.slice(optionIdx, optionIdx + 600)
    expect(window).toContain("hidden: true")
    expect(window).toMatch(/experimental/i)
  })
})
