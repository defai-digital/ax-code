import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { parseArgs } from "node:util"
import { buildDesktopArtifacts, type DesktopBuildArtifacts } from "./build"
import { MAC_RELEASE_MANIFEST_NAME, type MacReleaseGate, type MacReleaseManifest } from "./release-diagnostics"
import { createPackagedDesktopSmokePlan, type PackagedDesktopSmokePlan } from "./smoke"

export { MAC_RELEASE_MANIFEST_NAME, type MacReleaseGate, type MacReleaseManifest } from "./release-diagnostics"

export type MacAppBundle = {
  bundlePath: string
  resourcesPath: string
  appPayloadPath: string
  appPackagePath: string
  releaseManifestPath: string
  releaseManifest: MacReleaseManifest
}

export type MacPackagingResult = {
  artifacts: DesktopBuildArtifacts
  bundle: MacAppBundle
  smoke: PackagedDesktopSmokePlan
}

export async function packageMacApp(
  input: {
    outDir?: string
    appDist?: string
    bundleRoot?: string
    electronAppPath?: string
    version?: string
  } = {},
): Promise<MacPackagingResult> {
  const artifacts = await buildDesktopArtifacts({ outDir: input.outDir, appDist: input.appDist })
  const bundle = createMacAppBundle({
    artifacts,
    bundleRoot: input.bundleRoot,
    electronAppPath: input.electronAppPath,
    version: input.version,
  })
  const smoke = createPackagedDesktopSmokePlan({
    appDist: path.join(bundle.appPayloadPath, "app"),
    preloadPath: path.join(bundle.appPayloadPath, "preload.cjs"),
    mainPath: path.join(bundle.appPayloadPath, "main.js"),
    packageTarget: "mac",
    macBundlePath: bundle.bundlePath,
    releaseManifestPath: bundle.releaseManifestPath,
  })
  return { artifacts, bundle, smoke }
}

export function createMacAppBundle(input: {
  artifacts: DesktopBuildArtifacts
  bundleRoot?: string
  electronAppPath?: string
  version?: string
  electronVersion?: string
}): MacAppBundle {
  const bundleRoot = input.bundleRoot ?? path.join(input.artifacts.outDir, "mac")
  const sourceApp = input.electronAppPath ?? resolveElectronAppPath()
  const bundlePath = path.join(bundleRoot, "AX Code.app")
  rmSync(bundlePath, { recursive: true, force: true })
  mkdirSync(bundleRoot, { recursive: true })
  cpSync(sourceApp, bundlePath, { recursive: true })

  rewriteInfoPlist(path.join(bundlePath, "Contents/Info.plist"))
  const resourcesPath = path.join(bundlePath, "Contents/Resources")
  const appPayloadPath = path.join(resourcesPath, "app")
  rmSync(path.join(resourcesPath, "default_app.asar"), { force: true })
  rmSync(appPayloadPath, { recursive: true, force: true })
  mkdirSync(appPayloadPath, { recursive: true })

  const payloadMainPath = path.join(appPayloadPath, "main.js")
  const payloadPreloadPath = path.join(appPayloadPath, "preload.cjs")
  const payloadRendererPath = path.join(appPayloadPath, "app")
  cpSync(input.artifacts.mainPath, payloadMainPath)
  copyIfExists(`${input.artifacts.mainPath}.map`, `${payloadMainPath}.map`)
  cpSync(input.artifacts.preloadPath, payloadPreloadPath)
  cpSync(input.artifacts.appDist, payloadRendererPath, { recursive: true })

  const appPackagePath = path.join(appPayloadPath, "package.json")
  writeFileSync(
    appPackagePath,
    JSON.stringify(
      {
        name: "@ax-code/desktop",
        productName: "AX Code",
        version: input.version ?? "0.0.0",
        type: "module",
        main: "main.js",
        private: true,
      },
      null,
      2,
    ),
  )

  const releaseManifestPath = path.join(resourcesPath, MAC_RELEASE_MANIFEST_NAME)
  const releaseManifest: MacReleaseManifest = {
    productName: "AX Code",
    version: input.version ?? "0.0.0",
    packageTarget: "mac",
    appPath: bundlePath,
    resourcesAppPath: appPayloadPath,
    mainPath: payloadMainPath,
    preloadPath: payloadPreloadPath,
    rendererIndexPath: path.join(payloadRendererPath, "index.html"),
    electronVersion: input.electronVersion ?? resolveElectronVersion(),
    signed: false,
    notarized: false,
    updaterConfigured: false,
    gates: {
      signing: {
        configured: false,
        status: "blocked",
        reason: "Code signing identity and signing pipeline are not configured yet.",
      },
      notarization: {
        configured: false,
        status: "blocked",
        reason: "Apple notarization credentials and submission pipeline are not configured yet.",
      },
      updater: {
        configured: false,
        status: "blocked",
        reason: "Desktop auto-update feed and update verification are not configured yet.",
      },
    },
  }
  writeFileSync(releaseManifestPath, JSON.stringify(releaseManifest, null, 2))

  return {
    bundlePath,
    resourcesPath,
    appPayloadPath,
    appPackagePath,
    releaseManifestPath,
    releaseManifest,
  }
}

export function resolveElectronAppPath() {
  const require = createRequire(import.meta.url)
  const electronBinary = require("electron") as unknown
  if (typeof electronBinary !== "string") throw new Error("Electron executable path is invalid")
  const marker = `${path.sep}Electron.app${path.sep}`
  const markerIndex = electronBinary.indexOf(marker)
  if (markerIndex < 0) throw new Error(`Cannot resolve Electron.app from ${electronBinary}`)
  return electronBinary.slice(0, markerIndex + marker.length - 1)
}

function resolveElectronVersion() {
  const require = createRequire(import.meta.url)
  const packageJson = require("electron/package.json") as { version?: unknown }
  if (typeof packageJson.version !== "string") throw new Error("Electron package version is invalid")
  return packageJson.version
}

function rewriteInfoPlist(infoPath: string) {
  if (!existsSync(infoPath)) throw new Error(`Electron Info.plist is missing: ${infoPath}`)
  const original = readFileSync(infoPath, "utf8")
  const updated = setPlistString(
    setPlistString(setPlistString(original, "CFBundleIdentifier", "digital.defai.ax-code"), "CFBundleName", "AX Code"),
    "CFBundleDisplayName",
    "AX Code",
  )
  writeFileSync(infoPath, updated)
}

function setPlistString(plist: string, key: string, value: string) {
  const pattern = new RegExp(`(<key>${escapeRegExp(key)}</key>\\s*<string>)([^<]*)(</string>)`)
  if (pattern.test(plist)) return plist.replace(pattern, `$1${value}$3`)
  return plist.replace("</dict>", `\t<key>${key}</key>\n\t<string>${value}</string>\n</dict>`)
}

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function copyIfExists(source: string, destination: string) {
  if (existsSync(source)) cpSync(source, destination)
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "out-dir": { type: "string" },
      "app-dist": { type: "string" },
      "bundle-root": { type: "string" },
      "electron-app": { type: "string" },
      version: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  })
  const result = await packageMacApp({
    outDir: values["out-dir"],
    appDist: values["app-dist"],
    bundleRoot: values["bundle-root"],
    electronAppPath: values["electron-app"],
    version: values.version,
  })
  console.log(JSON.stringify(result, null, 2))
}
