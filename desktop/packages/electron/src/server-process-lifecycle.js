"use strict"

const DEFAULT_FATAL_SHUTDOWN_TIMEOUT_MS = 5_000

function createServerProcessLifecycle({
  processTarget,
  getServerHandle,
  logger = console,
  exit = (code) => processTarget.exit(code),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  fatalShutdownTimeoutMs = DEFAULT_FATAL_SHUTDOWN_TIMEOUT_MS,
}) {
  let stopping = false
  let exited = false

  const finish = (exitCode) => {
    if (exited) return
    exited = true
    exit(exitCode)
  }

  async function stop(exitCode = 0) {
    if (stopping) return
    stopping = true

    const forceExitTimer =
      exitCode === 0
        ? null
        : setTimer(() => {
            finish(exitCode)
          }, fatalShutdownTimeoutMs)
    forceExitTimer?.unref?.()

    try {
      // Graceful shutdown also terminates the ax-code child the server spawned.
      await getServerHandle()?.stop({ exitProcess: false })
    } catch (error) {
      logger.error("[server-process] graceful shutdown failed:", error)
    } finally {
      if (forceExitTimer) clearTimer(forceExitTimer)
      finish(exitCode)
    }
  }

  function installFatalHandlers() {
    processTarget.on("unhandledRejection", (reason) => {
      logger.error("[server-process] unhandled rejection:", reason)
      void stop(1)
    })
    processTarget.on("uncaughtException", (error) => {
      logger.error("[server-process] uncaught exception:", error)
      void stop(1)
    })
  }

  return { installFatalHandlers, stop }
}

module.exports = { createServerProcessLifecycle, DEFAULT_FATAL_SHUTDOWN_TIMEOUT_MS }
