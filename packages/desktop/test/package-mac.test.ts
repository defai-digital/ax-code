import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { createElectronHostPlan } from "../src/electron/config"
import { buildDesktopArtifacts } from "../src/packaging/build"
import { createMacAppBundle, type MacPackagingCommand } from "../src/packaging/mac"
import { readDesktopReleaseDiagnostics } from "../src/packaging/release-diagnostics"
import { createPackagedDesktopSmokePlan } from "../src/packaging/smoke"

const PACKAGED_MAIN_CONTRACT_FIXTURE = [
  'const bridgeCommands = ["backend.start", "backend.attach", "diagnostics.read", "diagnostics.exportLogs"]',
  "function createDesktopBridgeHandler() {}",
  "function createStartBackendPlan(options) { return options }",
  "function createAttachBackendPlan(input) { return input }",
  "const backend = { connect(plan) { return plan }, reconnect(plan) { return plan } }",
  'backend.reconnect(createStartBackendPlan("backend.start"))',
  'backend.reconnect(createAttachBackendPlan("backend.attach"))',
  'backend.connect(createStartBackendPlan({ directory: "fixture", port: 0 }))',
  "backend.connect(createAttachBackendPlan({ port: 7373 }))",
  "function recordStartupFailure() {}",
  'console.log("backend sidecar failed: fixture")',
  'console.log("render-process-gone did-fail-load renderer load failed")',
  'console.log("proxy-bypass-list NO_PROXY no_proxy")',
  'console.log("before-quit window-all-closed input.backend.close quitReady quitContinuation")',
  "export {}",
].join("\n")

const PACKAGED_PRELOAD_CONTRACT_FIXTURE = [
  'const { contextBridge, ipcRenderer } = require("electron")',
  'const menuCommandChannel = "ax-code:menu-command"',
  "const allowedCommands = new Set([",
  '  "platform.capabilities",',
  '  "release.checkUpdate",',
  '  "release.downloadUpdate",',
  '  "release.openDownloadedUpdate",',
  '  "external.open",',
  '  "dialog.chooseDirectory",',
  '  "path.reveal",',
  '  "editor.open",',
  '  "notification.show",',
  '  "diagnostics.exportLogs",',
  '  "diagnostics.read",',
  '  "app.config",',
  '  "backend.attach",',
  '  "backend.start",',
  "])",
  'const allowedMenuCommands = new Set(["session.new", "composer.focus", "composer.run", "composer.queue", "diagnostics.refresh"])',
  'contextBridge.exposeInMainWorld("axCodeDesktop", {',
  "  invoke(name, payload = {}) {",
  "    if (!allowedCommands.has(name)) return Promise.reject(new Error('Unsupported desktop bridge command'))",
  '    return ipcRenderer.invoke("ax-code:bridge", { name, payload })',
  "  },",
  "  onMenuCommand(callback) {",
  "    const listener = (_event, payload) => {",
  "      const command = payload && typeof payload === 'object' ? payload.command : undefined",
  "      if (typeof command === 'string' && allowedMenuCommands.has(command)) callback(command)",
  "    }",
  "    ipcRenderer.on(menuCommandChannel, listener)",
  "    return () => ipcRenderer.removeListener(menuCommandChannel, listener)",
  "  },",
  "})",
].join("\n")

