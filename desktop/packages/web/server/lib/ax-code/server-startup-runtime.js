export const createServerStartupRuntime = (dependencies) => {
  const { process, server, gracefulShutdown, getSignalsAttached, setSignalsAttached, syncToHmrState } = dependencies
  const asTrimmedString = (value) => (typeof value === "string" ? value.trim() : "")

  const resolveBindHost = (host) =>
    host || asTrimmedString(process.env.AX_CODE_DESKTOP_HOST) || "127.0.0.1"

  const startListening = async ({ port, bindHost }) => {
    let activePort = port

    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off("error", onError)
        reject(error)
      }
      server.once("error", onError)
      const onListening = async () => {
        server.off("error", onError)
        try {
          const addressInfo = server.address()
          activePort = typeof addressInfo === "object" && addressInfo ? addressInfo.port : port

          if (typeof process.send === "function") {
            if (!process.connected) {
              throw new Error("AX Code Desktop startup IPC channel disconnected before ready notification")
            }

            await new Promise((resolveReadyNotification, rejectReadyNotification) => {
              try {
                process.send({ type: "openchamber:ready", port: activePort }, (error) => {
                  if (error) {
                    rejectReadyNotification(error)
                    return
                  }
                  resolveReadyNotification()
                })
              } catch (error) {
                rejectReadyNotification(error)
              }
            })
          }

          const displayHost =
            bindHost === "0.0.0.0" || bindHost === "::" || bindHost === "[::]"
              ? "localhost"
              : bindHost.includes(":")
                ? `[${bindHost}]`
                : bindHost
          console.log(`AX Code Desktop server listening on ${bindHost}:${activePort}`)
          console.log(`Health check: http://${displayHost}:${activePort}/health`)
          console.log(`Web interface: http://${displayHost}:${activePort}`)

          resolve()
        } catch (error) {
          reject(error)
        }
      }

      server.listen(port, bindHost, onListening)
    })

    return { activePort }
  }

  const attachProcessHandlers = ({ attachSignals }) => {
    if (attachSignals && !getSignalsAttached()) {
      const handleSignal = async () => {
        await gracefulShutdown()
      }
      process.on("SIGTERM", handleSignal)
      process.on("SIGINT", handleSignal)
      process.on("SIGQUIT", handleSignal)

      process.on("unhandledRejection", (reason, promise) => {
        console.error("Unhandled Rejection at:", promise, "reason:", reason)
      })

      process.on("uncaughtException", (error) => {
        console.error("Uncaught Exception:", error)
        gracefulShutdown()
      })

      setSignalsAttached(true)
      syncToHmrState()
    }
  }

  return {
    resolveBindHost,
    startListening,
    attachProcessHandlers,
  }
}
