import { describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import {
  TUI_MODE_CHOICES,
  TUI_SUPPORTED_RENDER_BACKEND,
  applyTuiRenderBackendMode,
  isExperimentalTuiRenderBackend,
  isNativeRenderEnvEnabled,
  resolveEffectiveTuiRenderBackend,
} from "../../../src/cli/cmd/tui/render-backend"

describe("tui render backend policy (Zig supported; native/yoga experimental)", () => {
  test("supported production backend is zig", () => {
    expect(TUI_SUPPORTED_RENDER_BACKEND).toBe("zig")
    expect(isExperimentalTuiRenderBackend("zig")).toBe(false)
    expect(isExperimentalTuiRenderBackend("native")).toBe(true)
    expect(isExperimentalTuiRenderBackend("yoga")).toBe(true)
  })

  test("resolveEffective matches overlay truthiness and yoga scope", () => {
    expect(resolveEffectiveTuiRenderBackend({})).toBe("zig")
    expect(resolveEffectiveTuiRenderBackend({ AX_CODE_NATIVE_RENDER: "0" })).toBe("zig")
    expect(resolveEffectiveTuiRenderBackend({ AX_CODE_NATIVE_RENDER: "false" })).toBe("zig")
    expect(resolveEffectiveTuiRenderBackend({ AX_CODE_NATIVE_RENDER: "1" })).toBe("native")
    expect(resolveEffectiveTuiRenderBackend({ AX_CODE_NATIVE_RENDER: "true" })).toBe("native")
    expect(resolveEffectiveTuiRenderBackend({ AX_CODE_NATIVE_RENDER: "ON" })).toBe("native")
    expect(
      resolveEffectiveTuiRenderBackend({
        AX_CODE_NATIVE_RENDER: "1",
        AX_CODE_NATIVE_RENDER_SCOPE: "yoga",
      }),
    ).toBe("yoga")
    // SCOPE without opt-in is ignored (render stays zig).
    expect(resolveEffectiveTuiRenderBackend({ AX_CODE_NATIVE_RENDER_SCOPE: "yoga" })).toBe("zig")
    expect(isNativeRenderEnvEnabled({ AX_CODE_NATIVE_RENDER: "1" })).toBe(true)
    expect(isNativeRenderEnvEnabled({ AX_CODE_NATIVE_RENDER: "0" })).toBe(false)
  })

  test("zig forces the bundled library and blanks scope (blocks shell re-inject)", () => {
    const env: Record<string, string | undefined> = {
      AX_CODE_NATIVE_RENDER: "1",
      AX_CODE_NATIVE_RENDER_SCOPE: "yoga",
    }
    expect(applyTuiRenderBackendMode("zig", env)).toBe("zig")
    expect(env["AX_CODE_NATIVE_RENDER"]).toBe("0")
    // Empty string keeps the key present so shell-env fill (`if (key in env)`)
    // will not re-inject a profile SCOPE after the CLI override.
    expect(env["AX_CODE_NATIVE_RENDER_SCOPE"]).toBe("")
    expect("AX_CODE_NATIVE_RENDER_SCOPE" in env).toBe(true)
  })

  test("native opts into the full Rust render core (lab)", () => {
    const env: Record<string, string | undefined> = { AX_CODE_NATIVE_RENDER_SCOPE: "yoga" }
    expect(applyTuiRenderBackendMode("native", env)).toBe("native")
    expect(env["AX_CODE_NATIVE_RENDER"]).toBe("1")
    expect(env["AX_CODE_NATIVE_RENDER_SCOPE"]).toBe("")
  })

  test("yoga narrows the Rust opt-in to yoga/audio (lab scaffold)", () => {
    const env: Record<string, string | undefined> = {}
    expect(applyTuiRenderBackendMode("yoga", env)).toBe("yoga")
    expect(env["AX_CODE_NATIVE_RENDER"]).toBe("1")
    expect(env["AX_CODE_NATIVE_RENDER_SCOPE"]).toBe("yoga")
  })

  test("mode is case-insensitive when applied programmatically", () => {
    const env: Record<string, string | undefined> = {}
    expect(applyTuiRenderBackendMode("NATIVE", env)).toBe("native")
    expect(applyTuiRenderBackendMode(" Zig ", { AX_CODE_NATIVE_RENDER: "1" })).toBe("zig")
  })

  test("no flag leaves the environment untouched (overlay default = zig)", () => {
    const env: Record<string, string | undefined> = {}
    expect(applyTuiRenderBackendMode(undefined, env)).toBe("zig")
    expect(env["AX_CODE_NATIVE_RENDER"]).toBeUndefined()
    expect(env["AX_CODE_NATIVE_RENDER_SCOPE"]).toBeUndefined()

    // An explicit env opt-in survives when the flag is absent (lab use).
    const optedIn: Record<string, string | undefined> = { AX_CODE_NATIVE_RENDER: "1" }
    expect(applyTuiRenderBackendMode(undefined, optedIn)).toBe("native")
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

  test("thread awaits shell env before applying render backend", async () => {
    const thread = await fs.readFile(
      path.resolve(import.meta.dirname, "../../../src/cli/cmd/tui/thread.ts"),
      "utf8",
    )
    expect(thread).toContain("await ensureShellEnv()")
    const shellIdx = thread.indexOf("await ensureShellEnv()")
    const applyIdx = thread.indexOf("applyTuiRenderBackendMode(")
    expect(shellIdx).toBeGreaterThanOrEqual(0)
    expect(applyIdx).toBeGreaterThan(shellIdx)
  })
})
