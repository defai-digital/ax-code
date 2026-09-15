import { spawn, type ChildProcess } from "child_process"

export const STATUS_LINE_TIMEOUT_MS = 300
export const STATUS_LINE_MAX_BYTES = 64 * 1024

function firstLine(raw: Buffer) {
  const text = raw.toString("utf8")
  const newline = text.indexOf("\n")
  const line = newline === -1 ? text : text.slice(0, newline)
  // Control characters (ESC, CR, tabs, C1 controls, ...) would let the command
  // inject ANSI escapes or extra rows into the footer, so flatten them to
  // spaces. C1 (U+0080–U+009F, e.g. CSI U+009B) is included: UTF-8 terminals
  // honor the decoded form as control codes too.
  const clean = line.replace(/[\x00-\x1F\x7F-\x9F]/g, " ").trim()
  return clean.length > 0 ? clean : undefined
}

function killTree(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return
  // Detached children get their own process group, so a negative pid kills the
  // whole tree — a hung `sh -c "... | sleep 999"` would otherwise survive the
  // shell being killed.
  if (process.platform !== "win32" && child.pid !== undefined) {
    try {
      process.kill(-child.pid, "SIGKILL")
      return
    } catch {
      // fall through to a plain kill
    }
  }
  try {
    child.kill("SIGKILL")
  } catch {
    // already gone
  }
}

/**
 * Picks the shell that runs the status-line command. Stock Windows has no
 * `sh`, so use `cmd /d /s /c` there and `sh -c` everywhere else.
 */
export function statusLineShellCommand(
  command: string,
  platform: NodeJS.Platform = process.platform,
): [file: string, args: string[]] {
  return platform === "win32" ? ["cmd", ["/d", "/s", "/c", command]] : ["sh", ["-c", command]]
}

/**
 * Runs the user's status-line command, feeding a JSON snapshot on stdin, and
 * returns its first stdout line sanitized for a single-cell-high TUI slot.
 * Never rejects: spawn failures, timeouts, hangs, and empty output all
 * resolve to undefined so the footer just renders nothing.
 */
export function runStatusLineCommand(
  command: string,
  snapshot: Record<string, unknown>,
  opts: { timeoutMs?: number; maxBytes?: number; cwd?: string } = {},
): Promise<string | undefined> {
  const timeoutMs = opts.timeoutMs ?? STATUS_LINE_TIMEOUT_MS
  const maxBytes = opts.maxBytes ?? STATUS_LINE_MAX_BYTES

  return new Promise((resolve) => {
    let child: ChildProcess
    try {
      const [file, args] = statusLineShellCommand(command)
      child = spawn(file, args, {
        stdio: ["pipe", "pipe", "ignore"],
        detached: process.platform !== "win32",
        cwd: opts.cwd,
      })
    } catch {
      resolve(undefined)
      return
    }

    const chunks: Buffer[] = []
    let received = 0
    let settled = false
    const timer = setTimeout(() => finish(undefined), timeoutMs)
    timer.unref?.()

    function finish(value: string | undefined) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      killTree(child)
      resolve(value)
    }

    child.on("error", () => finish(undefined))
    child.on("close", () => finish(firstLine(Buffer.concat(chunks))))
    child.stdout?.on("data", (chunk: Buffer) => {
      received += chunk.length
      if (received <= maxBytes) {
        chunks.push(chunk)
        return
      }
      // Keep only the head of an oversized output and stop reading — the
      // status line is one line, so the tail is never useful.
      const overflow = received - maxBytes
      const keep = chunk.length - overflow
      if (keep > 0) chunks.push(chunk.subarray(0, keep))
      finish(firstLine(Buffer.concat(chunks)))
    })

    try {
      child.stdin?.on("error", () => {
        // The command may exit without reading stdin (EPIPE) — not an error.
      })
      child.stdin?.write(JSON.stringify(snapshot))
      child.stdin?.end()
    } catch {
      finish(undefined)
    }
  })
}
