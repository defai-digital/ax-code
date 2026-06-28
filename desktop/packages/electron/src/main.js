"use strict"

const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  session,
  utilityProcess,
  Menu,
  nativeTheme,
  Notification,
  screen,
  net: electronNet,
  powerMonitor,
  webContents,
} = require("electron")
const { autoUpdater } = require("electron-updater")
const path = require("path")
const os = require("os")
const fs = require("fs")
const fsp = require("fs/promises")
const dgram = require("dgram")
const { execFile, spawn, spawnSync } = require("child_process")
const { promisify } = require("util")
const { createStartupDiagnostics } = require("./startup-diagnostics")
const { collectOpenPathCandidates } = require("./open-paths")
const { GITHUB_BUG_REPORT_URL, GITHUB_FEATURE_REQUEST_URL } = require("./support-urls")
const { createServerRestartPolicy } = require("./server-restart-policy")
const { shouldCheckForUpdatesOnStartup } = require("./startup-update-policy")
const {
  applyDesktopHostsConfigToRoot,
  isAllowedDesktopHostTargetUrl,
  normalizeHostUrl,
  readDesktopHostsConfigFromRoot,
  resolveStoredClientTokenForUrl,
  sanitizeClientTokenForStorage,
} = require("./desktop-hosts")
const { ElectronSshManager } = require("./ssh-manager.mjs")
const { createTrayController } = require("./tray.mjs")

const execFileAsync = promisify(execFile)

// Override the package name so macOS menus show "AX Code" instead
// of the scoped npm package name "@ax-code/electron".
app.name = "AX Code"
app.setAppUserModelId("ai.defai.ax-code-app")

// When run UNPACKAGED (e.g. `electron dist/main.js` for local testing), the dock
// shows Electron's default icon and "Electron" as the name. A packaged build
// gets these from its bundle; for dev runs, set the dock icon explicitly so the
// app is recognizably AX Code. No-op when packaged (bundle wins).
if (process.platform === "darwin" && !app.isPackaged && app.dock) {
  try {
    app.dock.setIcon(path.join(__dirname, "..", "build", "icon.png"))
  } catch {
    // Best-effort branding; never block startup on it.
  }
}

// ── Resource paths ──────────────────────────────────────────────────────────
// In production (packaged), extraResources land at process.resourcesPath/web-dist.
// In development, point at the Vite build output directly.
function getWebDistPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "web-dist")
  }
  return path.join(__dirname, "..", "..", "..", "packages", "web", "dist")
}

function getDevRendererUrl() {
  if (app.isPackaged) return null
  const raw = process.env.AX_CODE_DESKTOP_ELECTRON_RENDERER_URL
  if (!raw) return null
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(parsed.hostname)) {
      return null
    }
    return parsed.toString().replace(/\/$/, "")
  } catch {
    return null
  }
}

// ── State ───────────────────────────────────────────────────────────────────
let mainWindow = null
let serverPort = 0
let serverChild = null
let isQuitting = false
let isRelaunchingServer = false
let rendererReadyForOpenProject = false
let externalOpenPathDrainRunning = false
let externalOpenPathHandlerReady = false
const pendingExternalOpenRequests = []
const pendingOpenProjectPaths = []
// A session/draft hand-off requested while the main window was being created.
// Flushed on 'ax-code:renderer-app-ready' (same mechanism as open-project),
// because loadURL resolves before React mounts the IPC listeners.
let pendingFocusOpen = null
const startupDiagnostics = createStartupDiagnostics({
  logPath:
    process.platform === "darwin"
      ? path.join(os.homedir(), "Library", "Logs", "AX Code", "main.log")
      : path.join(os.homedir(), ".ax-code-desktop", "logs", "main.log"),
})

function recordStartupEvent(name, details = {}, options = {}) {
  const event =
    options.once === false
      ? startupDiagnostics.record(name, details, options)
      : startupDiagnostics.markOnce(name, details, options)
  if (event && options.forward !== false && serverChild) {
    try {
      serverChild.postMessage({ type: "desktop-startup-event", event })
    } catch {
      // The utilityProcess may not be accepting messages yet.
    }
  }
  return event
}

recordStartupEvent("electron.process.start")

// Install process-level safety nets before any async work. Without these,
// an unhandled rejection in Node >=18 terminates the main process with no
// graceful shutdown — the server utility process stays alive holding its
// port, and the next launch fails to bind.
process.on("unhandledRejection", (reason) => {
  console.error("[electron] unhandled rejection:", reason)
})
process.on("uncaughtException", (error) => {
  console.error("[electron] uncaught exception:", error)
  // Give the log a moment to flush, then exit. The before-quit handler
  // will still fire and shut down the server process cleanly.
  setTimeout(() => {
    if (!isQuitting) app.quit()
  }, 100)
})

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
}

app.on("second-instance", (_event, argv, cwd) => {
  queueExternalOpenRequest({
    argv,
    cwd,
    source: "second-instance",
  })
  focusMainWindowIfPresent()
})

app.on("open-file", (event, filePath) => {
  event.preventDefault()
  queueExternalOpenRequest({
    argv: [filePath],
    cwd: process.cwd(),
    source: "open-file",
  })
})

// ── Server ──────────────────────────────────────────────────────────────────
// The web server runs in a dedicated utilityProcess (dist/server-process.js)
// rather than in-process, so its CPU/IO never blocks the main event loop that
// drives the window, IPC, and auto-update. The renderer reaches it over HTTP
// loopback exactly as before — only where the server runs changes.
const SERVER_START_TIMEOUT_MS = 30_000
const SERVER_STOP_TIMEOUT_MS = 5_000
const MAX_SERVER_CRASH_RESTARTS = 5
const serverRestartPolicy = createServerRestartPolicy({ maxRestarts: MAX_SERVER_CRASH_RESTARTS })

function launchServer() {
  return new Promise((resolve, reject) => {
    const serverEntry = path.join(__dirname, "server-process.js")
    recordStartupEvent("server.utilityProcess.launch", {}, { once: false })
    serverChild = utilityProcess.fork(serverEntry, [], {
      serviceName: "ax-code-server",
      env: {
        ...process.env,
        // The server reads these at module-init time; previously set on the
        // main process before require, now passed into the forked process.
        AX_CODE_DESKTOP_DIST_DIR: getWebDistPath(),
        AX_CODE_DESKTOP_RUNTIME: "desktop",
        AX_CODE_DESKTOP_SHUTDOWN_TIMEOUT_MS: "4000",
        AX_CODE_DESKTOP_STARTUP_SNAPSHOT: JSON.stringify(startupDiagnostics.snapshot()),
      },
    })

    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        serverChild?.kill()
      } catch {
        /* ignore */
      }
      reject(new Error("server process start timed out"))
    }, SERVER_START_TIMEOUT_MS)

    serverChild.on("message", (msg) => {
      if (msg?.type === "startup-event" && msg.event?.name) {
        recordStartupEvent(msg.event.name, msg.event.details ?? {}, {
          source: msg.event.source || "web-server",
          atEpochMs: Number.isFinite(msg.event.atEpochMs) ? msg.event.atEpochMs : undefined,
          forward: false,
          milestone: msg.event.name,
        })
        return
      }
      if (settled) return
      if (msg?.type === "ready") {
        settled = true
        clearTimeout(timer)
        serverPort = msg.port
        recordStartupEvent("server.utilityProcess.ready", { port: serverPort }, { once: false })
        resolve()
      } else if (msg?.type === "error") {
        settled = true
        clearTimeout(timer)
        reject(new Error(msg.message || "server process failed to start"))
      }
    })

    serverChild.on("exit", (code) => {
      const wasReady = settled
      serverChild = null
      if (!settled) {
        settled = true
        clearTimeout(timer)
        reject(new Error(`server process exited before ready (code ${code})`))
      } else if (wasReady && code !== 0 && !isQuitting) {
        console.error("[electron] server process exited unexpectedly with code", code)
        restartServerAfterCrash().catch((err) => {
          console.error("[electron] failed to recover server process:", err)
        })
      }
    })
  })
}

async function restartServerAfterCrash() {
  if (isRelaunchingServer || isQuitting) return
  if (!serverRestartPolicy.beginRestart()) {
    console.error(
      "[electron] server process crashed too many times (%d), giving up on restart",
      serverRestartPolicy.crashRestarts,
    )
    return
  }
  isRelaunchingServer = true
  try {
    serverPort = 0
    await launchServer()
    serverRestartPolicy.completeRestart({ successful: true })
    if (mainWindow && !mainWindow.isDestroyed()) {
      await mainWindow.loadURL(`http://localhost:${serverPort}`)
    }
  } finally {
    serverRestartPolicy.completeRestart()
    isRelaunchingServer = false
  }
}

// Ask the server to shut down gracefully (which also stops the ax-code child it
// spawned), then ensure the process is gone. Resolves once the child exits or a
// timeout forces a kill.
function stopServer() {
  const child = serverChild
  if (!child) return Promise.resolve()
  serverChild = null
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      finish()
    }, SERVER_STOP_TIMEOUT_MS)
    child.once("exit", finish)
    try {
      child.postMessage({ type: "stop" })
    } catch {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      finish()
    }
  })
}

// ── Window ──────────────────────────────────────────────────────────────────
function isTrustedRendererNavigation(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  const devRendererUrl = getDevRendererUrl()
  const isServerUrl =
    parsed.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(parsed.hostname) &&
    parsed.port === String(serverPort)
  const isDevRendererUrl = devRendererUrl && parsed.origin === new URL(devRendererUrl).origin
  return Boolean(isServerUrl || isDevRendererUrl)
}

// Only allow safe protocols for shell.openExternal. Electron's docs explicitly
// recommend validating the URL protocol to prevent launching arbitrary OS handlers
// (file://, ms-settings:, javascript:, etc.) from the renderer.
const SAFE_EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"])
function safeOpenExternal(url) {
  try {
    const parsed = new URL(url)
    if (SAFE_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
      shell.openExternal(url)
    }
  } catch {
    // Malformed URL — silently ignore
  }
}

async function createWindow() {
  rendererReadyForOpenProject = false
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: "AX Code",
    backgroundColor: "#151313",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })

  // Restore saved geometry before first paint, then persist future changes.
  restoreMainWindowGeometry(mainWindow)
  attachWindowStateListeners(mainWindow)

  mainWindow.once("ready-to-show", () => {
    recordStartupEvent("renderer.ready-to-show")
    applyMacVibrancy(mainWindow)
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Keep internal navigation inside the window; open everything else in the
    // default OS browser. Match host+port exactly via URL parsing — a prefix
    // check (startsWith) would treat e.g. `http://localhost:<port>@evil.com` or
    // `http://localhost:<port>9` as internal and load it in the trusted window
    // (which runs with webSecurity disabled and the preload IPC bridge).
    if (isTrustedRendererNavigation(url)) {
      return { action: "allow" }
    }
    safeOpenExternal(url)
    return { action: "deny" }
  })

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isTrustedRendererNavigation(url)) {
      return
    }
    event.preventDefault()
    safeOpenExternal(url)
  })

  mainWindow.webContents.on("did-finish-load", () => {
    recordStartupEvent("renderer.did-finish-load")
  })

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl) => {
    recordStartupEvent(
      "renderer.did-fail-load",
      {
        errorCode,
        errorDescription,
        url: validatedUrl,
      },
      { once: false },
    )
  })

  mainWindow.on("closed", () => {
    mainWindow = null
  })

  const rendererUrl = getDevRendererUrl() || `http://localhost:${serverPort}`
  recordStartupEvent("renderer.load-url.start", {
    devRenderer: Boolean(getDevRendererUrl()),
  })
  await mainWindow.loadURL(rendererUrl)
}

