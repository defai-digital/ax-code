import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { createMacAppBundle, type MacPackagingResult } from "../src/packaging/mac"
import { releaseMacApp, type MacReleaseCommand } from "../src/packaging/release-mac"
import { readDesktopReleaseDiagnostics } from "../src/packaging/release-diagnostics"

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

describe("mac release pipeline", () => {
  test("signs, notarizes, staples, archives, and writes update-backed release diagnostics", async () => {
    const root = path.join(tmpdir(), `ax-code-release-mac-${Date.now()}`)
    const packaging = createPackagedResult(root)
    const archivePath = path.join(root, "dist/AX Code.app.zip")
    const updateManifestPath = path.join(root, "dist/ax-code-update.json")
    const commands: MacReleaseCommand[] = []
    let archiveWrites = 0

    const result = await releaseMacApp({
      packaged: packaging,
      signingIdentity: "Developer ID Application: Example",
      notarization: { profile: "ax-code-notary" },
      updateFeedUrl: "https://updates.example.test/ax-code/",
      archivePath,
      updateManifestPath,
      commandRunner: async (command) => {
        commands.push(command)
        if (
          command.command === "/usr/bin/codesign" ||
          command.command === "/usr/bin/ditto" ||
          command.command === "/usr/bin/xcrun"
        ) {
          expect(readDesktopReleaseDiagnostics({ resourcesPath: packaging.bundle.resourcesPath })).toMatchObject({
            status: "manifest-found",
            signed: true,
            notarized: true,
            updaterConfigured: true,
            updatePolicy: "feed-configured",
            updateFeed: {
              url: "https://updates.example.test/ax-code/",
              manifestName: "ax-code-update.json",
            },
            gates: {
              signing: { configured: true, status: "passed" },
              notarization: { configured: true, status: "passed" },
              updater: { configured: true, status: "passed" },
            },
          })
          const installed = readDesktopReleaseDiagnostics({ resourcesPath: packaging.bundle.resourcesPath })
          expect(installed.updateFeed).not.toHaveProperty("manifestPath")
          expect(installed.updateFeed).not.toHaveProperty("artifactPath")
          expect(installed.updateFeed).not.toHaveProperty("artifactName")
          expect(installed.updateFeed).not.toHaveProperty("artifactUrl")
          expect(installed.updateFeed).not.toHaveProperty("sha256")
          expect(installed.updateFeed).not.toHaveProperty("sizeBytes")
        }
        if (command.command === "/usr/bin/ditto") {
          archiveWrites++
          writeFileSync(archivePath, archiveWrites === 1 ? "pre-staple" : "post-staple")
        }
      },
    })

    expect(commands.map((command) => [command.command, command.args[0]])).toEqual([
      ["/usr/bin/codesign", "--force"],
      ["/usr/bin/codesign", "--verify"],
      ["/usr/bin/ditto", "-c"],
      ["/usr/bin/xcrun", "notarytool"],
      ["/usr/bin/xcrun", "stapler"],
      ["/usr/bin/xcrun", "stapler"],
      ["/usr/bin/ditto", "-c"],
    ])
    expect(commands[0].args).toContain("Developer ID Application: Example")
    expect(commands[0].args).toContain("--entitlements")
    const entitlementsPath = commands[0].args[commands[0].args.indexOf("--entitlements") + 1]
    expect(entitlementsPath.endsWith(path.join("resources", "entitlements.mac.plist"))).toBe(true)
    expect(commands[1].args).toContain("--strict")
    expect(commands[3].args).toContain("ax-code-notary")
    expect(commands[5].args).toContain("validate")
    expect(existsSync(archivePath)).toBe(true)
    expect(readFileSync(archivePath, "utf8")).toBe("post-staple")
    expect(result.releaseManifest).toMatchObject({
      signed: true,
      notarized: true,
      updaterConfigured: true,
      updateFeed: {
        url: "https://updates.example.test/ax-code/",
        manifestName: "ax-code-update.json",
      },
      gates: {
        signing: { configured: true, status: "passed" },
        notarization: { configured: true, status: "passed" },
        updater: { configured: true, status: "passed" },
      },
    })
    expect(result.releaseManifest.updateFeed).not.toHaveProperty("manifestPath")
    expect(result.releaseManifest.updateFeed).not.toHaveProperty("artifactPath")
    expect(result.releaseManifest.updateFeed).not.toHaveProperty("artifactName")
    expect(result.releaseManifest.updateFeed).not.toHaveProperty("artifactUrl")
    expect(result.releaseManifest.updateFeed).not.toHaveProperty("sha256")
    expect(result.releaseManifest.updateFeed).not.toHaveProperty("sizeBytes")

    const updateFeed = JSON.parse(readFileSync(updateManifestPath, "utf8")) as Record<string, unknown>
    expect(updateFeed).toMatchObject({
      productName: "AX Code",
      version: "9.8.7",
      platform: "darwin",
      manifestName: "ax-code-update.json",
      artifactName: "AX Code.app.zip",
      artifactUrl: "https://updates.example.test/ax-code/AX%20Code.app.zip",
      sizeBytes: 11,
    })
    expect(typeof updateFeed.sha256).toBe("string")

    expect(readDesktopReleaseDiagnostics({ resourcesPath: packaging.bundle.resourcesPath })).toMatchObject({
      status: "manifest-found",
      signed: true,
      notarized: true,
      updaterConfigured: true,
      updatePolicy: "feed-configured",
      updateFeed: {
        url: "https://updates.example.test/ax-code/",
        manifestName: "ax-code-update.json",
      },
      gates: {
        signing: { configured: true, status: "passed" },
        notarization: { configured: true, status: "passed" },
        updater: { configured: true, status: "passed" },
      },
    })
    const installed = readDesktopReleaseDiagnostics({ resourcesPath: packaging.bundle.resourcesPath })
    expect(installed.updateFeed).not.toHaveProperty("manifestPath")
    expect(installed.updateFeed).not.toHaveProperty("artifactPath")
    expect(installed.updateFeed).not.toHaveProperty("artifactName")
    expect(installed.updateFeed).not.toHaveProperty("artifactUrl")
    expect(installed.updateFeed).not.toHaveProperty("sha256")
    expect(installed.updateFeed).not.toHaveProperty("sizeBytes")
  })

  test("keeps release gates closed when notarization fails before update evidence exists", async () => {
    const root = path.join(tmpdir(), `ax-code-release-mac-fail-${Date.now()}`)
    const packaging = createPackagedResult(root)
    const archivePath = path.join(root, "dist/AX Code.app.zip")

    await expect(
      releaseMacApp({
        packaged: packaging,
        signingIdentity: "Developer ID Application: Example",
        notarization: { profile: "ax-code-notary" },
        updateFeedUrl: "https://updates.example.test/ax-code/",
        archivePath,
        commandRunner: async (command) => {
          if (command.command === "/usr/bin/ditto") writeFileSync(archivePath, "pre-staple")
          if (command.command === "/usr/bin/xcrun" && command.args[0] === "notarytool") {
            throw new Error("notary failed")
          }
        },
      }),
    ).rejects.toThrow("notary failed")

    expect(readDesktopReleaseDiagnostics({ resourcesPath: packaging.bundle.resourcesPath })).toMatchObject({
      status: "manifest-found",
      updatePolicy: "disabled-until-release-pipeline",
      signed: false,
      notarized: false,
      updaterConfigured: false,
      gates: {
        signing: { configured: false, status: "blocked" },
        notarization: { configured: false, status: "blocked" },
        updater: { configured: false, status: "blocked" },
      },
    })
  })

  test("requires an HTTPS update feed for public release artifacts", async () => {
    const root = path.join(tmpdir(), `ax-code-release-mac-feed-${Date.now()}`)
    const packaging = createPackagedResult(root)

    await expect(
      releaseMacApp({
        packaged: packaging,
        signingIdentity: "Developer ID Application: Example",
        notarization: { profile: "ax-code-notary" },
        updateFeedUrl: "http://updates.example.test/ax-code/",
        commandRunner: async () => {},
      }),
    ).rejects.toThrow("Mac release update feed URL must use HTTPS.")
  })

  test("requires a release entitlements file before signing", async () => {
    const root = path.join(tmpdir(), `ax-code-release-mac-entitlements-${Date.now()}`)
    const packaging = createPackagedResult(root)

    await expect(
      releaseMacApp({
        packaged: packaging,
        signingIdentity: "Developer ID Application: Example",
        entitlementsPath: path.join(root, "missing-entitlements.plist"),
        notarization: { profile: "ax-code-notary" },
        updateFeedUrl: "https://updates.example.test/ax-code/",
        commandRunner: async () => {},
      }),
    ).rejects.toThrow("Mac release entitlements file is missing:")
  })

  test("keeps the default update feed manifest outside the signed app bundle", async () => {
    const root = path.join(tmpdir(), `ax-code-release-mac-default-feed-${Date.now()}`)
    const packaging = createPackagedResult(root)
    const archivePath = path.join(root, "dist/AX Code.app.zip")
    let archiveWrites = 0

    const result = await releaseMacApp({
      packaged: packaging,
      signingIdentity: "Developer ID Application: Example",
      notarization: { profile: "ax-code-notary" },
      updateFeedUrl: "https://updates.example.test/ax-code/",
      archivePath,
      commandRunner: async (command) => {
        if (command.command === "/usr/bin/ditto") {
          archiveWrites++
          writeFileSync(archivePath, archiveWrites === 1 ? "pre-staple" : "post-staple")
        }
      },
    })

    expect(result.updateFeed.manifestPath).toBe(path.join(path.dirname(archivePath), "ax-code-update.json"))
    expect(result.updateFeed.manifestPath?.startsWith(packaging.bundle.resourcesPath)).toBe(false)
    expect(existsSync(result.updateFeed.manifestPath!)).toBe(true)
  })
})

