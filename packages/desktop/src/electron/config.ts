import path from "node:path"
import { existsSync, readFileSync } from "node:fs"
import { desktopSecurityBaseline, isNavigationAllowed } from "../security/baseline"

export const DESKTOP_BRIDGE_CHANNEL = "ax-code:bridge"
export const APP_PROTOCOL = "app"
export const APP_HOST = "ax-code"

export type ElectronRendererMode =
  | {
      kind: "dev"
      url: string
    }
  | {
      kind: "packaged"
      appDist: string
    }

export type ElectronHostPlan = {
  renderer: ElectronRendererMode
  preloadPath: string
  window: ElectronWindowOptions
  csp: string
  allowedNavigation: readonly string[]
  bridgeChannel: typeof DESKTOP_BRIDGE_CHANNEL
}

export type ElectronWindowOptions = {
  width: number
  height: number
  minWidth: number
  minHeight: number
  title: string
  show: boolean
  backgroundColor: string
  webPreferences: {
    preload: string
    contextIsolation: true
    nodeIntegration: false
    sandbox: true
    webSecurity: true
    allowRunningInsecureContent: false
  }
}

export function createElectronHostPlan(
  input: {
    dev?: boolean
    rendererUrl?: string
    appDist?: string
    preloadPath?: string
    runtimeDir?: string
  } = {},
): ElectronHostPlan {
  const runtimeDir = input.runtimeDir ?? import.meta.dirname
  const root = desktopPackageRoot(runtimeDir)
  const preloadPath = input.preloadPath ?? defaultPreloadPath(root, runtimeDir)
  const renderer =
    input.dev || input.rendererUrl
      ? ({
          kind: "dev",
          url: input.rendererUrl ?? "http://127.0.0.1:5173",
        } satisfies ElectronRendererMode)
      : ({
          kind: "packaged",
          appDist: input.appDist ?? defaultAppDist(root),
        } satisfies ElectronRendererMode)

  return {
    renderer,
    preloadPath,
    window: createElectronWindowOptions(preloadPath),
    csp: desktopSecurityBaseline.csp,
    allowedNavigation: desktopSecurityBaseline.navigationAllowlist,
    bridgeChannel: DESKTOP_BRIDGE_CHANNEL,
  }
}

export function createElectronWindowOptions(preloadPath: string): ElectronWindowOptions {
  return {
    width: 1320,
    height: 860,
    minWidth: 1024,
    minHeight: 720,
    title: "AX Code",
    show: false,
    backgroundColor: "#f6f7f4",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: desktopSecurityBaseline.contextIsolation,
      nodeIntegration: desktopSecurityBaseline.nodeIntegration,
      sandbox: desktopSecurityBaseline.sandbox,
      webSecurity: desktopSecurityBaseline.webSecurity,
      allowRunningInsecureContent: desktopSecurityBaseline.allowRunningInsecureContent,
    },
  }
}

export function rendererEntryUrl(renderer: ElectronRendererMode) {
  if (renderer.kind === "dev") return renderer.url
  return `${APP_PROTOCOL}://${APP_HOST}/index.html`
}

export function isAppNavigationAllowed(target: string, plan: Pick<ElectronHostPlan, "allowedNavigation">) {
  return isNavigationAllowed(target, plan.allowedNavigation)
}

function defaultPreloadPath(root: string, runtimeDir: string) {
  const appPayloadPreload = path.join(root, "preload.cjs")
  if (existsSync(appPayloadPreload)) return appPayloadPreload
  const relative = path.relative(root, runtimeDir)
  return relative === "dist" || relative.startsWith(`dist${path.sep}`)
    ? path.join(root, "dist/preload.cjs")
    : path.join(root, "src/preload.cjs")
}

function defaultAppDist(root: string) {
  for (const candidate of [path.join(root, "app"), path.join(root, "dist/app"), path.resolve(root, "../app/dist")]) {
    if (existsSync(path.join(candidate, "index.html"))) return candidate
  }
  return path.join(root, "app")
}

function desktopPackageRoot(start: string) {
  let current = start
  for (let index = 0; index < 6; index++) {
    const manifestPath = path.join(current, "package.json")
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { name?: unknown }
        if (isDesktopPackageManifest(manifest)) return current
      } catch {
        // Continue walking when a package file is unreadable or unrelated.
      }
    }
    if (
      existsSync(path.join(current, "main.js")) &&
      existsSync(path.join(current, "preload.cjs")) &&
      existsSync(path.join(current, "app/index.html"))
    ) {
      return current
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return path.resolve(start, "../..")
}

function isDesktopPackageManifest(manifest: { name?: unknown }) {
  return manifest.name === "@ax-code/desktop" || manifest.name === "ax-code-desktop-app"
}
