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

  const cleanup = () => {
    if (!controller.signal.aborted) {
      controller.abort()
    }
    reader?.stop()
    wsClients.delete(socket)
  }

  const pingInterval = setInterval(() => {
    if (socket.readyState !== 1) {
      return
    }

    try {
      socket.ping()
    } catch {}
  }, heartbeatIntervalMs)

  const heartbeatInterval = setInterval(() => {
    if (!upstreamConnected) {
      return
    }

    sendMessageStreamWsEvent(socket, { type: "openchamber:heartbeat", timestamp: Date.now() }, { directory: "global" })
  }, heartbeatIntervalMs)

  socket.on("close", () => {
    clearInterval(pingInterval)
    clearInterval(heartbeatInterval)
    upstreamConnected = false
    cleanup()
  })

  socket.on("error", () => {
    void 0
  })

  const run = async () => {
    const forwardEvent = ({ envelope, payload }) => {
      const directory = requestedDirectory || envelope?.directory || "global"

      sendMessageStreamWsEvent(socket, payload, {
        directory,
        eventId: typeof envelope?.eventId === "string" && envelope.eventId.length > 0 ? envelope.eventId : undefined,
      })

      processForwardedEventPayload(payload, (syntheticPayload) => {
        sendMessageStreamWsEvent(socket, syntheticPayload, { directory: "global" })
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
            sendMessageStreamWsFrame(socket, {
              type: "ready",
              scope: "directory",
            })
            streamReady = true
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
