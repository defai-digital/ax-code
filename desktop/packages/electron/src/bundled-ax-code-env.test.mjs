import { createRequire } from "node:module"
import path from "node:path"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { applyBundledAxCodeEnv, buildBundledAxCodeEnv } = require("./bundled-ax-code-env.js")

const base = {
  platform: "darwin",
  isPackaged: true,
  resourcesPath: "/Applications/AX Code.app/Contents/Resources",
}

describe("bundled ax-code runtime env", () => {
  test("points at the bundled launcher when it is executable", () => {
    const env = buildBundledAxCodeEnv({ ...base, isExecutable: () => true })

    expect(env).toEqual({
      AX_CODE_DESKTOP_BUNDLED_AX_CODE_BINARY: "/Applications/AX Code.app/Contents/Resources/ax-code/bin/ax-code",
    })
  })

  test("uses the .cmd launcher on Windows (existence-only, no exec bits)", () => {
    const env = buildBundledAxCodeEnv({
      ...base,
      platform: "win32",
      resourcesPath: "C:\\Program Files\\AX Code\\resources",
      exists: () => true,
      isExecutable: () => false,
    })

    // path.join uses host separators; compute the expectation the same way so
    // the assertion holds on POSIX dev machines and Windows CI alike.
    expect(env).toEqual({
      AX_CODE_DESKTOP_BUNDLED_AX_CODE_BINARY: path.join(
        "C:\\Program Files\\AX Code\\resources",
        "ax-code",
        "bin",
        "ax-code.cmd",
      ),
    })
  })

  test("uses the unix launcher on Linux", () => {
    const env = buildBundledAxCodeEnv({
      ...base,
      platform: "linux",
      resourcesPath: "/opt/AX Code/resources",
      isExecutable: () => true,
    })

    expect(env).toEqual({
      AX_CODE_DESKTOP_BUNDLED_AX_CODE_BINARY: "/opt/AX Code/resources/ax-code/bin/ax-code",
    })
  })

  test("leaves the env unchanged when the staged tree has only the placeholder", () => {
    expect(buildBundledAxCodeEnv({ ...base, isExecutable: () => false })).toEqual({})
  })

  test("rejects a staged launcher that exists but is not executable", () => {
    expect(buildBundledAxCodeEnv({ ...base, exists: () => true, isExecutable: () => false })).toEqual({})
  })

  test("passes through in development (unpackaged)", () => {
    expect(buildBundledAxCodeEnv({ ...base, isPackaged: false, isExecutable: () => true })).toEqual({})
  })
})

describe("applyBundledAxCodeEnv", () => {
  test("sets the bundled launcher when one was staged", () => {
    const env = applyBundledAxCodeEnv(
      { PATH: "/usr/bin" },
      { AX_CODE_DESKTOP_BUNDLED_AX_CODE_BINARY: "/app/ax-code/bin/ax-code" },
    )

    expect(env).toEqual({
      PATH: "/usr/bin",
      AX_CODE_DESKTOP_BUNDLED_AX_CODE_BINARY: "/app/ax-code/bin/ax-code",
    })
  })

  test("strips an inherited AX_CODE_DESKTOP_BUNDLED_AX_CODE_BINARY when nothing was staged", () => {
    const env = applyBundledAxCodeEnv(
      { PATH: "/usr/bin", AX_CODE_DESKTOP_BUNDLED_AX_CODE_BINARY: "/user/exported/ax-code" },
      {},
    )

    expect(env).toEqual({ PATH: "/usr/bin" })
    expect("AX_CODE_DESKTOP_BUNDLED_AX_CODE_BINARY" in env).toBe(false)
  })

  test("leaves the env untouched when nothing was staged and nothing was inherited", () => {
    expect(applyBundledAxCodeEnv({ PATH: "/usr/bin" }, {})).toEqual({ PATH: "/usr/bin" })
  })
})
