import { chmodSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { createElectronHostPlan } from "../src/electron/config"
import { createPackagedDesktopSmokePlan, validatePackagedDesktopSmokePlan } from "../src/packaging/smoke"

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
    writeFileSync(mainPath, PACKAGED_MAIN_CONTRACT_FIXTURE)
    writeFileSync(preloadPath, PACKAGED_PRELOAD_CONTRACT_FIXTURE)
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
        backendLifecycleBridge: true,
        diagnosticsLogExport: true,
        startupFailureDiagnostics: true,
        rendererCrashDiagnostics: true,
        loopbackProxyBypass: true,
        cleanShutdownLifecycle: true,
        rendererIndex: true,
        preload: true,
        preloadBridgeAllowlist: true,
        preloadNoRawIpcExposure: true,
        preloadMenuCommandFilter: true,
        customProtocol: true,
        sandboxedRenderer: true,
      },
    })
  })

  test("defaults packaged smoke to the mac app bundle payload when it exists", () => {
    const root = path.join(tmpdir(), `ax-code-desktop-smoke-mac-${Date.now()}`)
    const bundlePath = path.join(root, "dist/mac/AX Code.app")
    const resourcesPath = path.join(bundlePath, "Contents/Resources")
    const payloadPath = path.join(resourcesPath, "app")
    const appDist = path.join(payloadPath, "app")
    const electronPackagePath = path.join(root, "electron-package.json")
    const electronBinaryPath = path.join(root, "Electron")
    mkdirSync(appDist, { recursive: true })
    mkdirSync(path.join(bundlePath, "Contents/MacOS"), { recursive: true })
    writeFileSync(
      path.join(bundlePath, "Contents/Info.plist"),
      [
        "<plist>",
        "<dict>",
        "<key>CFBundleExecutable</key>",
        "<string>AX Code</string>",
        "<key>CFBundleIconFile</key>",
        "<string>ax-code.icns</string>",
        "<key>CFBundleShortVersionString</key>",
        "<string>9.8.7</string>",
        "<key>CFBundleVersion</key>",
        "<string>9.8.7</string>",
        "</dict>",
        "</plist>",
      ].join("\n"),
    )
    const executablePath = path.join(bundlePath, "Contents/MacOS/AX Code")
    writeFileSync(executablePath, "")
    chmodSync(executablePath, 0o755)
    writeFileSync(path.join(resourcesPath, "ax-code.icns"), "")
    writeFileSync(path.join(appDist, "index.html"), '<div id="root"></div>')
    writeFileSync(path.join(payloadPath, "main.js"), PACKAGED_MAIN_CONTRACT_FIXTURE)
    writeFileSync(path.join(payloadPath, "preload.cjs"), PACKAGED_PRELOAD_CONTRACT_FIXTURE)
    writeFileSync(path.join(payloadPath, "package.json"), '{"name":"@ax-code/desktop","main":"main.js"}')
    writeFileSync(electronPackagePath, '{"version":"42.3.0"}')
    writeFileSync(electronBinaryPath, "")
    writeFileSync(
      path.join(resourcesPath, "ax-code-release.json"),
      JSON.stringify({
        version: "9.8.7",
        packageTarget: "mac",
        appPath: bundlePath,
        signed: false,
        notarized: false,
        updaterConfigured: false,
      }),
    )

    const smoke = createPackagedDesktopSmokePlan({
      root,
      electronVersion: "42.3.0",
      electronPackagePath,
      electronBinaryPath,
    })

    expect(smoke.packageTarget).toBe("mac")
    expect(smoke.mainPath).toBe(path.join(payloadPath, "main.js"))
    expect(smoke.appDist).toBe(appDist)
    expect(smoke.preloadPath).toBe(path.join(payloadPath, "preload.cjs"))
    expect(smoke.macBundlePath).toBe(bundlePath)
    expect(smoke.checks.macBundle).toBe(true)
    expect(smoke.checks.releaseManifest).toBe(true)
  })

  test("fails when the mac app bundle executable is not executable", () => {
    const root = path.join(tmpdir(), `ax-code-desktop-smoke-mac-mode-${Date.now()}`)
    const bundlePath = path.join(root, "dist/mac/AX Code.app")
    const resourcesPath = path.join(bundlePath, "Contents/Resources")
    const payloadPath = path.join(resourcesPath, "app")
    const appDist = path.join(payloadPath, "app")
    const electronPackagePath = path.join(root, "electron-package.json")
    const electronBinaryPath = path.join(root, "Electron")
    mkdirSync(appDist, { recursive: true })
    mkdirSync(path.join(bundlePath, "Contents/MacOS"), { recursive: true })
    writeFileSync(
      path.join(bundlePath, "Contents/Info.plist"),
      [
        "<plist>",
        "<dict>",
        "<key>CFBundleExecutable</key>",
        "<string>AX Code</string>",
        "<key>CFBundleIconFile</key>",
        "<string>ax-code.icns</string>",
        "<key>CFBundleShortVersionString</key>",
        "<string>9.8.7</string>",
        "</dict>",
        "</plist>",
      ].join("\n"),
    )
    const executablePath = path.join(bundlePath, "Contents/MacOS/AX Code")
    writeFileSync(executablePath, "")
    chmodSync(executablePath, 0o644)
    writeFileSync(path.join(resourcesPath, "ax-code.icns"), "")
    writeFileSync(path.join(appDist, "index.html"), '<div id="root"></div>')
    writeFileSync(path.join(payloadPath, "main.js"), PACKAGED_MAIN_CONTRACT_FIXTURE)
    writeFileSync(path.join(payloadPath, "preload.cjs"), PACKAGED_PRELOAD_CONTRACT_FIXTURE)
    writeFileSync(path.join(payloadPath, "package.json"), '{"name":"@ax-code/desktop","main":"main.js"}')
    writeFileSync(electronPackagePath, '{"version":"42.3.0"}')
    writeFileSync(electronBinaryPath, "")
    writeFileSync(
      path.join(resourcesPath, "ax-code-release.json"),
      JSON.stringify({
        version: "9.8.7",
        packageTarget: "mac",
        appPath: bundlePath,
        signed: false,
        notarized: false,
        updaterConfigured: false,
      }),
    )

    expect(() =>
      createPackagedDesktopSmokePlan({
        root,
        electronVersion: "42.3.0",
        electronPackagePath,
        electronBinaryPath,
      }),
    ).toThrow("Mac app bundle executable must have executable permissions")
  })

  test("fails when the mac app bundle allows arbitrary network loads", () => {
    const root = path.join(tmpdir(), `ax-code-desktop-smoke-mac-ats-${Date.now()}`)
    const bundlePath = path.join(root, "dist/mac/AX Code.app")
    const resourcesPath = path.join(bundlePath, "Contents/Resources")
    const payloadPath = path.join(resourcesPath, "app")
    const appDist = path.join(payloadPath, "app")
    const electronPackagePath = path.join(root, "electron-package.json")
    const electronBinaryPath = path.join(root, "Electron")
    mkdirSync(appDist, { recursive: true })
    mkdirSync(path.join(bundlePath, "Contents/MacOS"), { recursive: true })
    writeFileSync(
      path.join(bundlePath, "Contents/Info.plist"),
      [
        "<plist>",
        "<dict>",
        "<key>CFBundleExecutable</key>",
        "<string>AX Code</string>",
        "<key>CFBundleIconFile</key>",
        "<string>ax-code.icns</string>",
        "<key>CFBundleShortVersionString</key>",
        "<string>9.8.7</string>",
        "<key>CFBundleVersion</key>",
        "<string>9.8.7</string>",
        "<key>NSAppTransportSecurity</key>",
        "<dict>",
        "<key>NSAllowsArbitraryLoads</key>",
        "<true/>",
        "</dict>",
        "</dict>",
        "</plist>",
      ].join("\n"),
    )
    const executablePath = path.join(bundlePath, "Contents/MacOS/AX Code")
    writeFileSync(executablePath, "")
    chmodSync(executablePath, 0o755)
    writeFileSync(path.join(resourcesPath, "ax-code.icns"), "")
    writeFileSync(path.join(appDist, "index.html"), '<div id="root"></div>')
    writeFileSync(path.join(payloadPath, "main.js"), PACKAGED_MAIN_CONTRACT_FIXTURE)
    writeFileSync(path.join(payloadPath, "preload.cjs"), PACKAGED_PRELOAD_CONTRACT_FIXTURE)
    writeFileSync(path.join(payloadPath, "package.json"), '{"name":"@ax-code/desktop","main":"main.js"}')
    writeFileSync(electronPackagePath, '{"version":"42.3.0"}')
    writeFileSync(electronBinaryPath, "")
    writeFileSync(
      path.join(resourcesPath, "ax-code-release.json"),
      JSON.stringify({
        version: "9.8.7",
        packageTarget: "mac",
        appPath: bundlePath,
        signed: false,
        notarized: false,
        updaterConfigured: false,
      }),
    )

    expect(() =>
      createPackagedDesktopSmokePlan({
        root,
        electronVersion: "42.3.0",
        electronPackagePath,
        electronBinaryPath,
      }),
    ).toThrow("Mac app bundle must not allow arbitrary network loads")
  })

  test("fails when the mac app bundle advertises unused privacy permissions", () => {
    const root = path.join(tmpdir(), `ax-code-desktop-smoke-mac-privacy-${Date.now()}`)
    const bundlePath = path.join(root, "dist/mac/AX Code.app")
    const resourcesPath = path.join(bundlePath, "Contents/Resources")
    const payloadPath = path.join(resourcesPath, "app")
    const appDist = path.join(payloadPath, "app")
    const electronPackagePath = path.join(root, "electron-package.json")
    const electronBinaryPath = path.join(root, "Electron")
    mkdirSync(appDist, { recursive: true })
    mkdirSync(path.join(bundlePath, "Contents/MacOS"), { recursive: true })
    writeFileSync(
      path.join(bundlePath, "Contents/Info.plist"),
      [
        "<plist>",
        "<dict>",
        "<key>CFBundleExecutable</key>",
        "<string>AX Code</string>",
        "<key>CFBundleIconFile</key>",
        "<string>ax-code.icns</string>",
        "<key>CFBundleShortVersionString</key>",
        "<string>9.8.7</string>",
        "<key>CFBundleVersion</key>",
        "<string>9.8.7</string>",
        "<key>NSCameraUsageDescription</key>",
        "<string>This app needs access to the camera</string>",
        "</dict>",
        "</plist>",
      ].join("\n"),
    )
    const executablePath = path.join(bundlePath, "Contents/MacOS/AX Code")
    writeFileSync(executablePath, "")
    chmodSync(executablePath, 0o755)
    writeFileSync(path.join(resourcesPath, "ax-code.icns"), "")
    writeFileSync(path.join(appDist, "index.html"), '<div id="root"></div>')
    writeFileSync(path.join(payloadPath, "main.js"), PACKAGED_MAIN_CONTRACT_FIXTURE)
    writeFileSync(path.join(payloadPath, "preload.cjs"), PACKAGED_PRELOAD_CONTRACT_FIXTURE)
    writeFileSync(path.join(payloadPath, "package.json"), '{"name":"@ax-code/desktop","main":"main.js"}')
    writeFileSync(electronPackagePath, '{"version":"42.3.0"}')
    writeFileSync(electronBinaryPath, "")
    writeFileSync(
      path.join(resourcesPath, "ax-code-release.json"),
      JSON.stringify({
        version: "9.8.7",
        packageTarget: "mac",
        appPath: bundlePath,
        signed: false,
        notarized: false,
        updaterConfigured: false,
      }),
    )

    expect(() =>
      createPackagedDesktopSmokePlan({
        root,
        electronVersion: "42.3.0",
        electronPackagePath,
        electronBinaryPath,
      }),
    ).toThrow("Mac app bundle must not advertise unused privacy permission: NSCameraUsageDescription")
  })

  test("fails default packaged smoke when the mac app bundle is missing", () => {
    const root = path.join(tmpdir(), `ax-code-desktop-smoke-missing-mac-${Date.now()}`)
    const electronPackagePath = path.join(root, "electron-package.json")
    const electronBinaryPath = path.join(root, "Electron")
    mkdirSync(root, { recursive: true })
    writeFileSync(electronPackagePath, '{"version":"42.3.0"}')
    writeFileSync(electronBinaryPath, "")

    expect(() =>
      createPackagedDesktopSmokePlan({
        root,
        electronVersion: "42.3.0",
        electronPackagePath,
        electronBinaryPath,
      }),
    ).toThrow("Desktop main is missing")
  })

  test("fails when the packaged main leaves runtime dependencies externalized", () => {
    const root = path.join(tmpdir(), `ax-code-desktop-smoke-external-${Date.now()}`)
    const appDist = path.join(root, "app-dist")
    const mainPath = path.join(root, "main.js")
    const preloadPath = path.join(root, "preload.cjs")
    mkdirSync(appDist, { recursive: true })
    writeFileSync(path.join(appDist, "index.html"), '<div id="root"></div>')
    writeFileSync(mainPath, 'import { startHeadlessBackend } from "@ax-code/sdk/headless"\nexport {}')
    writeFileSync(preloadPath, PACKAGED_PRELOAD_CONTRACT_FIXTURE)

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

  test("fails when the packaged main omits bridge and diagnostics runtime contracts", () => {
    const root = path.join(tmpdir(), `ax-code-desktop-smoke-contract-${Date.now()}`)
    const appDist = path.join(root, "app-dist")
    const mainPath = path.join(root, "main.js")
    const preloadPath = path.join(root, "preload.cjs")
    mkdirSync(appDist, { recursive: true })
    writeFileSync(path.join(appDist, "index.html"), '<div id="root"></div>')
    writeFileSync(mainPath, "export {}")
    writeFileSync(preloadPath, PACKAGED_PRELOAD_CONTRACT_FIXTURE)

    expect(() =>
      createPackagedDesktopSmokePlan({
        appDist,
        mainPath,
        preloadPath,
        electronVersion: "42.3.0",
        electronPackagePath: import.meta.path,
        electronBinaryPath: import.meta.path,
      }),
    ).toThrow("Desktop main is missing packaged runtime contract")
  })

  test("fails when the packaged main only preserves backend command names without lifecycle wiring", () => {
    const root = path.join(tmpdir(), `ax-code-desktop-smoke-lifecycle-${Date.now()}`)
    const appDist = path.join(root, "app-dist")
    const mainPath = path.join(root, "main.js")
    const preloadPath = path.join(root, "preload.cjs")
    mkdirSync(appDist, { recursive: true })
    writeFileSync(path.join(appDist, "index.html"), '<div id="root"></div>')
    writeFileSync(
      mainPath,
      [
        'const bridgeCommands = ["backend.start", "backend.attach", "diagnostics.read", "diagnostics.exportLogs"]',
        "function recordStartupFailure() {}",
        'console.log("backend sidecar failed: fixture")',
        'console.log("render-process-gone did-fail-load renderer load failed")',
        'console.log("proxy-bypass-list NO_PROXY no_proxy")',
        'console.log("before-quit window-all-closed input.backend.close quitReady quitContinuation")',
        "export {}",
      ].join("\n"),
    )
    writeFileSync(preloadPath, PACKAGED_PRELOAD_CONTRACT_FIXTURE)

    expect(() =>
      createPackagedDesktopSmokePlan({
        appDist,
        mainPath,
        preloadPath,
        electronVersion: "42.3.0",
        electronPackagePath: import.meta.path,
        electronBinaryPath: import.meta.path,
      }),
    ).toThrow("backend lifecycle bridge")
  })

  test("fails when the packaged preload exposes raw ipc", () => {
    const root = path.join(tmpdir(), `ax-code-desktop-smoke-preload-${Date.now()}`)
    const appDist = path.join(root, "app-dist")
    const mainPath = path.join(root, "main.js")
    const preloadPath = path.join(root, "preload.cjs")
    mkdirSync(appDist, { recursive: true })
    writeFileSync(path.join(appDist, "index.html"), '<div id="root"></div>')
    writeFileSync(mainPath, PACKAGED_MAIN_CONTRACT_FIXTURE)
    writeFileSync(
      preloadPath,
      `${PACKAGED_PRELOAD_CONTRACT_FIXTURE}\ncontextBridge.exposeInMainWorld("ipcRenderer", ipcRenderer)`,
    )

    expect(() =>
      createPackagedDesktopSmokePlan({
        appDist,
        mainPath,
        preloadPath,
        electronVersion: "42.3.0",
        electronPackagePath: import.meta.path,
        electronBinaryPath: import.meta.path,
      }),
    ).toThrow("forbidden raw IPC exposure")
  })

  test("fails when the packaged preload bridge allowlist drifts from schema", () => {
    const root = path.join(tmpdir(), `ax-code-desktop-smoke-preload-allowlist-${Date.now()}`)
    const appDist = path.join(root, "app-dist")
    const mainPath = path.join(root, "main.js")
    const preloadPath = path.join(root, "preload.cjs")
    mkdirSync(appDist, { recursive: true })
    writeFileSync(path.join(appDist, "index.html"), '<div id="root"></div>')
    writeFileSync(mainPath, PACKAGED_MAIN_CONTRACT_FIXTURE)
    writeFileSync(preloadPath, PACKAGED_PRELOAD_CONTRACT_FIXTURE.replace("])", '  "backend.stop",\n])'))

    expect(() =>
      createPackagedDesktopSmokePlan({
        appDist,
        mainPath,
        preloadPath,
        electronVersion: "42.3.0",
        electronPackagePath: import.meta.path,
        electronBinaryPath: import.meta.path,
      }),
    ).toThrow("unexpected bridge commands: backend.stop")
  })

  test("fails when packaged renderer assets are missing", () => {
    const root = path.join(tmpdir(), `ax-code-desktop-smoke-missing-${Date.now()}`)
    const mainPath = path.join(root, "main.js")
    const preloadPath = path.join(root, "preload.cjs")
    mkdirSync(root, { recursive: true })
    writeFileSync(mainPath, "export {}")
    writeFileSync(preloadPath, PACKAGED_PRELOAD_CONTRACT_FIXTURE)
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

  test("fails when packaged desktop trust expands to loopback renderer origins", () => {
    const root = path.join(tmpdir(), `ax-code-desktop-smoke-trust-${Date.now()}`)
    const appDist = path.join(root, "app-dist")
    const mainPath = path.join(root, "main.js")
    const preloadPath = path.join(root, "preload.cjs")
    mkdirSync(appDist, { recursive: true })
    writeFileSync(path.join(appDist, "index.html"), '<div id="root"></div>')
    writeFileSync(mainPath, "export {}")
    writeFileSync(preloadPath, PACKAGED_PRELOAD_CONTRACT_FIXTURE)
    const plan = {
      ...createElectronHostPlan({
        appDist,
        preloadPath,
      }),
      allowedNavigation: ["app://ax-code", "http://127.0.0.1:5173"],
      trustedBridgeOrigins: ["http://127.0.0.1:5173"],
    }

    expect(() =>
      validatePackagedDesktopSmokePlan(plan, {
        electronVersion: "42.3.0",
        electronPackagePath: import.meta.path,
        electronBinaryPath: import.meta.path,
        mainPath,
      }),
    ).toThrow("Packaged renderer navigation must stay on the custom app protocol")
  })
})
