import { useRenderer } from "ax-tui/solid"
import { onCleanup } from "solid-js"
import { createSimpleContext } from "./helper"
import { FormatError, FormatUnknownError } from "@/cli/error"
import { win32FlushInputBuffer } from "../win32"
import { destroyTuiRenderer } from "../renderer"
import { registerShutdownSignals } from "@/util/signals"
import { Log } from "@/util/log"
type Exit = ((reason?: unknown) => Promise<void>) & {
  message: {
    set: (value?: string) => () => void
    clear: () => void
    get: () => string | undefined
  }
  /**
   * Register (or clear, with `undefined`) the app-owned pre-teardown flourish.
   * The overlay lives in the Solid tree, so this context only stores the
   * handler; App owns playing it and resolving it.
   */
  onFlourish: (handler: (() => Promise<void>) | undefined) => void
  /** Exit after the registered flourish has played. */
  flourish: () => Promise<void>
}

const TUI_EXIT_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT", "SIGTRAP"]

export const { use: useExit, provider: ExitProvider } = createSimpleContext({
  name: "Exit",
  init: (input: { onExit?: () => Promise<void> }) => {
    const renderer = useRenderer()
    let message: string | undefined
    let task: Promise<void> | undefined
    let flourishHandler: (() => Promise<void>) | undefined
    // Requested by the explicit-quit path and consumed by the teardown that
    // follows, so a second exit call cannot replay the animation.
    let flourishRequested = false
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
    const runFlourish = async () => {
      if (!flourishRequested) return
      flourishRequested = false
      if (!flourishHandler) return
      try {
        await flourishHandler()
      } catch (error) {
        Log.Default.warn("tui.exit.flourish failed", { error })
      }
    }
    const exit: Exit = Object.assign(
      (reason?: unknown) => {
        if (task) return task
        task = (async () => {
          // Abnormal exits carry a reason (a bootstrap failure); they must
          // return the terminal as fast as possible and never animate.
          if (!reason) await runFlourish()
          await destroyTuiRenderer(renderer)
          win32FlushInputBuffer()
          if (reason) {
            // A reason means the exit is abnormal (e.g. sync bootstrap
            // failure) — make sure the process exit code reflects that
            // instead of the default 0.
            process.exitCode = 1
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
        onFlourish: (handler: (() => Promise<void>) | undefined) => {
          flourishHandler = handler
        },
        flourish: () => {
          flourishRequested = true
          return exit()
        },
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
