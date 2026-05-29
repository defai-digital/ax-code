import { readFile } from "node:fs/promises"
import path from "node:path"
import { createDesktopBridgeHandler } from "../bridge/handler"
import { assertBridgeSender, parseBridgeCommand } from "../bridge/schema"
import { DesktopBackendManager } from "../lifecycle/backend-manager"
import { desktopSecurityBaseline, isNavigationAllowed } from "../security/baseline"
import {
  APP_HOST,
  APP_PROTOCOL,
  DESKTOP_BRIDGE_CHANNEL,
  createElectronHostPlan,
  rendererEntryUrl,
  type ElectronHostPlan,
} from "./config"
import {
  applyWindowState,
  attachWindowStatePersistence,
  createWindowStateStore,
  type DesktopWindowStateStore,
} from "./window-state"

type ElectronModule = {
  app: any
  BrowserWindow: any
  ipcMain: any
  protocol: any
  shell: any
  dialog: any
  Notification?: {
    new (options: { title: string; body?: string; silent?: boolean }): { show(): void }
    isSupported?(): boolean
  }
}

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

  registerAppSchemeAsPrivileged(electron, plan)
  await electron.app.whenReady()
  registerAppProtocol(electron, plan)
  installBridgeHandler(electron, backend)

  if (options.attachUrl) {
    await backend.connect({
      mode: "attach",
      baseUrl: options.attachUrl,
      headers: options.authHeader ? { authorization: options.authHeader } : {},
      loopbackOnly: true,
      generatedAuth: false,
    })
  } else if (options.directory) {
    await backend.connect({
      mode: "start",
      options: { directory: options.directory, hostname: "127.0.0.1", port: 0 },
      loopbackOnly: true,
      generatedAuth: true,
    })
  }

  const window = await createMainWindow(electron, plan, {
    windowStateStore: createWindowStateStore(electron.app.getPath("userData")),
  })
  electron.app.on("window-all-closed", async () => {
    await warnBeforeScheduledShutdown(electron, backend)
    await backend.close()
    if (process.platform !== "darwin") electron.app.quit()
  })

  return { backend, window, plan }
}

export async function createMainWindow(
  electron: ElectronModule,
  plan: ElectronHostPlan,
  options: {
    windowStateStore?: DesktopWindowStateStore
  } = {},
) {
  const state = options.windowStateStore?.read() ?? {}
  const win = new electron.BrowserWindow(applyWindowState(plan.window, state))
  if (state.maximized) win.maximize?.()
  if (options.windowStateStore) attachWindowStatePersistence(win, options.windowStateStore)
  applyWindowSecurity(electron, win, plan)
  await win.loadURL(rendererEntryUrl(plan.renderer))
  win.once("ready-to-show", () => win.show())
  return win
}

export function applyWindowSecurity(electron: ElectronModule, win: any, plan: ElectronHostPlan) {
  win.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
    if (isNavigationAllowed(url, plan.allowedNavigation)) return { action: "allow" }
    void electron.shell.openExternal(url)
    return { action: "deny" }
  })
  win.webContents.on("will-navigate", (event: { preventDefault: () => void }, url: string) => {
    if (!isNavigationAllowed(url, plan.allowedNavigation)) event.preventDefault()
  })
  win.webContents.session.webRequest.onHeadersReceived((details: unknown, callback: (headers: unknown) => void) => {
    callback({
      responseHeaders: {
        ...(details as { responseHeaders?: Record<string, string[]> }).responseHeaders,
        "Content-Security-Policy": [desktopSecurityBaseline.csp],
      },
    })
  })
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

function installBridgeHandler(electron: ElectronModule, backend: DesktopBackendManager) {
  electron.ipcMain.handle(DESKTOP_BRIDGE_CHANNEL, async (event: any, input: unknown) => {
    const sender = {
      url: event.senderFrame?.url ?? event.sender?.getURL?.() ?? "",
      frameUrl: event.senderFrame?.url,
    }
    assertBridgeSender(sender)
    const record = input as { name?: unknown; payload?: unknown }
    if (typeof record?.name !== "string") throw new Error("Desktop bridge command name is required")
    const command = parseBridgeCommand(record.name as never, record.payload)
    const invoke = createDesktopBridgeHandler({
      backend,
      sender,
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
  const pathname = decodeURIComponent(url.pathname)
  const relative = pathname === "/" ? "index.html" : pathname.slice(1)
  const appDist = path.resolve(renderer.appDist)
  const resolved = path.resolve(appDist, relative)
  const root = `${appDist}${path.sep}`
  if (!resolved.startsWith(root)) return undefined
  return resolved
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
  try {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (
      specifier: string,
    ) => Promise<unknown>
    return (await dynamicImport("electron")) as ElectronModule
  } catch (cause) {
    throw new Error("Electron is not installed in this checkout. Run pnpm install with the desktop Electron deps.", {
      cause,
    })
  }
}
