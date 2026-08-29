/**
 * WebSocket driver adapter for the openchamber global message-stream protocol
 * (`/api/global/event/ws`). Ported verbatim from event-pipeline.ts
 * runWsAttempt: the attempt settles on the first terminal condition —
 * `ready` frame (success, the promise stays open until close/abort), `error`
 * frame, socket close, ready timeout, or abort.
 *
 * The adapter parses and classifies control frames (`ready` / `error`) and
 * forwards everything else (`event`, `backpressure`) as raw frames. JSON
 * parse failures are logged and skipped, never fatal.
 */

import { createTransportError, type AttemptContext, type WsDriver } from "../types"

export type MessageStreamWsFrame = {
  type: "ready" | "event" | "error" | "backpressure"
  payload?: unknown
  eventId?: string
  directory?: string
  message?: string
  scope?: "global" | "directory"
}

export function runWebSocketAttempt(driver: WsDriver, ctx: AttemptContext): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false
    let opened = false
    let readyAt = 0
    const socket = new WebSocket(driver.url(ctx.cursor()))

    let readyTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
      readyTimer = undefined
      settleReject(
        createTransportError("ws_ready_timeout", "ws", "Message stream WebSocket ready timeout", {
          fallbackEligible: ctx.wsFallbackAllowed,
        }),
      )
      try {
        socket.close()
      } catch {
        // ignore
      }
    }, ctx.wsReadyTimeoutMs)

    const cleanup = () => {
      if (readyTimer) {
        clearTimeout(readyTimer)
        readyTimer = undefined
      }
      socket.onopen = null
      socket.onmessage = null
      socket.onerror = null
      socket.onclose = null
    }

    const settleResolve = () => {
      if (settled) return
      settled = true
      ctx.signal.removeEventListener("abort", handleAbort)
      cleanup()
      resolve()
    }

    const settleReject = (error: unknown) => {
      if (settled) return
      settled = true
      ctx.signal.removeEventListener("abort", handleAbort)
      cleanup()
      reject(error)
    }

    const handleAbort = () => {
      try {
        socket.close()
      } catch {
        // ignore close failures during abort
      }
      settleResolve()
    }

    ctx.signal.addEventListener("abort", handleAbort, { once: true })

    socket.onopen = () => {
      // Nothing to do: `ready` is the subscription acknowledgement.
    }

    socket.onmessage = (messageEvent) => {
      ctx.activity()

      let frame: MessageStreamWsFrame | null = null
      try {
        frame = JSON.parse(String(messageEvent.data)) as MessageStreamWsFrame
      } catch (error) {
        console.warn("[event-transport] Failed to parse WS frame", error)
        return
      }

      if (!frame || typeof frame.type !== "string") {
        return
      }

      if (frame.type === "ready") {
        opened = true
        readyAt = Date.now()
        if (readyTimer) {
          clearTimeout(readyTimer)
          readyTimer = undefined
        }
        ctx.ready()
        return
      }

      if (frame.type === "error") {
        settleReject(
          createTransportError("ws_error_frame", "ws", frame.message || "unknown", {
            fallbackEligible: ctx.wsFallbackAllowed && !opened,
          }),
        )
        try {
          socket.close()
        } catch {
          // ignore
        }
        return
      }

      if (frame.type === "backpressure") {
        ctx.deliver(frame)
        return
      }

      if (frame.type !== "event") {
        return
      }

      const eventId = typeof frame.eventId === "string" && frame.eventId.length > 0 ? frame.eventId : undefined
      if (eventId) {
        ctx.setCursor(eventId)
      }
      ctx.deliver(frame, eventId)
    }

    socket.onerror = () => {
      void 0
    }

    socket.onclose = (event) => {
      if (ctx.signal.aborted) {
        settleResolve()
        return
      }

      // If the WS stream connects (ready) but then drops quickly — including
      // in the very same millisecond as the ready frame (a proxy/LB cutting
      // the socket right after the handshake) — prefer SSE for a while. This
      // avoids tight reconnect loops with repeated console spam.
      const livedMs = readyAt > 0 ? Date.now() - readyAt : 0
      const unstableAfterReady = opened && livedMs < ctx.unstableReadyWindowMs
      settleReject(
        createTransportError(
          opened ? "ws_closed" : "ws_closed_before_ready",
          "ws",
          "Global message stream WebSocket closed",
          {
            closeCode: event?.code,
            fallbackEligible: ctx.wsFallbackAllowed && (!opened || unstableAfterReady),
          },
        ),
      )
    }
  })
}
