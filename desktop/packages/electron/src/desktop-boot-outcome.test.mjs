import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { createElectronDesktopBootOutcome } = require("./desktop-boot-outcome.js")

describe("createElectronDesktopBootOutcome", () => {
  test("returns a valid local-ok desktop boot outcome for Electron preload injection", () => {
    expect(createElectronDesktopBootOutcome()).toEqual({
      target: "local",
      status: "ok",
    })
  })

  test("returns a fresh object so renderer code cannot mutate a shared singleton", () => {
    const first = createElectronDesktopBootOutcome()
    const second = createElectronDesktopBootOutcome()

    expect(first).toEqual(second)
    expect(first).not.toBe(second)
  })
})
