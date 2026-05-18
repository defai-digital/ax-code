// Shared OS-signal registration for long-running CLI entries (TUI renderer,
// worker, server commands). Without SIGHUP, the process is killed on SSH
// disconnect / terminal close before resources (MCP children, LSP servers,
// HTTP server, event-stream timer) can release; without SIGQUIT, ^\ leaves
// the terminal in alt-screen + raw mode. Each entry point used to register
// some subset of these by hand; centralizing keeps the behavior consistent.

export type ShutdownCallback = (signal: NodeJS.Signals) => void | Promise<void>

export interface RegisterOptions {
  signals?: NodeJS.Signals[]
}

const DEFAULT_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"]

export function registerShutdownSignals(callback: ShutdownCallback, options?: RegisterOptions): () => void {
  const signals = options?.signals ?? DEFAULT_SIGNALS
  let handled = false
  const onSignal = (signal: NodeJS.Signals) => {
    if (handled) return
    handled = true
    try {
      const result = callback(signal)
      if (result && typeof (result as Promise<void>).catch === "function") {
        ;(result as Promise<void>).catch(() => {})
      }
    } catch {
      // swallow — callback owns error reporting
    }
  }
  for (const sig of signals) process.on(sig, onSignal)
  return () => {
    for (const sig of signals) process.off(sig, onSignal)
  }
}
