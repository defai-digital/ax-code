import { Log } from "@/util/log"
import { registerTuiProcessHandler, runTuiCleanup, type TuiLifecycleOptions } from "./lifecycle"

const log = Log.create({ service: "tui.terminal-suspend" })

export type TerminalSuspendDeps = {
  /**
   * Register a process signal handler. Defaults to `registerTuiProcessHandler`.
   * Injected in tests so SIGCONT can be simulated without touching the real process.
   */
  registerProcessHandler?: (
    event: string | symbol,
    handler: (...args: unknown[]) => void,
    input: TuiLifecycleOptions,
  ) => () => void
  /** Send SIGTSTP to the process group. Defaults to `process.kill(0, "SIGTSTP")`. */
  sendStop?: () => void
  logger?: Pick<Log.Logger, "warn">
}

export type TerminalSuspendTarget = {
  suspend: () => void
  resume: () => void
}

/**
 * Suspend the TUI renderer and park a lifecycle-managed SIGCONT handler that
 * resumes it. Returns a dispose function that removes any pending SIGCONT
 * handler (safe to call after resume already fired).
 *
 * Calling this again while a previous suspend is still pending disposes the
 * previous handler first so only one resume is armed.
 */
export function createTerminalSuspendController(deps: TerminalSuspendDeps = {}) {
  const register = deps.registerProcessHandler ?? registerTuiProcessHandler
  const sendStop =
    deps.sendStop ??
    (() => {
      process.kill(0, "SIGTSTP")
    })
  const logger = deps.logger ?? log

  let disposePending: (() => void) | undefined

  const dispose = () => {
    if (!disposePending) return
    const cancel = disposePending
    disposePending = undefined
    runTuiCleanup(cancel, { name: "terminal-suspend-sigcont-dispose", logger })
  }

  const suspend = (target: TerminalSuspendTarget) => {
    // Replace any prior pending resume so repeated suspend doesn't stack handlers.
    dispose()

    const unregister = register(
      "SIGCONT",
      () => {
        // once semantics: drop the dispose slot before resume so a re-entrant
        // suspend from resume cannot double-unregister.
        disposePending = undefined
        runTuiCleanup(unregister, { name: "terminal-suspend-sigcont-once", logger })
        try {
          target.resume()
        } catch (error) {
          logger.warn("tui terminal resume failed", { error })
        }
      },
      { name: "terminal-suspend-sigcont", logger },
    )
    disposePending = unregister

    try {
      target.suspend()
    } catch (error) {
      dispose()
      logger.warn("tui terminal suspend failed", { error })
      return
    }

    try {
      sendStop()
    } catch (error) {
      // If we failed to stop the process group, resume immediately so the UI
      // is not left suspended with a hanging SIGCONT wait.
      dispose()
      try {
        target.resume()
      } catch (resumeError) {
        logger.warn("tui terminal resume after stop failure failed", { error: resumeError })
      }
      logger.warn("tui terminal stop signal failed", { error })
    }
  }

  return {
    suspend,
    dispose,
  }
}
