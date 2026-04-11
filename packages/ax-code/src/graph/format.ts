import type { ExecutionGraph } from "./index"

function sanitize(label: string): string {
  return label.replace(/"/g, "'").replace(/[<>{}|]/g, "_").replace(/\n/g, " ")
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

export namespace GraphFormat {
  export function json(graph: ExecutionGraph.Graph): string {
    return JSON.stringify(graph, null, 2)
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
    lines.push(`Duration: ${formatDuration(m.duration)} | Risk: ${m.risk.level} (${m.risk.score}/100) | Tokens: ${m.tokens.input.toLocaleString()} in / ${m.tokens.output.toLocaleString()} out`)
    if (m.agents.length > 0) lines.push(`Agents: ${m.agents.join(", ")}`)
    if (m.errors > 0) lines.push(`Errors: ${m.errors}`)
    lines.push("")

    // Group nodes by step
    const stepIndices = graph.nodes
      .filter((n) => n.type === "step")
      .map((n) => n.stepIndex!)
      .sort((a, b) => a - b)

    // Nodes before any step (session start, initial routing)
    const preStep = graph.nodes.filter((n) => {
      if (n.type === "session" && n.id === "session-start") return true
      if (n.type === "agent_route") {
        const firstStep = graph.nodes.find((s) => s.type === "step")
        return firstStep ? n.timestamp < firstStep.timestamp : true
      }
      return false
    })

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
    const contained = new Map<string, string[]>()
    for (const edge of graph.edges) {
      if (edge.type !== "step_contains") continue
      const list = contained.get(edge.from) ?? []
      list.push(edge.to)
      contained.set(edge.from, list)
    }

    for (const idx of stepIndices) {
      const stepNode = graph.nodes.find((n) => n.id === `step-${idx}`)
      if (!stepNode) continue

      const dur = stepNode.duration != null ? ` (${formatDuration(stepNode.duration)})` : ""
      const tok = stepNode.tokens ? ` | tokens: ${stepNode.tokens.input}/${stepNode.tokens.output}` : ""
      lines.push(`### Step ${idx}${dur}${tok}`)
      lines.push("")

      const childIDs = contained.get(stepNode.id) ?? []
      const children = childIDs
        .map((id) => graph.nodes.find((n) => n.id === id))
        .filter((n): n is ExecutionGraph.Node => !!n)
        .sort((a, b) => a.timestamp - b.timestamp)

      // Show agent routes within this step
      const stepRoutes = children.filter((n) => n.type === "agent_route")
      for (const route of stepRoutes) {
        const conf = route.confidence != null ? ` (confidence: ${route.confidence.toFixed(2)})` : ""
        lines.push(`- **Route:** ${route.label}${conf}`)
      }

      // Show tool calls paired with results
      const calls = children.filter((n) => n.type === "tool_call")
      for (const call of calls) {
        const resultEdge = graph.edges.find((e) => e.from === call.id && e.type === "call_result")
        const result = resultEdge ? graph.nodes.find((n) => n.id === resultEdge.to) : undefined
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
