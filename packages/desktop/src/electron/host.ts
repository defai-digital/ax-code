import { readFile } from "node:fs/promises"
import path from "node:path"
// Static import ensures Electron resolves to the runtime singleton, not a fresh ESM namespace copy.
// The build marks "electron" as external so this import is preserved as-is in main.js.
import * as electronBuiltin from "electron"
import { createDesktopBridgeHandler } from "../bridge/handler"
import { assertBridgeSender, parseBridgeCommand } from "../bridge/schema"
import { DesktopBackendManager } from "../lifecycle/backend-manager"
import { createAttachBackendPlan, createStartBackendPlan } from "../lifecycle/sidecar-plan"
import { desktopSecurityBaseline, isNavigationAllowed } from "../security/baseline"
import {
  APP_HOST,
  APP_PROTOCOL,
  DESKTOP_BRIDGE_CHANNEL,
  createElectronHostPlan,
  rendererEntryUrl,
  type ElectronHostPlan,
} from "./config"
import { installDesktopApplicationMenu } from "./menu"
import {
  applyWindowState,
  attachWindowStatePersistence,
  createWindowStateStore,
  type DesktopWindowStateStore,
} from "./window-state"

type DesktopHostDiagnostics = {
  recordSystemLog(line: string): void
}

type ElectronModule = {
  app: any
  BrowserWindow: any
  ipcMain: any
  protocol: any
  shell: any
  dialog: any
  Menu?: any
  Notification?: {
    new (options: { title: string; body?: string; silent?: boolean }): { show(): void }
    isSupported?(): boolean
  }
}

const LOOPBACK_PROXY_BYPASS = "<-loopback>"
const LOOPBACK_NO_PROXY_HOSTS = ["127.0.0.1", "localhost", "::1"] as const

export type StartElectronDesktopHostOptions = {
  dev?: boolean
  rendererUrl?: string
  directory?: string
  attachUrl?: string
  authHeader?: string
}

export async function startElectronDesktopHost(options: StartElectronDesktopHostOptions = {}) {
  const electron = await loadElectron()
  const plan = createElectronHostPlan({ dev: options.dev, rendererUrl: options.rendererUrl })
  const backend = new DesktopBackendManager()

  configureDesktopRuntimeForLoopback(electron)
  registerAppSchemeAsPrivileged(electron, plan)
  const createWindow = () =>
    createMainWindow(electron, plan, {
      windowStateStore: createWindowStateStore(electron.app.getPath("userData")),
      diagnostics: backend,
    })
  let desktopWindowCreationReady = false
  if (
    !installDesktopSingleInstanceLock({
      electron,
      createWindow,
      canCreateWindow: () => desktopWindowCreationReady,
    })
  ) {
    return { backend, window: undefined, plan }
  }
  const defaultApp = (electronBuiltin as any).default
  const realApp = defaultApp?.app ?? electron.app
  await new Promise<void>((resolve) => {
    if (realApp.isReady?.()) {
      resolve()
      return
    }
    realApp.once("ready", resolve)
  })
  registerAppProtocol(electron, plan)
  installBridgeHandler(electron, backend, plan)

  desktopWindowCreationReady = true
  const window = await createWindow()
  installDesktopApplicationMenu(electron, () => currentDesktopMenuWindow(electron, window))
  installDesktopAppLifecycleHandlers({
    electron,
    backend,
    createWindow,
  })
  void connectInitialDesktopBackendAfterWindow(backend, options, window)

  return { backend, window, plan }
}

export function configureDesktopRuntimeForLoopback(
  electron: Pick<ElectronModule, "app">,
  env: NodeJS.ProcessEnv = process.env,
) {
  ensureLoopbackNoProxy(env)
  electron.app.disableHardwareAcceleration?.()
  electron.app.commandLine?.appendSwitch?.("disable-gpu")
  electron.app.commandLine?.appendSwitch?.("proxy-bypass-list", LOOPBACK_PROXY_BYPASS)
}

