import type { Part } from "@ax-code/sdk/v2"
import type { ReplayEvent } from "@/replay/event"
import { routeEvent, type AgentInfo } from "./route"

export type Activity = {
  id: string
  icon: string
  label: string
  status: string
  tool: string
  time?: number
  description?: string
  category: string
}

export function statusLabel(status: string): string {
  switch (status) {
    case "completed": return "ok"
    case "error": return "ERR"
    case "running": return "running"
    case "pending": return "pending"
    case "delegate": return "delegate"
    case "switch": return "switch"
    default: return status
  }
}

export function activityIcon(tool: string): string {
  switch (tool) {
    case "bash":
      return "$"
    case "read":
      return "\u2192"
    case "edit":
    case "write":
      return "\u270E"
    case "glob":
    case "grep":
    case "codesearch":
      return "\u2315"
    case "webfetch":
    case "websearch":
      return "\u2295"
    case "task":
      return "\u25C8"
    case "route.delegate":
      return "↳"
    case "route.switch":
      return "⇄"
    default:
      return "\u00B7"
  }
}

export function activityLabel(part: Part): string {
  if (part.type !== "tool") return ""
  const state = part.state as { status: string; title?: string; error?: string }
  if (state.title) {
    return state.title.length > 33 ? state.title.slice(0, 30) + "..." : state.title
  }
  if (state.status === "pending") return `${part.tool} (pending)`
  if (state.status === "error" && state.error) {
    const label = `${part.tool}: ${state.error.replace(/\n/g, " ")}`
    return label.length > 33 ? label.slice(0, 30) + "..." : label
  }
  return part.tool
}

function toolItem(part: Part): Activity | undefined {
  if (part.type !== "tool") return
  const state = part.state as {
    status: string
    time?: { start: number; end?: number }
  }
  return {
    id: part.id,
    icon: activityIcon(part.tool),
    label: activityLabel(part),
    status: state.status,
    tool: part.tool,
    time: state.time?.start,
    category: part.tool,
  }
}

function routeItem(
  row: { event_data: ReplayEvent; time_created: number },
  agents?: AgentInfo[],
): Activity | undefined {
  const item = routeEvent(row, agents)
  if (!item) return
  return {
    id: item.id,
    icon: item.icon,
    label: item.title,
    status: item.mode,
    tool: `route.${item.mode}`,
    time: item.time,
    description: item.detail,
    category: "routing",
  }
}

export function activityItems(
  parts: Part[],
  rows: { event_data: ReplayEvent; time_created: number }[],
  agents?: AgentInfo[],
) {
  return [
    ...parts.map(toolItem).filter((item) => !!item),
    ...rows.map((row) => routeItem(row, agents)).filter((item) => !!item),
  ]
    .toSorted((a, b) => (b.time ?? 0) - (a.time ?? 0))
}
