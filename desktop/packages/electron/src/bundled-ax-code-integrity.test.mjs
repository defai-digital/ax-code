import { afterEach, describe, expect, test } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { writeRuntimeManifest } = require("../../../../script/runtime-manifest.cjs")
const {
  EMBEDDED_MANIFEST_NAME,
  PLACEHOLDER_SCHEMA,
  verifyBundledAxCodeIntegrity,
} = require("./bundled-ax-code-integrity.js")
const tempDirs = []

afterEach(() => {
  for (const directory of tempDirs.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

function makePackagedRuntime({ staged = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ax-bundled-integrity-"))
  tempDirs.push(root)
  const appPath = path.join(root, "app.asar")
  const resourcesPath = path.join(root, "resources")
  const runtimeRoot = path.join(resourcesPath, "ax-code")
  fs.mkdirSync(path.join(appPath, "dist"), { recursive: true })
  fs.mkdirSync(runtimeRoot, { recursive: true })
  if (staged) {
    fs.mkdirSync(path.join(runtimeRoot, "bin"), { recursive: true })
    fs.mkdirSync(path.join(runtimeRoot, "lib"), { recursive: true })
    fs.writeFileSync(path.join(runtimeRoot, "bin", "ax-code"), "#!/bin/sh\n")
    fs.writeFileSync(path.join(runtimeRoot, "lib", "index-node-tui.js"), "runtime\n")
    fs.writeFileSync(path.join(runtimeRoot, "package.json"), "{}\n")
    writeRuntimeManifest(runtimeRoot)
    fs.copyFileSync(path.join(runtimeRoot, "runtime-manifest.json"), path.join(appPath, "dist", EMBEDDED_MANIFEST_NAME))
  } else {
    fs.writeFileSync(
      path.join(appPath, "dist", EMBEDDED_MANIFEST_NAME),
      `${JSON.stringify({ schema: PLACEHOLDER_SCHEMA, reason: "runtime-not-staged" })}\n`,
    )
  }
  return { appPath, resourcesPath, runtimeRoot }
}

describe("bundled ax-code runtime integrity", () => {
  test("verifies the external runtime against the ASAR-trusted manifest", () => {
    const paths = makePackagedRuntime()
    expect(
      verifyBundledAxCodeIntegrity({
        platform: "darwin",
        isPackaged: true,
        appPath: paths.appPath,
        resourcesPath: paths.resourcesPath,
      }),
    ).toMatchObject({ status: "verified", entries: 3 })
  })

  test("rejects modified sidecar JavaScript before it can be spawned", () => {
    const paths = makePackagedRuntime()
    fs.appendFileSync(path.join(paths.runtimeRoot, "lib", "index-node-tui.js"), "modified\n")

    expect(() =>
      verifyBundledAxCodeIntegrity({
        platform: "darwin",
        isPackaged: true,
        appPath: paths.appPath,
        resourcesPath: paths.resourcesPath,
      }),
    ).toThrow("Runtime manifest mismatch: lib/index-node-tui.js")
  })

  test("fails closed when a required packaged runtime is removed", () => {
    const paths = makePackagedRuntime()
    fs.rmSync(path.join(paths.runtimeRoot, "bin", "ax-code"))

    expect(() =>
      verifyBundledAxCodeIntegrity({
        platform: "darwin",
        isPackaged: true,
        appPath: paths.appPath,
        resourcesPath: paths.resourcesPath,
      }),
    ).toThrow("required by the trusted ASAR manifest is incomplete")
  })

  test("skips a packaged placeholder build with no runtime", () => {
    const paths = makePackagedRuntime({ staged: false })
    expect(
      verifyBundledAxCodeIntegrity({
        platform: "darwin",
        isPackaged: true,
        appPath: paths.appPath,
        resourcesPath: paths.resourcesPath,
      }),
    ).toMatchObject({ status: "skipped", reason: "runtime-not-staged" })
  })

  test("rejects a runtime inserted into a placeholder build", () => {
    const paths = makePackagedRuntime({ staged: false })
    fs.mkdirSync(path.join(paths.runtimeRoot, "bin"), { recursive: true })
    fs.writeFileSync(path.join(paths.runtimeRoot, "bin", "ax-code"), "#!/bin/sh\n")

    expect(() =>
      verifyBundledAxCodeIntegrity({
        platform: "darwin",
        isPackaged: true,
        appPath: paths.appPath,
        resourcesPath: paths.resourcesPath,
      }),
    ).toThrow("trusted ASAR manifest authorizes only a placeholder")
  })
})