function createPackagedResult(root: string): MacPackagingResult {
  const artifacts = createBuildArtifacts(path.join(root, "build"))
  const electronAppPath = createElectronApp(path.join(root, "electron"))
  const bundle = createMacAppBundle({
    artifacts,
    electronAppPath,
    iconSourcePath: path.join(electronAppPath, "Contents/Resources/electron.icns"),
    bundleRoot: path.join(root, "dist/mac"),
    version: "9.8.7",
    electronVersion: "42.3.0",
    commandRunner: () => {},
  })
  return {
    artifacts,
    bundle,
    smoke: {
      packageTarget: "mac",
      electronVersion: "42.3.0",
      electronPackagePath: path.join(root, "electron/electron-package.json"),
      electronBinaryPath: path.join(electronAppPath, "Contents/MacOS/Electron"),
      rendererUrl: "app://ax-code/index.html",
      mainPath: path.join(bundle.appPayloadPath, "main.js"),
      appDist: path.join(bundle.appPayloadPath, "app"),
      preloadPath: path.join(bundle.appPayloadPath, "preload.cjs"),
      macBundlePath: bundle.bundlePath,
      releaseManifestPath: bundle.releaseManifestPath,
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
        macBundle: true,
        releaseManifest: true,
      },
    },
  }
}

function createBuildArtifacts(outDir: string) {
  const appDist = path.join(outDir, "app")
  mkdirSync(appDist, { recursive: true })
  writeFileSync(path.join(outDir, "main.js"), PACKAGED_MAIN_CONTRACT_FIXTURE)
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
  writeFileSync(path.join(contentsPath, "MacOS/Electron"), "")
  writeFileSync(path.join(resourcesPath, "default_app.asar"), "")
  writeFileSync(path.join(resourcesPath, "electron.icns"), "")
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
      "</dict>",
      "</plist>",
    ].join("\n"),
  )
  return electronAppPath
}
