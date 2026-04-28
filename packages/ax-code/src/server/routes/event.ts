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
        // bypass the soft/hard backpressure caps. They are tiny, never
        // burst, and dropping them is worse than letting them sit
        // alongside the queue: a heartbeat lost during a near-cap burst
        // can mask a stalled proxy until the next 10s tick, and an
        // overflow trip on a heartbeat would tear down a connection
        // that data frames could still reach.
        const pushControl = (payload: unknown) => {
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
