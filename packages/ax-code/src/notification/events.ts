import { BusEvent } from "@/bus/bus-event"
import z from "zod"

export const NotificationEvent = {
  ToastShow: BusEvent.define(
    "notification.toast.show",
    z.object({
      title: z.string().optional(),
      message: z.string(),
      variant: z.enum(["info", "success", "warning", "error"]),
      duration: z.number().optional().describe("Duration in milliseconds"),
    }),
  ),
  MonitorLine: BusEvent.define(
    "notification.monitor.line",
    z.object({
      monitorID: z.string(),
      line: z.string(),
      description: z.string(),
    }),
  ),
  MonitorExit: BusEvent.define(
    "notification.monitor.exit",
    z.object({
      monitorID: z.string(),
      description: z.string(),
      exitCode: z.number().nullable(),
    }),
  ),
}
