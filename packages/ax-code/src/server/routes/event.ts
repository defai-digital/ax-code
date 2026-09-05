import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { streamSSE } from "hono/streaming"
import { Log } from "@/util/log"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { lazy } from "../../util/lazy"
import { Instance } from "@/project/instance"
import { EventStream } from "../event-stream"
import "@/notification/events"

const log = Log.create({ service: "server" })

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
      const directory = Instance.directory
      return streamSSE(c, (stream) =>
        EventStream.run<{ type: string; properties?: { directory?: string } }>(stream, {
          label: "project",
          cursor: c.req.header("Last-Event-ID")?.trim() || undefined,
          subscribe: (cursor, listener) => Bus.subscribeAllFrom(cursor, listener),
          filter: (event) => event.properties?.directory === undefined || event.properties.directory === directory,
          terminate: (event) => event.type === Bus.InstanceDisposed.type,
        }),
      )
    },
  ),
)
