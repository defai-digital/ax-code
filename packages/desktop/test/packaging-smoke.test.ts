import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { createElectronHostPlan } from "../src/electron/config"
import { createPackagedDesktopSmokePlan, validatePackagedDesktopSmokePlan } from "../src/packaging/smoke"

describe("packaged desktop smoke", () => {
  test("validates packaged renderer assets and Electron dependency evidence", () => {
    const root = path.join(tmpdir(), `ax-code-desktop-smoke-${Date.now()}`)
    const appDist = path.join(root, "app-dist")
    const mainPath = path.join(root, "main.js")
    const preloadPath = path.join(root, "preload.cjs")
    const electronPackagePath = path.join(root, "electron-package.json")
    const electronBinaryPath = path.join(root, "Electron")
    mkdirSync(appDist, { recursive: true })
    writeFileSync(path.join(appDist, "index.html"), '<div id="root"></div>')
    writeFileSync(mainPath, "export {}")
    writeFileSync(preloadPath, "module.exports = {}")
    writeFileSync(electronPackagePath, '{"version":"42.3.0"}')
    writeFileSync(electronBinaryPath, "")

    const smoke = createPackagedDesktopSmokePlan({
      appDist,
      mainPath,
      preloadPath,
      electronVersion: "42.3.0",
      electronPackagePath,
      electronBinaryPath,
      packageTarget: "mac",
    })

    expect(smoke).toMatchObject({
      packageTarget: "mac",
      electronVersion: "42.3.0",
      electronBinaryPath,
      mainPath,
      rendererUrl: "app://ax-code/index.html",
      appDist,
      preloadPath,
      checks: {
        electronDependency: true,
        main: true,
        runtimeDependencyClosure: true,
        rendererIndex: true,
        preload: true,
        customProtocol: true,
        sandboxedRenderer: true,
      },
    })
  })

  test("fails when the packaged main leaves runtime dependencies externalized", () => {
    const root = path.join(tmpdir(), `ax-code-desktop-smoke-external-${Date.now()}`)
    const appDist = path.join(root, "app-dist")
    const mainPath = path.join(root, "main.js")
    const preloadPath = path.join(root, "preload.cjs")
    mkdirSync(appDist, { recursive: true })
    writeFileSync(path.join(appDist, "index.html"), '<div id="root"></div>')
    writeFileSync(mainPath, 'import { startHeadlessBackend } from "@ax-code/sdk/headless"\nexport {}')
    writeFileSync(preloadPath, "module.exports = {}")

    expect(() =>
      createPackagedDesktopSmokePlan({
        appDist,
        mainPath,
        preloadPath,
        electronVersion: "42.3.0",
        electronPackagePath: import.meta.path,
        electronBinaryPath: import.meta.path,
      }),
    ).toThrow("unresolved runtime imports")
  })

  test("fails when packaged renderer assets are missing", () => {
    const root = path.join(tmpdir(), `ax-code-desktop-smoke-missing-${Date.now()}`)
    const mainPath = path.join(root, "main.js")
    const preloadPath = path.join(root, "preload.cjs")
    mkdirSync(root, { recursive: true })
    writeFileSync(mainPath, "export {}")
    writeFileSync(preloadPath, "module.exports = {}")
    const plan = createElectronHostPlan({
      appDist: path.join(root, "missing-dist"),
      preloadPath,
    })

    expect(() =>
      validatePackagedDesktopSmokePlan(plan, {
        electronVersion: "42.3.0",
        electronPackagePath: import.meta.path,
        electronBinaryPath: import.meta.path,
        mainPath,
      }),
    ).toThrow("Renderer index is missing")
  })
})
