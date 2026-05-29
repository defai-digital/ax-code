import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
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
  iconPath: string
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
    iconSourcePath?: string
    version?: string
  } = {},
): Promise<MacPackagingResult> {
  const artifacts = await buildDesktopArtifacts({ outDir: input.outDir, appDist: input.appDist })
  const bundle = createMacAppBundle({
    artifacts,
    bundleRoot: input.bundleRoot,
    electronAppPath: input.electronAppPath,
    iconSourcePath: input.iconSourcePath,
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
  iconSourcePath?: string
  version?: string
  electronVersion?: string
}): MacAppBundle {
  const bundleRoot = input.bundleRoot ?? path.join(input.artifacts.outDir, "mac")
  const sourceApp = input.electronAppPath ?? resolveElectronAppPath()
  const bundlePath = path.join(bundleRoot, "AX Code.app")
  rmSync(bundlePath, { recursive: true, force: true })
  mkdirSync(bundleRoot, { recursive: true })
  cpSync(sourceApp, bundlePath, { recursive: true })

  const version = input.version ?? "0.0.0"
  renameMacBundleExecutable(bundlePath)
  rewriteInfoPlist(path.join(bundlePath, "Contents/Info.plist"), { version })
  const resourcesPath = path.join(bundlePath, "Contents/Resources")
  const iconPath = installMacBundleIcon({
    resourcesPath,
    sourcePath: input.iconSourcePath ?? defaultMacIconSourcePath(),
  })
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
        version,
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
    version,
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
    iconPath,
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

const MAC_EXECUTABLE_NAME = "AX Code"
const MAC_ICON_FILE = "ax-code.icns"

function renameMacBundleExecutable(bundlePath: string) {
  const macosPath = path.join(bundlePath, "Contents/MacOS")
  const electronExecutablePath = path.join(macosPath, "Electron")
  const axCodeExecutablePath = path.join(macosPath, MAC_EXECUTABLE_NAME)
  if (!existsSync(electronExecutablePath)) {
    if (!existsSync(axCodeExecutablePath)) throw new Error(`Electron executable is missing: ${electronExecutablePath}`)
    return
  }
  rmSync(axCodeExecutablePath, { force: true })
  renameSync(electronExecutablePath, axCodeExecutablePath)
}

function rewriteInfoPlist(infoPath: string, input: { version: string }) {
  if (!existsSync(infoPath)) throw new Error(`Electron Info.plist is missing: ${infoPath}`)
  const original = readFileSync(infoPath, "utf8")
  const updated = setPlistString(
    setPlistString(
      setPlistString(
        setPlistString(
          setPlistString(
            setPlistString(
              removePlistDictKey(original, "ElectronAsarIntegrity"),
              "CFBundleIdentifier",
              "digital.defai.ax-code",
            ),
            "CFBundleExecutable",
            MAC_EXECUTABLE_NAME,
          ),
          "CFBundleName",
          "AX Code",
        ),
        "CFBundleIconFile",
        MAC_ICON_FILE,
      ),
      "CFBundleShortVersionString",
      input.version,
    ),
    "CFBundleVersion",
    input.version,
  )
  const branded = setPlistString(updated, "CFBundleDisplayName", "AX Code")
  writeFileSync(infoPath, branded)
}

function setPlistString(plist: string, key: string, value: string) {
  const pattern = new RegExp(`(<key>${escapeRegExp(key)}</key>\\s*<string>)([^<]*)(</string>)`)
  if (pattern.test(plist)) return plist.replace(pattern, `$1${value}$3`)
  return plist.replace("</dict>", `\t<key>${key}</key>\n\t<string>${value}</string>\n</dict>`)
}

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function removePlistDictKey(plist: string, key: string) {
  const marker = `<key>${escapeRegExp(key)}</key>`
  const pattern = new RegExp(`\\s*${marker}\\s*`)
  const match = pattern.exec(plist)
  if (!match) return plist
  const dictStart = plist.indexOf("<dict>", match.index + match[0].length)
  if (dictStart < 0) return plist
  if (plist.slice(match.index + match[0].length, dictStart).trim()) return plist
  const dictEnd = matchingDictEnd(plist, dictStart)
  if (dictEnd === undefined) return plist
  return `${plist.slice(0, match.index)}${plist.slice(dictEnd)}`
}

function matchingDictEnd(plist: string, dictStart: number) {
  const tags = /<\/?dict>/g
  tags.lastIndex = dictStart
  let depth = 0
  for (let match = tags.exec(plist); match; match = tags.exec(plist)) {
    if (match[0] === "<dict>") {
      depth++
      continue
    }
    depth--
    if (depth === 0) return tags.lastIndex
  }
  return undefined
}

function defaultMacIconSourcePath() {
  return path.resolve(import.meta.dirname, "../../../ui/src/assets/favicon/web-app-manifest-512x512.png")
}

function installMacBundleIcon(input: { resourcesPath: string; sourcePath: string }) {
  if (!existsSync(input.sourcePath)) throw new Error(`Mac app icon source is missing: ${input.sourcePath}`)
  const iconPath = path.join(input.resourcesPath, MAC_ICON_FILE)
  if (path.extname(input.sourcePath).toLowerCase() === ".icns") {
    cpSync(input.sourcePath, iconPath)
    rmSync(path.join(input.resourcesPath, "electron.icns"), { force: true })
    return iconPath
  }
  runMacPackagingCommand("sips", ["-s", "format", "icns", input.sourcePath, "--out", iconPath])
  rmSync(path.join(input.resourcesPath, "electron.icns"), { force: true })
  return iconPath
}

function runMacPackagingCommand(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: "utf8" })
  if (result.status === 0) return
  const detail = result.stderr?.trim() || result.stdout?.trim()
  throw new Error(`${command} failed${detail ? `: ${detail}` : ""}`)
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
      "icon-source": { type: "string" },
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
    iconSourcePath: values["icon-source"],
    version: values.version,
  })
  console.log(JSON.stringify(result, null, 2))
}