export function ensureLoopbackNoProxy(env: NodeJS.ProcessEnv = process.env) {
  for (const key of ["NO_PROXY", "no_proxy"] as const) {
    const values = (env[key] ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
    const seen = new Set(values.map((value) => value.toLowerCase()))
    for (const host of LOOPBACK_NO_PROXY_HOSTS) {
      if (seen.has(host)) continue
      values.push(host)
      seen.add(host)
    }
    env[key] = values.join(",")
  }
}

export async function connectInitialDesktopBackend(
  backend: DesktopBackendManager,
  options: Pick<StartElectronDesktopHostOptions, "attachUrl" | "authHeader" | "directory">,
) {
  if (options.attachUrl) {
    try {
      await backend.connect(
        createAttachBackendPlan({
          baseUrl: options.attachUrl,
          authHeader: options.authHeader,
        }),
      )
      return true
    } catch (cause) {
      if (!backend.getConnection() && backend.diagnostics().status !== "failed") {
        backend.recordStartupFailure("attach", cause)
      }
      return false
    }
  }

  if (options.directory) {
    try {
      await backend.connect(createStartBackendPlan({ directory: options.directory, port: 0 }))
      return true
    } catch {
      return false
    }
  }

  return true
}

export function connectInitialDesktopBackendAfterWindow(
  backend: DesktopBackendManager,
  options: Pick<StartElectronDesktopHostOptions, "attachUrl" | "authHeader" | "directory">,
  window?: { isDestroyed?: () => boolean; webContents?: { reloadIgnoringCache?: () => void; reload?: () => void } },
) {
  if (!options.attachUrl && !options.directory) return undefined
  return connectInitialDesktopBackend(backend, options).then((connected) => {
    if (connected) reloadDesktopRendererForBackend(window)
    return connected
  })
}

function reloadDesktopRendererForBackend(
  window: { isDestroyed?: () => boolean; webContents?: { reloadIgnoringCache?: () => void; reload?: () => void } } | undefined,
) {
  if (!window || window.isDestroyed?.() === true) return false
  if (typeof window.webContents?.reloadIgnoringCache === "function") {
    window.webContents.reloadIgnoringCache()
    return true
  }
  if (typeof window.webContents?.reload === "function") {
    window.webContents.reload()
    return true
  }
  return false
}

export function installDesktopSingleInstanceLock(input: {
  electron: Pick<ElectronModule, "app" | "BrowserWindow">
  createWindow: () => Promise<unknown>
  canCreateWindow?: () => boolean
}) {
  const requestLock = input.electron.app.requestSingleInstanceLock
  if (typeof requestLock !== "function") return true
  if (!requestLock.call(input.electron.app)) {
    input.electron.app.quit?.()
    return false
  }

  input.electron.app.on?.("second-instance", () => {
    void focusOrCreateDesktopWindow(input)
  })
  return true
}

export function installDesktopAppLifecycleHandlers(input: {
  electron: Pick<ElectronModule, "app" | "BrowserWindow" | "dialog">
  backend: Pick<DesktopBackendManager, "close" | "getConnection">
  createWindow: () => Promise<unknown>
  platform?: NodeJS.Platform
}) {
  const platform = input.platform ?? process.platform
  let quitting = false
  let quitReady = false
  let quitContinuation: Promise<void> | undefined
  let closingBackend: Promise<void> | undefined
  const closeBackend = () => {
    closingBackend ??= (async () => {
      await warnBeforeScheduledShutdown(input.electron, input.backend)
      await input.backend.close()
    })()
    return closingBackend
  }
  const continueQuitAfterClose = () => {
    quitContinuation ??= closeBackend()
      .finally(() => {
        quitReady = true
        input.electron.app.quit()
      })
      .catch(() => undefined)
    return quitContinuation
  }

  input.electron.app.on("before-quit", (event?: { preventDefault?: () => void }) => {
    quitting = true
    if (quitReady) return
    if (typeof event?.preventDefault === "function") {
      event.preventDefault()
      void continueQuitAfterClose()
      return
    }
    return closeBackend()
  })
  input.electron.app.on("window-all-closed", async () => {
    if (platform === "darwin" && !quitting) return
    await closeBackend()
    if (platform !== "darwin" && !quitting) input.electron.app.quit()
  })
  input.electron.app.on("activate", async () => {
    await focusOrCreateDesktopWindow(input)
  })
}

export async function focusOrCreateDesktopWindow(input: {
  electron: Pick<ElectronModule, "BrowserWindow">
  createWindow: () => Promise<unknown>
  canCreateWindow?: () => boolean
}) {
  const windows = (
    typeof input.electron.BrowserWindow.getAllWindows === "function" ? input.electron.BrowserWindow.getAllWindows() : []
  ).filter((window: { isDestroyed?: () => boolean }) => window.isDestroyed?.() !== true)
  const target = windows.find((window: { isVisible?: () => boolean }) => window.isVisible?.() !== false) ?? windows[0]
  if (target) {
    if (target.isMinimized?.()) target.restore?.()
    target.show?.()
    target.focus?.()
    return target
  }
  if (input.canCreateWindow?.() === false) return undefined
  return input.createWindow()
}

export async function createMainWindow(
  electron: ElectronModule,
  plan: ElectronHostPlan,
  options: {
    windowStateStore?: DesktopWindowStateStore
    diagnostics?: DesktopHostDiagnostics
  } = {},
) {
  const state = options.windowStateStore?.read() ?? {}
  const win = new electron.BrowserWindow(applyWindowState(plan.window, state))
  if (state.maximized) win.maximize?.()
  if (options.windowStateStore) attachWindowStatePersistence(win, options.windowStateStore)
  applyWindowSecurity(electron, win, plan)
  installRendererCrashDiagnostics(win, options.diagnostics)
  win.once("ready-to-show", () => showDesktopWindow(win))
  showDesktopWindow(win)
  const url = rendererEntryUrl(plan.renderer)
  void loadDesktopRenderer(win, url, options.diagnostics)
  return win
}

function showDesktopWindow(win: { isDestroyed?: () => boolean; show?: () => void }) {
  if (win.isDestroyed?.() === true) return false
  win.show?.()
  return true
}

async function loadDesktopRenderer(
  win: { isDestroyed?: () => boolean; loadURL(url: string): Promise<unknown>; show?: () => void },
  url: string,
  diagnostics: DesktopHostDiagnostics | undefined,
) {
  try {
    await win.loadURL(url)
  } catch (cause) {
    const error = cause instanceof Error && cause.message ? cause.message : String(cause)
    diagnostics?.recordSystemLog(`renderer initial load failed: url=${redactRendererUrl(url)} error=${error}`)
  }
  showDesktopWindow(win)
}

export function installRendererCrashDiagnostics(win: any, diagnostics: DesktopHostDiagnostics | undefined) {
  if (!diagnostics) return
  win.webContents?.on?.("render-process-gone", (_event: unknown, details: unknown) => {
    const record = readRecord(details)
    const reason = readString(record, "reason") ?? "unknown"
    const exitCode = readNumber(record, "exitCode")
    diagnostics.recordSystemLog(
      `renderer process gone: reason=${reason}${exitCode === undefined ? "" : ` exitCode=${exitCode}`}`,
    )
  })
  win.on?.("unresponsive", () => {
    diagnostics.recordSystemLog("renderer unresponsive")
  })
  win.on?.("responsive", () => {
    diagnostics.recordSystemLog("renderer responsive")
  })
  win.webContents?.on?.(
    "did-fail-load",
    (
      _event: unknown,
      errorCode: unknown,
      errorDescription: unknown,
      validatedURL: unknown,
      isMainFrame: unknown,
    ) => {
      if (isMainFrame === false) return
      diagnostics.recordSystemLog(
        `renderer load failed: code=${String(errorCode)} description=${String(errorDescription)} url=${redactRendererUrl(
          validatedURL,
        )}`,
      )
    },
  )
}

export function applyWindowSecurity(electron: ElectronModule, win: any, plan: ElectronHostPlan) {
  win.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
    if (isNavigationAllowed(url, plan.allowedNavigation)) return { action: "allow" }
    if (isSafeExternalUrl(url)) openExternalWithoutUnhandledRejection(electron, url)
    return { action: "deny" }
  })
  win.webContents.on("will-navigate", (event: { preventDefault: () => void }, url: string) => {
    if (isNavigationAllowed(url, plan.allowedNavigation)) return
    event.preventDefault()
    if (isSafeExternalUrl(url)) openExternalWithoutUnhandledRejection(electron, url)
  })
  installRendererPermissionGuards(win)
  win.webContents.session.webRequest.onHeadersReceived((details: unknown, callback: (headers: unknown) => void) => {
    callback({
      responseHeaders: desktopResponseHeadersForRequest(plan, details),
    })
  })
}

