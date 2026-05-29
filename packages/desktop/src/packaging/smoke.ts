import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { parseArgs } from "node:util"
import { bridgeCommandSchemas } from "../bridge/schema"
import { APP_PROTOCOL, createElectronHostPlan, rendererEntryUrl, type ElectronHostPlan } from "../electron/config"
import { DESKTOP_MENU_COMMANDS } from "../electron/menu"
import { MAC_RELEASE_MANIFEST_NAME } from "./release-diagnostics"

const MAC_ICON_FILE = "ax-code.icns"
const MAC_EXECUTABLE_NAME = "AX Code"
const UNUSED_ELECTRON_PRIVACY_USAGE_KEYS = [
  "NSAudioCaptureUsageDescription",
  "NSBluetoothAlwaysUsageDescription",
  "NSBluetoothPeripheralUsageDescription",
  "NSCameraUsageDescription",
  "NSMicrophoneUsageDescription",
]

export type PackagedDesktopSmokePlan = {
  packageTarget?: string
  electronVersion: string
  electronPackagePath: string
  electronBinaryPath: string
  rendererUrl: string
  mainPath: string
  appDist: string
  preloadPath: string
  macBundlePath?: string
  releaseManifestPath?: string
  checks: {
    electronDependency: true
    main: true
    runtimeDependencyClosure: true
    backendLifecycleBridge: true
    diagnosticsLogExport: true
    startupFailureDiagnostics: true
    rendererCrashDiagnostics: true
    loopbackProxyBypass: true
    cleanShutdownLifecycle: true
    rendererIndex: true
    preload: true
    preloadBridgeAllowlist: true
    preloadNoRawIpcExposure: true
    preloadMenuCommandFilter: true
    customProtocol: true
    sandboxedRenderer: true
    macBundle?: true
    releaseManifest?: true
  }
}

export function createPackagedDesktopSmokePlan(input: {
  root?: string
  appDist?: string
  preloadPath?: string
  electronVersion?: string
  electronPackagePath?: string
  electronBinaryPath?: string
  mainPath?: string
  packageTarget?: string
  macBundlePath?: string
  releaseManifestPath?: string
}): PackagedDesktopSmokePlan {
  const root = input.root ?? path.resolve(import.meta.dirname, "../..")
  const defaultMacBundlePath = path.join(root, "dist/mac/AX Code.app")
  const shouldUseDefaultMacBundle = !input.appDist && !input.preloadPath && !input.mainPath
  const macBundlePath = input.macBundlePath ?? (shouldUseDefaultMacBundle ? defaultMacBundlePath : undefined)
  const macPayloadPath = macBundlePath ? path.join(macBundlePath, "Contents/Resources/app") : undefined
  const plan = createElectronHostPlan({
    appDist: input.appDist ?? (macPayloadPath ? path.join(macPayloadPath, "app") : path.join(root, "dist/app")),
    preloadPath:
      input.preloadPath ??
      (macPayloadPath ? path.join(macPayloadPath, "preload.cjs") : path.join(root, "dist/preload.cjs")),
  })
  const electronVersion = input.electronVersion ?? resolveElectronPackage().version
  const electronPackagePath = input.electronPackagePath ?? resolveElectronPackage().path
  const electronBinaryPath = input.electronBinaryPath ?? resolveElectronPackage().binaryPath
  return validatePackagedDesktopSmokePlan(plan, {
    electronVersion,
    electronPackagePath,
    electronBinaryPath,
    mainPath:
      input.mainPath ?? (macPayloadPath ? path.join(macPayloadPath, "main.js") : path.join(root, "dist/main.js")),
    packageTarget: input.packageTarget ?? (macBundlePath ? "mac" : undefined),
    macBundlePath,
    releaseManifestPath:
      input.releaseManifestPath ??
      (macBundlePath ? path.join(macBundlePath, "Contents/Resources", MAC_RELEASE_MANIFEST_NAME) : undefined),
  })
}

