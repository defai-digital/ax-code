import fs from "node:fs"
import path from "node:path"

const LEGACY_TUNNEL_STATE_PATTERN = /^ax-code-desktop-tunnel-(\d+)\.json$/

const defaultIsProcessRunning = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return Boolean(error && typeof error === "object" && error.code === "EPERM")
  }
}

export const assertNoActiveLegacyPublicTunnels = ({
  dataDir,
  fsImpl = fs,
  pathImpl = path,
  isProcessRunning = defaultIsProcessRunning,
} = {}) => {
  const runDir = pathImpl.join(dataDir, "run")
  let files
  try {
    files = fsImpl.readdirSync(runDir)
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return
    throw error
  }

  const active = []
  for (const file of files) {
    const match = file.match(LEGACY_TUNNEL_STATE_PATTERN)
    if (!match) continue
    const statePath = pathImpl.join(runDir, file)
    let state = null
    try {
      state = JSON.parse(fsImpl.readFileSync(statePath, "utf8"))
    } catch {}

    const port = Number.parseInt(match[1], 10)
    const pid = Number.isFinite(state?.pid) ? Number(state.pid) : 0
    if (pid > 0 && isProcessRunning(pid)) {
      active.push({ port, pid, statePath })
      continue
    }

    try {
      fsImpl.unlinkSync(statePath)
    } catch {}
  }

  if (active.length === 0) return
  const details = active.map((entry) => `port ${entry.port} (PID ${entry.pid})`).join(", ")
  throw new Error(
    `A legacy public tunnel is still active for ${details}. ` +
      "Run `ax-code-desktop tunnel stop` before starting AX Code Desktop; public tunnels are disabled by the local-only policy.",
  )
}
