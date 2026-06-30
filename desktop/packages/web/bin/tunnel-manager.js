import fs from "fs"
import os from "os"
import path from "path"
import { spawn } from "child_process"

export const TUNNEL_PROVIDER_CLOUDFLARE = "cloudflare"
export const TUNNEL_MODE_QUICK = "quick"

const DEFAULT_TUNNEL_READY_TIMEOUT_MS = 30000
const CLOUDFLARE_QUICK_TUNNEL_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i

export function normalizeTunnelProvider(value) {
  const normalized =
    typeof value === "string" && value.trim().length > 0 ? value.trim().toLowerCase() : TUNNEL_PROVIDER_CLOUDFLARE
  if (normalized !== TUNNEL_PROVIDER_CLOUDFLARE) {
    throw new Error(`Unsupported tunnel provider: ${normalized}`)
  }
  return normalized
}

export function normalizeTunnelMode(value) {
  const normalized =
    typeof value === "string" && value.trim().length > 0 ? value.trim().toLowerCase() : TUNNEL_MODE_QUICK
  if (normalized !== TUNNEL_MODE_QUICK) {
    throw new Error(`Unsupported tunnel mode: ${normalized}`)
  }
  return normalized
}

export function parseCloudflareQuickTunnelUrl(text) {
  if (typeof text !== "string") return null
  const match = text.match(CLOUDFLARE_QUICK_TUNNEL_URL_RE)
  return match ? match[0] : null
}

export function buildCloudflaredArgs({ mode, originUrl }) {
  normalizeTunnelMode(mode)
  if (typeof originUrl !== "string" || originUrl.trim().length === 0) {
    throw new Error("originUrl is required")
  }
  return ["tunnel", "--no-autoupdate", "--url", originUrl.trim()]
}