export function validatePackagedDesktopSmokePlan(
  plan: ElectronHostPlan,
  electron: {
    electronVersion: string
    electronPackagePath: string
    electronBinaryPath: string
    mainPath: string
    packageTarget?: string
    macBundlePath?: string
    releaseManifestPath?: string
  },
): PackagedDesktopSmokePlan {
  if (plan.renderer.kind !== "packaged") throw new Error("Packaged smoke requires packaged renderer mode")
  if (!electron.electronVersion) throw new Error("Electron dependency version is required")
  if (!electron.electronPackagePath || !existsSync(electron.electronPackagePath)) {
    throw new Error("Electron dependency is not installed")
  }
  if (!electron.electronBinaryPath || !existsSync(electron.electronBinaryPath)) {
    throw new Error("Electron executable is not installed")
  }
  if (!electron.mainPath || !existsSync(electron.mainPath))
    throw new Error(`Desktop main is missing: ${electron.mainPath}`)
  const mainSource = readFileSync(electron.mainPath, "utf8")
  assertBundledRuntimeDependencies(electron.mainPath, mainSource)
  const indexPath = path.join(plan.renderer.appDist, "index.html")
  if (!existsSync(indexPath)) throw new Error(`Renderer index is missing: ${indexPath}`)
  if (!existsSync(plan.preloadPath)) throw new Error(`Desktop preload is missing: ${plan.preloadPath}`)
  const preloadSource = readFileSync(plan.preloadPath, "utf8")
  const preloadContractChecks = assertPackagedPreloadRuntimeContract(plan.preloadPath, preloadSource)
  const url = rendererEntryUrl(plan.renderer)
  if (!url.startsWith(`${APP_PROTOCOL}://`)) throw new Error(`Packaged renderer must use ${APP_PROTOCOL}:// URL`)
  if (plan.allowedNavigation.some((entry) => new URL(entry).protocol !== `${APP_PROTOCOL}:`)) {
    throw new Error("Packaged renderer navigation must stay on the custom app protocol")
  }
  if (plan.trustedBridgeOrigins.length > 0) {
    throw new Error("Packaged renderer must not trust loopback bridge origins")
  }
  if (
    plan.window.webPreferences.nodeIntegration ||
    !plan.window.webPreferences.contextIsolation ||
    !plan.window.webPreferences.sandbox
  ) {
    throw new Error("Packaged renderer must keep Electron security defaults enabled")
  }
  const runtimeContractChecks = assertPackagedMainRuntimeContract(electron.mainPath, mainSource)
  const macBundle = electron.macBundlePath
    ? validateMacBundle({
        bundlePath: electron.macBundlePath,
        releaseManifestPath: electron.releaseManifestPath,
      })
    : undefined

  return {
    packageTarget: electron.packageTarget,
    electronVersion: electron.electronVersion,
    electronPackagePath: electron.electronPackagePath,
    electronBinaryPath: electron.electronBinaryPath,
    rendererUrl: url,
    mainPath: electron.mainPath,
    appDist: plan.renderer.appDist,
    preloadPath: plan.preloadPath,
    macBundlePath: macBundle?.bundlePath,
    releaseManifestPath: macBundle?.releaseManifestPath,
    checks: {
      electronDependency: true,
      main: true,
      runtimeDependencyClosure: true,
      ...runtimeContractChecks,
      rendererIndex: true,
      preload: true,
      ...preloadContractChecks,
      customProtocol: true,
      sandboxedRenderer: true,
      ...(macBundle
        ? {
            macBundle: true as const,
            releaseManifest: true as const,
          }
        : {}),
    },
  }
}

