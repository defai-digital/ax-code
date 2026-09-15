import { Locale } from "@/util/locale"

export function scheduleTaskLine(input: { running: boolean; title?: string; id?: string; nextRunAt?: number }) {
  if (input.running) return input.title ? `Scheduling ${input.title}` : "Scheduling..."
  const parts = ["Scheduled"]
  if (input.title) parts.push(input.title)
  if (input.id) parts.push(input.id)
  if (input.nextRunAt !== undefined) parts.push(`next ${Locale.todayTimeOrDateTime(input.nextRunAt)}`)
  return parts.join(" · ")
}
