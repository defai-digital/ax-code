"use strict"

// Runs inside an Electron utilityProcess, forked by the main process. Hosting the
// web/API server here keeps its CPU/IO (git scans, SQLite, file reads, SSE) off
// the main process event loop, so window management, IPC, and SSE delivery stay
// responsive. The renderer reaches this server over HTTP loopback exactly as
// before — only *where* the server runs changes.
//
// Environment variables the server reads at module-init time
// (AX_CODE_DESKTOP_DIST_DIR, AX_CODE_DESKTOP_RUNTIME, AX_CODE_DESKTOP_ELECTRON_SERVER_PORT)
// are supplied by the parent's utilityProcess.fork({ env }) call.

// Bundled server (dist/server.js produced by bundle-main.mjs). Kept as an
// external require so esbuild does not inline the 5 MB server into this entry.
const { startWebUiServer } = require("./server.js")
const { createServerProcessLifecycle } = require("./server-process-lifecycle.js")

let serverHandle = null

// Safety nets: the utility process runs the full web server including
// user-facing SSE, WebSocket, and SQLite paths. An unhandled rejection
// would otherwise terminate the process with no cleanup, leaving the
// ax-code child it spawned orphaned and the port bound.
const fatalShutdownTimeoutMs = Number.parseInt(process.env.AX_CODE_DESKTOP_SHUTDOWN_TIMEOUT_MS || "", 10)
const lifecycle = createServerProcessLifecycle({
  processTarget: process,
  getServerHandle: () => serverHandle,
  fatalShutdownTimeoutMs:
    Number.isFinite(fatalShutdownTimeoutMs) && fatalShutdownTimeoutMs > 0 ? fatalShutdownTimeoutMs : undefined,
})
lifecycle.installFatalHandlers()

function parseStartupSnapshot() {
  const raw = process.env.AX_CODE_DESKTOP_STARTUP_SNAPSHOT
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function boot() {
  const configuredPort = Number.parseInt(process.env.AX_CODE_DESKTOP_ELECTRON_SERVER_PORT || "", 10)
  serverHandle = await startWebUiServer({
    port: Number.isFinite(configuredPort) && configuredPort > 0 ? configuredPort : 0,
    startupDiagnosticsSnapshot: parseStartupSnapshot(),
    onStartupDiagnostic: (event) => {
      try {
        process.parentPort.postMessage({ type: "startup-event", event })
      } catch {}
    },
  })
  process.parentPort.postMessage({ type: "ready", port: serverHandle.getPort() })
}

async function stop(exitCode = 0) {
  await lifecycle.stop(exitCode)
}

process.parentPort.on("message", (event) => {
  if (event?.data?.type === "stop") {
    void stop()
    return
  }
  if (event?.data?.type === "desktop-startup-event") {
    serverHandle?.recordDesktopStartupEvent?.(event.data.event)
  }
})

boot().catch((err) => {
  try {
    process.parentPort.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) })
  } catch {
    // parentPort may be gone; fall through to exit.
  }
  process.exit(1)
})
