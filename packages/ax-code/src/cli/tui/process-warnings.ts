import { Log } from "@/util/log"

const log = Log.create({ service: "tui.process-warnings" })

// Every mounted component that calls useKeyboard or useTerminalDimensions
// holds one listener on the renderer's key handler or on the renderer itself,
// and removes it on cleanup. Around two dozen components do, several of them
// once per visible tool call, so the UI legitimately passes Node's default of
// 10. The bound stays finite so an unbounded leak still reports.
export const TUI_COMPONENT_LISTENER_LIMIT = 256

type ListenerBound = { setMaxListeners(count: number): unknown }

export function allowTuiComponentListeners(renderer: ListenerBound & { keyInput: ListenerBound }): void {
  renderer.setMaxListeners(TUI_COMPONENT_LISTENER_LIMIT)
  renderer.keyInput.setMaxListeners(TUI_COMPONENT_LISTENER_LIMIT)
}

// Node prints process warnings to stderr. While the TUI owns the terminal
// that text lands at the cursor, inside the prompt box, and the differential
// renderer never repaints the cells it does not know changed.
const NODE_WARNING_PRINTER = "onWarning"

type WarningListener = (warning: Error) => void
let routed: { printers: WarningListener[]; record: WarningListener } | undefined

/** Send process warnings to the log instead of the screen. Returns the undo. */
export function routeProcessWarningsToLog(): () => void {
  if (!routed) {
    // Node's own printer is recognized by name. If a future Node renames it
    // nothing is detached and warnings print as before.
    const printers = process
      .listeners("warning")
      .filter((listener) => listener.name === NODE_WARNING_PRINTER) as WarningListener[]
    const record: WarningListener = (warning) => {
      // A throw here would itself be printed over the screen.
      try {
        const detail = warning as Partial<Error> | undefined
        log.warn("process warning", {
          name: detail?.name,
          message: detail?.message ?? String(warning),
          stack: detail?.stack,
        })
      } catch {
        // Nowhere safe to report a failed log write while the TUI owns the terminal.
      }
    }
    for (const printer of printers) process.off("warning", printer)
    process.on("warning", record)
    routed = { printers, record }
  }
  return restoreProcessWarnings
}

export function restoreProcessWarnings(): void {
  if (!routed) return
  const { printers, record } = routed
  routed = undefined
  process.off("warning", record)
  for (const printer of printers) process.on("warning", printer)
}
