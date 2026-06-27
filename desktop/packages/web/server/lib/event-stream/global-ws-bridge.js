import { sendMessageStreamWsEvent, sendMessageStreamWsFrame } from "./protocol.js"
import { shouldTriggerUpstreamHealthCheck } from "./upstream-health.js"

export function createGlobalMessageStreamWsBridge({
  globalHub,
  ownsGlobalHub,
  wsClients,
  processForwardedEventPayload,
  triggerHealthCheck,
  heartbeatIntervalMs,
}) {
  const clients = new Set()
  const clientLastEventIds = new Map()
  const readyClients = new Set()

  const removeClient = (socket) => {
    clients.delete(socket)
    clientLastEventIds.delete(socket)
    readyClients.delete(socket)
    wsClients.delete(socket)
  }

  const replayEvents = (socket, requestedLastEventId) => {
    for (const entry of globalHub.replayAfter(requestedLastEventId)) {
      const sent = sendMessageStreamWsEvent(socket, entry.payload, {
        directory: entry.directory,
        eventId: entry.eventId,
      })
      if (!sent) {
        removeClient(socket)
        return
      }
    }
  }

  const markReady = (socket, requestedLastEventId) => {
    if (socket.readyState !== 1) {
      return
    }

    const sent = sendMessageStreamWsFrame(socket, {
      type: "ready",
      scope: "global",
    })
    if (!sent) {
      removeClient(socket)
      return
    }

    readyClients.add(socket)
    wsClients.add(socket)
    replayEvents(socket, requestedLastEventId)
  }

  const stopHubIfUnused = () => {
    if (ownsGlobalHub && clients.size === 0) {
      globalHub.stop()
    }
  }

  const closeClientsWithInitialError = ({ message, closeReason = message, triggerHealthCheckFor = null }) => {
    for (const socket of Array.from(clients)) {
      sendMessageStreamWsFrame(socket, { type: "error", message })
      try {
        socket.close(1011, closeReason)
      } catch {}
      removeClient(socket)
    }

    if (
      triggerHealthCheckFor === true ||
      (triggerHealthCheckFor && shouldTriggerUpstreamHealthCheck(triggerHealthCheckFor))
    ) {
      triggerHealthCheck?.()
    }

    if (ownsGlobalHub) {
      globalHub.stop()
    }
  }

  const unsubscribeEvent = globalHub.subscribeEvent(({ payload, directory, eventId }) => {
    for (const socket of Array.from(clients)) {
      if (!readyClients.has(socket)) {
        continue
      }
      const sent = sendMessageStreamWsEvent(socket, payload, {
        directory,
        eventId,
      })
      if (!sent) {
        removeClient(socket)
      }
    }

    processForwardedEventPayload(payload, (syntheticPayload) => {
      for (const socket of Array.from(clients)) {
        if (!readyClients.has(socket)) {
          continue
        }
        const sent = sendMessageStreamWsEvent(socket, syntheticPayload, { directory: "global" })
        if (!sent) {
          removeClient(socket)
        }
      }
    })
  })

  const unsubscribeStatus = globalHub.subscribeStatus((status) => {
    if (status.type === "connect") {
      for (const socket of Array.from(clients)) {
        if (!readyClients.has(socket)) {
          markReady(socket, clientLastEventIds.get(socket) ?? "")
        }
      }
      return
    }

    if (status.type === "initial-error") {
      const error = status.error
      if (error?.type === "upstream_unavailable") {
        closeClientsWithInitialError({
          message: `AX Code event stream unavailable (${error.status})`,
          closeReason: "AX Code event stream unavailable",
          triggerHealthCheckFor: error.response,
        })
        return
      }

      closeClientsWithInitialError({
        message: status.buildUrlFailed ? "AX Code service unavailable" : "Failed to connect to AX Code event stream",
        closeReason: status.buildUrlFailed
          ? "AX Code service unavailable"
          : "Failed to connect to AX Code event stream",
        triggerHealthCheckFor: !status.buildUrlFailed,
      })
      return
    }

    if (status.type === "error" && status.error?.type === "stream_error") {
      console.warn("Message stream WS proxy error:", status.error.error)
    }
  })

  const accept = (socket, { requestedLastEventId = "" } = {}) => {
    const pingInterval = setInterval(() => {
      if (socket.readyState !== 1) {
        return
      }

      try {
        socket.ping()
      } catch {}
    }, heartbeatIntervalMs)
    if (typeof pingInterval.unref === "function") pingInterval.unref()

    const heartbeatInterval = setInterval(() => {
      // Only send to ready clients — the heartbeat is an event frame, and the
      // protocol requires the `ready` frame to precede any event frame (the
      // real-event forwarder applies the same readyClients guard).
      if (!globalHub.isConnected() || !readyClients.has(socket)) {
        return
      }

      sendMessageStreamWsEvent(
        socket,
        { type: "openchamber:heartbeat", timestamp: Date.now() },
        { directory: "global" },
      )
    }, heartbeatIntervalMs)
    if (typeof heartbeatInterval.unref === "function") heartbeatInterval.unref()

    socket.on("close", () => {
      clearInterval(pingInterval)
      clearInterval(heartbeatInterval)
      removeClient(socket)
      stopHubIfUnused()
    })

    socket.on("error", (error) => {
      // The `ws` library emits "error" before "close" for recoverable
      // transport errors, but an unhandled "error" event crashes the Node
      // process. Log and rely on the "close" handler for interval cleanup.
      console.warn("[global-ws-bridge] socket error:", error?.message ?? error)
    })

    clients.add(socket)
    clientLastEventIds.set(socket, requestedLastEventId)
    globalHub.start()
    if (globalHub.isConnected()) {
      markReady(socket, requestedLastEventId)
    }
  }

  const close = () => {
    unsubscribeEvent()
    unsubscribeStatus()
    if (ownsGlobalHub) {
      globalHub.stop()
    }
    for (const socket of Array.from(clients)) {
      removeClient(socket)
    }
  }

  return {
    accept,
    close,
  }
}