function assertBundledRuntimeDependencies(mainPath: string, source: string) {
  const unresolved = [
    {
      name: "@ax-code/sdk",
      pattern: /\b(?:from\s*|import\s*\(|import\s*)["']@ax-code\/sdk(?:\/[^"']*)?["']/,
    },
    { name: "zod", pattern: /\b(?:from\s*|import\s*\(|import\s*)["']zod["']/ },
  ].filter((entry) => entry.pattern.test(source))
  if (unresolved.length > 0) {
    throw new Error(`Desktop main has unresolved runtime imports: ${unresolved.map((entry) => entry.name).join(", ")}`)
  }
}

function assertPackagedMainRuntimeContract(mainPath: string, source: string) {
  const requiredContracts = [
    {
      check: "backendLifecycleBridge",
      label: "backend lifecycle bridge",
      tokens: [
        "createDesktopBridgeHandler",
        "backend.start",
        "backend.attach",
        "backend.reconnect(createStartBackendPlan",
        "backend.reconnect(createAttachBackendPlan",
        "backend.connect(createStartBackendPlan",
        "backend.connect(createAttachBackendPlan",
        "port: 0",
      ],
    },
    {
      check: "diagnosticsLogExport",
      label: "diagnostics log export bridge",
      tokens: ["diagnostics.read", "diagnostics.exportLogs"],
    },
    {
      check: "startupFailureDiagnostics",
      label: "startup failure diagnostics",
      tokens: ["recordStartupFailure", "backend ", " failed:"],
    },
    {
      check: "rendererCrashDiagnostics",
      label: "renderer crash diagnostics",
      tokens: ["render-process-gone", "did-fail-load", "renderer load failed"],
    },
    {
      check: "loopbackProxyBypass",
      label: "loopback proxy bypass",
      tokens: ["proxy-bypass-list", "NO_PROXY", "no_proxy"],
    },
    {
      check: "cleanShutdownLifecycle",
      label: "clean shutdown lifecycle",
      tokens: ["before-quit", "window-all-closed", "input.backend.close", "quitReady", "quitContinuation"],
    },
  ] as const

  for (const contract of requiredContracts) {
    const missing = contract.tokens.filter((token) => !source.includes(token))
    if (missing.length > 0) {
      throw new Error(
        `Desktop main is missing packaged runtime contract (${contract.label}) in ${mainPath}: ${missing.join(", ")}`,
      )
    }
  }

  return {
    backendLifecycleBridge: true,
    diagnosticsLogExport: true,
    startupFailureDiagnostics: true,
    rendererCrashDiagnostics: true,
    loopbackProxyBypass: true,
    cleanShutdownLifecycle: true,
  } as const
}

function assertPackagedPreloadRuntimeContract(preloadPath: string, source: string) {
  const allowedCommandNames = Object.keys(bridgeCommandSchemas)
  const requiredTokens = [
    "contextBridge.exposeInMainWorld",
    '"axCodeDesktop"',
    "allowedCommands.has(name)",
    'ipcRenderer.invoke("ax-code:bridge"',
  ]
  const missingTokens = requiredTokens.filter((token) => !source.includes(token))
  assertStringSetMatches({
    source,
    preloadPath,
    setName: "allowedCommands",
    label: "bridge commands",
    expected: allowedCommandNames,
  })
  const forbiddenTokens = [
    'contextBridge.exposeInMainWorld("ipcRenderer"',
    'contextBridge.exposeInMainWorld("electron"',
    'contextBridge.exposeInMainWorld("process"',
    'contextBridge.exposeInMainWorld("fs"',
    'contextBridge.exposeInMainWorld("shell"',
    "ipcRenderer:",
    "electron:",
    "process:",
    "fs:",
    "shell:",
    "ipcRenderer.send(",
    "ipcRenderer.sendSync(",
    "ipcRenderer.postMessage(",
    "ipcRenderer.sendToHost(",
  ].filter((token) => source.includes(token))
  if (missingTokens.length > 0 || forbiddenTokens.length > 0) {
    const details = [
      missingTokens.length > 0 ? `missing tokens: ${missingTokens.join(", ")}` : undefined,
      forbiddenTokens.length > 0 ? `forbidden raw IPC exposure: ${forbiddenTokens.join(", ")}` : undefined,
    ].filter(Boolean)
    throw new Error(`Desktop preload is missing packaged runtime contract in ${preloadPath}: ${details.join("; ")}`)
  }

  const menuTokens = ["allowedMenuCommands.has(command)", "ipcRenderer.on(menuCommandChannel", "removeListener"]
  const missingMenuTokens = menuTokens.filter((token) => !source.includes(token))
  assertStringSetMatches({
    source,
    preloadPath,
    setName: "allowedMenuCommands",
    label: "menu commands",
    expected: [...DESKTOP_MENU_COMMANDS],
  })
  if (missingMenuTokens.length > 0) {
    throw new Error(
      `Desktop preload is missing packaged menu command filter in ${preloadPath}: ${missingMenuTokens.join(", ")}`,
    )
  }

  return {
    preloadBridgeAllowlist: true,
    preloadNoRawIpcExposure: true,
    preloadMenuCommandFilter: true,
  } as const
}

function assertStringSetMatches(input: {
  source: string
  preloadPath: string
  setName: string
  label: string
  expected: readonly string[]
}) {
  const actual = extractStringSet(input.source, input.setName)
  if (!actual) {
    throw new Error(`Desktop preload is missing ${input.setName} in ${input.preloadPath}`)
  }
  const expected = [...input.expected].sort()
  const sortedActual = [...actual].sort()
  const missing = expected.filter((value) => !actual.has(value))
  const unexpected = sortedActual.filter((value) => !input.expected.includes(value))
  if (missing.length === 0 && unexpected.length === 0) return
  const details = [
    missing.length > 0 ? `missing ${input.label}: ${missing.join(", ")}` : undefined,
    unexpected.length > 0 ? `unexpected ${input.label}: ${unexpected.join(", ")}` : undefined,
  ].filter(Boolean)
  throw new Error(
    `Desktop preload ${input.setName} does not match packaged contract in ${input.preloadPath}: ${details.join("; ")}`,
  )
}

function extractStringSet(source: string, setName: string) {
  const match = new RegExp(
    `const\\s+${escapeRegExp(setName)}\\s*=\\s*new\\s+Set\\s*\\(\\s*\\[([\\s\\S]*?)\\]\\s*\\)`,
  ).exec(source)
  if (!match?.[1]) return undefined
  const values = new Set<string>()
  const stringLiteral = /(["'])((?:\\.|(?!\1).)*)\1/g
  let literal: RegExpExecArray | null
  while ((literal = stringLiteral.exec(match[1]))) {
    values.add(literal[2].replace(/\\(["'\\])/g, "$1"))
  }
  return values
}

function validateMacBundle(input: { bundlePath: string; releaseManifestPath?: string }) {
  const contentsPath = path.join(input.bundlePath, "Contents")
  const resourcesPath = path.join(contentsPath, "Resources")
  const payloadPath = path.join(resourcesPath, "app")
  const releaseManifestPath = input.releaseManifestPath ?? path.join(resourcesPath, MAC_RELEASE_MANIFEST_NAME)
  const executablePath = path.join(contentsPath, "MacOS", MAC_EXECUTABLE_NAME)
  const requiredFiles = [
    path.join(contentsPath, "Info.plist"),
    executablePath,
    path.join(resourcesPath, MAC_ICON_FILE),
    path.join(payloadPath, "package.json"),
    path.join(payloadPath, "main.js"),
    path.join(payloadPath, "preload.cjs"),
    path.join(payloadPath, "app/index.html"),
    releaseManifestPath,
  ]
  for (const file of requiredFiles) {
    if (!existsSync(file)) throw new Error(`Mac app bundle artifact is missing: ${file}`)
  }
  if ((statSync(executablePath).mode & 0o111) === 0) {
    throw new Error("Mac app bundle executable must have executable permissions")
  }

  const infoPlist = readFileSync(path.join(contentsPath, "Info.plist"), "utf8")
  if (plistStringValue(infoPlist, "CFBundleExecutable") !== MAC_EXECUTABLE_NAME) {
    throw new Error("Mac app bundle executable must be AX Code")
  }
  if (existsSync(path.join(contentsPath, "MacOS", "Electron"))) {
    throw new Error("Mac app bundle must not expose the Electron executable name")
  }
  if (plistStringValue(infoPlist, "CFBundleIconFile") !== MAC_ICON_FILE) {
    throw new Error("Mac app bundle icon must be ax-code.icns")
  }
  if (infoPlist.includes("ElectronAsarIntegrity")) {
    throw new Error("Mac app bundle must not keep stale Electron asar integrity metadata")
  }
  if (plistBooleanValue(infoPlist, "NSAllowsArbitraryLoads") === true) {
    throw new Error("Mac app bundle must not allow arbitrary network loads")
  }
  const unusedPrivacyKey = UNUSED_ELECTRON_PRIVACY_USAGE_KEYS.find((key) => infoPlist.includes(`<key>${key}</key>`))
  if (unusedPrivacyKey) {
    throw new Error(`Mac app bundle must not advertise unused privacy permission: ${unusedPrivacyKey}`)
  }

  const packageJson = readJson(path.join(payloadPath, "package.json")) as { main?: unknown; name?: unknown }
  if (packageJson.name !== "@ax-code/desktop") throw new Error("Mac app bundle package name is invalid")
  if (packageJson.main !== "main.js") throw new Error("Mac app bundle package main must be main.js")

  const manifest = readJson(releaseManifestPath) as {
    version?: unknown
    packageTarget?: unknown
    appPath?: unknown
    signed?: unknown
    notarized?: unknown
    updaterConfigured?: unknown
  }
  if (typeof manifest.version !== "string") throw new Error("Mac release manifest version is required")
  if (manifest.packageTarget !== "mac") throw new Error("Mac release manifest target must be mac")
  if (manifest.appPath !== input.bundlePath) throw new Error("Mac release manifest appPath does not match bundle path")
  if (plistStringValue(infoPlist, "CFBundleShortVersionString") !== manifest.version) {
    throw new Error("Mac app bundle short version must match release manifest")
  }
  if (plistStringValue(infoPlist, "CFBundleVersion") !== manifest.version) {
    throw new Error("Mac app bundle version must match release manifest")
  }
  if (manifest.signed !== false || manifest.notarized !== false || manifest.updaterConfigured !== false) {
    throw new Error("Mac release manifest must keep signing, notarization, and updater gates closed")
  }

  return {
    bundlePath: input.bundlePath,
    releaseManifestPath,
  }
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8")) as unknown
}

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function plistStringValue(plist: string, key: string) {
  const match = new RegExp(`<key>${escapeRegExp(key)}</key>\\s*<string>([^<]*)</string>`).exec(plist)
  return match?.[1]
}

function plistBooleanValue(plist: string, key: string) {
  const match = new RegExp(`<key>${escapeRegExp(key)}</key>\\s*<(true|false)\\s*/>`).exec(plist)
  if (!match) return undefined
  return match[1] === "true"
}

function resolveElectronPackage() {
  const require = createRequire(import.meta.url)
  const packagePath = require.resolve("electron/package.json")
  const packageJson = require(packagePath) as { version?: unknown }
  const binaryPath = require("electron") as unknown
  if (typeof packageJson.version !== "string") throw new Error("Electron package version is invalid")
  if (typeof binaryPath !== "string") throw new Error("Electron executable path is invalid")
  return {
    version: packageJson.version,
    path: packagePath,
    binaryPath,
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "app-dist": { type: "string" },
      "preload-path": { type: "string" },
      "main-path": { type: "string" },
      "package-target": { type: "string" },
      "mac-bundle-path": { type: "string" },
      "release-manifest-path": { type: "string" },
      output: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  })
  const result = createPackagedDesktopSmokePlan({
    appDist: values["app-dist"],
    preloadPath: values["preload-path"],
    mainPath: values["main-path"],
    packageTarget: values["package-target"],
    macBundlePath: values["mac-bundle-path"],
    releaseManifestPath: values["release-manifest-path"],
  })
  const json = JSON.stringify(result, null, 2)
  if (values.output) {
    mkdirSync(path.dirname(values.output), { recursive: true })
    writeFileSync(values.output, `${json}\n`)
  }
  console.log(json)
}
