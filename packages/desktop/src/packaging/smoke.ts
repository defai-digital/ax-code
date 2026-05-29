import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { parseArgs } from "node:util"
import { APP_PROTOCOL, createElectronHostPlan, rendererEntryUrl, type ElectronHostPlan } from "../electron/config"

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
    rendererIndex: true
    preload: true
    customProtocol: true
    sandboxedRenderer: true
    macBundle?: true
    releaseManifest?: true
  }
}

export function createPackagedDesktopSmokePlan(input: {
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
  const root = path.resolve(import.meta.dirname, "../..")
  const plan = createElectronHostPlan({
    appDist: input.appDist ?? path.join(root, "dist/app"),
    preloadPath: input.preloadPath ?? path.join(root, "dist/preload.cjs"),
  })
  const electronVersion = input.electronVersion ?? resolveElectronPackage().version
  const electronPackagePath = input.electronPackagePath ?? resolveElectronPackage().path
  const electronBinaryPath = input.electronBinaryPath ?? resolveElectronPackage().binaryPath
  return validatePackagedDesktopSmokePlan(plan, {
    electronVersion,
    electronPackagePath,
    electronBinaryPath,
    mainPath: input.mainPath ?? path.join(root, "dist/main.js"),
    packageTarget: input.packageTarget,
    macBundlePath: input.macBundlePath,
    releaseManifestPath: input.releaseManifestPath,
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
  assertBundledRuntimeDependencies(electron.mainPath)
  const indexPath = path.join(plan.renderer.appDist, "index.html")
  if (!existsSync(indexPath)) throw new Error(`Renderer index is missing: ${indexPath}`)
  if (!existsSync(plan.preloadPath)) throw new Error(`Desktop preload is missing: ${plan.preloadPath}`)
  const url = rendererEntryUrl(plan.renderer)
  if (!url.startsWith(`${APP_PROTOCOL}://`)) throw new Error(`Packaged renderer must use ${APP_PROTOCOL}:// URL`)
  if (
    plan.window.webPreferences.nodeIntegration ||
    !plan.window.webPreferences.contextIsolation ||
    !plan.window.webPreferences.sandbox
  ) {
    throw new Error("Packaged renderer must keep Electron security defaults enabled")
  }
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
      rendererIndex: true,
      preload: true,
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

function assertBundledRuntimeDependencies(mainPath: string) {
  const source = readFileSync(mainPath, "utf8")
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

function validateMacBundle(input: { bundlePath: string; releaseManifestPath?: string }) {
  const contentsPath = path.join(input.bundlePath, "Contents")
  const resourcesPath = path.join(contentsPath, "Resources")
  const payloadPath = path.join(resourcesPath, "app")
  const releaseManifestPath = input.releaseManifestPath ?? path.join(resourcesPath, "ax-code-release.json")
  const requiredFiles = [
    path.join(contentsPath, "Info.plist"),
    path.join(payloadPath, "package.json"),
    path.join(payloadPath, "main.js"),
    path.join(payloadPath, "preload.cjs"),
    path.join(payloadPath, "app/index.html"),
    releaseManifestPath,
  ]
  for (const file of requiredFiles) {
    if (!existsSync(file)) throw new Error(`Mac app bundle artifact is missing: ${file}`)
  }

  const packageJson = readJson(path.join(payloadPath, "package.json")) as { main?: unknown; name?: unknown }
  if (packageJson.name !== "@ax-code/desktop") throw new Error("Mac app bundle package name is invalid")
  if (packageJson.main !== "main.js") throw new Error("Mac app bundle package main must be main.js")

  const manifest = readJson(releaseManifestPath) as {
    packageTarget?: unknown
    appPath?: unknown
    signed?: unknown
    notarized?: unknown
    updaterConfigured?: unknown
  }
  if (manifest.packageTarget !== "mac") throw new Error("Mac release manifest target must be mac")
  if (manifest.appPath !== input.bundlePath) throw new Error("Mac release manifest appPath does not match bundle path")
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
  console.log(JSON.stringify(result, null, 2))
}
