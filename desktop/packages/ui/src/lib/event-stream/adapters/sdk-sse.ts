/**
 * SDK fetch-SSE driver adapter. Ported verbatim from event-pipeline.ts
 * runSseAttempt: wraps the SDK's SSE client (driver.open) instead of
 * reimplementing it, forwards every streamed event as a raw frame, and
 * paces long replay bursts with a macrotask yield every STREAM_YIELD_MS so
 * the UI stays responsive.
 *
 * The connection counts as acknowledged on the first streamed event — the
 * server sends `server.connected` first, which is what previously marked the
 * pipeline connected.
 */

import type { AttemptContext, SdkSseDriver } from "../types"

const STREAM_YIELD_MS = 8

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function runSdkSseAttempt(driver: SdkSseDriver, ctx: AttemptContext): Promise<void> {
  const events = await driver.open({
    signal: ctx.signal,
    ...(ctx.headers ? { headers: ctx.headers } : {}),
    onSseEvent: (event) => {
      ctx.activity()
      if (typeof event.id === "string" && event.id.length > 0) {
        ctx.setCursor(event.id)
      }
    },
  })

  let yielded = Date.now()
  ctx.activity()
  let announced = false

  for await (const event of events.stream) {
    ctx.activity()
    if (!announced) {
      announced = true
      ctx.ready()
    }
    ctx.deliver(event)

    if (Date.now() - yielded < STREAM_YIELD_MS) continue
    yielded = Date.now()
    await wait(0)
  }
}