export function desktopResponseHeadersForRequest(plan: ElectronHostPlan, details: unknown) {
  const record = readRecord(details)
  const responseHeaders = readResponseHeaders(record["responseHeaders"])
  const url = readString(record, "url")
  if (!url || !isNavigationAllowed(url, plan.allowedNavigation)) return responseHeaders
  return {
    ...responseHeaders,
    "Content-Security-Policy": [desktopSecurityBaseline.csp],
  }
}

function openExternalWithoutUnhandledRejection(electron: Pick<ElectronModule, "shell">, url: string) {
  void Promise.resolve(electron.shell.openExternal(url)).catch(() => undefined)
}

function installRendererPermissionGuards(win: any) {
  const session = win.webContents?.session
  session?.setPermissionRequestHandler?.((_webContents: unknown, _permission: string, callback: (allowed: boolean) => void) => {
    callback(false)
  })
  session?.setPermissionCheckHandler?.(() => false)
}

function isSafeExternalUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

function redactRendererUrl(value: unknown) {
  if (typeof value !== "string") return ""
  try {
    const url = new URL(value)
    url.username = ""
    url.password = ""
    url.search = ""
    url.hash = ""
    return url.toString()
  } catch {
    return value.split("?")[0]?.split("#")[0] ?? ""
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function readResponseHeaders(value: unknown): Record<string, string[]> {
  return value && typeof value === "object" ? (value as Record<string, string[]>) : {}
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === "string" ? value : undefined
}

function readNumber(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export async function warnBeforeScheduledShutdown(
  electron: Pick<ElectronModule, "dialog">,
  backend: Pick<DesktopBackendManager, "getConnection">,
) {
  if (!shouldWarnBeforeScheduledShutdown(backend)) return false
  await electron.dialog.showMessageBox({
    type: "warning",
    buttons: ["OK"],
    defaultId: 0,
    title: "Scheduled automations pause on quit",
    message: "Scheduled automations owned by this desktop backend will pause when AX Code closes.",
    detail: "Attach mode scheduled work continues on the attached backend.",
  })
  return true
}

export function shouldWarnBeforeScheduledShutdown(backend: Pick<DesktopBackendManager, "getConnection">) {
  return backend.getConnection()?.mode === "start"
}

function currentDesktopMenuWindow(
  electron: Pick<ElectronModule, "BrowserWindow">,
  fallback: unknown,
):
  | {
      isDestroyed?: () => boolean
      webContents?: { send(channel: string, payload: unknown): void }
    }
  | undefined {
  const focused =
    typeof electron.BrowserWindow.getFocusedWindow === "function"
      ? electron.BrowserWindow.getFocusedWindow()
      : undefined
  if (focused && focused.isDestroyed?.() !== true) return focused
  if (fallback && (fallback as { isDestroyed?: () => boolean }).isDestroyed?.() !== true) {
    return fallback as { isDestroyed?: () => boolean; webContents?: { send(channel: string, payload: unknown): void } }
  }
  return (
    typeof electron.BrowserWindow.getAllWindows === "function" ? electron.BrowserWindow.getAllWindows() : []
  ).find((window: { isDestroyed?: () => boolean }) => window.isDestroyed?.() !== true)
}

function installBridgeHandler(electron: ElectronModule, backend: DesktopBackendManager, plan: ElectronHostPlan) {
  electron.ipcMain.handle(DESKTOP_BRIDGE_CHANNEL, async (event: any, input: unknown) => {
    const sender = desktopBridgeSenderFromEvent(event)
    const senderValidation = { trustedOrigins: plan.trustedBridgeOrigins }
    assertBridgeSender(sender, senderValidation)
    const record = input as { name?: unknown; payload?: unknown }
    if (typeof record?.name !== "string") throw new Error("Desktop bridge command name is required")
    const command = parseBridgeCommand(record.name as never, record.payload)
    const invoke = createDesktopBridgeHandler({
      backend,
      sender,
      senderValidation,
      host: {
        async openExternal(url) {
          await electron.shell.openExternal(url)
        },
        async chooseDirectory(input) {
          const result = await electron.dialog.showOpenDialog({
            title: input.title,
            properties: ["openDirectory"],
          })
          return {
            canceled: result.canceled,
            path: result.filePaths[0],
          }
        },
        async revealPath(targetPath) {
          electron.shell.showItemInFolder(targetPath)
        },
        async openEditor(input) {
          const error = await electron.shell.openPath(input.path)
          if (error) throw new Error(`Unable to open editor path: ${error}`)
        },
        async openUpdateArtifact(artifactPath) {
          const error = await electron.shell.openPath(artifactPath)
          if (error) throw new Error(`Unable to open downloaded update: ${error}`)
        },
        async showNotification(input) {
          if (!electron.Notification || electron.Notification.isSupported?.() === false) return false
          const notification = new electron.Notification({
            title: input.title,
            body: input.body,
            silent: input.silent,
          })
          notification.show()
          return true
        },
      },
    })
    return invoke(command.name, command.payload)
  })
}

export function desktopBridgeSenderFromEvent(event: any) {
  return {
    url: event.sender?.getURL?.() ?? event.senderFrame?.url ?? "",
    frameUrl: event.senderFrame?.url,
  }
}

export function registerAppSchemeAsPrivileged(electron: Pick<ElectronModule, "protocol">, plan: ElectronHostPlan) {
  if (plan.renderer.kind !== "packaged") return
  electron.protocol.registerSchemesAsPrivileged?.([
    {
      scheme: APP_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ])
}

export function registerAppProtocol(electron: Pick<ElectronModule, "protocol">, plan: ElectronHostPlan) {
  const renderer = plan.renderer
  if (renderer.kind !== "packaged") return
  electron.protocol.handle(APP_PROTOCOL, (request: Request) => createAppProtocolResponse(renderer, request))
}

export async function createAppProtocolResponse(
  renderer: Extract<ElectronHostPlan["renderer"], { kind: "packaged" }>,
  request: Request,
) {
  const filePath = resolveAppProtocolFile(renderer, request.url)
  if (!filePath) return new Response("Not found", { status: 404 })
  try {
    return new Response(new Uint8Array(await readFile(filePath)), {
      headers: { "content-type": desktopProtocolContentType(filePath) },
    })
  } catch {
    return new Response("Not found", { status: 404 })
  }
}

export function resolveAppProtocolFile(
  renderer: Extract<ElectronHostPlan["renderer"], { kind: "packaged" }>,
  requestUrl: string,
) {
  const url = new URL(requestUrl)
  if (url.protocol !== `${APP_PROTOCOL}:` || url.hostname !== APP_HOST) return undefined
  const pathname = safeDecodePathname(url.pathname)
  if (!pathname) return undefined
  const relative = pathname === "/" ? "index.html" : pathname.slice(1)
  const appDist = path.resolve(renderer.appDist)
  const resolved = path.resolve(appDist, relative)
  const root = `${appDist}${path.sep}`
  if (!resolved.startsWith(root)) return undefined
  return resolved
}

function safeDecodePathname(pathname: string) {
  try {
    return decodeURIComponent(pathname)
  } catch {
    return undefined
  }
}

export function desktopProtocolContentType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === ".html") return "text/html; charset=utf-8"
  if (ext === ".js") return "text/javascript; charset=utf-8"
  if (ext === ".css") return "text/css; charset=utf-8"
  if (ext === ".json") return "application/json; charset=utf-8"
  if (ext === ".svg") return "image/svg+xml"
  if (ext === ".png") return "image/png"
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg"
  return "application/octet-stream"
}

async function loadElectron(): Promise<ElectronModule> {
  if (!electronBuiltin?.app) {
    throw new Error("Electron is not installed in this checkout. Run pnpm install with the desktop Electron deps.")
  }
  return electronBuiltin as unknown as ElectronModule
}