describe("mac desktop packaging", () => {
  test("rebuilds desktop artifacts without deleting existing mac bundles", async () => {
    const root = path.join(tmpdir(), `ax-code-desktop-build-preserve-${Date.now()}`)
    const sourceAppDist = path.join(root, "source-app")
    const outDir = path.join(root, "dist")
    const macBundleExecutable = path.join(outDir, "mac/AX Code.app/Contents/MacOS/AX Code")
    mkdirSync(sourceAppDist, { recursive: true })
    mkdirSync(path.dirname(macBundleExecutable), { recursive: true })
    writeFileSync(path.join(sourceAppDist, "index.html"), '<div id="root"></div>')
    writeFileSync(macBundleExecutable, "existing bundle")

    const artifacts = await buildDesktopArtifacts({ outDir, appDist: sourceAppDist })

    expect(existsSync(artifacts.mainPath)).toBe(true)
    expect(existsSync(artifacts.preloadPath)).toBe(true)
    expect(existsSync(artifacts.appIndexPath)).toBe(true)
    expect(readFileSync(macBundleExecutable, "utf8")).toBe("existing bundle")
  })

  test("creates an Electron .app bundle with runtime payload and closed release gates", () => {
    const root = path.join(tmpdir(), `ax-code-package-mac-${Date.now()}`)
    const artifacts = createBuildArtifacts(path.join(root, "build"))
    const electronAppPath = createElectronApp(path.join(root, "electron"))
    const packagingCommands: MacPackagingCommand[] = []
    const bundle = createMacAppBundle({
      artifacts,
      electronAppPath,
      iconSourcePath: path.join(electronAppPath, "Contents/Resources/electron.icns"),
      bundleRoot: path.join(root, "dist/mac"),
      version: "9.8.7",
      electronVersion: "42.3.0",
      commandRunner: (command) => packagingCommands.push(command),
    })

    expect(existsSync(path.join(bundle.bundlePath, "Contents/Info.plist"))).toBe(true)
    expect(existsSync(path.join(bundle.bundlePath, "Contents/MacOS/AX Code"))).toBe(true)
    expect(existsSync(path.join(bundle.bundlePath, "Contents/MacOS/Electron"))).toBe(false)
    expect(existsSync(path.join(bundle.appPayloadPath, "main.js"))).toBe(true)
    expect(existsSync(path.join(bundle.appPayloadPath, "main.js.map"))).toBe(true)
    expect(existsSync(path.join(bundle.appPayloadPath, "preload.cjs"))).toBe(true)
    expect(existsSync(path.join(bundle.appPayloadPath, "app/index.html"))).toBe(true)
    expect(existsSync(bundle.iconPath)).toBe(true)
    expect(existsSync(path.join(bundle.resourcesPath, "default_app.asar"))).toBe(false)
    expect(existsSync(path.join(bundle.resourcesPath, "electron.icns"))).toBe(false)

    const infoPlist = readFileSync(path.join(bundle.bundlePath, "Contents/Info.plist"), "utf8")
    expect(infoPlist).toContain("<key>CFBundleExecutable</key>\n\t<string>AX Code</string>")
    expect(infoPlist).toContain("<string>digital.defai.ax-code</string>")
    expect(infoPlist).toContain("<key>CFBundleDisplayName</key>")
    expect(infoPlist).toContain("<key>CFBundleIconFile</key>\n\t<string>ax-code.icns</string>")
    expect(infoPlist).toContain("<key>CFBundleShortVersionString</key>\n\t<string>9.8.7</string>")
    expect(infoPlist).toContain("<key>CFBundleVersion</key>\n\t<string>9.8.7</string>")
    expect(infoPlist).not.toContain("ElectronAsarIntegrity")
    expect(infoPlist).not.toContain("NSAppTransportSecurity")
    expect(infoPlist).not.toContain("NSAllowsArbitraryLoads")
    expect(infoPlist).not.toContain("NSAudioCaptureUsageDescription")
    expect(infoPlist).not.toContain("NSBluetoothAlwaysUsageDescription")
    expect(infoPlist).not.toContain("NSBluetoothPeripheralUsageDescription")
    expect(infoPlist).not.toContain("NSCameraUsageDescription")
    expect(infoPlist).not.toContain("NSMicrophoneUsageDescription")

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
    expect(packagingCommands).toEqual([
      {
        command: "/usr/bin/codesign",
        args: ["--force", "--deep", "--sign", "-", bundle.bundlePath],
      },
    ])

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
    expect(smoke.checks.backendLifecycleBridge).toBe(true)
    expect(smoke.checks.diagnosticsLogExport).toBe(true)
    expect(smoke.checks.startupFailureDiagnostics).toBe(true)
    expect(smoke.checks.rendererCrashDiagnostics).toBe(true)
    expect(smoke.checks.loopbackProxyBypass).toBe(true)
    expect(smoke.checks.cleanShutdownLifecycle).toBe(true)
    expect(smoke.checks.preloadBridgeAllowlist).toBe(true)
    expect(smoke.checks.preloadNoRawIpcExposure).toBe(true)
    expect(smoke.checks.preloadMenuCommandFilter).toBe(true)
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
  writeFileSync(path.join(outDir, "main.js"), PACKAGED_MAIN_CONTRACT_FIXTURE)
  writeFileSync(path.join(outDir, "main.js.map"), "{}")
  writeFileSync(path.join(outDir, "preload.cjs"), PACKAGED_PRELOAD_CONTRACT_FIXTURE)
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
  const electronExecutable = path.join(contentsPath, "MacOS/Electron")
  writeFileSync(electronExecutable, "")
  chmodSync(electronExecutable, 0o755)
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
      "\t<key>NSAppTransportSecurity</key>",
      "\t<dict>",
      "\t\t<key>NSAllowsArbitraryLoads</key>",
      "\t\t<true/>",
      "\t</dict>",
      "\t<key>NSAudioCaptureUsageDescription</key>",
      "\t<string>This app needs access to audio capture</string>",
      "\t<key>NSBluetoothAlwaysUsageDescription</key>",
      "\t<string>This app needs access to Bluetooth</string>",
      "\t<key>NSBluetoothPeripheralUsageDescription</key>",
      "\t<string>This app needs access to Bluetooth</string>",
      "\t<key>NSCameraUsageDescription</key>",
      "\t<string>This app needs access to the camera</string>",
      "\t<key>NSMicrophoneUsageDescription</key>",
      "\t<string>This app needs access to the microphone</string>",
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
