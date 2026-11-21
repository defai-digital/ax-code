import type { ChildProcess } from "node:child_process"

// A language server that dies before answering `initialize` used to hold its
// caller for the whole handshake timeout: vscode-jsonrpc leaves a pending
// request open when the transport closes. A rustup `rust-analyzer` proxy in a
// project whose pinned toolchain lacks the component exits after ~250 ms, and
// every first Rust edit of a session then waited 45 s for nothing.

// The startup failure reason is at the start of stderr; keep only that much.
const STDERR_HEAD_LIMIT_CHARS = 2_048
const STDERR_REASON_LIMIT_CHARS = 600
// After `exit` (or a closed transport) the stdio pipes may still hold a reply
// and the stderr text. `close` normally follows at once; the grace period
// covers a descendant that keeps the pipes open.
const STARTUP_DRAIN_GRACE_MS = 500

const stderrHeads = new WeakMap<ChildProcess, { text: string }>()

/** Keep the first part of a server's stderr so a startup failure can say why. */
export function captureStderrHead(proc: ChildProcess): void {
  const stream = proc.stderr
  if (!stream || stderrHeads.has(proc)) return
  const head = { text: "" }
  stderrHeads.set(proc, head)
  const onData = (chunk: Buffer | string) => {
    head.text += typeof chunk === "string" ? chunk : chunk.toString("utf8")
    if (head.text.length < STDERR_HEAD_LIMIT_CHARS) return
    head.text = head.text.slice(0, STDERR_HEAD_LIMIT_CHARS)
    stream.off("data", onData)
    // Unread stderr can block the server's next RPC response.
    stream.resume()
  }
  stream.on("data", onData)
}

function stderrHead(proc: ChildProcess): string | undefined {
  const text = stderrHeads.get(proc)?.text.trim()
  if (!text) return undefined
  return text.length > STDERR_REASON_LIMIT_CHARS ? `${text.slice(0, STDERR_REASON_LIMIT_CHARS)}...` : text
}

type ServerStartupWatch = {
  /** Rejects when the server can no longer answer the handshake. Never resolves. */
  terminated: Promise<never>
  /** The transport closed or errored; the process status may still be arriving. */
  connectionLost(error?: unknown): void
  /** Stop watching without rejecting (handshake finished or timed out). */
  dispose(): void
}

function stdioDrained(proc: ChildProcess): boolean {
  return [proc.stdout, proc.stderr].every((stream) => !stream || stream.destroyed || stream.readableEnded)
}

export function watchServerStartup(proc: ChildProcess): ServerStartupWatch {
  let settled = false
  let exit: { code: number | null; signal: NodeJS.Signals | null } | undefined
  let lost: { error?: unknown } | undefined
  let grace: ReturnType<typeof setTimeout> | undefined
  let reject!: (error: Error) => void
  const terminated = new Promise<never>((_, fail) => {
    reject = fail
  })
  // The caller races this promise; nothing else may observe it.
  terminated.catch(() => {})

  function describe(): string {
    const status = exit
      ? exit.signal
        ? `language server process was terminated by ${exit.signal}`
        : `language server process exited with code ${exit.code}`
      : "language server connection closed"
    const reason = stderrHead(proc)
    return `${status} before completing initialize${reason ? `: ${reason}` : ""}`
  }

  function cleanup() {
    proc.off("exit", onExit)
    proc.off("close", onClose)
    proc.off("error", onError)
    if (grace) clearTimeout(grace)
    grace = undefined
  }

  function fail(error: Error) {
    if (settled) return
    settled = true
    cleanup()
    reject(error)
  }

  function failWithStatus() {
    fail(new Error(describe(), lost?.error === undefined ? undefined : { cause: lost.error }))
  }

  function armGrace() {
    if (settled || grace) return
    grace = setTimeout(failWithStatus, STARTUP_DRAIN_GRACE_MS)
    grace.unref?.()
  }

  function onExit(code: number | null, signal: NodeJS.Signals | null) {
    exit = { code, signal }
    armGrace()
  }

  function onClose(code: number | null, signal: NodeJS.Signals | null) {
    exit = { code, signal }
    failWithStatus()
  }

  function onError(error: Error) {
    fail(new Error(`language server process failed to start: ${error.message}`, { cause: error }))
  }

  proc.on("exit", onExit)
  proc.on("close", onClose)
  proc.on("error", onError)

  if (proc.exitCode !== null || proc.signalCode !== null) {
    // Exited before the watch began, so `exit` (and perhaps `close`) already fired.
    exit = { code: proc.exitCode, signal: proc.signalCode }
    if (stdioDrained(proc)) failWithStatus()
    else armGrace()
  }

  return {
    terminated,
    connectionLost(error) {
      // A bare close may precede the error that explains it; keep the error.
      if (!lost || lost.error === undefined) lost = { error }
      armGrace()
    },
    dispose() {
      if (settled) return
      settled = true
      cleanup()
    },
  }
}