// ── Auto-update ───────────────────────────────────────────────────────────
// Updates are user-driven through the in-app dialog: check → download (with a
// live progress bar) → quit-and-install. Disable auto-download/auto-install so
// the download only runs when the user clicks "Download" — otherwise
// electron-updater fetches in the background and the progress events below
// would replay against an already-downloaded file (the bar would jump straight
// to done).
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = false

// Forward electron-updater download progress to the renderer using the same
// event name and payload shape the shared UI expects from the Tauri updater
// (see downloadDesktopUpdate in packages/ui/src/lib/desktop.ts).
function sendUpdateProgress(event, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("openchamber:update-progress", { event, data })
  }
}

autoUpdater.on("download-progress", (p) => {
  sendUpdateProgress("Progress", { downloaded: p.transferred, total: p.total })
})
autoUpdater.on("update-downloaded", () => {
  sendUpdateProgress("Finished", {})
})
// electron-updater emits 'error' alongside rejecting its promises; without a
// listener, Node's EventEmitter turns the emit into an uncaught exception that
// crashes the main process. The IPC handlers already report failures to the
// renderer, so logging here is enough.
autoUpdater.on("error", (err) => {
  console.warn("[updater] error:", err instanceof Error ? err.message : err)
})

// ── Origin guard & registration helper ───────────────────────────────────────
// The preload shim is injected into every webContents, including remote hosts
// the user switches to via the host switcher. Filesystem, shell, installed-app
// scans, ssh, dialogs, and hosts_set are gated to local senders; window/host
// switcher operations are safe for any renderer.
const isLocalSender = (wc) => {
  try {
    const raw = typeof wc?.getURL === "function" ? wc.getURL() : ""
    if (!raw) return false
    const url = new URL(raw)
    if (url.protocol !== "http:" && url.protocol !== "https:") return false
    if (!["localhost", "127.0.0.1"].includes(url.hostname)) return false
    // The local server is the only loopback origin we serve; treat any
    // loopback http(s) page on our server port as local. Also accept the dev
    // renderer origin.
    if (serverPort > 0 && url.port === String(serverPort)) return true
    const devRendererUrl = getDevRendererUrl()
    if (devRendererUrl && url.origin === new URL(devRendererUrl).origin) return true
    return false
  } catch {
    return false
  }
}

// Registration helper: enforces the remote-origin guard (a remote main-*
// window can only call commands flagged safeForRemote).
const handleCommand = (name, fn, { safeForRemote = false } = {}) => {
  ipcMain.handle(name, async (event, args) => {
    if (!isLocalSender(event.sender) && !safeForRemote) {
      throw new Error("IPC not available for this origin")
    }
    return fn(args || {}, event)
  })
}

// ── IPC handlers (Tauri-compatible surface, all guarded by handleCommand) ────
handleCommand("desktop_get_launch_at_login", async () => ({
  enabled: app.getLoginItemSettings().openAtLogin,
  supported: true,
}))

handleCommand("desktop_set_launch_at_login", async (args) => {
  const { enabled } = args ?? {}
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled) })
  return { enabled: Boolean(enabled), supported: true }
})

handleCommand("desktop_check_for_updates", async () => {
  if (!shouldCheckForUpdatesOnStartup()) {
    return { available: false, currentVersion: app.getVersion(), disabled: true }
  }
  try {
    const result = await autoUpdater.checkForUpdates()
    if (!result?.updateInfo) return { available: false, currentVersion: app.getVersion() }
    const available = result.updateInfo.version !== app.getVersion()
    return {
      available,
      version: result.updateInfo.version,
      currentVersion: app.getVersion(),
      body: result.updateInfo.releaseNotes ?? undefined,
      date: result.updateInfo.releaseDate ?? undefined,
    }
  } catch (err) {
    // Surface the failure so the UI can distinguish "check failed" from "you're
    // up to date" — both previously collapsed to available:false.
    return {
      available: false,
      currentVersion: app.getVersion(),
      error: err instanceof Error ? err.message : String(err),
    }
  }
})

handleCommand("desktop_download_and_install_update", async () => {
  sendUpdateProgress("Started", {})
  await autoUpdater.downloadUpdate()
})

// Stop the web server AND tear down SSH control-masters/forwards, so quitting
// the app doesn't orphan `ssh -M` processes and bound local ports.
const stopBackgroundServices = () => Promise.allSettled([stopServer(), sshManager.shutdownAll().catch(() => {})])

async function shutdownForExit() {
  isQuitting = true
  await stopBackgroundServices()
}

handleCommand("desktop_quit_and_install", async () => {
  await shutdownForExit()
  autoUpdater.quitAndInstall()
})

handleCommand("desktop_restart", async () => {
  await shutdownForExit()
  app.relaunch()
  app.exit(0)
})

handleCommand("desktop_set_badge_count", async (args) => {
  const { count } = args ?? {}
  const value = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
  // macOS dock and Linux launchers; returns false where unsupported (Windows).
  return app.setBadgeCount(value)
})

handleCommand("desktop_get_lan_address", async () => {
  const nets = os.networkInterfaces()
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === "IPv4" && !net.internal) {
        return `http://${net.address}:${serverPort}`
      }
    }
  }
  return null
})

handleCommand("desktop_dialog_open", async (args) => {
  const options = args ?? {}
  const properties = []
  if (options?.directory === true) {
    properties.push("openDirectory")
  } else {
    properties.push("openFile")
  }
  if (options?.multiple === true) {
    properties.push("multiSelections")
  }

  const dialogOptions = {
    properties,
  }

  if (typeof options?.title === "string" && options.title.trim()) {
    dialogOptions.title = options.title.trim()
  }
  if (typeof options?.defaultPath === "string" && options.defaultPath.trim()) {
    dialogOptions.defaultPath = options.defaultPath.trim()
  }
  if (Array.isArray(options?.filters)) {
    dialogOptions.filters = options.filters
      .filter(
        (filter) =>
          filter &&
          typeof filter.name === "string" &&
          Array.isArray(filter.extensions) &&
          filter.extensions.every((extension) => typeof extension === "string" && extension.trim().length > 0),
      )
      .map((filter) => ({
        name: filter.name,
        extensions: filter.extensions.map((extension) => extension.trim()),
      }))
  }

  const ownerWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined
  const result = ownerWindow
    ? await dialog.showOpenDialog(ownerWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions)

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  return options?.multiple === true ? result.filePaths : result.filePaths[0]
})

handleCommand("desktop_record_startup_event", async (args) => {
  const payload = args ?? {}
  const name = typeof payload?.name === "string" ? payload.name.trim() : ""
  if (!/^[a-z0-9._:-]{1,96}$/i.test(name)) {
    return { ok: false, error: "Invalid startup event name" }
  }

  recordStartupEvent(name, payload?.details ?? {}, {
    source: "renderer",
    milestone: name,
  })
  return { ok: true }
})

// ── Ported handlers & features (from upstream OpenChamber main.mjs) ──────────
// Adapted to our CJS shell and single utilityProcess server model. The upstream
// shell ran the web server in-process and supported multiple remote "hosts";
// here we keep OUR server lifecycle untouched and the host list is purely a
// renderer-side switcher convenience persisted to settings.json.

const LOCAL_HOST_ID = "local"
const MIN_WINDOW_WIDTH = 800
const MIN_WINDOW_HEIGHT = 520
const MIN_RESTORE_WINDOW_WIDTH = 900
const MIN_RESTORE_WINDOW_HEIGHT = 560
const MAX_CAPTURE_PAGE_RECT_AREA = 4_000_000
const INSTALLED_APPS_CACHE_TTL_SECS = 60 * 60 * 24
const INSTALLED_APPS_CACHE_FILE = "discovered-apps.json"

// Broadcast a renderer event. Our preload listens on the literal `openchamber:*`
// channels (a retained contract), so emit on the literal event name directly —
// no `openchamber:emit` envelope.
// Desktop events reach the renderer two ways, so send both:
//  - the literal channel, consumed via the preload's __TAURI__.event.listen
//    shim (menu-action, check-for-updates, update-progress, ssh-instance-status)
//  - an envelope on 'ax-code:dom-event', which the preload re-dispatches as a DOM
//    CustomEvent for consumers using window.addEventListener (open-session,
//    open-draft-session, open-project, installed-apps-updated, system-resume).
const sendDesktopEvent = (webContents, event, detail) => {
  webContents.send(event, detail)
  webContents.send("ax-code:dom-event", { event, detail })
}

const emitToAllWindows = (event, detail) => {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) sendDesktopEvent(w.webContents, event, detail)
  }
}

const emitToWindow = (win, event, detail) => {
  if (win && !win.isDestroyed()) sendDesktopEvent(win.webContents, event, detail)
}

function focusMainWindowIfPresent() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
}

function queueExternalOpenRequest(request) {
  pendingExternalOpenRequests.push(request)
  if (externalOpenPathHandlerReady) {
    void drainExternalOpenRequests()
  }
}

function enqueueOpenProjectPath(projectPath) {
  const key = process.platform === "win32" ? projectPath.toLowerCase() : projectPath
  const alreadyPending = pendingOpenProjectPaths.some((candidate) => {
    const candidateKey = process.platform === "win32" ? candidate.toLowerCase() : candidate
    return candidateKey === key
  })
  if (!alreadyPending) pendingOpenProjectPaths.push(projectPath)
}

async function revealMainWindowForOpenProject() {
  if (!app.isReady() || serverPort <= 0) return
  if (!mainWindow || mainWindow.isDestroyed()) {
    await createWindow()
  }
  focusMainWindowIfPresent()
}

function flushPendingOpenProjectPaths() {
  if (!rendererReadyForOpenProject || !mainWindow || mainWindow.isDestroyed()) return

  while (pendingOpenProjectPaths.length > 0) {
    const projectPath = pendingOpenProjectPaths.shift()
    if (projectPath) emitToWindow(mainWindow, "openchamber:open-project", { projectPath })
  }
}

function flushPendingFocusOpen() {
  if (!rendererReadyForOpenProject || !mainWindow || mainWindow.isDestroyed()) return
  const pending = pendingFocusOpen
  if (!pending) return
  pendingFocusOpen = null
  if (pending.sessionId) {
    emitToWindow(mainWindow, "openchamber:open-session", { sessionId: pending.sessionId, directory: pending.directory })
  } else if (pending.mode === "draft") {
    emitToWindow(mainWindow, "openchamber:open-draft-session", {
      directory: pending.directory,
      projectId: pending.projectId,
    })
  }
}

async function handleExternalOpenRequest(request) {
  const candidates = collectOpenPathCandidates(request.argv, {
    appExecutablePath: process.execPath,
    cwd: request.cwd,
    platform: process.platform,
  })
  if (candidates.length === 0) return

  const directoryPaths = []
  for (const candidate of candidates) {
    try {
      const stat = await fsp.stat(candidate)
      if (stat.isDirectory()) directoryPaths.push(candidate)
    } catch {
      // Dropped files or stale paths are ignored; only directories become projects.
    }
  }
  if (directoryPaths.length === 0) return

  for (const projectPath of directoryPaths) enqueueOpenProjectPath(projectPath)
  recordStartupEvent(
    "external-open.directories",
    {
      source: request.source,
      count: directoryPaths.length,
    },
    { once: false },
  )

  await revealMainWindowForOpenProject()
  flushPendingOpenProjectPaths()
}

