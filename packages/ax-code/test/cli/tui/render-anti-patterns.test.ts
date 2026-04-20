import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

const TUI_ROOT = path.resolve(import.meta.dir, "../../../src/cli/cmd/tui")
const APP_SRC = path.join(TUI_ROOT, "app.tsx")
const RENDERER_SRC = path.join(TUI_ROOT, "renderer.ts")
const DOCTOR_PRELOAD_SRC = path.resolve(import.meta.dir, "../../../src/cli/cmd/doctor-preload.ts")

describe("tui OpenTUI stability guardrails", () => {
  test("keeps OpenTUI wired as the default renderer path", async () => {
    const app = await fs.readFile(APP_SRC, "utf8")
    const renderer = await fs.readFile(RENDERER_SRC, "utf8")

    expect(app).toContain('import { renderTui } from "./renderer"')
    expect(app).not.toMatch(/runNativeTuiSlice|AX_CODE_TUI_NATIVE/i)
    expect(renderer).toContain('from "@opentui/solid"')
    expect(renderer).toContain("render(root, createTuiRenderOptions(options))")
  })

  test("keeps renderer startup configured for terminal stability", async () => {
    const renderer = await fs.readFile(RENDERER_SRC, "utf8")

    expect(renderer).toContain("targetFps: 60")
    expect(renderer).toContain("exitOnCtrlC: false")
    expect(renderer).toContain("autoFocus: false")
    expect(renderer).toContain("openConsoleOnError: false")
    expect(renderer).toContain("useKittyKeyboard: {}")
  })

  test("keeps passthrough external output enabled in the app runtime", async () => {
    const app = await fs.readFile(APP_SRC, "utf8")

    expect(app).toContain('renderer.externalOutputMode = "passthrough"')
  })

  test("keeps doctor checking the OpenTUI preload dependency with bundled-runtime awareness", async () => {
    const doctor = await fs.readFile(DOCTOR_PRELOAD_SRC, "utf8")

    expect(doctor).toContain("Bun.resolveSync")
    expect(doctor).toContain('"@opentui/solid/preload"')
    expect(doctor).toContain("Bundled runtime")
    expect(doctor).toContain("source/dev TUI may fail to start")
  })
})
