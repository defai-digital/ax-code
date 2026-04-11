import z from "zod"
import type { ExecutionGraph } from "./index"

function sanitize(label: string): string {
  return label
    .replace(/"/g, "'")
    .replace(/[<>{}|]/g, "_")
    .replace(/\n/g, " ")
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

function node(graph: ExecutionGraph.Graph, id: string) {
  const next = graph.nodes.find((item) => item.id === id)
  if (!next) return
  return next
}

function kids(graph: ExecutionGraph.Graph, id: string) {
  return graph.edges
    .filter((item) => item.type === "step_contains" && item.from === id)
    .map((item) => node(graph, item.to))
    .filter((item): item is ExecutionGraph.Node => !!item)
    .sort((a, b) => a.timestamp - b.timestamp)
}

function pair(graph: ExecutionGraph.Graph, id: string) {
  const edge = graph.edges.find((item) => item.type === "call_result" && item.from === id)
  if (!edge) return
  const next = node(graph, edge.to)
  if (!next || next.type !== "tool_result") return
  return next
}

function lead(graph: ExecutionGraph.Graph) {
  const first = graph.nodes.findIndex((item) => item.type === "step")
  return graph.nodes.filter((item, idx) => {
    if (item.type === "session" && item.id === "session-start") return true
    if (item.type !== "agent_route") return false
    return first === -1 ? true : idx < first
  })
}

function flow(graph: ExecutionGraph.Graph, step: ExecutionGraph.Node) {
  const seen = new Set<string>()
  return kids(graph, step.id).flatMap((item) => {
    if (seen.has(item.id)) return []
    seen.add(item.id)
    if (item.type !== "tool_call") return [item]
    const res = pair(graph, item.id)
    if (!res || seen.has(res.id)) return [item]
    seen.add(res.id)
    return [item, res]
  })
}

function branch(graph: ExecutionGraph.Graph, step: ExecutionGraph.Node) {
  const list = flow(graph, step)
  const out = [] as string[]

  for (let idx = 0; idx < list.length; idx++) {
    const item = list[idx]
    if (item.type !== "tool_call") {
      out.push(`[${item.label}]`)
      continue
    }

    const res = pair(graph, item.id)
    if (!res) {
      out.push(`[${item.label}]`)
      continue
    }

    if (list[idx + 1]?.id === res.id) idx += 1
    out.push(`[${item.label}] => [${res.label}]`)
  }

  return out
}

export namespace GraphFormat {
  export type TimelineLine = {
    kind: "heading" | "meta" | "step" | "route" | "tool" | "llm" | "error"
    text: string
  }

  export const TopologyHeading = z
    .object({
      kind: z.literal("heading"),
      text: z.string(),
    })
    .meta({ ref: "ExecutionGraphTopologyHeading" })
  export type TopologyHeading = z.output<typeof TopologyHeading>

  export const TopologyPath = z
    .object({
      kind: z.literal("path"),
      text: z.string(),
      nodes: z.string().array(),
    })
    .meta({ ref: "ExecutionGraphTopologyPath" })
  export type TopologyPath = z.output<typeof TopologyPath>

  export const TopologyStep = z
    .object({
      kind: z.literal("step"),
      text: z.string(),
      stepIndex: z.number(),
      nodes: z.string().array(),
    })
    .meta({ ref: "ExecutionGraphTopologyStep" })
  export type TopologyStep = z.output<typeof TopologyStep>

  export const TopologyPair = z
    .object({
      kind: z.literal("pair"),
      text: z.string(),
      call: z.string(),
      result: z.string(),
    })
    .meta({ ref: "ExecutionGraphTopologyPair" })
  export type TopologyPair = z.output<typeof TopologyPair>

  export const TopologyLine = z
    .discriminatedUnion("kind", [TopologyHeading, TopologyPath, TopologyStep, TopologyPair])
    .meta({ ref: "ExecutionGraphTopologyLine" })
  export type TopologyLine = z.output<typeof TopologyLine>

  export const TopologyResponse = z
    .object({
      data: TopologyLine.array(),
    })
    .meta({ ref: "ExecutionGraphTopologyResponse" })
  export type TopologyResponse = z.output<typeof TopologyResponse>

  export function json(graph: ExecutionGraph.Graph): string {
    return JSON.stringify(graph, null, 2)
  }

  export function timeline(graph: ExecutionGraph.Graph): TimelineLine[] {
    if (graph.nodes.length === 0) return [{ kind: "meta", text: "No execution graph recorded." }]

    const out = [] as TimelineLine[]
    const meta = graph.metadata
    out.push({
      kind: "heading",
      text: `Duration ${formatDuration(meta.duration)} | Risk ${meta.risk.level.toLowerCase()} (${meta.risk.score}/100) | Tokens ${meta.tokens.input}/${meta.tokens.output}`,
    })

    const pre = lead(graph)

    for (const node of pre) {
      if (node.type === "session") out.push({ kind: "meta", text: node.label })
      if (node.type === "agent_route")
        out.push({
          kind: "route",
          text: `${node.label}${node.confidence != null ? ` (confidence ${node.confidence.toFixed(2)})` : ""}`,
        })
    }

    const steps = graph.nodes
      .filter((node) => node.type === "step")
      .sort((a, b) => (a.stepIndex ?? 0) - (b.stepIndex ?? 0))

    for (const step of steps) {
      const dur = step.duration != null ? ` | ${formatDuration(step.duration)}` : ""
      const tok = step.tokens ? ` | tokens ${step.tokens.input}/${step.tokens.output}` : ""
      out.push({ kind: "step", text: `Step ${step.stepIndex}${dur}${tok}` })

      for (const kid of kids(graph, step.id)) {
        if (kid.type === "agent_route") {
          out.push({
            kind: "route",
            text: `${kid.label}${kid.confidence != null ? ` (confidence ${kid.confidence.toFixed(2)})` : ""}`,
          })
          continue
        }

        if (kid.type === "tool_call") {
          const next = pair(graph, kid.id)
          const status = next?.status === "error" ? "ERR" : next ? "ok" : "pending"
          const dur = next?.duration != null ? ` (${next.duration}ms)` : ""
          out.push({ kind: "tool", text: `${kid.label} -> ${status}${dur}` })
          continue
        }

        if (kid.type === "llm") {
          out.push({ kind: "llm", text: kid.label })
          continue
        }

        if (kid.type === "error") out.push({ kind: "error", text: kid.label })
      }
    }

    return out
  }

  export function topologyLines(graph: ExecutionGraph.Graph): TopologyLine[] {
    if (graph.nodes.length === 0) return [{ kind: "heading", text: "No execution graph recorded." }]

    const out = [] as TopologyLine[]
    const meta = graph.metadata
    out.push({
      kind: "heading",
      text: `Duration ${formatDuration(meta.duration)} | Steps ${meta.steps} | Tools ${meta.tools.length} | Errors ${meta.errors}`,
    })

    const steps = graph.nodes
      .filter((item) => item.type === "step")
      .sort((a, b) => (a.stepIndex ?? 0) - (b.stepIndex ?? 0))
    const path = [...lead(graph).map((item) => item.label), ...steps.flatMap((item) => [item.label, ...flow(graph, item).map((next) => next.label)])]

    if (path.length > 0) {
      out.push({
        kind: "path",
        text: `Critical path: ${path.join(" → ")}`,
        nodes: path,
      })
    }

    for (const step of steps) {
      const list = flow(graph, step)
      if (list.length === 0) continue
      const idx = step.stepIndex ?? 0
      out.push({
        kind: "step",
        stepIndex: idx,
        text: `Step ${idx} flow: ${list.map((item) => item.label).join(" → ")}`,
        nodes: list.map((item) => item.label),
      })
    }

    for (const call of graph.nodes.filter((item) => item.type === "tool_call").sort((a, b) => a.timestamp - b.timestamp)) {
      const res = pair(graph, call.id)
      if (!res) continue
      out.push({
        kind: "pair",
        text: `Call/result: ${call.label} → ${res.label}`,
        call: call.label,
        result: res.label,
      })
    }

    return out
  }

  export function topology(graph: ExecutionGraph.Graph): string[] {
    return topologyLines(graph).map((item) => item.text)
  }

  export function ascii(graph: ExecutionGraph.Graph): string[] {
    if (graph.nodes.length === 0) return ["No execution graph recorded."]

    const out = [] as string[]
    const meta = graph.metadata
    out.push(
      `Duration ${formatDuration(meta.duration)} | Risk ${meta.risk.level.toLowerCase()} (${meta.risk.score}/100) | Tokens ${meta.tokens.input}/${meta.tokens.output}`,
    )

    const pre = lead(graph)
    const steps = graph.nodes
      .filter((item) => item.type === "step")
      .sort((a, b) => (a.stepIndex ?? 0) - (b.stepIndex ?? 0))

    if (steps.length === 0) {
      if (pre.length > 0) out.push(pre.map((item) => `[${item.label}]`).join(" -> "))
      return out
    }

    for (const step of steps) {
      const head = [...pre.map((item) => item.label), step.label]
      const line = head.map((item) => `[${item}]`).join(" -> ")
      out.push(line)

      const list = branch(graph, step)
      const stem = head
        .slice(0, -1)
        .map((item) => `[${item}]`)
        .join(" -> ")
      const pad = " ".repeat(stem.length === 0 ? 0 : stem.length + 4)

      list.forEach((item, idx) => {
        out.push(`${pad}${idx === list.length - 1 ? "`->" : "|->"} ${item}`)
      })
    }

    return out
  }

  export function mermaid(graph: ExecutionGraph.Graph): string {
    if (graph.nodes.length === 0) return "graph TD\n  empty[No events recorded]"

    const lines: string[] = ["graph TD"]
    const errors: string[] = []
    const sessions: string[] = []
    const steps: string[] = []
    const routes: string[] = []

    // Emit nodes
    for (const node of graph.nodes) {
      const label = sanitize(node.label)
      const id = node.id.replace(/[^a-zA-Z0-9_-]/g, "_")

      switch (node.type) {
        case "session":
          lines.push(`  ${id}([${label}])`)
          sessions.push(id)
          break
        case "step":
          lines.push(`  ${id}(${label})`)
          steps.push(id)
          break
        case "tool_call":
          lines.push(`  ${id}[${label}]`)
          break
        case "tool_result": {
          const dur = node.duration != null ? ` ${node.duration}ms` : ""
          lines.push(`  ${id}[${label}${dur}]`)
          if (node.status === "error") errors.push(id)
          break
        }
        case "llm":
          lines.push(`  ${id}{{${label}}}`)
          break
        case "agent_route":
          lines.push(`  ${id}[/${label}/]`)
          routes.push(id)
          break
        case "error":
          lines.push(`  ${id}[${label}]`)
          errors.push(id)
          break
      }
    }

    lines.push("")

    // Emit edges — only sequence and call_result (step_contains adds clutter in Mermaid)
    for (const edge of graph.edges) {
      if (edge.type === "step_contains") continue
      const from = edge.from.replace(/[^a-zA-Z0-9_-]/g, "_")
      const to = edge.to.replace(/[^a-zA-Z0-9_-]/g, "_")
      if (edge.type === "call_result") {
        lines.push(`  ${from} ==> ${to}`)
      } else {
        lines.push(`  ${from} --> ${to}`)
      }
    }

    // Styles
    lines.push("")
    lines.push("  classDef error fill:#ef4444,stroke:#dc2626,color:#fff")
    lines.push("  classDef session fill:#22c55e,stroke:#16a34a,color:#fff")
    lines.push("  classDef step fill:#3b82f6,stroke:#2563eb,color:#fff")
    lines.push("  classDef route fill:#a855f7,stroke:#9333ea,color:#fff")

    if (errors.length > 0) lines.push(`  class ${errors.join(",")} error`)
    if (sessions.length > 0) lines.push(`  class ${sessions.join(",")} session`)
    if (steps.length > 0) lines.push(`  class ${steps.join(",")} step`)
    if (routes.length > 0) lines.push(`  class ${routes.join(",")} route`)

    return lines.join("\n")
  }

  export function markdown(graph: ExecutionGraph.Graph): string {
    if (graph.nodes.length === 0) return "No events recorded for this session."

    const lines: string[] = []
    const m = graph.metadata

    // Header
    lines.push(`## Session ${graph.sessionID}`)
    lines.push("")
    lines.push(
      `Duration: ${formatDuration(m.duration)} | Risk: ${m.risk.level} (${m.risk.score}/100) | Tokens: ${m.tokens.input.toLocaleString()} in / ${m.tokens.output.toLocaleString()} out`,
    )
    if (m.agents.length > 0) lines.push(`Agents: ${m.agents.join(", ")}`)
    if (m.errors > 0) lines.push(`Errors: ${m.errors}`)
    lines.push("")

    // Group nodes by step
    const stepIndices = graph.nodes
      .filter((n) => n.type === "step")
      .map((n) => n.stepIndex!)
      .sort((a, b) => a - b)

    const preStep = lead(graph)

    for (const node of preStep) {
      if (node.type === "session") {
        lines.push(`**${node.label}**`)
      }
      if (node.type === "agent_route") {
        const conf = node.confidence != null ? ` (confidence: ${node.confidence.toFixed(2)})` : ""
        lines.push(`Route: ${node.label}${conf}`)
      }
    }
    if (preStep.length > 0) lines.push("")

    // Collect step_contains edges for grouping
    for (const idx of stepIndices) {
      const stepNode = graph.nodes.find((n) => n.id === `step-${idx}`)
      if (!stepNode) continue

      const dur = stepNode.duration != null ? ` (${formatDuration(stepNode.duration)})` : ""
      const tok = stepNode.tokens ? ` | tokens: ${stepNode.tokens.input}/${stepNode.tokens.output}` : ""
      lines.push(`### Step ${idx}${dur}${tok}`)
      lines.push("")

      const children = kids(graph, stepNode.id)

      // Show agent routes within this step
      const stepRoutes = children.filter((n) => n.type === "agent_route")
      for (const route of stepRoutes) {
        const conf = route.confidence != null ? ` (confidence: ${route.confidence.toFixed(2)})` : ""
        lines.push(`- **Route:** ${route.label}${conf}`)
      }

      // Show tool calls paired with results
      const calls = children.filter((n) => n.type === "tool_call")
      for (const call of calls) {
        const result = pair(graph, call.id)
        const status = result?.status === "error" ? "ERR" : result ? "ok" : "pending"
        const dur = result?.duration != null ? ` (${result.duration}ms)` : ""
        lines.push(`- ${call.label} \u2192 ${status}${dur}`)
      }

      // Show LLM responses
      const llms = children.filter((n) => n.type === "llm")
      for (const llm of llms) {
        lines.push(`- ${llm.label}`)
      }

      // Show errors
      const errs = children.filter((n) => n.type === "error")
      for (const err of errs) {
        lines.push(`- **ERROR:** ${err.label}`)
      }

      lines.push("")
    }

    // Risk breakdown
    lines.push("### Risk Assessment")
    lines.push("")
    lines.push(`- **Level:** ${m.risk.level} (${m.risk.score}/100)`)
    lines.push(`- **Summary:** ${m.risk.summary}`)
    lines.push("")

    return lines.join("\n")
  }
}