async function drainExternalOpenRequests() {
  if (externalOpenPathDrainRunning) return
  externalOpenPathDrainRunning = true
  try {
    while (pendingExternalOpenRequests.length > 0) {
      const request = pendingExternalOpenRequests.shift()
      if (request) await handleExternalOpenRequest(request)
    }
  } finally {
    externalOpenPathDrainRunning = false
    if (pendingExternalOpenRequests.length > 0) {
      void drainExternalOpenRequests()
    }
  }
}

ipcMain.on("ax-code:renderer-app-ready", (event) => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (event.sender !== mainWindow.webContents) return
  rendererReadyForOpenProject = true
  flushPendingOpenProjectPaths()
  flushPendingFocusOpen()
})

externalOpenPathHandlerReady = true
if (hasSingleInstanceLock) {
  queueExternalOpenRequest({
    argv: process.argv,
    cwd: process.cwd(),
    source: "startup-argv",
  })
}

// ── Settings persistence ──────────────────────────────────────────────────
const settingsFilePath = () => {
  const dataDir =
    typeof process.env.AX_CODE_DESKTOP_DATA_DIR === "string" && process.env.AX_CODE_DESKTOP_DATA_DIR.trim()
      ? process.env.AX_CODE_DESKTOP_DATA_DIR.trim()
      : null
  if (dataDir) return path.join(dataDir, "settings.json")
  return path.join(os.homedir(), ".config", "openchamber", "settings.json")
}

const readJsonFile = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch (error) {
    if (error && error.code === "ENOENT") return {}
    console.warn("[electron] failed to read JSON file", filePath, error)
    return {}
  }
}

const writeJsonFile = async (filePath, data) => {
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  // Atomic: write to a temp file then rename. Readers never see a partial JSON
  // file that could parse-error and get coerced to {}.
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2))
  await fsp.rename(tmp, filePath)
}

const readSettingsRoot = () => {
  const root = readJsonFile(settingsFilePath())
  return root && typeof root === "object" && !Array.isArray(root) ? root : {}
}

// Serializes read-modify-write of the settings file so interleaved RMW pairs
// across awaits don't overwrite each other's just-persisted changes.
let settingsMutationChain = Promise.resolve()
const mutateSettingsRoot = (mutator) => {
  const next = settingsMutationChain.then(async () => {
    const current = readSettingsRoot()
    const result = await mutator(current)
    const nextRoot = result ?? current
    await writeJsonFile(settingsFilePath(), nextRoot)
  })
  settingsMutationChain = next.catch(() => {})
  return next
}

// ── SSH manager ───────────────────────────────────────────────────────────
const sshManager = new ElectronSshManager({
  settingsFilePath: settingsFilePath(),
  appVersion: app.getVersion(),
  emit: (event, detail) => emitToAllWindows(event, detail),
})

// ── Host list (renderer-side switcher; persisted to settings) ──────────────
const readDesktopLocalClientToken = () =>
  sanitizeClientTokenForStorage(readSettingsRoot().desktopLocalClientToken) || ""

const readDesktopHostsConfig = (options) => readDesktopHostsConfigFromRoot(readSettingsRoot(), options)

const writeDesktopHostsConfig = async (config) => {
  await mutateSettingsRoot((root) => {
    applyDesktopHostsConfigToRoot(root, config)
  })
}

// Our local origin is always the loopback server in this single-server model.
const localOriginUrl = () => `http://localhost:${serverPort}`

// ── Host probe ─────────────────────────────────────────────────────────────
const buildVersionUrl = (url) => {
  try {
    const parsed = new URL(url)
    parsed.pathname = `${parsed.pathname.replace(/\/$/, "") || ""}/api/version`
    return parsed.toString()
  } catch {
    return null
  }
}

const classifyVersionPayload = (payload) => {
  const compatibility = payload?.compatibility
  if (!payload || payload.status !== "ok" || !compatibility || typeof compatibility !== "object") {
    return "wrong-service"
  }
  if (!Array.isArray(compatibility.capabilities) || !compatibility.capabilities.includes("api.runtime-url.v1")) {
    return "incompatible"
  }
  if (compatibility.apiVersion !== 1 || compatibility.minClientApiVersion > 1) {
    return "update-recommended"
  }
  return "ok"
}

const fetchVersionPayload = async (versionUrl, { headers, timeoutMs }) => {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  try {
    return await fetch(versionUrl, { signal: timeoutSignal, headers })
  } catch (error) {
    if (timeoutSignal.aborted) throw error
    return await Promise.race([
      electronNet.fetch(versionUrl, { headers }),
      new Promise((_, reject) => setTimeout(() => reject(error), timeoutMs)),
    ])
  }
}

const probeHostWithTimeout = async (url, timeoutMs, clientToken = "") => {
  const versionUrl = buildVersionUrl(url)
  if (!versionUrl) throw new Error("Invalid URL")
  const started = Date.now()
  try {
    const headers = { Accept: "application/json" }
    const token = typeof clientToken === "string" ? clientToken.trim() : ""
    if (token) headers.Authorization = `Bearer ${token}`
    const response = await fetchVersionPayload(versionUrl, { headers, timeoutMs })
    const status = response.status
    if (status === 401 || status === 403) return { status: "auth", latencyMs: Date.now() - started }
    if (status < 200 || status >= 300) return { status: "unreachable", latencyMs: Date.now() - started }
    const payload = await response.json().catch(() => null)
    return { status: classifyVersionPayload(payload), latencyMs: Date.now() - started }
  } catch {
    return { status: "unreachable", latencyMs: Date.now() - started }
  }
}

// ── LAN address detection ──────────────────────────────────────────────────
const detectLanIPv4Address = async () => {
  const ip = await new Promise((resolve) => {
    const socket = dgram.createSocket("udp4")
    const finish = (value) => {
      try {
        socket.close()
      } catch {}
      resolve(value)
    }
    socket.once("error", () => finish(null))
    try {
      socket.connect(80, "8.8.8.8", (error) => {
        if (error) return finish(null)
        try {
          const addr = socket.address()
          finish(addr && typeof addr.address === "string" ? addr.address : null)
        } catch {
          finish(null)
        }
      })
    } catch {
      finish(null)
    }
  })
  if (ip && ip !== "0.0.0.0" && !ip.startsWith("127.")) return ip
  for (const entries of Object.values(os.networkInterfaces() || {})) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal && entry.address) return entry.address
    }
  }
  return null
}

// ── Native notifications ───────────────────────────────────────────────────
const normalizeNotificationInput = (raw) => {
  if (!raw || typeof raw !== "object") return {}
  if (raw.payload && typeof raw.payload === "object") return { ...raw, ...raw.payload }
  return raw
}

const isAnyWindowFocused = () => BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isFocused())

const focusForegroundWindow = () => {
  const windows = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
  if (windows.length === 0) return
  const target = mainWindow && !mainWindow.isDestroyed() ? mainWindow : windows.find((w) => w.isVisible()) || windows[0]
  if (process.platform === "darwin") app.focus({ steal: true })
  if (target.isMinimized()) target.restore()
  target.show()
  target.focus()
  if (typeof target.moveTop === "function") target.moveTop()
}

// Keep references to live notifications so click/close still fire (macOS GC bug).
const activeNotifications = new Set()

const maybeShowNativeNotification = (rawInput) => {
  const payload = normalizeNotificationInput(rawInput)
  const requireHidden = Boolean(payload.requireHidden ?? payload.require_hidden)
  if (requireHidden && isAnyWindowFocused()) return
  if (!Notification.isSupported()) return

  const title = typeof payload.title === "string" && payload.title.trim() ? payload.title.trim() : "AX Code"
  const body = typeof payload.body === "string" ? payload.body : ""
  const sessionId = typeof payload.sessionId === "string" && payload.sessionId.trim() ? payload.sessionId.trim() : null
  const directory = typeof payload.directory === "string" && payload.directory.trim() ? payload.directory.trim() : null

  const notification = new Notification({
    title,
    body,
    silent: false,
    ...(process.platform === "darwin" ? { sound: "Glass" } : {}),
  })

  activeNotifications.add(notification)
  const release = () => {
    activeNotifications.delete(notification)
  }

  notification.on("click", () => {
    focusForegroundWindow()
    if (sessionId) emitToAllWindows("openchamber:open-session", { sessionId, directory })
    release()
  })
  notification.on("close", release)
  notification.on("failed", release)

  notification.show()
}

// ── Installed-app discovery / open-in-app (macOS + Windows) ────────────────
const buildInstalledAppsCachePath = () => path.join(path.dirname(settingsFilePath()), INSTALLED_APPS_CACHE_FILE)

const pathExists = async (candidate) => {
  try {
    await fsp.access(candidate)
    return true
  } catch {
    return false
  }
}

const resolveAppBundlePath = async (appName) => {
  if (process.platform !== "darwin") return null
  const bundleName = appName.endsWith(".app") ? appName : `${appName}.app`
  const candidates = [
    `/Applications/${bundleName}`,
    `/System/Applications/${bundleName}`,
    `/System/Applications/Utilities/${bundleName}`,
    path.join(os.homedir(), "Applications", bundleName),
  ]
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate
  }
  try {
    const { stdout } = await execFileAsync("mdfind", ["-name", bundleName], { encoding: "utf8" })
    const first = (stdout || "")
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean)
    return first || null
  } catch {
    return null
  }
}

const isAppBundleInstalled = async (appName) => Boolean(await resolveAppBundlePath(appName))

const iconToDataUrl = async (iconPath, appName) => {
  if (!iconPath || !(await pathExists(iconPath))) return null
  const safeName = String(appName || "app").replace(/[^a-z0-9]/gi, "_")
  const tempPath = path.join(os.tmpdir(), `ax-code-icon-${safeName}-${Date.now()}.png`)
  try {
    await execFileAsync("sips", ["-s", "format", "png", "-Z", "32", iconPath, "--out", tempPath], { stdio: "ignore" })
  } catch {
    return null
  }
  if (!(await pathExists(tempPath))) return null
  try {
    const bytes = await fsp.readFile(tempPath)
    return `data:image/png;base64,${bytes.toString("base64")}`
  } finally {
    await fsp.rm(tempPath, { force: true }).catch(() => {})
  }
}

const resolveAppIconPath = async (appPath) => {
  if (!appPath || !(await pathExists(appPath))) return null
  const resourcesPath = path.join(appPath, "Contents", "Resources")
  if (!(await pathExists(resourcesPath))) return null
  let entries
  try {
    entries = await fsp.readdir(resourcesPath)
  } catch {
    return null
  }
  const icon = entries.find((entry) => entry.toLowerCase().endsWith(".icns"))
  return icon ? path.join(resourcesPath, icon) : null
}

const buildInstalledApps = async (apps) => {
  const seen = new Set()
  const names = apps.map((raw) => String(raw || "").trim()).filter((raw) => raw && !seen.has(raw) && seen.add(raw))
  const results = []
  for (const name of names) {
    const appPath = await resolveAppBundlePath(name)
    if (!appPath) continue
    const iconDataUrl = await iconToDataUrl(await resolveAppIconPath(appPath), name)
    results.push({ name, iconDataUrl })
  }
  return results
}

const JETBRAINS_APP_IDS = new Set([
  "pycharm",
  "intellij",
  "webstorm",
  "phpstorm",
  "rider",
  "rustrover",
  "android-studio",
])

const CLI_BY_APP_ID = {
  vscode: "code",
  cursor: "cursor",
  vscodium: "codium",
  windsurf: "windsurf",
  zed: "zed",
}

