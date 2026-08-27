import { BusEvent } from "@/bus/bus-event"
import z from "zod"

export const RuntimeEvent = {
  Connected: BusEvent.define("server.connected", z.object({})),
  ResyncRequired: BusEvent.define(
    "server.resync_required",
    z.object({
      reason: z.enum(["invalid_cursor", "server_restarted", "cursor_expired", "cursor_ahead", "buffer_overflow"]),
      cursor: z.string(),
    }),
  ),
  Disposed: BusEvent.define("global.disposed", z.object({})),
}
