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
}