const WINDOWS_CLI_BY_APP_ID = {
  vscode: "code.cmd",
  cursor: "cursor.cmd",
  vscodium: "codium.cmd",
  windsurf: "windsurf.cmd",
  zed: "zed.cmd",
}

const WINDOWS_APP_EXECUTABLES = {
  terminal: ["wt.exe", "WindowsTerminal.exe"],
  vscode: ["code.exe", "code.cmd"],
  cursor: ["cursor.exe", "cursor.cmd"],
  vscodium: ["codium.exe", "codium.cmd"],
  windsurf: ["windsurf.exe", "windsurf.cmd"],
  zed: ["zed.exe", "zed.cmd"],
  "visual-studio": ["devenv.exe"],
  "sublime-text": ["subl.exe", "sublime_text.exe"],
}

const WINDOWS_APP_ID_BY_NAME = new Map([
  ["finder", "finder"],
  ["file explorer", "finder"],
  ["terminal", "terminal"],
  ["windows terminal", "terminal"],
  ["visual studio code", "vscode"],
  ["cursor", "cursor"],
  ["vscodium", "vscodium"],
  ["windsurf", "windsurf"],
  ["zed", "zed"],
  ["visual studio", "visual-studio"],
  ["sublime text", "sublime-text"],
])

const getWindowsAppIdForName = (appName) =>
  WINDOWS_APP_ID_BY_NAME.get(
    String(appName || "")
      .trim()
      .toLowerCase(),
  ) || ""

const runWhere = (program) => {
  const result = spawnSync("where.exe", [program], { encoding: "utf8", windowsHide: true })
  if (result.error || result.status !== 0) return null
  const first = String(result.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
  return first || null
}

const findWindowsExecutable = (appId) => {
  for (const program of WINDOWS_APP_EXECUTABLES[appId] || []) {
    const resolved = runWhere(program)
    if (resolved) return resolved
  }
  return null
}

const resolveWindowsScriptIconExecutable = (scriptPath) => {
  if (!scriptPath || !/\.(?:cmd|bat)$/i.test(scriptPath)) return null
  let source = ""
  try {
    source = fs.readFileSync(scriptPath, "utf8")
  } catch {
    return null
  }
  const scriptDir = path.dirname(scriptPath)
  const matches = [
    ...source.matchAll(/(?:(?:%~dp0|%~dp0\\|%~dp0\/|\.\.\\|\.\.\/|[A-Za-z]:\\|[A-Za-z]:\/)[^"'\r\n]*?\.exe)/gi),
  ]
  for (const match of matches) {
    const raw = String(match[0] || "")
      .replace(/^%~dp0[\\/]?/i, "")
      .trim()
    const candidate = path.isAbsolute(raw) ? raw : path.resolve(scriptDir, raw)
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

let windowsTerminalPackagePathCache
const resolveWindowsTerminalPackagePath = () => {
  if (windowsTerminalPackagePathCache !== undefined) return windowsTerminalPackagePathCache
  const powershell = runWhere("powershell.exe") || runWhere("pwsh.exe")
  if (powershell) {
    const command =
      "$packages = @(" +
      "Get-AppxPackage -Name Microsoft.WindowsTerminal -ErrorAction SilentlyContinue;" +
      "Get-AppxPackage -Name Microsoft.WindowsTerminalPreview -ErrorAction SilentlyContinue" +
      ") | Where-Object { $_.InstallLocation } | Sort-Object Version -Descending; " +
      "if ($packages) { $packages[0].InstallLocation }"
    const result = spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-Command", command], {
      encoding: "utf8",
      windowsHide: true,
    })
    if (!result.error && result.status === 0) {
      const packagePath = String(result.stdout || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean)
      if (packagePath && fs.existsSync(packagePath)) {
        windowsTerminalPackagePathCache = packagePath
        return windowsTerminalPackagePathCache
      }
    }
  }
  const programFilesRoots = [process.env.ProgramW6432, process.env.ProgramFiles, "C:\\Program Files"].filter(
    (value, index, values) => typeof value === "string" && value && values.indexOf(value) === index,
  )
  for (const root of programFilesRoots) {
    const windowsAppsPath = path.join(root, "WindowsApps")
    let entries = []
    try {
      entries = fs.readdirSync(windowsAppsPath, { withFileTypes: true })
    } catch {
      continue
    }
    const packageNames = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => /^Microsoft\.WindowsTerminal(?:Preview)?_.*__8wekyb3d8bbwe$/i.test(name))
      .sort()
      .reverse()
    const stable = packageNames.find((name) => /^Microsoft\.WindowsTerminal_/i.test(name))
    const selected = stable || packageNames[0]
    if (selected) {
      windowsTerminalPackagePathCache = path.join(windowsAppsPath, selected)
      return windowsTerminalPackagePathCache
    }
  }
  windowsTerminalPackagePathCache = null
  return windowsTerminalPackagePathCache
}

const resolveWindowsTerminalIconPath = () => {
  const packagePath = resolveWindowsTerminalPackagePath()
  if (!packagePath) return null
  const candidates = [
    path.join(packagePath, "Images", "Square44x44Logo.targetsize-96_altform-unplated.png"),
    path.join(packagePath, "Images", "Square44x44Logo.targetsize-96.png"),
    path.join(packagePath, "Images", "StoreLogo.scale-200.png"),
    path.join(packagePath, "Images", "StoreLogo.scale-100.png"),
  ]
  return candidates.find((candidate) => fs.existsSync(candidate)) || null
}

const resolveWindowsTerminalExecutable = () => {
  const packagePath = resolveWindowsTerminalPackagePath()
  if (packagePath) {
    const executable = path.join(packagePath, "WindowsTerminal.exe")
    if (fs.existsSync(executable)) return executable
  }
  return findWindowsExecutable("terminal")
}

const imageFileToDataUrl = (filePath) => {
  if (!filePath) return null
  try {
    return `data:image/png;base64,${fs.readFileSync(filePath).toString("base64")}`
  } catch {
    return null
  }
}

const findWindowsAppNameExecutable = (appName) => {
  const program = `${String(appName || "").trim()}.exe`.replace(/\s+/g, "")
  return program === ".exe" ? null : runWhere(program)
}

const resolveWindowsAppIconExecutable = ({ appId, appName }) => {
  if (appId === "finder") {
    const explorerPath = path.join(process.env.SystemRoot || "C:\\Windows", "explorer.exe")
    return fs.existsSync(explorerPath) ? explorerPath : "explorer.exe"
  }
  if (appId === "terminal") return resolveWindowsTerminalExecutable()
  const executable = findWindowsExecutable(appId) || findWindowsAppNameExecutable(appName)
  if (!executable) return null
  if (/\.exe$/i.test(executable)) return executable
  return resolveWindowsScriptIconExecutable(executable) || executable
}

const windowsIconToDataUrl = async (executablePath) => {
  if (!executablePath) return null
  try {
    const image = await app.getFileIcon(executablePath, { size: "normal" })
    if (image.isEmpty()) return null
    return image.toDataURL()
  } catch {
    return null
  }
}

const isWindowsAppInstalled = ({ appId, appName }) => {
  if (appId === "finder") return true
  if (appId === "terminal") return Boolean(resolveWindowsTerminalExecutable())
  if (findWindowsExecutable(appId)) return true
  return Boolean(findWindowsAppNameExecutable(appName))
}

const buildWindowsInstalledApps = async (apps) => {
  const seen = new Set()
  const names = (Array.isArray(apps) ? apps : [])
    .map((appName) => String(appName || "").trim())
    .filter((appName) => appName && !seen.has(appName) && seen.add(appName))
    .filter((appName) => isWindowsAppInstalled({ appId: getWindowsAppIdForName(appName), appName }))
  const results = []
  for (const name of names) {
    const appId = getWindowsAppIdForName(name)
    const executablePath = resolveWindowsAppIconExecutable({ appId, appName: name })
    const iconDataUrl =
      appId === "terminal"
        ? imageFileToDataUrl(resolveWindowsTerminalIconPath()) || (await windowsIconToDataUrl(executablePath))
        : await windowsIconToDataUrl(executablePath)
    results.push({ name, iconDataUrl })
  }
  return results
}

const buildWindowsOpenProjectSpecs = ({ projectPath, appId, appName }) => {
  if (appId === "finder") return [{ program: "explorer.exe", args: [projectPath] }]
  if (appId === "terminal") {
    const specs = []
    const terminal = findWindowsExecutable("terminal")
    if (terminal) specs.push({ program: terminal, args: ["-d", projectPath] })
    const shellProgram = runWhere("pwsh.exe") || runWhere("powershell.exe")
    if (shellProgram) {
      specs.push({
        program: shellProgram,
        args: ["-NoExit", "-Command", `Set-Location -LiteralPath ${JSON.stringify(projectPath)}`],
        shellStart: true,
      })
    }
    const commandPrompt = process.env.ComSpec || runWhere("cmd.exe")
    if (commandPrompt) specs.push({ program: commandPrompt, args: ["/k", "cd", "/d", projectPath], shellStart: true })
    return specs
  }
  const specs = []
  const cli = WINDOWS_CLI_BY_APP_ID[appId]
  if (cli) {
    const resolvedCli = runWhere(cli)
    if (resolvedCli) specs.push({ program: resolvedCli, args: [projectPath] })
  }
  const exe = findWindowsExecutable(appId)
  if (exe) specs.push({ program: exe, args: [projectPath] })
  const namedExe = findWindowsAppNameExecutable(appName)
  if (namedExe && !specs.some((spec) => spec.program === namedExe)) {
    specs.push({ program: namedExe, args: [projectPath] })
  }
  return specs
}

const buildWindowsOpenFileSpecs = ({ filePath, appId, appName }) => {
  if (appId === "terminal") {
    return buildWindowsOpenProjectSpecs({ projectPath: path.dirname(filePath), appId, appName })
  }
  return buildWindowsOpenProjectSpecs({ projectPath: filePath, appId, appName })
}

const buildOpenProjectSpecs = ({ projectPath, appId, appName }) => {
  if (appId === "finder") return [{ program: "open", args: [projectPath] }]
  if (appId === "terminal" || appId === "iterm2" || appId === "ghostty") {
    return [{ program: "open", args: ["-a", appName, projectPath] }]
  }
  const specs = []
  const cli = CLI_BY_APP_ID[appId]
  if (cli) specs.push({ program: cli, args: ["-n", projectPath] })
  if (JETBRAINS_APP_IDS.has(appId)) specs.push({ program: "open", args: ["-na", appName, "--args", projectPath] })
  specs.push({ program: "open", args: ["-a", appName, projectPath] })
  return specs
}

const buildOpenFileSpecs = ({ filePath, appId, appName }) => {
  if (appId === "finder") return [{ program: "open", args: ["-R", filePath] }]
  if (appId === "terminal" || appId === "iterm2" || appId === "ghostty") {
    return buildOpenProjectSpecs({ projectPath: path.dirname(filePath), appId, appName })
  }
  const specs = []
  const cli = CLI_BY_APP_ID[appId]
  if (cli) specs.push({ program: cli, args: ["-n", filePath] })
  if (JETBRAINS_APP_IDS.has(appId)) specs.push({ program: "open", args: ["-na", appName, "--args", filePath] })
  specs.push({ program: "open", args: ["-a", appName, filePath] })
  return specs
}

const quoteWindowsCommandArg = (value) => `"${String(value).replace(/"/g, '""')}"`

const resolveWindowsLaunchProgram = (program) => {
  if (path.isAbsolute(program)) return fs.existsSync(program) ? program : null
  return runWhere(program)
}

const launchWindowsCommandScript = (spec, program) => {
  const commandLine = ["call", quoteWindowsCommandArg(program), ...spec.args.map(quoteWindowsCommandArg)].join(" ")
  const child = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", commandLine], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
    windowsVerbatimArguments: true,
  })
  child.unref()
}

const launchWindowsSpec = (spec) => {
  const program = resolveWindowsLaunchProgram(spec.program)
  if (!program) throw new Error("program not found")
  if (spec.shellStart) {
    const commandLine = ["start", '""', quoteWindowsCommandArg(program), ...spec.args.map(quoteWindowsCommandArg)].join(
      " ",
    )
    const child = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", commandLine], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
      windowsVerbatimArguments: true,
    })
    child.unref()
    return
  }
  if (/\.(cmd|bat)$/i.test(program)) {
    launchWindowsCommandScript(spec, program)
    return
  }
  const child = spawn(program, spec.args, { detached: true, stdio: "ignore", windowsHide: false })
  child.unref()
}