export function createTunnelManager(dependencies) {
  const {
    getRunDir,
    getLogsDir,
    searchPathFor,
    isExecutable,
    isProcessRunning,
    terminateProcessTree,
    fsImpl = fs,
    pathImpl = path,
    spawnImpl = spawn,
    processLike = process,
  } = dependencies

  const getTunnelStateFilePath = (port) => pathImpl.join(getRunDir(), `ax-code-desktop-tunnel-${port}.json`)
  const getTunnelLogFilePath = (port) => pathImpl.join(getLogsDir(), `ax-code-desktop-tunnel-${port}.log`)

  const readTunnelState = (port) => {
    try {
      const parsed = JSON.parse(fsImpl.readFileSync(getTunnelStateFilePath(port), "utf8"))
      if (!parsed || typeof parsed !== "object") return null
      return parsed
    } catch {
      return null
    }
  }

  const writeTunnelState = (port, state) => {
    fsImpl.mkdirSync(pathImpl.dirname(getTunnelStateFilePath(port)), { recursive: true, mode: 0o700 })
    fsImpl.writeFileSync(getTunnelStateFilePath(port), JSON.stringify(state, null, 2), { mode: 0o600 })
  }

  const removeTunnelState = (port) => {
    try {
      fsImpl.unlinkSync(getTunnelStateFilePath(port))
    } catch {}
  }

  const resolveCloudflaredBinary = () => {
    const configured =
      typeof processLike.env?.AX_CODE_DESKTOP_CLOUDFLARED_BINARY === "string"
        ? processLike.env.AX_CODE_DESKTOP_CLOUDFLARED_BINARY.trim()
        : ""
    if (configured) {
      if (typeof isExecutable === "function" && !isExecutable(configured)) {
        return null
      }
      return configured
    }
    return searchPathFor("cloudflared")
  }

  const checkDependency = ({ provider } = {}) => {
    const normalizedProvider = normalizeTunnelProvider(provider)
    const binary = resolveCloudflaredBinary()
    return {
      ok: Boolean(binary),
      provider: normalizedProvider,
      dependency: "cloudflared",
      path: binary,
      message: binary
        ? "cloudflared is available"
        : "cloudflared was not found on PATH. Install it first, or set AX_CODE_DESKTOP_CLOUDFLARED_BINARY to the executable path.",
    }
  }

  const waitForTunnelUrl = async (logPath, timeoutMs = DEFAULT_TUNNEL_READY_TIMEOUT_MS, isAlive = () => true) => {
    const start = Date.now()
    let lastText = ""
    while (Date.now() - start < timeoutMs) {
      try {
        lastText = fsImpl.readFileSync(logPath, "utf8")
      } catch {}
      const url = parseCloudflareQuickTunnelUrl(lastText)
      if (url) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        if (!isAlive()) {
          throw new Error("cloudflared exited before the tunnel became active")
        }
        return url
      }
      if (!isAlive()) {
        const tail = lastText.split(/\r?\n/).slice(-12).join("\n").trim()
        throw new Error(`cloudflared exited before publishing a public URL${tail ? `: ${tail}` : ""}`)
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    const tail = lastText.split(/\r?\n/).slice(-12).join("\n").trim()
    throw new Error(`Timed out waiting for cloudflared public URL${tail ? `: ${tail}` : ""}`)
  }

  const listTunnels = () => {
    const runDir = getRunDir()
    let files = []
    try {
      files = fsImpl.readdirSync(runDir)
    } catch {
      return []
    }

    const tunnels = []
    for (const file of files) {
      const match = file.match(/^ax-code-desktop-tunnel-(\d+)\.json$/)
      if (!match) continue
      const port = Number.parseInt(match[1], 10)
      if (!Number.isFinite(port) || port <= 0) continue
      const state = readTunnelState(port)
      if (!state) continue
      const pid = Number.isFinite(state.pid) ? state.pid : null
      if (!pid || !isProcessRunning(pid)) {
        removeTunnelState(port)
        continue
      }
      tunnels.push({ ...state, port, pid, active: true })
    }
    tunnels.sort((a, b) => a.port - b.port)
    return tunnels
  }

  const getTunnel = (port) => listTunnels().find((entry) => entry.port === port) || null

  const stopTunnel = async ({ port }) => {
    const state = readTunnelState(port)
    const pid = Number.isFinite(state?.pid) ? state.pid : null
    if (!pid || !isProcessRunning(pid)) {
      removeTunnelState(port)
      return { port, stopped: false, reason: "not-running" }
    }
    const stopped = await terminateProcessTree(pid, { gracefulTimeoutMs: 2000, forceTimeoutMs: 3000 })
    removeTunnelState(port)
    return { port, pid, stopped }
  }

  const startTunnel = async ({ port, originUrl, provider, mode, force = false, readyTimeoutMs } = {}) => {
    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
      throw new Error("A valid server port is required")
    }

    const normalizedProvider = normalizeTunnelProvider(provider)
    const normalizedMode = normalizeTunnelMode(mode)
    const existing = getTunnel(port)
    if (existing) {
      if (!force) {
        throw new Error(`A tunnel is already running for port ${port}. Use --force to replace it.`)
      }
      await stopTunnel({ port })
    }

    const dependency = checkDependency({ provider: normalizedProvider })
    if (!dependency.ok) {
      throw new Error(dependency.message)
    }
    const cloudflared = dependency.path

    const logPath = getTunnelLogFilePath(port)
    fsImpl.mkdirSync(pathImpl.dirname(logPath), { recursive: true, mode: 0o700 })
    fsImpl.writeFileSync(logPath, "", { mode: 0o600 })
    const logFd = fsImpl.openSync(logPath, "a")

    const args = buildCloudflaredArgs({ mode: normalizedMode, originUrl })
    const child = spawnImpl(cloudflared, args, {
      detached: true,
      windowsHide: true,
      stdio: ["ignore", logFd, logFd],
      env: {
        ...processLike.env,
      },
    })
    let childExited = false
    child.on?.("error", () => {})
    child.on?.("exit", () => {
      childExited = true
    })
    child.unref?.()

    try {
      fsImpl.closeSync(logFd)
    } catch {}

    const pid = child.pid
    if (!Number.isFinite(pid) || pid <= 0) {
      throw new Error("cloudflared did not start")
    }

    let publicUrl
    try {
      publicUrl = await waitForTunnelUrl(logPath, readyTimeoutMs, () => !childExited && isProcessRunning(pid))
    } catch (error) {
      await terminateProcessTree(pid, { gracefulTimeoutMs: 1000, forceTimeoutMs: 1500 }).catch(() => false)
      throw error
    }

    const state = {
      port,
      pid,
      provider: normalizedProvider,
      mode: normalizedMode,
      url: publicUrl,
      originUrl,
      logPath,
      startedAt: Date.now(),
      platform: os.platform(),
    }
    writeTunnelState(port, state)
    return { ...state, active: true }
  }

  return {
    getTunnelStateFilePath,
    getTunnelLogFilePath,
    checkDependency,
    listTunnels,
    getTunnel,
    startTunnel,
    stopTunnel,
  }
}
