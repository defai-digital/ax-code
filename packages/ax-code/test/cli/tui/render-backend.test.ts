import { describe, expect, test } from "vitest"
import { TUI_MODE_CHOICES, applyTuiRenderBackendMode } from "../../../src/cli/cmd/tui/render-backend"

describe("tui --tui-mode render backend mapping", () => {
  test("zig forces the bundled library and clears any scope", () => {
    const env: Record<string, string | undefined> = {
      AX_CODE_NATIVE_RENDER: "1",
      AX_CODE_NATIVE_RENDER_SCOPE: "yoga",
    }
    applyTuiRenderBackendMode("zig", env)
    expect(env["AX_CODE_NATIVE_RENDER"]).toBe("0")
    expect(env["AX_CODE_NATIVE_RENDER_SCOPE"]).toBeUndefined()
  })

  test("native opts into the full Rust render core", () => {
    const env: Record<string, string | undefined> = { AX_CODE_NATIVE_RENDER_SCOPE: "yoga" }
    applyTuiRenderBackendMode("native", env)
    expect(env["AX_CODE_NATIVE_RENDER"]).toBe("1")
    expect(env["AX_CODE_NATIVE_RENDER_SCOPE"]).toBeUndefined()
  })

  test("yoga narrows the Rust opt-in to yoga/audio", () => {
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

    // An explicit env opt-in survives when the flag is absent.
    const optedIn: Record<string, string | undefined> = { AX_CODE_NATIVE_RENDER: "1" }
    applyTuiRenderBackendMode(undefined, optedIn)
    expect(optedIn["AX_CODE_NATIVE_RENDER"]).toBe("1")
  })

  test("choices cover exactly the documented modes", () => {
    expect([...TUI_MODE_CHOICES].sort()).toEqual(["native", "yoga", "zig"])
  })
})
