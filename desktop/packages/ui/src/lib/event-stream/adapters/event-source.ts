/**
 * Native EventSource driver adapter. Mirrors the reconnect discipline the two
 * small consumers (openchamberEvents, useWebNotificationStream) relied on: any
 * `error` closes the source and fails the attempt so the transport's backoff
 * loop owns reconnection (instead of the browser's opaque internal retry).
 *
 * The connection counts as acknowledged on the FIRST message — for the
 * openchamber event stream that is the `openchamber:event-stream-ready`
 * envelope, which is exactly what reset the reconnect counter before.
 */

import { createTransportError, type AttemptContext, type EventSourceDriver } from "../types"

export function runEventSourceAttempt(driver: EventSourceDriver, ctx: AttemptContext): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const source = new EventSource(driver.url)
    let settled = false
    let announced = false

    const cleanup = () => {
      source.onopen = null
      source.onmessage = null
      source.onerror = null
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
        source.close()
      } catch {
        // ignore close failures during abort
      }
      settleResolve()
    }

    ctx.signal.addEventListener("abort", handleAbort, { once: true })

    source.onopen = () => {
      ctx.activity()
    }

    source.onmessage = (event) => {
      ctx.activity()
      if (!announced) {
        announced = true
        ctx.ready()
      }
      ctx.deliver(event.data)
    }

    source.onerror = () => {
      if (ctx.signal.aborted) {
        settleResolve()
        return
      }
      try {
        source.close()
      } catch {
        // ignore
      }
      settleReject(createTransportError("sse_error", "sse", "EventSource stream error"))
    }
  })
}
