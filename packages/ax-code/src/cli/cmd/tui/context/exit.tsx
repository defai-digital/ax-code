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
    let exitReason: unknown
    const flourishAbort = new AbortController()
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
      const handler = flourishHandler
      if (!handler || flourishAbort.signal.aborted) return
      let timer: ReturnType<typeof setTimeout> | undefined
      let stop: (() => void) | undefined
      const interrupted = new Promise<void>((resolve) => {
        stop = resolve
        flourishAbort.signal.addEventListener("abort", stop, { once: true })
        // Cosmetic work must never hold terminal or backend cleanup indefinitely.
        timer = setTimeout(resolve, 5_000)
        timer.unref?.()
      })
      try {
        await Promise.race([
          Promise.resolve().then(() => {
            if (!flourishAbort.signal.aborted) return handler()
          }),
          interrupted,
        ])
      } catch (error) {
        Log.Default.warn("tui.exit.flourish failed", { error })
      } finally {
        clearTimeout(timer)
        if (stop) flourishAbort.signal.removeEventListener("abort", stop)
      }
    }
    const exit: Exit = Object.assign(
      (reason?: unknown) => {
        if (reason !== undefined) {
          exitReason ??= reason
          process.exitCode = 1
        }
        if (task) {
          // Signals, failures and a direct second exit bypass cosmetic work.
          flourishAbort.abort()
          return task
        }
        const playFlourish = flourishRequested && reason === undefined
        flourishRequested = false
        // Publish the task before invoking a handler that can itself request exit.
        task = Promise.resolve().then(async () => {
          if (playFlourish) await runFlourish()
          let failure: { error: unknown } | undefined
          const recordFailure = (error: unknown) => {
            failure ??= { error }
            process.exitCode = 1
          }
          // Each cleanup stage is independent: renderer failure must not leave
          // queued input for the shell, hide the exit reason or strand a backend.
          try {
            await destroyTuiRenderer(renderer)
          } catch (error) {
            recordFailure(error)
          }
          try {
            win32FlushInputBuffer()
          } catch (error) {
            recordFailure(error)
          }
          try {
            if (exitReason !== undefined) {
              const formatted = FormatError(exitReason) ?? FormatUnknownError(exitReason)
              if (formatted) process.stderr.write(formatted + "\n")
            }
            const text = store.get()
            if (text) process.stdout.write(text + "\n")
          } catch (error) {
            recordFailure(error)
          }
          try {
            await input.onExit?.()
          } catch (error) {
            recordFailure(error)
          }
          if (failure) throw failure.error
        })
        return task
      },
      {
        message: store,
        onFlourish: (handler: (() => Promise<void>) | undefined) => {
          flourishHandler = handler
          if (!handler) flourishAbort.abort()
        },
        flourish: () => {
          if (task) return task
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
    const unregister = registerShutdownSignals(() => exit(), { signals: TUI_EXIT_SIGNALS })
    onCleanup(() => {
      unregister()
      flourishAbort.abort()
    })
    return exit
  },
})
