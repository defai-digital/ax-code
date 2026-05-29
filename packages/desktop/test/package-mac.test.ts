import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { createElectronHostPlan } from "../src/electron/config"
import { createMacAppBundle } from "../src/packaging/mac"
import { readDesktopReleaseDiagnostics } from "../src/packaging/release-diagnostics"
import { createPackagedDesktopSmokePlan } from "../src/packaging/smoke"

describe("mac desktop packaging", () => {
  test("creates an Electron .app bundle with runtime payload and closed release gates", () => {
    const root = path.join(tmpdir(), `ax-code-package-mac-${Date.now()}`)
    const artifacts = createBuildArtifacts(path.join(root, "build"))
    const electronAppPath = createElectronApp(path.join(root, "electron"))
    const bundle = createMacAppBundle({
      artifacts,
      electronAppPath,
      bundleRoot: path.join(root, "dist/mac"),
      version: "9.8.7",
      electronVersion: "42.3.0",
    })

    expect(existsSync(path.join(bundle.bundlePath, "Contents/Info.plist"))).toBe(true)
    expect(existsSync(path.join(bundle.appPayloadPath, "main.js"))).toBe(true)
    expect(existsSync(path.join(bundle.appPayloadPath, "main.js.map"))).toBe(true)
    expect(existsSync(path.join(bundle.appPayloadPath, "preload.cjs"))).toBe(true)
    expect(existsSync(path.join(bundle.appPayloadPath, "app/index.html"))).toBe(true)
    expect(existsSync(bundle.iconPath)).toBe(true)
    expect(existsSync(path.join(bundle.resourcesPath, "default_app.asar"))).toBe(false)
    expect(existsSync(path.join(bundle.resourcesPath, "electron.icns"))).toBe(false)

    const infoPlist = readFileSync(path.join(bundle.bundlePath, "Contents/Info.plist"), "utf8")
    expect(infoPlist).toContain("<key>CFBundleExecutable</key>\n\t<string>Electron</string>")
    expect(infoPlist).toContain("<string>digital.defai.ax-code</string>")
    expect(infoPlist).toContain("<key>CFBundleDisplayName</key>")
    expect(infoPlist).toContain("<key>CFBundleIconFile</key>\n\t<string>ax-code.icns</string>")
    expect(infoPlist).toContain("<key>CFBundleShortVersionString</key>\n\t<string>9.8.7</string>")
    expect(infoPlist).toContain("<key>CFBundleVersion</key>\n\t<string>9.8.7</string>")
    expect(infoPlist).not.toContain("ElectronAsarIntegrity")

    const appPackage = JSON.parse(readFileSync(bundle.appPackagePath, "utf8")) as {
      name: string
      main: string
      version: string
    }
    expect(appPackage).toMatchObject({ name: "@ax-code/desktop", main: "main.js", version: "9.8.7" })
    expect(bundle.releaseManifest).toMatchObject({
      productName: "AX Code",
      version: "9.8.7",
      packageTarget: "mac",
      signed: false,
      notarized: false,
      updaterConfigured: false,
    })

    const plan = createElectronHostPlan({ runtimeDir: bundle.appPayloadPath })
    expect(plan.preloadPath).toBe(path.join(bundle.appPayloadPath, "preload.cjs"))
    expect(plan.renderer).toEqual({ kind: "packaged", appDist: path.join(bundle.appPayloadPath, "app") })

    const smoke = createPackagedDesktopSmokePlan({
      appDist: path.join(bundle.appPayloadPath, "app"),
      mainPath: path.join(bundle.appPayloadPath, "main.js"),
      preloadPath: path.join(bundle.appPayloadPath, "preload.cjs"),
      electronVersion: "42.3.0",
      electronPackagePath: path.join(root, "electron/electron-package.json"),
      electronBinaryPath: path.join(electronAppPath, "Contents/MacOS/Electron"),
      packageTarget: "mac",
      macBundlePath: bundle.bundlePath,
      releaseManifestPath: bundle.releaseManifestPath,
    })

    expect(smoke.checks.macBundle).toBe(true)
    expect(smoke.checks.releaseManifest).toBe(true)
    expect(smoke.releaseManifestPath).toBe(bundle.releaseManifestPath)

    expect(readDesktopReleaseDiagnostics({ resourcesPath: bundle.resourcesPath })).toMatchObject({
      status: "manifest-found",
      packageTarget: "mac",
      version: "9.8.7",
      signed: false,
      notarized: false,
      updaterConfigured: false,
      gates: {
        signing: { status: "blocked" },
        notarization: { status: "blocked" },
        updater: { status: "blocked" },
      },
    })
  })
})

function createBuildArtifacts(outDir: string) {
  const appDist = path.join(outDir, "app")
  mkdirSync(appDist, { recursive: true })
  writeFileSync(path.join(outDir, "main.js"), "export {}")
  writeFileSync(path.join(outDir, "main.js.map"), "{}")
  writeFileSync(path.join(outDir, "preload.cjs"), "module.exports = {}")
  writeFileSync(path.join(appDist, "index.html"), '<div id="root"></div>')
  return {
    outDir,
    mainPath: path.join(outDir, "main.js"),
    preloadPath: path.join(outDir, "preload.cjs"),
    appDist,
    appIndexPath: path.join(appDist, "index.html"),
  }
}

function createElectronApp(root: string) {
  const electronAppPath = path.join(root, "Electron.app")
  const contentsPath = path.join(electronAppPath, "Contents")
  const resourcesPath = path.join(contentsPath, "Resources")
  mkdirSync(path.join(contentsPath, "MacOS"), { recursive: true })
  mkdirSync(resourcesPath, { recursive: true })
  writeFileSync(path.join(contentsPath, "MacOS/Electron"), "")
  writeFileSync(path.join(resourcesPath, "default_app.asar"), "")
  writeFileSync(path.join(resourcesPath, "electron.icns"), "")
  writeFileSync(path.join(root, "electron-package.json"), '{"version":"42.3.0"}')
  writeFileSync(
    path.join(contentsPath, "Info.plist"),
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<plist version="1.0">',
      "<dict>",
      "\t<key>CFBundleExecutable</key>",
      "\t<string>Electron</string>",
      "\t<key>CFBundleIdentifier</key>",
      "\t<string>com.github.Electron</string>",
      "\t<key>CFBundleName</key>",
      "\t<string>Electron</string>",
      "\t<key>CFBundleShortVersionString</key>",
      "\t<string>42.3.0</string>",
      "\t<key>CFBundleVersion</key>",
      "\t<string>42.3.0</string>",
      "\t<key>CFBundleIconFile</key>",
      "\t<string>electron.icns</string>",
      "\t<key>ElectronAsarIntegrity</key>",
      "\t<dict>",
      "\t\t<key>Resources/default_app.asar</key>",
      "\t\t<dict>",
      "\t\t\t<key>algorithm</key>",
      "\t\t\t<string>SHA256</string>",
      "\t\t</dict>",
      "\t</dict>",
      "</dict>",
      "</plist>",
    ].join("\n"),
  )
  return electronAppPath
}
