import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { streamSSE } from "hono/streaming"
import { Log } from "@/util/log"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { lazy } from "../../util/lazy"
import { AsyncQueue } from "../../util/queue"
import { Instance } from "@/project/instance"
import { pushSseFrame } from "../sse-queue"
import { Event } from "../event"

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
        const q = new AsyncQueue<string | null>()
        let done = false
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

        const push = (payload: unknown) => {
          const result = pushSseFrame(q, payload)
          if (result === "overflow") stop()
          return result
        }

        // Control frames (`server.connected`, `server.heartbeat`)
        // bypass the data-frame backpressure ladder so a near-cap burst
        // of real events can't trigger a teardown on an otherwise-fine
        // heartbeat — but they are still bounded. Without an upper
        // bound a stalled consumer would let heartbeats accumulate
        // forever (one every 10s, ~80 bytes each, but unbounded across
        // hours of stall). When the queue is already congested past
        // the soft watermark we drop the control frame: heartbeats
        // resume once the consumer drains data frames, and the proxy
        // will see a stalled connection and reset it normally.
        const CONTROL_FRAME_QUEUE_LIMIT = 256
        const pushControl = (payload: unknown) => {
          if (q.size >= CONTROL_FRAME_QUEUE_LIMIT) return
          q.push(JSON.stringify(payload))
        }

        pushControl({
          type: Event.Connected.type,
          properties: {},
        })

        // Send heartbeat every 10s to prevent stalled proxy streams.
        heartbeat = setInterval(() => {
          pushControl({
            type: "server.heartbeat",
            properties: {},
          })
        }, HEARTBEAT_INTERVAL_MS)

        unsub = Bus.subscribeAll((event) => {
          push(event)
          if (event.type === Bus.InstanceDisposed.type) stop()
        })

        stream.onAbort(stop)

        try {
          for await (const data of q) {
            if (data === null) return
            await stream.writeSSE({ data })
          }
        } finally {
          stop()
        }
      })
    },
  ),
)
