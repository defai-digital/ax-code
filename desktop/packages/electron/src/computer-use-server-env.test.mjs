import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { buildComputerUseServerEnv } = require("./computer-use-server-env.js")

const base = {
  platform: "darwin",
  isPackaged: true,
  resourcesPath: "/Applications/AX Code.app/Contents/Resources",
  execPath: "/Applications/AX Code.app/Contents/MacOS/AX Code",
}

describe("computer-use server env", () => {
  test("sets both variables when the bundled shim exists", () => {
    const env = buildComputerUseServerEnv({ ...base, exists: () => true })

    expect(env).toEqual({
      AX_COMPUTER_COMMAND: "/Applications/AX Code.app/Contents/Resources/ax-computer/bin/ax-computer-electron",
      AX_COMPUTER_ELECTRON_BINARY: base.execPath,
    })
  })

  test("leaves the env unchanged when the artifact is absent", () => {
    expect(buildComputerUseServerEnv({ ...base, exists: () => false })).toEqual({})
  })

  test("passes through on non-darwin platforms", () => {
    expect(buildComputerUseServerEnv({ ...base, platform: "win32", exists: () => true })).toEqual({})
    expect(buildComputerUseServerEnv({ ...base, platform: "linux", exists: () => true })).toEqual({})
  })

  test("passes through in development (unpackaged)", () => {
    expect(buildComputerUseServerEnv({ ...base, isPackaged: false, exists: () => true })).toEqual({})
  })
})
