import { ExecutionGraph } from "@/graph"
import { GraphFormat } from "@/graph/format"
import { EventQuery } from "@/replay/query"
import { duration as formatDuration } from "./format"

export namespace SessionGraph {
  export type Entry = {
    id: string
    title: string
    description?: string
    footer?: string
    category?: string
  }

  function stat(n: number, txt: string) {
    return `${n} ${txt}${n === 1 ? "" : "s"}`
  }

  function label(type: ExecutionGraph.NodeType) {
    if (type === "tool_call") return "Tool call"
    if (type === "tool_result") return "Tool result"
    if (type === "agent_route") return "Route"
    if (type === "llm") return "LLM"
    if (type === "error") return "Error"
    return type[0]!.toUpperCase() + type.slice(1)
  }

  function node(input: ExecutionGraph.Graph, id: string) {
    const next = input.nodes.find((item) => item.id === id)
    if (!next) return
    return next
  }

  function kids(input: ExecutionGraph.Graph, id: string) {
    return input.edges
      .filter((item) => item.type === "step_contains" && item.from === id)
      .map((item) => node(input, item.to))
      .filter((item): item is ExecutionGraph.Node => !!item)
      .sort((a, b) => a.timestamp - b.timestamp)
  }

  function step(input: ExecutionGraph.Graph, id: string) {
    const edge = input.edges.find((item) => item.type === "step_contains" && item.to === id)
    if (!edge) return
    const next = node(input, edge.from)
    if (!next || next.type !== "step") return
    return next
  }

  function pair(input: ExecutionGraph.Graph, id: string) {
    const edge = input.edges.find((item) => item.type === "call_result" && item.from === id)
    if (!edge) return
    const next = node(input, edge.to)
    if (!next || next.type !== "tool_result") return
    return next
  }

  function topology(input: ExecutionGraph.Graph) {
    return GraphFormat.topologyLines(input).flatMap((item, idx): Entry[] => {
      if (item.kind === "heading") return []
      if (item.kind === "path") {
        return [
          {
            id: `path:${idx}`,
            title: "Critical path",
            description: item.nodes.join(" → "),
            footer: `${item.nodes.length} node${item.nodes.length === 1 ? "" : "s"}`,
            category: "Topology",
          },
        ]
      }
      if (item.kind === "step") {
        return [
          {
            id: `flow:${item.stepIndex}`,
            title: `Step ${item.stepIndex} flow`,
            description: item.nodes.join(" → "),
            footer: `${item.nodes.length} node${item.nodes.length === 1 ? "" : "s"}`,
            category: "Topology",
          },
        ]
      }
      return [
        {
          id: `pair:${idx}`,
          title: item.call,
          description: item.result,
          footer: "call → result",
          category: "Topology",
        },
      ]
    })
  }

  export function ascii(input: ExecutionGraph.Graph) {
    return GraphFormat.ascii(input)
  }

  export function entries(input: ExecutionGraph.Graph): Entry[] {
    if (input.nodes.length === 0) return []

    const meta = input.metadata
    const out = [
      {
        id: "summary",
        title: `${input.nodes.length} nodes · ${input.edges.length} edges`,
        description: [
          `Risk ${meta.risk.level.toLowerCase()} (${meta.risk.score}/100)`,
          stat(meta.steps, "step"),
          stat(meta.tools.length, "tool"),
          stat(meta.errors, "error"),
        ].join(" · "),
        footer: `${formatDuration(meta.duration)} · ${meta.tokens.input}/${meta.tokens.output} tokens`,
        category: "Overview",
      },
    ] as Entry[]

    const seen = new Map<ExecutionGraph.NodeType, number>()
    input.nodes.forEach((item) => seen.set(item.type, (seen.get(item.type) ?? 0) + 1))

    for (const type of ["session", "agent_route", "step", "tool_call", "tool_result", "llm", "error"] as const) {
      const count = seen.get(type)
      if (!count) continue
      out.push({
        id: `node:${type}`,
        title: `${label(type)} ${count}`,
        description: `${count} node${count === 1 ? "" : "s"}`,
        category: "Nodes",
      })
    }

    input.nodes
      .filter((item) => item.type === "agent_route")
      .sort((a, b) => a.timestamp - b.timestamp)
      .forEach((item, idx) =>
        out.push({
          id: `route:${idx}`,
          title: item.label,
          description: item.confidence != null ? `confidence ${item.confidence.toFixed(2)}` : undefined,
          category: "Routing",
        }),
      )

    input.nodes
      .filter((item) => item.type === "step")
      .sort((a, b) => (a.stepIndex ?? 0) - (b.stepIndex ?? 0))
      .forEach((item) => {
        const list = kids(input, item.id)
        out.push({
          id: `step:${item.stepIndex ?? item.id}`,
          title: `Step ${item.stepIndex ?? "?"}`,
          description: `${list.length} child event${list.length === 1 ? "" : "s"}`,
          footer: [
            formatDuration(item.duration),
            item.tokens ? `tokens ${item.tokens.input}/${item.tokens.output}` : undefined,
          ]
            .filter(Boolean)
            .join(" · "),
          category: "Steps",
        })
      })

    for (const item of topology(input)) out.push(item)

    input.nodes
      .filter((item) => item.type === "tool_call")
      .sort((a, b) => a.timestamp - b.timestamp)
      .forEach((item, idx) => {
        const res = pair(input, item.id)
        const parent = step(input, item.id)
        out.push({
          id: `tool:${idx}`,
          title: item.label,
          description: res?.status ?? "pending",
          footer: [
            parent?.stepIndex != null ? `step ${parent.stepIndex}` : undefined,
            res?.duration != null ? `${res.duration}ms` : undefined,
          ]
            .filter(Boolean)
            .join(" · "),
          category: "Tools",
        })
      })

    input.nodes
      .filter((item) => item.type === "llm")
      .sort((a, b) => a.timestamp - b.timestamp)
      .forEach((item, idx) => {
        const parent = step(input, item.id)
        out.push({
          id: `llm:${idx}`,
          title: item.label,
          description: item.tokens ? `${item.tokens.input}/${item.tokens.output} tokens` : undefined,
          footer: [
            parent?.stepIndex != null ? `step ${parent.stepIndex}` : undefined,
            item.duration != null ? `${item.duration}ms` : undefined,
          ]
            .filter(Boolean)
            .join(" · "),
          category: "LLM",
        })
      })

    input.nodes
      .filter((item) => item.type === "error")
      .sort((a, b) => a.timestamp - b.timestamp)
      .forEach((item, idx) => {
        const parent = step(input, item.id)
        out.push({
          id: `error:${idx}`,
          title: item.label,
          description: parent?.stepIndex != null ? `step ${parent.stepIndex}` : undefined,
          category: "Errors",
        })
      })

    return out
  }

  export function loadGraph(sessionID: Parameters<typeof EventQuery.bySession>[0]) {
    if (EventQuery.count(sessionID) === 0) return
    return ExecutionGraph.build(sessionID)
  }

  export function load(sessionID: Parameters<typeof EventQuery.bySession>[0]) {
    const graph = loadGraph(sessionID)
    if (!graph) return []
    return entries(graph)
  }

  export function loadAscii(sessionID: Parameters<typeof EventQuery.bySession>[0]) {
    const graph = loadGraph(sessionID)
    if (!graph) return []
    return ascii(graph)
  }
}
