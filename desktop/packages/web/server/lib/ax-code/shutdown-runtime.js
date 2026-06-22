export const createGracefulShutdownRuntime = (dependencies) => {
  const {
    process,
    shutdownTimeoutMs,
    getExitOnShutdown,
    getIsShuttingDown,
    setIsShuttingDown,
    syncToHmrState,
    axCodeWatcherRuntime,
    sessionRuntime,
    scheduledTasksRuntime,
    getHealthCheckInterval,
    clearHealthCheckInterval,
    getTerminalRuntime,
    setTerminalRuntime,
    getMessageStreamRuntime,
    setMessageStreamRuntime,
    shouldSkipAxCodeStop,
    getAxCodePort,
    getAxCodeProcess,
    setAxCodeProcess,
    killProcessOnPort,
    waitForPortRelease,
    getServer,
    getUiAuthController,
    setUiAuthController,
    destroyAllClientConnections,
  } = dependencies

  const gracefulShutdown = async (options = {}) => {
    if (getIsShuttingDown()) return

    setIsShuttingDown(true)
    syncToHmrState()
    console.log("Starting graceful shutdown...")
    const exitProcess = typeof options.exitProcess === "boolean" ? options.exitProcess : getExitOnShutdown()

    // Phase 1: synchronous teardown (fast, immediate)
    axCodeWatcherRuntime.stop()
    sessionRuntime.dispose()
    scheduledTasksRuntime?.stop?.()

    const healthCheckInterval = getHealthCheckInterval()
    if (healthCheckInterval) {
      clearHealthCheckInterval(healthCheckInterval)
    }

    // Phase 2: parallel async teardown of independent subsystems.
    // Terminal sessions, message streams, and client connections can all
    // be shut down concurrently since they have no interdependencies.
    const terminalRuntime = getTerminalRuntime()
    const messageStreamRuntime = getMessageStreamRuntime()

    const phase2Tasks = []

    if (terminalRuntime) {
      phase2Tasks.push(
        terminalRuntime
          .shutdown()
          .catch(() => {})
          .finally(() => setTerminalRuntime(null)),
      )
    }

    if (messageStreamRuntime) {
      phase2Tasks.push(
        messageStreamRuntime
          .close()
          .catch(() => {})
          .finally(() => setMessageStreamRuntime(null)),
      )
    }

    // Force-close all tracked SSE/WS client connections so that
    // server.close() below does not hang waiting for keep-alive drain.
    if (typeof destroyAllClientConnections === "function") {
      phase2Tasks.push(
        Promise.resolve()
          .then(() => destroyAllClientConnections())
          .catch(() => {}),
      )
    }

    await Promise.all(phase2Tasks)

    // Phase 3: ax-code process teardown + HTTP server close in parallel.
    // These are independent: the HTTP server does not depend on the ax-code
    // process, and running them concurrently saves up to shutdownTimeoutMs.
    const phase3Tasks = []

    if (!shouldSkipAxCodeStop()) {
      const portToKill = getAxCodePort()
      const axCodeProcess = getAxCodeProcess()

      phase3Tasks.push(
        (async () => {
          if (axCodeProcess) {
            console.log("Stopping ax-code process...")
            let closeTimedOut = false
            let closeTimeout = null
            try {
              await Promise.race([
                axCodeProcess.close(),
                new Promise((resolve) => {
                  closeTimeout = setTimeout(
                    () => {
                      closeTimedOut = true
                      resolve()
                    },
                    Math.max(1000, shutdownTimeoutMs - 1000),
                  )
                }),
              ])
            } catch (error) {
              console.warn("Error closing ax-code process:", error)
            } finally {
              if (closeTimeout) {
                clearTimeout(closeTimeout)
              }
            }
            if (closeTimedOut) {
              console.warn("Timed out closing ax-code process; forcing port cleanup")
            }
            setAxCodeProcess(null)
          }

          killProcessOnPort(portToKill)
          if (!(await waitForPortRelease(portToKill, 5000))) {
            console.warn(`Timed out waiting for ax-code port ${portToKill} to be released during shutdown`)
          }
        })(),
      )
    } else {
      console.log("Skipping ax-code shutdown (external server)")
    }

    const server = getServer()
    if (server) {
      phase3Tasks.push(
        (async () => {
          let closeTimeout = null
          try {
            await Promise.race([
              new Promise((resolve) => {
                server.close(() => {
                  console.log("HTTP server closed")
                  resolve()
                })
              }),
              new Promise((resolve) => {
                closeTimeout = setTimeout(() => {
                  console.warn("Server close timeout reached, forcing shutdown")
                  resolve()
                }, shutdownTimeoutMs)
              }),
            ])
          } finally {
            if (closeTimeout) {
              clearTimeout(closeTimeout)
            }
          }
        })(),
      )
    }

    await Promise.all(phase3Tasks)

    const uiAuthController = getUiAuthController()
    if (uiAuthController) {
      uiAuthController.dispose()
      setUiAuthController(null)
    }

    console.log("Graceful shutdown complete")
    if (exitProcess) {
      process.exit(0)
    }
  }

  return {
    gracefulShutdown,
  }
}
