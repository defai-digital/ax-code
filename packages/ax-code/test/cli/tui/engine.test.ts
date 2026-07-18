import { describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import {
  TUI_ENGINE_ENV,
  TUI_MODE_CHOICES,
  TUI_SUPPORTED_ENGINE,
  applyTuiEngineMode,
  isExperimentalTuiEngine,
  normalizeTuiEngine,
  resolveEffectiveTuiEngine,
} from "../../../src/cli/cmd/tui/engine"

describe("tui engine policy", () => {
  test("keeps Zig/OpenTUI as the supported default and native as experimental", () => {
    expect(TUI_SUPPORTED_ENGINE).toBe("zig")
    expect(TUI_MODE_CHOICES).toEqual(["zig", "native"])
    expect(isExperimentalTuiEngine("zig")).toBe(false)
    expect(isExperimentalTuiEngine("native")).toBe(true)
  })

  test("normalizes implementation aliases without bringing back yoga", () => {
    expect(normalizeTuiEngine("opentui")).toBe("zig")
    expect(normalizeTuiEngine("Ratatui")).toBe("native")
    expect(normalizeTuiEngine("rust")).toBe("native")
    expect(normalizeTuiEngine("yoga")).toBeUndefined()
  })

  test("resolves AX_CODE_TUI_ENGINE and otherwise defaults to zig", () => {
    expect(resolveEffectiveTuiEngine({})).toBe("zig")
    expect(resolveEffectiveTuiEngine({ [TUI_ENGINE_ENV]: "native" })).toBe("native")
    expect(resolveEffectiveTuiEngine({ [TUI_ENGINE_ENV]: "unknown" })).toBe("zig")
    expect(resolveEffectiveTuiEngine({ AX_CODE_NATIVE_RENDER: "1" })).toBe("zig")
  })

  test("explicit CLI mode wins and disables the retired renderer overlay", () => {
    const env: Record<string, string | undefined> = {
      [TUI_ENGINE_ENV]: "native",
      AX_CODE_NATIVE_RENDER: "1",
      AX_CODE_NATIVE_RENDER_SCOPE: "yoga",
    }
    expect(applyTuiEngineMode("zig", env)).toBe("zig")
    expect(env[TUI_ENGINE_ENV]).toBe("zig")
    expect(env.AX_CODE_NATIVE_RENDER).toBe("0")
    expect(env.AX_CODE_NATIVE_RENDER_SCOPE).toBe("")
  })

  test("environment can select the standalone native Rust UI", () => {
    const env: Record<string, string | undefined> = { [TUI_ENGINE_ENV]: "native" }
    expect(applyTuiEngineMode(undefined, env)).toBe("native")
    expect(env.AX_CODE_NATIVE_RENDER).toBe("0")
    expect(env.AX_CODE_NATIVE_RENDER_SCOPE).toBe("")
  })

  test("CLI keeps --tui-mode hidden", async () => {
    const thread = await fs.readFile(path.resolve(import.meta.dirname, "../../../src/cli/cmd/tui/thread.ts"), "utf8")
    const optionIdx = thread.indexOf('.option("tui-mode"')
    expect(optionIdx).toBeGreaterThanOrEqual(0)
    const window = thread.slice(optionIdx, optionIdx + 500)
    expect(window).toContain("hidden: true")
    expect(window).toMatch(/Rust\/Ratatui/)
  })

  test("thread selects the engine after shell hydration and before OpenTUI backend startup", async () => {
    const thread = await fs.readFile(path.resolve(import.meta.dirname, "../../../src/cli/cmd/tui/thread.ts"), "utf8")
    const shellIdx = thread.indexOf("await ensureShellEnv()")
    const engineIdx = thread.indexOf("applyTuiEngineMode(")
    const backendIdx = thread.indexOf("const backend = await createBackendRuntime(", engineIdx)
    expect(shellIdx).toBeGreaterThanOrEqual(0)
    expect(engineIdx).toBeGreaterThan(shellIdx)
    expect(backendIdx).toBeGreaterThan(engineIdx)
  })
})
