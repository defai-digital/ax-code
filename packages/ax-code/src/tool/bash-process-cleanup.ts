import { Log } from "@/util/log"
import { spawnSync } from "node:child_process"

const log = Log.create({ service: "bash-process-cleanup" })

const isPidError = (error: unknown): error is { code: string } => {
  return error instanceof Error && "code" in error && typeof (error as { code: unknown }).code === "string"
}

export function signalBashProcessTree(
  pid: number,
  signal: NodeJS.Signals,
  platform: NodeJS.Platform = process.platform,
) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  if (platform === "win32") {
    // This also runs from the process exit handler, where asynchronous cleanup
    // cannot finish. Windows has no negative-PID process-group signaling.
    try {
      const result = spawnSync("taskkill", ["/pid", String(pid), "/f", "/t"], {
        stdio: "ignore",
        windowsHide: true,
        timeout: 1000,
      })
      if (!result.error && result.status === 0) return true
      log.warn("bash Windows tree cleanup failed", {
        pid,
        status: result.status,
        errorCode: isPidError(result.error) ? result.error.code : undefined,
      })
      // Once taskkill ran, it may have terminated the original process even
      // on failure/timeout. Do not signal a potentially reused PID afterward.
      if (!isPidError(result.error) || result.error.code !== "ENOENT") return false
    } catch (error) {
      log.warn("bash Windows tree cleanup threw", { pid, errorCode: isPidError(error) ? error.code : "unknown" })
      return false
    }
  } else {
    try {
      process.kill(-pid, signal)
      return true
    } catch (error) {
      // A vanished group must not cause a signal to a potentially reused PID.
      if (isPidError(error) && error.code === "ESRCH") return false
      log.warn("bash process group kill failed", { pid, signal, errorCode: isPidError(error) ? error.code : "unknown" })
    }
  }

  try {
    process.kill(pid, signal)
    return true
  } catch (error) {
    if (isPidError(error) && error.code === "ESRCH") {
      return false
    }
    log.warn("bash process kill failed", { pid, signal, errorCode: isPidError(error) ? error.code : "unknown" })
  }

  return false
}
