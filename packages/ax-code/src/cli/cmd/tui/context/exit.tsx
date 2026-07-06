import { useRenderer } from "@ax-code/opentui-solid"
import { onCleanup } from "solid-js"
import { createSimpleContext } from "./helper"
import { FormatError, FormatUnknownError } from "@/cli/error"
import { win32FlushInputBuffer } from "../win32"
import { destroyTuiRenderer } from "../renderer"
import { registerShutdownSignals } from "@/util/signals"
type Exit = ((reason?: unknown) => Promise<void>) & {
  message: {
    set: (value?: string) => () => void
    clear: () => void
    get: () => string | undefined
  }
}

const TUI_EXIT_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT", "SIGTRAP"]

export const { use: useExit, provider: ExitProvider } = createSimpleContext({
  name: "Exit",
  init: (input: { onExit?: () => Promise<void> }) => {
    const renderer = useRenderer()
    let message: string | undefined
    let task: Promise<void> | undefined
    const store = {
      set: (value?: string) => {
        const prev = message
        message = value
        return () => {
          message = prev
        }
      },
      clear: () => {
        message = undefined
      },
      get: () => message,
    }
    const exit: Exit = Object.assign(
      (reason?: unknown) => {
        if (task) return task
        task = (async () => {
          await destroyTuiRenderer(renderer)
          win32FlushInputBuffer()
          if (reason) {
            const formatted = FormatError(reason) ?? FormatUnknownError(reason)
            if (formatted) {
              process.stderr.write(formatted + "\n")
            }
          }
          const text = store.get()
          if (text) process.stdout.write(text + "\n")
          await input.onExit?.()
        })()
        return task
      },
      {
        message: store,
      },
    )
    // Register terminal-affecting signals so external kill, SSH disconnect,
    // ^C, ^\, and native renderer traps all route through the same TUI teardown path
    // (destroyTuiRenderer → disableTuiMouseTracking → flushTuiStdout).
    // Without this, the terminal is left in alt-screen + raw mode + mouse
    // tracking on anything other than a clean React unmount or SIGHUP.
    const unregister = registerShutdownSignals(() => void exit(), { signals: TUI_EXIT_SIGNALS })
    onCleanup(unregister)
    return exit
  },
})
