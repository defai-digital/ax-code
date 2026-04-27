import type { Part, UserMessage } from "@ax-code/sdk/v2"
import type { ReplayEvent } from "@/replay/event"
import { Locale } from "@/util/locale"

export type AgentInfo = {
  name: string
  displayName?: string
}

export function agentLabel(name: string, agents?: AgentInfo[]) {
  return agents?.find((item) => item.name === name)?.displayName ?? Locale.titlecase(name)
}

export function userRoute(msg: UserMessage, parts: Part[], agents?: AgentInfo[]) {
  const seen = new Set<string>()
  const delegated = parts.flatMap((part) => {
    if (part.type !== "subtask") return []
    if (part.agent === msg.agent) return []
    if (seen.has(part.agent)) return []
    seen.add(part.agent)
    return [{ id: part.id, name: part.agent, label: agentLabel(part.agent, agents) }]
  })
  return {
    primary: { name: msg.agent, label: agentLabel(msg.agent, agents) },
    delegated,
  }
}

export function routeNote(msg: UserMessage, parts: Part[], agents?: AgentInfo[]) {
  const route = userRoute(msg, parts, agents)
  if (route.delegated.length > 0) {
    return `Primary ${route.primary.label} · specialist ${route.delegated.map((item) => item.label).join(", ")}`
  }
  // Agent.list sorts the configured default first (cfg.default_agent or "build"),
  // so agents[0] is the user's actual default — fall back to "build" only when no list is supplied.
  const defaultAgent = agents?.[0]?.name ?? "build"
  if (msg.agent !== defaultAgent) return `Primary ${route.primary.label}`
  return ""
}

export function routeEvent(
  row: { event_data: ReplayEvent; time_created: number },
  agents?: AgentInfo[],
) {
  const event = row.event_data
  if (event.type !== "agent.route") return
  const mode = event.routeMode ?? "switch"

  if (mode === "complexity") {
    return {
      id: `route:${row.time_created}:complexity`,
      mode,
      icon: "⚡",
      title: "Fast model",
      detail: `simple task · ${agentLabel(event.fromAgent, agents)}`,
      time: row.time_created,
    }
  }

  const to = agentLabel(event.toAgent, agents)
  const from = agentLabel(event.fromAgent, agents)
  const matched = event.matched?.length ? ` · ${event.matched.join(", ")}` : ""
  if (mode === "delegate") {
    return {
      id: `route:${row.time_created}:${event.toAgent}`,
      mode,
      icon: "↳",
      title: `Delegated ${to}`,
      detail: `Kept ${from} active${matched}`,
      time: row.time_created,
    }
  }
  return {
    id: `route:${row.time_created}:${event.toAgent}`,
    mode,
    icon: "⇄",
    title: `Switched primary to ${to}`,
    detail: `From ${from}${matched}`,
    time: row.time_created,
  }
}

export function messageRoute(
  msg: UserMessage,
  parts: Part[],
  rows: { event_data: ReplayEvent; time_created: number }[],
  agents?: AgentInfo[],
) {
  const matches = rows.filter((row) => row.event_data.type === "agent.route" && row.event_data.messageID === msg.id)
  // Prefer agent-switch/delegate events over complexity-only events (more informative for display)
  const row =
    matches.find((r) => {
      const e = r.event_data
      return e.type === "agent.route" && e.routeMode !== "complexity"
    }) ?? matches.at(-1)
  if (row) {
    const item = routeEvent(row, agents)
    if (item) {
      const event = row.event_data
      if (event.type !== "agent.route") throw new Error("narrowing")
      const matched = event.matched?.length ? event.matched.join(", ") : undefined
      const footer = [`confidence ${event.confidence.toFixed(2)}`, matched].filter(Boolean).join(" · ")
      return {
        title: `Routing: ${item.title}`,
        description: item.detail,
        footer,
      }
    }
  }
  const note = routeNote(msg, parts, agents)
  if (!note) return
  return {
    title: "Execution Context",
    description: note,
  }
}