const runSpecChain = (specs, appName) => {
  if (!Array.isArray(specs) || specs.length === 0) {
    throw new Error(`Failed to open in ${appName}: no launch candidates`)
  }
  if (process.platform === "win32") {
    const failures = []
    for (const spec of specs) {
      try {
        launchWindowsSpec(spec)
        return
      } catch (error) {
        failures.push(`${spec.program}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    throw new Error(`Failed to open in ${appName}: ${failures.join("; ")}`)
  }
  const failures = []
  for (const spec of specs) {
    const result = spawnSync(spec.program, spec.args, { stdio: "ignore", windowsHide: true })
    if (result.error) {
      failures.push(`${spec.program}: ${result.error.message}`)
      continue
    }
    if (result.status === 0) return
    failures.push(`${spec.program} exited ${result.status}`)
  }
  throw new Error(`Failed to open in ${appName}: ${failures.join("; ")}`)
}

// ── Window-state persistence (main window geometry) ────────────────────────
const windowGeometryTimers = new Map()
const windowGeometryRevisions = new Map()

const readWindowState = () => {
  const stateValue = readSettingsRoot().desktopWindowState
  return stateValue && typeof stateValue === "object" ? stateValue : null
}

const clampWindowBoundsToVisibleWorkArea = (bounds) => {
  const width = Math.max(MIN_RESTORE_WINDOW_WIDTH, Math.round(Number(bounds?.width) || 0))
  const height = Math.max(MIN_RESTORE_WINDOW_HEIGHT, Math.round(Number(bounds?.height) || 0))
  const x = Math.round(Number(bounds?.x))
  const y = Math.round(Number(bounds?.y))
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { width, height }
  try {
    const display = screen.getDisplayMatching({ x, y, width, height }) || screen.getPrimaryDisplay()
    const workArea = display.workArea
    const clampedWidth = Math.min(width, Math.max(MIN_WINDOW_WIDTH, workArea.width))
    const clampedHeight = Math.min(height, Math.max(MIN_WINDOW_HEIGHT, workArea.height))
    const maxX = workArea.x + workArea.width - clampedWidth
    const maxY = workArea.y + workArea.height - clampedHeight
    return {
      x: clampedWidth >= workArea.width ? workArea.x : Math.min(Math.max(x, workArea.x), maxX),
      y: clampedHeight >= workArea.height ? workArea.y : Math.min(Math.max(y, workArea.y), maxY),
      width: clampedWidth,
      height: clampedHeight,
    }
  } catch {
    return { x, y, width, height }
  }
}

const writeWindowState = async (browserWindow) => {
  if (!browserWindow || browserWindow.isDestroyed()) return
  if (!mainWindow || browserWindow.id !== mainWindow.id) return
  const bounds = browserWindow.getBounds()
  await mutateSettingsRoot((root) => {
    if (!browserWindow || browserWindow.isDestroyed()) return root
    root.desktopWindowState = {
      x: bounds.x,
      y: bounds.y,
      width: Math.max(bounds.width, MIN_WINDOW_WIDTH),
      height: Math.max(bounds.height, MIN_WINDOW_HEIGHT),
      maximized: browserWindow.isMaximized(),
      fullscreen: browserWindow.isFullScreen(),
    }
  })
}

const debounceWindowStatePersist = (browserWindow, immediate = false) => {
  if (!browserWindow || browserWindow.isDestroyed()) return
  const key = String(browserWindow.id)
  const revision = (windowGeometryRevisions.get(key) || 0) + 1
  windowGeometryRevisions.set(key, revision)
  const existingTimer = windowGeometryTimers.get(key)
  if (existingTimer) {
    clearTimeout(existingTimer)
    windowGeometryTimers.delete(key)
  }
  const persist = async () => {
    if (windowGeometryRevisions.get(key) !== revision) return
    windowGeometryTimers.delete(key)
    await writeWindowState(browserWindow)
  }
  if (immediate) {
    void persist()
    return
  }
  const timer = setTimeout(() => {
    void persist()
  }, 300)
  windowGeometryTimers.set(key, timer)
}

// Attach geometry-persist + vibrancy listeners to a window. Used for the main
// window; restores saved geometry on the main window at creation time.
const attachWindowStateListeners = (browserWindow) => {
  if (!browserWindow || browserWindow.isDestroyed()) return
  const onChange = () => debounceWindowStatePersist(browserWindow)
  browserWindow.on("resize", onChange)
  browserWindow.on("move", onChange)
  browserWindow.on("maximize", onChange)
  browserWindow.on("unmaximize", onChange)
  browserWindow.on("close", () => debounceWindowStatePersist(browserWindow, true))
}

// Restore saved geometry onto the main window before it is shown.
const restoreMainWindowGeometry = (browserWindow) => {
  if (!browserWindow || browserWindow.isDestroyed()) return
  const saved = readWindowState()
  if (!saved || typeof saved.width !== "number" || typeof saved.height !== "number") return
  const bounds = clampWindowBoundsToVisibleWorkArea(saved)
  try {
    browserWindow.setBounds(bounds)
    if (saved.fullscreen) browserWindow.setFullScreen(true)
    else if (saved.maximized) browserWindow.maximize()
  } catch {}
}

// macOS vibrancy preference (persisted; takes effect on a fresh launch).
const isVibrancyEnabled = () => readSettingsRoot().desktopVibrancy === true
const applyMacVibrancy = (browserWindow) => {
  if (process.platform !== "darwin" || !browserWindow || browserWindow.isDestroyed()) return
  if (!isVibrancyEnabled()) return
  try {
    browserWindow.setVibrancy("sidebar")
  } catch {}
}

// ── Additional windows ─────────────────────────────────────────────────────
// In our single-server model a new window simply loads the local server URL
// (or, when a non-local default host is configured, that host's URL). We do not
// inject runtime-config the way upstream's packaged-UI protocol did.
const createAdditionalWindow = async (url) => {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: "AX Code",
    backgroundColor: "#151313",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })
  win.once("ready-to-show", () => win.show())
  win.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (isTrustedRendererNavigation(targetUrl)) return { action: "allow" }
    safeOpenExternal(targetUrl)
    return { action: "deny" }
  })
  win.webContents.on("will-navigate", (event, targetUrl) => {
    if (isTrustedRendererNavigation(targetUrl)) return
    event.preventDefault()
    safeOpenExternal(targetUrl)
  })
  await win.loadURL(url)
  return win
}

// ── Menu (native application menu) ─────────────────────────────────────────
const dispatchMenuAction = (action) => {
  const target = getMenuTargetWindow()
  if (target && !target.isDestroyed()) target.webContents.send("openchamber:menu-action", action)
}

const dispatchCheckForUpdates = () => {
  emitToAllWindows("openchamber:check-for-updates")
}

const getMenuTargetWindow = () => {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused && !focused.isDestroyed()) return focused
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow
  const [firstWindow] = BrowserWindow.getAllWindows()
  return firstWindow && !firstWindow.isDestroyed() ? firstWindow : null
}

const reloadMenuTargetWindow = () => {
  const target = getMenuTargetWindow()
  if (!target || target.isDestroyed()) return
  target.webContents.reload()
}

const relaunchFromMenu = async () => {
  await shutdownForExit()
  app.relaunch()
  app.exit(0)
}

const DISCORD_INVITE_URL = "https://discord.gg/ZYRSdnwwKA"

const buildMacMenu = () => {
  const dispatchAction = (action) => dispatchMenuAction(action)
  const handleCopyAction = () => {
    BrowserWindow.getFocusedWindow()?.webContents.copy()
    dispatchAction("copy")
  }
  return Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { label: "About AX Code", click: () => dispatchAction("about") },
        { label: "Check for Updates", click: () => dispatchCheckForUpdates() },
        { type: "separator" },
        { label: "Settings", accelerator: "Cmd+,", click: () => dispatchAction("settings") },
        { label: "Reload Webview", click: () => reloadMenuTargetWindow() },
        {
          label: "Restart",
          click: () => {
            void relaunchFromMenu()
          },
        },
        { label: "Command Palette", accelerator: "Cmd+P", click: () => dispatchAction("command-palette") },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        {
          label: "New Window",
          accelerator: "Cmd+Shift+Alt+N",
          click: () => {
            void handleNewWindow()
          },
        },
        { type: "separator" },
        { label: "New Session", accelerator: "Cmd+N", click: () => dispatchAction("new-session") },
        { label: "New Worktree", accelerator: "Cmd+Shift+N", click: () => dispatchAction("new-worktree-session") },
        { type: "separator" },
        { label: "Add Workspace", click: () => dispatchAction("change-workspace") },
        { type: "separator" },
        { role: "close" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { label: "Copy", accelerator: "Cmd+C", click: () => handleCopyAction() },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Toggle Right Sidebar", accelerator: "Cmd+B", click: () => dispatchAction("toggle-right-sidebar") },
        {
          label: "Open Git Sidebar",
          accelerator: "Cmd+Shift+G",
          click: () => dispatchAction("open-right-sidebar-git"),
        },
        {
          label: "Open Files Sidebar",
          accelerator: "Cmd+Shift+F",
          click: () => dispatchAction("open-right-sidebar-files"),
        },
        { type: "separator" },
        { label: "Toggle Terminal Dock", accelerator: "Cmd+J", click: () => dispatchAction("toggle-terminal") },
        {
          label: "Toggle Terminal Expanded",
          accelerator: "Cmd+Shift+J",
          click: () => dispatchAction("toggle-terminal-expanded"),
        },
        { type: "separator" },
        { label: "Light Theme", click: () => dispatchAction("theme-light") },
        { label: "Dark Theme", click: () => dispatchAction("theme-dark") },
        { label: "System Theme", click: () => dispatchAction("theme-system") },
        { type: "separator" },
        { label: "Toggle Session Sidebar", accelerator: "Cmd+L", click: () => dispatchAction("toggle-sidebar") },
        { type: "separator" },
        { role: "resetZoom", label: "Actual Size" },
        { role: "zoomIn", label: "Zoom In" },
        { role: "zoomOut", label: "Zoom Out" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "close" }],
    },
    {
      label: "Help",
      submenu: [
        { label: "Keyboard Shortcuts", accelerator: "Cmd+.", click: () => dispatchAction("help-dialog") },
        { label: "Show Diagnostics", accelerator: "Cmd+Shift+L", click: () => dispatchAction("download-logs") },
        { type: "separator" },
        {
          label: "Clear Cache",
          click: () => {
            void clearCacheAndReload()
          },
        },
        { type: "separator" },
        { label: "Report a Bug", click: () => shell.openExternal(GITHUB_BUG_REPORT_URL) },
        { label: "Request a Feature", click: () => shell.openExternal(GITHUB_FEATURE_REQUEST_URL) },
        { type: "separator" },
        { label: "Join Discord", click: () => shell.openExternal(DISCORD_INVITE_URL) },
      ],
    },
  ])
}

const buildNonMacMenu = () => {
  const dispatchAction = (action) => dispatchMenuAction(action)
  const handleCopyAction = () => {
    BrowserWindow.getFocusedWindow()?.webContents.copy()
    dispatchAction("copy")
  }
  const isDev = !app.isPackaged
  return Menu.buildFromTemplate([
    {
      label: "AX Code",
      submenu: [
        { label: "About AX Code", click: () => dispatchAction("about") },
        { label: "Check for Updates", click: () => dispatchCheckForUpdates() },
        { type: "separator" },
        { label: "Settings", accelerator: "Ctrl+,", click: () => dispatchAction("settings") },
        { label: "Reload Webview", click: () => reloadMenuTargetWindow() },
        {
          label: "Restart",
          click: () => {
            void relaunchFromMenu()
          },
        },
        { label: "Command Palette", accelerator: "Ctrl+P", click: () => dispatchAction("command-palette") },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        {
          label: "New Window",
          accelerator: "Ctrl+Shift+Alt+N",
          click: () => {
            void handleNewWindow()
          },
        },
        { type: "separator" },
        { label: "New Session", accelerator: "Ctrl+N", click: () => dispatchAction("new-session") },
        { label: "New Worktree", accelerator: "Ctrl+Shift+N", click: () => dispatchAction("new-worktree-session") },
        { type: "separator" },
        { label: "Add Workspace", click: () => dispatchAction("change-workspace") },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { label: "Copy", accelerator: "Ctrl+C", click: () => handleCopyAction() },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        ...(isDev ? [{ role: "toggleDevTools" }] : []),
        { type: "separator" },
        { label: "Toggle Right Sidebar", accelerator: "Ctrl+B", click: () => dispatchAction("toggle-right-sidebar") },
        { type: "separator" },
        { label: "Light Theme", click: () => dispatchAction("theme-light") },
        { label: "Dark Theme", click: () => dispatchAction("theme-dark") },
        { label: "System Theme", click: () => dispatchAction("theme-system") },
        { type: "separator" },
        { role: "resetZoom", label: "Actual Size" },
        { role: "zoomIn", label: "Zoom In" },
        { role: "zoomOut", label: "Zoom Out" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Help",
      submenu: [
        { label: "Keyboard Shortcuts", accelerator: "Ctrl+.", click: () => dispatchAction("help-dialog") },
        { label: "Show Diagnostics", accelerator: "Ctrl+Shift+L", click: () => dispatchAction("download-logs") },
        { type: "separator" },
        {
          label: "Clear Cache",
          click: () => {
            void clearCacheAndReload()
          },
        },
        { type: "separator" },
        { label: "Report a Bug", click: () => shell.openExternal(GITHUB_BUG_REPORT_URL) },
        { label: "Request a Feature", click: () => shell.openExternal(GITHUB_FEATURE_REQUEST_URL) },
      ],
    },
  ])
}

const setupApplicationMenu = () => {
  Menu.setApplicationMenu(process.platform === "darwin" ? buildMacMenu() : buildNonMacMenu())
}

// ── Tray (macOS only; no-ops cleanly if icon assets are absent) ────────────
let trayController = null
const resourceRoot = () => (app.isPackaged ? process.resourcesPath : path.join(__dirname, "resources"))

const trayIconAssets = () => {
  const dir = path.join(resourceRoot(), "icons", "tray")
  const statusDir = path.join(dir, "status")
  const TRAY_BREATH_FRAME_COUNT = 16
  return {
    idleIconPath: path.join(dir, "trayTemplate-idle.png"),
    unseenIconPath: path.join(dir, "trayTemplate-unseen.png"),
    breathIconPaths: Array.from({ length: TRAY_BREATH_FRAME_COUNT }, (_, i) =>
      path.join(dir, `trayTemplate-breath-${String(i).padStart(2, "0")}.png`),
    ),
    statusIconPaths: {
      busy: path.join(statusDir, "busy.png"),
      retry: path.join(statusDir, "retry.png"),
      error: path.join(statusDir, "error.png"),
      unseen: path.join(statusDir, "unseen.png"),
      blank: path.join(statusDir, "blank.png"),
    },
  }
}

const revealMainWindow = async () => {
  let target = mainWindow
  if ((!target || target.isDestroyed()) && serverPort > 0) {
    await createWindow().catch(() => {})
    target = mainWindow
  }
  if (target && !target.isDestroyed()) {
    if (target.isMinimized()) target.restore()
    target.show()
    target.focus()
  }
  return target
}

const dispatchTrayAction = async (action) => {
  if (!action || typeof action !== "object") return
  if (action.type === "quit") {
    app.quit()
    return
  }
  if (action.type === "respond-permission") {
    const target = mainWindow && !mainWindow.isDestroyed() ? mainWindow : await revealMainWindow()
    // Use sendDesktopEvent so the tray action reaches the renderer via both
    // the literal IPC channel (for __TAURI__.event.listen) AND the
    // ax-code:dom-event envelope (for window.addEventListener). Raw
    // webContents.send only delivers on the literal channel, where no
    // listener exists for openchamber:tray-action — causing the click to
    // silently do nothing. See #tray-permission-stability.
    if (target && !target.isDestroyed()) sendDesktopEvent(target.webContents, "openchamber:tray-action", action)
    return
  }
  if (action.type === "new-mini-chat") {
    const target = getMenuTargetWindow() || (await revealMainWindow())
    if (target && !target.isDestroyed()) target.webContents.send("openchamber:open-mini-chat")
    return
  }
  if (action.type === "focus-session") {
    const target = await revealMainWindow()
    if (target && !target.isDestroyed() && action.sessionId) {
      // Use sendDesktopEvent so the open-session event reaches the renderer
      // via the ax-code:dom-event envelope (window.addEventListener path).
      sendDesktopEvent(target.webContents, "openchamber:open-session", {
        sessionId: action.sessionId,
        directory: action.directory || "",
      })
    }
    return
  }
  const target = await revealMainWindow()
  if (!target || target.isDestroyed()) return
  if (action.type === "new-session") {
    sendDesktopEvent(target.webContents, "openchamber:open-draft-session", { directory: "", projectId: "" })
  }
  // show-main-window: revealing the window above is the whole action.
}

const setupTray = () => {
  if (process.platform !== "darwin" || trayController) return
  const assets = trayIconAssets()
  if (!fs.existsSync(assets.idleIconPath)) {
    console.warn("[electron] tray icon missing, skipping tray setup", { iconPath: assets.idleIconPath })
    return
  }
  try {
    trayController = createTrayController({
      ...assets,
      onAction: (action) => {
        void dispatchTrayAction(action)
      },
    })
    trayController.update({ sessions: [], approvals: [] })
  } catch (error) {
    console.warn("[electron] failed to set up tray", error)
    trayController = null
  }
}

// ── Shared command bodies (used by handlers and menu items) ────────────────
const clearCacheAndReload = async () => {
  await session.defaultSession.clearStorageData()
  for (const browserWindow of BrowserWindow.getAllWindows()) {
    browserWindow.webContents.reload()
  }
}

const handleNewWindow = async () => {
  const config = readDesktopHostsConfig()
  let targetUrl = localOriginUrl()
  if (config.defaultHostId && config.defaultHostId !== LOCAL_HOST_ID) {
    const host = config.hosts.find((entry) => entry.id === config.defaultHostId)
    if (host?.url) targetUrl = host.url
  }
  await createAdditionalWindow(targetUrl)
}

const applyWindowTheme = (browserWindow, args) => {
  const mode = typeof args?.themeMode === "string" ? args.themeMode : ""
  const variant = typeof args?.themeVariant === "string" ? args.themeVariant : ""
  if (mode === "system") nativeTheme.themeSource = "system"
  else if (mode === "light") nativeTheme.themeSource = "light"
  else if (mode === "dark") nativeTheme.themeSource = "dark"
  else if (variant === "light") nativeTheme.themeSource = "light"
  else if (variant === "dark") nativeTheme.themeSource = "dark"
  else nativeTheme.themeSource = "system"
}

// ── New command handlers (origin guard defined above) ─────────────────────────

// File / app ops (local-only)
handleCommand("desktop_open_path", async (args) => {
  const targetPath = typeof args.path === "string" ? args.path.trim() : ""
  const appName = typeof args.app === "string" ? args.app.trim() : ""
  if (!targetPath) throw new Error("Path is required")
  if (process.platform === "darwin") {
    const openArgs = appName ? ["-a", appName, targetPath] : [targetPath]
    spawn("open", openArgs, { detached: true, stdio: "ignore" }).unref()
    return null
  }
  await shell.openPath(targetPath)
  return null
})

handleCommand("desktop_reveal_path", async (args) => {
  const targetPath = typeof args.path === "string" ? args.path.trim() : ""
  if (!targetPath) throw new Error("Path is required")
  shell.showItemInFolder(targetPath)
  return null
})

handleCommand("desktop_open_external_url", async (args) => {
  const target = typeof args.url === "string" ? args.url.trim() : ""
  if (!target) throw new Error("URL is required")
  const parsed = new URL(target)
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only HTTP URLs can be opened externally")
  }
  await shell.openExternal(parsed.toString())
  return null
})

handleCommand("desktop_open_in_app", async (args) => {
  const projectPath = typeof args.projectPath === "string" ? args.projectPath.trim() : ""
  const appId = typeof args.appId === "string" ? args.appId.trim().toLowerCase() : ""
  const appName = typeof args.appName === "string" ? args.appName.trim() : ""
  if (!projectPath || !appId || !appName) {
    throw new Error("Project path, app id, and app name are required")
  }
  if (process.platform === "win32") {
    if (appId === "finder") {
      const error = await shell.openPath(projectPath)
      if (error) throw new Error(error)
      return null
    }
    runSpecChain(buildWindowsOpenProjectSpecs({ projectPath, appId, appName }), appName)
    return null
  }
  if (process.platform !== "darwin") {
    throw new Error("desktop_open_in_app is only supported on macOS and Windows")
  }
  runSpecChain(buildOpenProjectSpecs({ projectPath, appId, appName }), appName)
  return null
})

handleCommand("desktop_open_file_in_app", async (args) => {
  const filePath = typeof args.filePath === "string" ? args.filePath.trim() : ""
  const appId = typeof args.appId === "string" ? args.appId.trim().toLowerCase() : ""
  const appName = typeof args.appName === "string" ? args.appName.trim() : ""
  if (!filePath || !appId || !appName) {
    throw new Error("File path, app id, and app name are required")
  }
  if (process.platform === "win32") {
    if (appId === "finder") {
      shell.showItemInFolder(filePath)
      return null
    }
    runSpecChain(buildWindowsOpenFileSpecs({ filePath, appId, appName }), appName)
    return null
  }
  if (process.platform !== "darwin") {
    throw new Error("desktop_open_file_in_app is only supported on macOS and Windows")
  }
  runSpecChain(buildOpenFileSpecs({ filePath, appId, appName }), appName)
  return null
})

handleCommand("desktop_get_installed_apps", async (args) => {
  const cachePath = buildInstalledAppsCachePath()
  const now = Math.floor(Date.now() / 1000)
  let cache = null
  try {
    cache = JSON.parse(await fsp.readFile(cachePath, "utf8"))
  } catch {}
  const cachedApps = Array.isArray(cache?.apps) ? cache.apps : []
  const hasCache = Boolean(cache)
  const isCacheStale = !cache || now - Number(cache.updatedAt || 0) > INSTALLED_APPS_CACHE_TTL_SECS
  const refresh = async () => {
    const apps =
      process.platform === "win32"
        ? await buildWindowsInstalledApps(args.apps)
        : await buildInstalledApps(Array.isArray(args.apps) ? args.apps : [])
    await fsp.mkdir(path.dirname(cachePath), { recursive: true })
    await fsp.writeFile(cachePath, JSON.stringify({ updatedAt: now, apps }, null, 2))
    emitToAllWindows("openchamber:installed-apps-updated", apps)
  }
  if (process.platform !== "darwin" && process.platform !== "win32") {
    throw new Error("desktop_get_installed_apps is only supported on macOS and Windows")
  }
  if (!hasCache || isCacheStale || args.force === true) void refresh()
  return { apps: cachedApps, hasCache, isCacheStale }
})

handleCommand("desktop_filter_installed_apps", async (args) => {
  if (process.platform === "win32") {
    return (await buildWindowsInstalledApps(args.apps)).map((a) => a.name)
  }
  if (process.platform !== "darwin") {
    throw new Error("desktop_filter_installed_apps is only supported on macOS")
  }
  if (!Array.isArray(args.apps)) return []
  const results = await Promise.all(
    args.apps.map(async (appName) => ((await isAppBundleInstalled(String(appName))) ? String(appName) : null)),
  )
  return results.filter(Boolean)
})

handleCommand("desktop_fetch_app_icons", async (args) => {
  if (process.platform === "win32") {
    const names = Array.isArray(args.apps) ? args.apps : []
    const results = []
    for (const name of names) {
      const appName = String(name || "").trim()
      if (!appName) continue
      const appId = getWindowsAppIdForName(appName)
      const dataUrl =
        appId === "terminal"
          ? imageFileToDataUrl(resolveWindowsTerminalIconPath()) ||
            (await windowsIconToDataUrl(resolveWindowsAppIconExecutable({ appId, appName })))
          : await windowsIconToDataUrl(resolveWindowsAppIconExecutable({ appId, appName }))
      if (dataUrl) results.push({ app: appName, dataUrl })
    }
    return results
  }
  if (process.platform !== "darwin") {
    throw new Error("desktop_fetch_app_icons is only supported on macOS")
  }
  const names = Array.isArray(args.apps) ? args.apps : []
  const results = []
  for (const name of names) {
    const appPath = await resolveAppBundlePath(String(name))
    if (!appPath) continue
    const dataUrl = await iconToDataUrl(await resolveAppIconPath(appPath), String(name))
    if (dataUrl) results.push({ app: String(name), dataUrl })
  }
  return results
})

handleCommand("desktop_read_file", async (args) => {
  const rawPath = typeof args.path === "string" ? args.path : ""
  if (!rawPath) throw new Error("Path is required")
  // Defense in depth behind the IPC origin gate: resolve the path, require it
  // under $HOME or tmpdir, and refuse known secret dirs / dotfiles.
  const filePath = path.resolve(rawPath)
  // Resolve symlinks so a symlink inside $HOME pointing to /etc/shadow or
  // ~/.ssh/id_rsa can't bypass the allowlist / DENIED_SEGMENTS check.
  let realPath
  try {
    realPath = await fsp.realpath(filePath)
  } catch {
    throw new Error("Cannot resolve file path")
  }
  const home = os.homedir() || ""
  const tmp = os.tmpdir() || ""
  const underHome = home && (realPath === home || realPath.startsWith(home + path.sep))
  const underTmp = tmp && (realPath === tmp || realPath.startsWith(tmp + path.sep))
  if (!underHome && !underTmp) throw new Error("File is outside the allowed workspace")
  const DENIED_SEGMENTS = [".ssh", ".aws", ".gnupg", ".gpg", ".config/gh", ".config/openchamber/credentials"]
  const relFromHome = underHome ? realPath.slice(home.length + 1) : ""
  const relNormalized = relFromHome.split(path.sep).join("/")
  if (DENIED_SEGMENTS.some((segment) => relNormalized === segment || relNormalized.startsWith(`${segment}/`))) {
    throw new Error("Access to this path is not allowed")
  }
  const basename = path.basename(realPath).toLowerCase()
  if (basename === ".env" || basename.startsWith(".env.") || basename.endsWith(".pem") || basename.endsWith(".key")) {
    throw new Error("Access to this path is not allowed")
  }
  const stats = await fsp.stat(realPath)
  if (stats.size > 50 * 1024 * 1024) throw new Error("File is too large. Maximum size is 50MB.")
  const bytes = await fsp.readFile(realPath)
  // Classify by the resolved target we actually read, not the (possibly
  // symlinked) requested path — otherwise the mime can mislabel the bytes.
  const ext = path.extname(realPath).toLowerCase()
  const mime =
    {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
      ".bmp": "image/bmp",
      ".ico": "image/x-icon",
      ".pdf": "application/pdf",
      ".txt": "text/plain",
      ".md": "text/markdown",
      ".json": "application/json",
      ".js": "text/javascript",
      ".ts": "text/typescript",
      ".tsx": "text/typescript-jsx",
      ".jsx": "text/javascript-jsx",
      ".html": "text/html",
      ".css": "text/css",
      ".py": "text/x-python",
    }[ext] || "application/octet-stream"
  return { mime, base64: bytes.toString("base64"), size: bytes.length }
})

handleCommand("desktop_save_markdown_file", async (args, event) => {
  const defaultPath = typeof args.defaultFileName === "string" ? args.defaultFileName.trim() : ""
  if (!defaultPath) throw new Error("Default file name is required")
  const content = typeof args.content === "string" ? args.content : ""
  const ownerWindow = event ? BrowserWindow.fromWebContents(event.sender) : undefined
  const result = await dialog.showSaveDialog(ownerWindow || undefined, {
    defaultPath,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  })
  if (result.canceled || !result.filePath) return null
  await fsp.writeFile(result.filePath, content, "utf8")
  return result.filePath
})

// desktop_search_files: upstream main.mjs has no such handler; implement a
// minimal recursive name search under an allowed root (HOME/tmp) so the
// renderer contract is satisfied.
// Matches the renderer contract in packages/ui/src/lib/desktop.ts:
//   args:   { directory, query, options?: { limit, includeHidden, respectGitignore } }
//   return: NativeFileSearchResult[] = { name, path, relativePath, extension? }
// Searches the given (user-opened) project directory directly — no HOME/tmp
// restriction, matching the previous Tauri desktop_search_files behaviour.
// respectGitignore is honoured best-effort via the SKIP_DIRS denylist; the
// renderer falls back to the gitignore-aware HTTP search when this returns null.
handleCommand("desktop_search_files", async (args) => {
  const root = typeof args.directory === "string" ? args.directory.trim() : ""
  const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : ""
  if (!root || !path.isAbsolute(root)) throw new Error("An absolute directory is required")
  if (!query) return []
  const options = args.options && typeof args.options === "object" ? args.options : {}
  const includeHidden = options.includeHidden === true
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? Math.min(Math.floor(options.limit), 1000) : 200
  const resolvedRoot = path.resolve(root)
  try {
    if (!(await fsp.stat(resolvedRoot)).isDirectory()) return []
  } catch {
    return []
  }
  const SKIP_DIRS = new Set(["node_modules", ".git", ".hg", ".svn", "dist", "build", ".next", ".cache", "target"])
  const results = []
  const walk = async (dir, depth) => {
    if (results.length >= limit || depth > 12) return
    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (results.length >= limit) return
      if (entry.name.startsWith(".") && !includeHidden) continue
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.name.toLowerCase().includes(query)) {
        const ext = entry.isDirectory() ? undefined : path.extname(entry.name).replace(/^\./, "") || undefined
        results.push({
          name: entry.name,
          path: full,
          relativePath: path.relative(resolvedRoot, full),
          ...(ext ? { extension: ext } : {}),
        })
      }
      if (entry.isDirectory()) await walk(full, depth + 1)
    }
  }
  await walk(resolvedRoot, 0)
  return results
})

handleCommand("desktop_clear_cache", async () => {
  await clearCacheAndReload()
  return null
})

handleCommand("desktop_notify", async (args) => {
  maybeShowNativeNotification(args)
  return null
})

// Window-rect screen capture (local-only by capability, but mirror upstream's
// safe-for-remote allowlist? upstream lists desktop_capture_page_rect as safe).
handleCommand(
  "desktop_capture_page_rect",
  async (args, event) => {
    const browserWindow = event ? BrowserWindow.fromWebContents(event.sender) : mainWindow
    if (!browserWindow || browserWindow.isDestroyed()) throw new Error("Window is not available")
    const bounds = browserWindow.getContentBounds()
    const x = Number.isFinite(args.x) ? Math.max(0, Math.floor(args.x)) : 0
    const y = Number.isFinite(args.y) ? Math.max(0, Math.floor(args.y)) : 0
    const width = Number.isFinite(args.width) ? Math.max(1, Math.floor(args.width)) : 1
    const height = Number.isFinite(args.height) ? Math.max(1, Math.floor(args.height)) : 1
    const clampedX = Math.min(x, Math.max(0, bounds.width - 1))
    const clampedY = Math.min(y, Math.max(0, bounds.height - 1))
    const rect = {
      x: clampedX,
      y: clampedY,
      width: Math.min(width, Math.max(1, bounds.width - clampedX)),
      height: Math.min(height, Math.max(1, bounds.height - clampedY)),
    }
    if (rect.width * rect.height > MAX_CAPTURE_PAGE_RECT_AREA) throw new Error("Capture area is too large")
    const image = await browserWindow.webContents.capturePage(rect)
    const buffer = image.toJPEG(82)
    return {
      mime: "image/jpeg",
      base64: buffer.toString("base64"),
      width: image.getSize().width,
      height: image.getSize().height,
    }
  },
  { safeForRemote: true },
)

handleCommand("desktop_browser_capture_page", async (args) => {
  const wcId = Number.isFinite(args.webContentsId) ? Math.trunc(args.webContentsId) : null
  if (wcId === null || wcId < 0) throw new Error("webContentsId is required")
  const wc = webContents.fromId(wcId)
  if (!wc || wc.isDestroyed()) throw new Error("WebContents not found")
  const image = await wc.capturePage()
  const buffer = image.toJPEG(82)
  return {
    mime: "image/jpeg",
    base64: buffer.toString("base64"),
    width: image.getSize().width,
    height: image.getSize().height,
  }
})

// Hosts (switcher list) — get/probe safe-for-remote, set local-only.
handleCommand(
  "desktop_hosts_get",
  async () => ({
    ...readDesktopHostsConfig({ includeSecrets: false }),
    localOrigin: localOriginUrl(),
  }),
  { safeForRemote: true },
)

handleCommand("desktop_hosts_set", async (args) => {
  const nextConfigInput = args.input || args.config || {}
  await writeDesktopHostsConfig(nextConfigInput)
  return null
})

handleCommand(
  "desktop_host_probe",
  async (args, event) => {
    const targetUrl = String(args.url || "")
    const hostConfig = readDesktopHostsConfig({ includeSecrets: true })
    if (
      !isLocalSender(event.sender) &&
      !isAllowedDesktopHostTargetUrl(targetUrl, {
        localOrigin: localOriginUrl(),
        hosts: hostConfig.hosts,
      })
    ) {
      throw new Error("Host URL is not configured for this desktop session")
    }
    const explicitToken = sanitizeClientTokenForStorage(args.clientToken) || ""
    const localToken = isAllowedDesktopHostTargetUrl(targetUrl, { localOrigin: localOriginUrl(), hosts: [] })
      ? readDesktopLocalClientToken()
      : ""
    const storedToken =
      explicitToken ||
      localToken ||
      resolveStoredClientTokenForUrl(targetUrl, { hosts: hostConfig.hosts })
    return probeHostWithTimeout(targetUrl, 2_000, storedToken)
  },
  { safeForRemote: true },
)

// Window / UI
handleCommand(
  "desktop_set_window_theme",
  async (args, event) => {
    const browserWindow = event ? BrowserWindow.fromWebContents(event.sender) : getMenuTargetWindow()
    applyWindowTheme(browserWindow, args)
    return null
  },
  { safeForRemote: true },
)

handleCommand("desktop_set_vibrancy", async (args) => {
  // Vibrancy is a window-creation option; persist the preference and relaunch.
  const enabled = args.enabled === true
  await mutateSettingsRoot((root) => {
    root.desktopVibrancy = enabled
  })
  setImmediate(() => {
    shutdownForExit().finally(() => {
      app.relaunch()
      app.exit(0)
    })
  })
  return { enabled, requiresRestart: true }
})

handleCommand(
  "desktop_new_window",
  async () => {
    await handleNewWindow()
    return null
  },
  { safeForRemote: true },
)

handleCommand(
  "desktop_new_window_at_url",
  async (args) => {
    const targetUrl = normalizeHostUrl(String(args.url || ""))
    if (!targetUrl) throw new Error("Invalid URL")
    if (
      !isAllowedDesktopHostTargetUrl(targetUrl, {
        localOrigin: localOriginUrl(),
        hosts: readDesktopHostsConfig().hosts,
      })
    ) {
      throw new Error("Host URL is not configured for this desktop session")
    }
    await createAdditionalWindow(targetUrl)
    return null
  },
  { safeForRemote: true },
)

// SSH (local-only) — mirror upstream's dispatch.
handleCommand("desktop_ssh_instances_get", async () => sshManager.readInstances())
handleCommand("desktop_ssh_instances_set", async (args) => {
  await sshManager.setInstances(args.config || {})
  return null
})
handleCommand("desktop_ssh_import_hosts", async () => sshManager.importHosts())
handleCommand("desktop_ssh_connect", async (args) => {
  await sshManager.connect(String(args.id || "").trim())
  return null
})
handleCommand("desktop_ssh_disconnect", async (args) => {
  await sshManager.disconnect(String(args.id || "").trim())
  return null
})
handleCommand("desktop_ssh_status", async (args) =>
  sshManager.statusesWithDefaults(String(args.id || "").trim() || undefined),
)
handleCommand("desktop_ssh_logs", async (args) =>
  sshManager.logsForInstance(String(args.id || "").trim(), Number(args.limit) || 200),
)
handleCommand("desktop_ssh_logs_clear", async (args) => {
  sshManager.clearLogsForInstance(String(args.id || "").trim())
  return null
})

// ── Window controls, app menu & mini-chat windows ──────────────────────────
const senderWindow = (event) => (event ? BrowserWindow.fromWebContents(event.sender) : null)

// Mini-chat is a small companion window that loads the dedicated mini-chat.html
// entry; the renderer (ElectronMiniChatApp) reads mode/sessionId/directory/
// projectId from the URL query string.
const createMiniChatWindow = async ({ mode, sessionId, directory, projectId }) => {
  const win = new BrowserWindow({
    width: 420,
    height: 640,
    minWidth: 360,
    minHeight: 420,
    title: "AX Code",
    backgroundColor: "#151313",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })
  win.once("ready-to-show", () => win.show())
  win.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (isTrustedRendererNavigation(targetUrl)) return { action: "allow" }
    safeOpenExternal(targetUrl)
    return { action: "deny" }
  })
  win.webContents.on("will-navigate", (event, targetUrl) => {
    if (isTrustedRendererNavigation(targetUrl)) return
    event.preventDefault()
    safeOpenExternal(targetUrl)
  })
  const params = new URLSearchParams()
  params.set("mode", mode === "session" ? "session" : "draft")
  if (sessionId) params.set("sessionId", sessionId)
  if (directory) params.set("directory", directory)
  if (projectId) params.set("projectId", projectId)
  const base = getDevRendererUrl() || `http://localhost:${serverPort}`
  await win.loadURL(`${base}/mini-chat.html?${params.toString()}`)
  return win
}

handleCommand("desktop_open_session_mini_chat_window", async (args) => {
  const sessionId = typeof args.sessionId === "string" ? args.sessionId.trim() : ""
  if (!sessionId) throw new Error("Session id is required")
  const directory = typeof args.directory === "string" ? args.directory.trim() : ""
  await createMiniChatWindow({ mode: "session", sessionId, directory })
  return null
})

handleCommand("desktop_open_draft_mini_chat_window", async (args) => {
  const directory = typeof args.directory === "string" ? args.directory.trim() : ""
  const projectId = typeof args.projectId === "string" ? args.projectId.trim() : ""
  await createMiniChatWindow({ mode: "draft", directory, projectId })
  return null
})

handleCommand("desktop_set_window_pinned", async (args, event) => {
  const win = senderWindow(event)
  const pinned = Boolean(args && args.pinned === true)
  if (win && !win.isDestroyed()) {
    win.setAlwaysOnTop(pinned, "floating")
    if (process.platform === "darwin") win.setVisibleOnAllWorkspaces(pinned)
    win.__ocPinned = pinned
  }
  return { pinned }
})

handleCommand("desktop_get_window_pinned", async (_args, event) => {
  const win = senderWindow(event)
  return { pinned: Boolean(win && win.__ocPinned) }
})

handleCommand("desktop_focus_main_window", async (args) => {
  const sessionId = typeof args.sessionId === "string" ? args.sessionId.trim() : ""
  const directory = typeof args.directory === "string" ? args.directory.trim() : ""
  const mode = typeof args.mode === "string" ? args.mode.trim() : ""
  const projectId = typeof args.projectId === "string" ? args.projectId.trim() : ""

  const emitOpen = () => {
    // Target the main window only — broadcasting would also hit the mini-chat
    // that requested the hand-off.
    if (sessionId) emitToWindow(mainWindow, "openchamber:open-session", { sessionId, directory })
    else if (mode === "draft") emitToWindow(mainWindow, "openchamber:open-draft-session", { directory, projectId })
  }

  const hadWindow = Boolean(mainWindow && !mainWindow.isDestroyed())
  if (!hadWindow) {
    await createWindow()
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    if (hadWindow) {
      emitOpen()
    } else {
      // A freshly created window's renderer hasn't mounted React (and attached
      // the window 'openchamber:open-session' listener) by the time loadURL
      // resolves — and loadURL resolves only AFTER 'did-finish-load' has fired,
      // so a listener attached here would never run. Queue the hand-off and let
      // the 'ax-code:renderer-app-ready' signal flush it once React is mounted.
      pendingFocusOpen = { sessionId, directory, mode, projectId }
      flushPendingFocusOpen()
    }
  }
  return { focused: true }
})

handleCommand(
  "desktop_close_current_window",
  async (_args, event) => {
    const win = senderWindow(event)
    if (win && !win.isDestroyed()) win.close()
    return null
  },
  { safeForRemote: true },
)

handleCommand(
  "desktop_minimize_current_window",
  async (_args, event) => {
    const win = senderWindow(event)
    if (win && !win.isDestroyed()) win.minimize()
    return null
  },
  { safeForRemote: true },
)

handleCommand(
  "desktop_toggle_current_window_maximized",
  async (_args, event) => {
    const win = senderWindow(event)
    if (win && !win.isDestroyed()) {
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
      return { maximized: win.isMaximized() }
    }
    return { maximized: false }
  },
  { safeForRemote: true },
)

handleCommand(
  "desktop_get_current_window_state",
  async (_args, event) => {
    const win = senderWindow(event)
    return { maximized: Boolean(win && !win.isDestroyed() && win.isMaximized()) }
  },
  { safeForRemote: true },
)

handleCommand("desktop_show_app_menu", async (args, event) => {
  const win = senderWindow(event)
  if (!win || win.isDestroyed()) return null
  const menu = Menu.getApplicationMenu()
  if (!menu) return null
  const x = Number.isFinite(Number(args.x)) ? Math.max(0, Math.round(Number(args.x))) : undefined
  const y = Number.isFinite(Number(args.y)) ? Math.max(0, Math.round(Number(args.y))) : undefined
  menu.popup({ window: win, x, y })
  return null
})

handleCommand(
  "desktop_is_window_fullscreen",
  async (_args, event) => {
    const win = senderWindow(event)
    return Boolean(win && !win.isDestroyed() && win.isFullScreen())
  },
  { safeForRemote: true },
)

handleCommand(
  "desktop_set_window_title",
  async (args, event) => {
    const win = senderWindow(event)
    const title = typeof args.title === "string" ? args.title : ""
    if (win && !win.isDestroyed() && title) win.setTitle(title)
    return null
  },
  { safeForRemote: true },
)

handleCommand("desktop_get_app_version", async () => app.getVersion(), { safeForRemote: true })

// ── App lifecycle ───────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) {
    return
  }

  recordStartupEvent("electron.app.ready")
  nativeTheme.themeSource = "system"
  setupApplicationMenu()
  setupTray()
  // Deny all permission requests except clipboard and fullscreen.
  // Chromium enumerates media devices on startup, which triggers macOS
  // permission prompts for device and media libraries, none of which this
  // app needs.
  const ALLOWED_PERMISSIONS = new Set(["fullscreen", "clipboard-read", "clipboard-sanitized-write"])
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission))
  })

  try {
    await launchServer()
    await createWindow()
    // Best-effort update check — failures must not crash the app. With
    // autoDownload disabled, the in-app dialog (driven by the renderer's
    // periodic check) handles surfacing and downloading; checkForUpdates just
    // warms the cache here. Release smoke runs before updater metadata is
    // uploaded to the draft release, so it opts out with this environment flag.
    if (shouldCheckForUpdatesOnStartup()) {
      autoUpdater.checkForUpdates().catch(() => {})
    }

    // Notify renderer on OS wake-from-sleep so the SSE event pipeline can
    // reconnect immediately instead of waiting for the heartbeat watchdog.
    powerMonitor.on("resume", () => {
      emitToAllWindows("openchamber:system-resume", { timestamp: Date.now() })
    })
  } catch (err) {
    console.error("[electron] startup failed:", err)
    // app.exit() does not fire 'before-quit', so stop the server process
    // (and any ax-code child it spawned) here to avoid orphaning it when the
    // server booted but window creation failed.
    await stopServer().catch(() => {})
    app.exit(1)
  }
})

app.on("window-all-closed", () => {
  // On macOS, keep the server running so the user can reopen from the dock.
  if (process.platform !== "darwin") {
    isQuitting = true
    stopBackgroundServices().finally(() => app.quit())
  }
})

app.on("activate", () => {
  if (!mainWindow && serverPort > 0) {
    createWindow().catch(console.error)
  }
})

app.on("before-quit", (event) => {
  // Fire-and-forget would let the app exit before the server shuts down,
  // orphaning ax-code-server (and its ax-code child) and leaving the port
  // bound — the next launch then fails to rebind. Hold the quit, shut down
  // gracefully, then quit for real. stopServer() nulls serverChild
  // synchronously and the guard prevents intercepting the re-triggered quit.
  if (isQuitting) return
  isQuitting = true
  event.preventDefault()
  stopBackgroundServices().finally(() => app.quit())
})
