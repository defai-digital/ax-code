import { sendMessageStreamWsEvent, sendMessageStreamWsFrame } from "./protocol.js"
import { shouldTriggerUpstreamHealthCheck } from "./upstream-health.js"
import { createUpstreamSseReader } from "./upstream-reader.js"

export function acceptDirectoryMessageStreamWsConnection({
  socket,
  requestedLastEventId,
  requestedDirectory,
  buildAxCodeUrl,
  getAxCodeAuthHeaders,
  processForwardedEventPayload,
  wsClients,
  triggerHealthCheck,
  heartbeatIntervalMs,
  upstreamStallTimeoutMs,
  upstreamReconnectDelayMs,
  fetchImpl,
}) {
  const controller = new AbortController()
  let upstreamConnected = false
  let streamReady = false
  let reader = null
  let closed = false

  const cleanup = () => {
    if (!controller.signal.aborted) {
      controller.abort()
    }
    reader?.stop()
    wsClients.delete(socket)
  }

  const cleanupAfterClose = () => {
    if (closed) {
      return
    }
    closed = true
    clearInterval(pingInterval)
    clearInterval(heartbeatInterval)
    upstreamConnected = false
    cleanup()
  }

  const closeAndCleanup = (code = 1011, reason = "Message stream client unavailable") => {
    cleanupAfterClose()
    try {
      if (socket.readyState === 1 || socket.readyState === 0) {
        socket.close(code, reason)
      }
    } catch {}
  }

  const pingInterval = setInterval(() => {
    if (socket.readyState !== 1) {
      return
    }

    try {
      socket.ping()
    } catch {}
  }, heartbeatIntervalMs)
  // Intervals must not prevent the server process from exiting
  // during graceful shutdown.
  if (typeof pingInterval.unref === "function") pingInterval.unref()

  const heartbeatInterval = setInterval(() => {
    if (!upstreamConnected) {
      return
    }

    const sent = sendMessageStreamWsEvent(
      socket,
      { type: "openchamber:heartbeat", timestamp: Date.now() },
      {
        directory: requestedDirectory || "global",
      },
    )
    if (!sent) {
      closeAndCleanup()
    }
  }, heartbeatIntervalMs)
  if (typeof heartbeatInterval.unref === "function") heartbeatInterval.unref()

  socket.on("close", () => {
    cleanupAfterClose()
  })

  socket.on("error", (error) => {
    // The `ws` library emits "error" before "close" for recoverable
    // transport errors, but an unhandled "error" event crashes the Node
    // process. Log and rely on the "close" handler for interval cleanup.
    console.warn("[directory-ws-bridge] socket error:", error?.message ?? error)
  })

  const run = async () => {
    const forwardEvent = ({ envelope, payload }) => {
      const directory = requestedDirectory || envelope?.directory || "global"

      const sent = sendMessageStreamWsEvent(socket, payload, {
        directory,
        eventId: typeof envelope?.eventId === "string" && envelope.eventId.length > 0 ? envelope.eventId : undefined,
      })
      if (!sent) {
        closeAndCleanup()
        return
      }

      processForwardedEventPayload(payload, (syntheticPayload) => {
        const syntheticSent = sendMessageStreamWsEvent(socket, syntheticPayload, { directory: "global" })
        if (!syntheticSent) {
          closeAndCleanup()
        }
      })
    }

    try {
      let buildUrlFailed = false
      const closeWithInitialError = ({ message, closeReason = message, triggerHealthCheckFor = null }) => {
        sendMessageStreamWsFrame(socket, { type: "error", message })
        socket.close(1011, closeReason)
        if (
          triggerHealthCheckFor === true ||
          (triggerHealthCheckFor && shouldTriggerUpstreamHealthCheck(triggerHealthCheckFor))
        ) {
          triggerHealthCheck?.()
        }
        reader?.stop()
        cleanup()
      }

      reader = createUpstreamSseReader({
        initialLastEventId: requestedLastEventId,
        signal: controller.signal,
        stallTimeoutMs: upstreamStallTimeoutMs,
        reconnectDelayMs: upstreamReconnectDelayMs,
        fetchImpl,
        buildUrl: () => {
          buildUrlFailed = false
          let targetUrl
          try {
            targetUrl = new URL(buildAxCodeUrl("/event", ""))
          } catch {
            buildUrlFailed = true
            throw new Error("AX Code service unavailable")
          }

          if (requestedDirectory) {
            targetUrl.searchParams.set("directory", requestedDirectory)
          }

          return targetUrl
        },
        getHeaders: getAxCodeAuthHeaders,
        onConnect() {
          if (!streamReady) {
            const readySent = sendMessageStreamWsFrame(socket, {
              type: "ready",
              scope: "directory",
            })
            if (!readySent) {
              closeAndCleanup()
              return
            }
            streamReady = true
            wsClients.add(socket)
          }

          upstreamConnected = true
        },
        onDisconnect() {
          upstreamConnected = false
        },
        onEvent: forwardEvent,
        onError(error) {
          if (controller.signal.aborted) {
            return
          }

          if (!streamReady) {
            if (error?.type === "upstream_unavailable") {
              closeWithInitialError({
                message: `AX Code event stream unavailable (${error.status})`,
                closeReason: "AX Code event stream unavailable",
                triggerHealthCheckFor: error.response,
              })
              return
            }

            closeWithInitialError({
              message: buildUrlFailed ? "AX Code service unavailable" : "Failed to connect to AX Code event stream",
              closeReason: buildUrlFailed ? "AX Code service unavailable" : "Failed to connect to AX Code event stream",
              triggerHealthCheckFor: !buildUrlFailed,
            })
            return
          }

          if (error?.type === "stream_error") {
            console.warn("Message stream WS proxy error:", error.error)
          }
        },
      })

      await reader.start()
    } catch (error) {
      if (!controller.signal.aborted) {
        console.warn("Message stream WS proxy error:", error)
        sendMessageStreamWsFrame(socket, { type: "error", message: "Message stream proxy error" })
        socket.close(1011, "Message stream proxy error")
      }
    } finally {
      cleanup()
      try {
        if (socket.readyState === 1 || socket.readyState === 0) {
          socket.close()
        }
      } catch {}
    }
  }

  void run()
}
