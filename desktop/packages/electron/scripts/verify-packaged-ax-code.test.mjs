import { afterEach, describe, expect, test } from "vitest"
import { createRequire } from "node:module"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const { dependencyManifestPath, resolvePackagedAxCodeRoot, verifyPackagedAxCode } =
  require("./verify-packaged-ax-code.cjs").__test

const tempDirs = []
const testSymlinks = process.platform === "win32" ? test.skip : test

const makeContext = (platform) => {
  const appOutDir = fs.mkdtempSync(path.join(os.tmpdir(), "ax-packaged-runtime-"))
  tempDirs.push(appOutDir)
  return {
    appOutDir,
    electronPlatformName: platform,
    packager: { appInfo: { productFilename: "AX Code" } },
  }
}

const writeRuntime = (context, dependencies) => {
  const runtimeRoot = resolvePackagedAxCodeRoot(context)
  const launcher = path.join(runtimeRoot, "bin", context.electronPlatformName === "win32" ? "ax-code.cmd" : "ax-code")
  fs.mkdirSync(path.dirname(launcher), { recursive: true })
  fs.writeFileSync(launcher, "launcher")
  fs.writeFileSync(path.join(runtimeRoot, "package.json"), JSON.stringify({ dependencies }))
  return runtimeRoot
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe("packaged ax-code runtime verification", () => {
  test("resolves platform-specific resources directories", () => {
    const mac = makeContext("darwin")
    const windows = makeContext("win32")

    expect(resolvePackagedAxCodeRoot(mac)).toBe(
      path.join(mac.appOutDir, "AX Code.app", "Contents", "Resources", "ax-code"),
    )
    expect(resolvePackagedAxCodeRoot(windows)).toBe(path.join(windows.appOutDir, "resources", "ax-code"))
  })

  test("allows placeholder builds unless release staging is required", () => {
    const context = makeContext("linux")

    expect(verifyPackagedAxCode(context, { env: {} }).status).toBe("skipped")
    expect(() => verifyPackagedAxCode(context, { env: { AX_CODE_STAGE_REQUIRED: "true" } })).toThrow(
      "missing the required ax-code runtime",
    )
  })

  test("fails when electron-builder drops runtime dependencies", () => {
    const context = makeContext("darwin")
    const runtimeRoot = writeRuntime(context, { "solid-js": "1.9.9", "@ax-code/util": "1.0.0" })
    fs.mkdirSync(path.dirname(dependencyManifestPath(runtimeRoot, "solid-js")), { recursive: true })
    fs.writeFileSync(dependencyManifestPath(runtimeRoot, "solid-js"), "{}")

    expect(() => verifyPackagedAxCode(context)).toThrow("@ax-code/util")
  })

  testSymlinks("fails before signing when a runtime symlink escapes the app bundle", () => {
    const context = makeContext("darwin")
    const runtimeRoot = writeRuntime(context, { "solid-js": "1.9.9" })
    const dependency = dependencyManifestPath(runtimeRoot, "solid-js")
    fs.mkdirSync(path.dirname(dependency), { recursive: true })
    fs.writeFileSync(dependency, "{}")
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ax-packaged-runtime-outside-"))
    tempDirs.push(outside)
    const link = path.join(runtimeRoot, "node_modules", "workspace-only")
    fs.symlinkSync(outside, link)

    expect(() => verifyPackagedAxCode(context)).toThrow("unsafe symlinks: node_modules/workspace-only")
  })

  test("accepts a runtime with every direct dependency", () => {
    const context = makeContext("win32")
    const runtimeRoot = writeRuntime(context, { "solid-js": "1.9.9", "@ax-code/util": "1.0.0" })
    for (const dependency of ["solid-js", "@ax-code/util"]) {
      const manifest = dependencyManifestPath(runtimeRoot, dependency)
      fs.mkdirSync(path.dirname(manifest), { recursive: true })
      fs.writeFileSync(manifest, "{}")
    }

    expect(verifyPackagedAxCode(context).status).toBe("verified")
  })

  test("keeps node_modules in a dedicated electron-builder FileSet", () => {
    const configPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "electron-builder.yml")
    const config = fs.readFileSync(configPath, "utf8")

    expect(config).toContain("from: resources/ax-code/node_modules")
    expect(config).toContain("to: ax-code/node_modules")
    expect(config).toContain("afterPack: scripts/verify-packaged-ax-code.cjs")
  })
})
