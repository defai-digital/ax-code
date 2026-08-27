import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { streamSSE } from "hono/streaming"
import { Log } from "@/util/log"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { lazy } from "../../util/lazy"
import { AsyncQueue } from "../../util/queue"
import { Instance } from "@/project/instance"
import { encodeSsePayload, SSE_HARD_MAX, SSE_WARN_THRESHOLD } from "../sse-queue"
import { Event } from "../event"
import type { EventJournalEntry } from "@/bus/event-journal"
import "@/notification/events"

const log = Log.create({ service: "server" })
const HEARTBEAT_INTERVAL_MS = 10_000

export const EventRoutes = lazy(() =>
  new Hono().get(
    "/event",
    describeRoute({
      summary: "Subscribe to events",
      description: "Get events",
      operationId: "event.subscribe",
      responses: {
        200: {
          description: "Event stream",
          content: {
            "text/event-stream": {
              schema: resolver(BusEvent.payloads()),
            },
          },
        },
      },
    }),
    async (c) => {
      log.info("event connected")
      c.header("X-Accel-Buffering", "no")
      c.header("X-Content-Type-Options", "nosniff")
      return streamSSE(c, async (stream) => {
        type QueuedFrame = { data: string; id?: string }
        const q = new AsyncQueue<QueuedFrame | null>()
        let done = false
        let warned = false
        let heartbeat: ReturnType<typeof setInterval> | undefined
        let unsub = () => {}

        const stop = () => {
          if (done) return
          done = true
          if (heartbeat) clearInterval(heartbeat)
          try {
            unsub()
          } finally {
            q.push(null)
          }
          log.info("event disconnected")
        }

        const push = (entry: EventJournalEntry<any>) => {
          if (q.size >= SSE_HARD_MAX) return "overflow" as const
          q.push({ data: entry.data, id: entry.id })
          if (q.size >= SSE_WARN_THRESHOLD && !warned) {
            // Log only once when crossing the threshold to avoid flooding
            // logs under sustained backpressure.
            warned = true
            log.warn("SSE queue approaching capacity", {
              queueSize: q.size,
              warnThreshold: SSE_WARN_THRESHOLD,
              hardMax: SSE_HARD_MAX,
            })
          }
          return "queued" as const
        }

        // Control frames (`server.connected`, `server.heartbeat`) bypass
        // data-frame overflow handling so a near-cap burst of real events
        // can't trigger a teardown on an otherwise-fine heartbeat, but they
        // are still bounded. Without a smaller control-frame cap, a stalled
        // consumer would let heartbeats accumulate forever.
        const CONTROL_FRAME_QUEUE_LIMIT = 256
        const pushControl = (payload: unknown, id?: string, limit = CONTROL_FRAME_QUEUE_LIMIT) => {
          if (q.size >= limit) return
          q.push({ data: encodeSsePayload(payload), id })
        }

        // Send heartbeat every 10s to prevent stalled proxy streams.
        // Guard the callback so a pushControl failure cannot become an
        // uncaught exception from the timer and take down the process.
        heartbeat = setInterval(() => {
          try {
            pushControl({
              type: "server.heartbeat",
              properties: {},
            })
          } catch (error) {
            log.warn("event heartbeat failed", { error })
          }
        }, HEARTBEAT_INTERVAL_MS)
        heartbeat.unref?.()

        const shouldForward = (event: { properties?: { directory?: string } }) => {
          const directory = event.properties?.directory
          return directory === undefined || directory === Instance.directory
        }

        const lastEventID = c.req.header("Last-Event-ID")?.trim() || undefined
        const subscription = Bus.subscribeAllFrom(lastEventID, (entry) => {
          if (!shouldForward(entry.value)) return
          if (q.size >= SSE_HARD_MAX) {
            log.warn("SSE queue overflow — disconnecting client", {
              queueSize: q.size,
              hardMax: SSE_HARD_MAX,
            })
            stop()
            return
          }
          push(entry)
          if (entry.value.type === Bus.InstanceDisposed.type) stop()
        })
        unsub = subscription.unsubscribe

        if (subscription.replay?.type === "replay") {
          for (const entry of subscription.replay.entries) {
            if (!shouldForward(entry.value)) continue
            if (q.size >= SSE_HARD_MAX) {
              stop()
              break
            }
            push(entry)
          }
        } else if (subscription.replay?.type === "gap") {
          pushControl(
            {
              type: Event.ResyncRequired.type,
              properties: {
                reason: subscription.replay.reason,
                cursor: subscription.replay.cursor,
              },
            },
            subscription.replay.cursor,
            SSE_HARD_MAX,
          )
        }

        // This is an actual subscription acknowledgement, not merely an HTTP
        // response acknowledgement. Replayed frames are queued first so a
        // client can apply them before reconciling its authoritative snapshot.
        if (!done) {
          pushControl(
            {
              type: Event.Connected.type,
              properties: {},
            },
            subscription.cursor,
            SSE_HARD_MAX,
          )
        }

        stream.onAbort(stop)

        try {
          for await (const data of q) {
            if (data === null) return
            await stream.writeSSE(data)
          }
        } finally {
          stop()
        }
      })
    },
  ),
)
