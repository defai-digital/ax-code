import type { Part } from "@ax-code/sdk/v2"
import type { ReplayEvent } from "@/replay/event"
import { agentControlActivityItems } from "./agent-control-activity"
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
    case "completed":
      return "ok"
    case "error":
      return "ERR"
    case "running":
      return "running"
    case "pending":
      return "pending"
    case "fast":
      return "fast"
    case "standard":
      return "standard"
    case "delegate":
      return "delegate"
    case "switch":
      return "switch"
    case "blocked":
      return "blocked"
    case "assess":
      return "assess"
    case "plan":
      return "plan"
    case "await_approval":
      return "approval"
    case "execute":
      return "exec"
    case "validate":
      return "validate"
    case "recover":
      return "recover"
    case "summarize":
      return "summary"
    case "complete":
      return "done"
    case "deep":
      return "deep"
    case "xdeep":
      return "xdeep"
    case "passed":
      return "passed"
    case "failed":
      return "failed"
    case "allow":
      return "allow"
    case "ask":
      return "ask"
    case "deny":
      return "deny"
    case "allow_with_checkpoint":
      return "checkpoint"
    case "approved":
      return "approved"
    case "rejected":
      return "rejected"
    case "not_required":
      return "skip"
    default:
      return status
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

function routeItem(row: { event_data: ReplayEvent; time_created: number }, agents?: AgentInfo[]): Activity | undefined {
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

/**
 * Activity rows derived from the event log only. Callers that re-run on every
 * tool-part event but whose rows change far less often memoize this part and
 * pass it to activityItems, which keeps the same concatenation order.
 */
export function rowActivityItems(rows: { event_data: ReplayEvent; time_created: number }[], agents?: AgentInfo[]) {
  return [...rows.map((row) => routeItem(row, agents)).filter((item) => !!item), ...agentControlActivityItems(rows)]
}

export function activityItems(
  parts: Part[],
  rows: { event_data: ReplayEvent; time_created: number }[],
  agents?: AgentInfo[],
  limit?: number,
  rowItems: Activity[] = rowActivityItems(rows, agents),
) {
  const all = [...parts.map(toolItem).filter((item) => !!item), ...rowItems]
  if (limit === undefined) return all.toSorted((a, b) => (b.time ?? 0) - (a.time ?? 0))
  // Bounded selection for callers that render only the newest few rows: the
  // sidebar recomputes this on every tool-part event, so avoid sorting every
  // part in the session. Inserting only before strictly smaller times keeps
  // ties in production order, matching the stable full sort.
  const top: Activity[] = []
  for (const item of all) {
    const time = item.time ?? 0
    let index = top.length
    while (index > 0 && (top[index - 1]!.time ?? 0) < time) index--
    if (index >= limit) continue
    top.splice(index, 0, item)
    if (top.length > limit) top.pop()
  }
  return top
}
