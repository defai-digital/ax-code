import { describe, expect, test } from "vitest"
import path from "node:path"
import { extractAssetPath, packagedPaths, parseSmokeArgs } from "./smoke-packaged-asar-cli.mjs"

describe("packaged ASAR CLI smoke", () => {
  test("parses builder flags and a bounded timeout", () => {
    expect(parseSmokeArgs(["--win", "--arm64", "--timeout-ms", "90000"])).toEqual({
      builderArgs: ["--win", "--arm64"],
      timeoutMs: 90_000,
    })
    expect(() => parseSmokeArgs(["--linux", "--timeout-ms", "0"])).toThrow("between 1000 and 300000")
  })

  test("resolves ASAR and runtime paths for every packaged layout", () => {
    const windows = packagedPaths({ appPath: "/release/AX Code.exe", platform: "win32" })
    expect(windows.cliPath).toBe(path.join("/release", "resources", "app.asar", "dist", "desktop-cli.mjs"))
    expect(windows.launcherPath.endsWith(path.join("ax-code", "bin", "ax-code.cmd"))).toBe(true)

    const linux = packagedPaths({ appPath: "/release/ax-code-desktop", platform: "linux" })
    expect(linux.webDistPath).toBe("/release/resources/app.asar/web-dist")

    const mac = packagedPaths({ appPath: "/release/AX Code.app", platform: "darwin" })
    expect(mac.executablePath).toBe("/release/AX Code.app/Contents/MacOS/AX Code")
  })

  test("extracts a packaged renderer asset from HTML", () => {
    expect(extractAssetPath('<link href="/assets/app.css"><script src="/assets/app.js"></script>')).toBe(
      "/assets/app.css",
    )
    expect(extractAssetPath("<html></html>")).toBeUndefined()
  })
})
