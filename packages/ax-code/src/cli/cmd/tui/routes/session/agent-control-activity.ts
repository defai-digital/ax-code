import { AgentControlReplayQuery } from "@/replay/agent-control-query"
import type { Activity } from "./activity"

type ActivityRow = {
  event_data: unknown
  time_created: number
}

export function agentControlActivityItems(rows: readonly ActivityRow[]): Activity[] {
  return AgentControlReplayQuery.timelineFromRows(rows, "agent-control").map(agentControlActivityItem)
}

export function agentControlActivityItem(item: AgentControlReplayQuery.TimelineItem): Activity {
  const tool = agentControlTool(item.kind)
  return {
    id: item.id,
    icon: agentControlIcon(item.kind),
    label: item.title,
    status: item.status,
    tool,
    time: item.time,
    description: item.detail,
    category: "agent-control",
  }
}

function agentControlTool(kind: AgentControlReplayQuery.TimelineKind): string {
  return `agent.${kind}`
}

function agentControlIcon(kind: AgentControlReplayQuery.TimelineKind): string {
  switch (kind) {
    case "phase":
      return "\u25C7"
    case "reasoning":
      return "\u22EF"
    case "plan":
      return "\u25C6"
    case "validation":
    case "completed":
      return "\u2713"
    case "blocked":
    case "safety":
      return "!"
  }
}
