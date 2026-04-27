import z from "zod"
import type { ExecutionGraph } from "./index"

const AGENT_DISPLAY: Record<string, string> = {
  build: "Dev",
  plan: "Planner",
  react: "Reasoner",
  general: "Assistant",
  explore: "Researcher",
  security: "Security",
  architect: "Architect",
  debug: "Debugger",
  perf: "Perf",
  devops: "DevOps",
  test: "Tester",
}

function agentDisplayName(name: string): string {
  return AGENT_DISPLAY[name] ?? name.charAt(0).toUpperCase() + name.slice(1)
}

// Summarise what a step primarily did from its tool_call children
function stepActivity(graph: ExecutionGraph.Graph, stepId: string): string {
  const children = graph.edges
    .filter((e) => e.from === stepId && e.type === "step_contains")
    .map((e) => graph.nodes.find((n) => n.id === e.to))
    .filter((n): n is ExecutionGraph.Node => n?.type === "tool_call")

  const cats: Record<string, number> = {}
  for (const child of children) {
    const n = (child.tool ?? child.label).toLowerCase()
    let cat: string
    if (/^(read|view|cat)$/.test(n)) cat = "read"
    else if (/^(edit|write|apply_patch|multiedit|patch)$/.test(n)) cat = "edit"
    else if (/^(grep|glob|search|find|code_intelligence|semantic)/.test(n)) cat = "search"
    else if (/^(bash|run|exec|shell)$/.test(n)) cat = "bash"
    else if (/^(web_fetch|web_search|fetch)/.test(n)) cat = "web"
    else cat = n.slice(0, 8)
    cats[cat] = (cats[cat] ?? 0) + 1
  }

  return Object.entries(cats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cat, count]) => (count > 1 ? `${cat}×${count}` : cat))
    .join(", ")
}

function sanitize(label: string): string {
  return label
    .replace(/"/g, "'")
    .replace(/[<>{}|[\]()]/g, "_")
    .replace(/\n/g, " ")
}

function sanitizeId(id: string): string {
  const clean = id.replace(/[^a-zA-Z0-9_]/g, "_")
  return /^[0-9]/.test(clean) ? "n" + clean : clean
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

    for (const n of pre) {
      if (n.type === "session") out.push({ kind: "meta", text: n.label })
      if (n.type === "agent_route")
        out.push({
          kind: "route",
          text: `${n.label}${n.confidence != null ? ` (confidence ${n.confidence.toFixed(2)})` : ""}`,
        })
    }

    const steps = graph.nodes.filter((n) => n.type === "step").sort((a, b) => (a.stepIndex ?? 0) - (b.stepIndex ?? 0))

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
    const criticalPath = [
      ...lead(graph).map((item) => item.label),
      ...steps.flatMap((item) => [item.label, ...flow(graph, item).map((next) => next.label)]),
    ]

    if (criticalPath.length > 0) {
      out.push({
        kind: "path",
        text: `Critical path: ${criticalPath.join(" \u2192 ")}`,
        nodes: criticalPath,
      })
    }

    for (const step of steps) {
      const list = flow(graph, step)
      if (list.length === 0) continue
      const idx = step.stepIndex ?? 0
      out.push({
        kind: "step",
        stepIndex: idx,
        text: `Step ${idx} flow: ${list.map((item) => item.label).join(" \u2192 ")}`,
        nodes: list.map((item) => item.label),
      })
    }

    for (const call of graph.nodes
      .filter((item) => item.type === "tool_call")
      .sort((a, b) => a.timestamp - b.timestamp)) {
      const res = pair(graph, call.id)
      if (!res) continue
      out.push({
        kind: "pair",
        text: `Call/result: ${call.label} \u2192 ${res.label}`,
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
        out.push(`${pad}${idx === list.length - 1 ? "\`->" : "|->"} ${item}`)
      })
    }

    return out
  }

  export function mermaid(graph: ExecutionGraph.Graph): string {
    if (graph.nodes.length === 0) return "graph LR\n  empty[No events recorded]"

    // High-level only: session, step, agent_route — skip tool_call/tool_result/llm/error
    const allowed = new Set(["session", "step", "agent_route"])

    const lines: string[] = ["graph LR"]
    const errors: string[] = []
    const sessions: string[] = []
    const steps: string[] = []
    const routes: string[] = []

    // Pre-compute tool counts and error flags per step
    const toolCount = new Map<string, number>()
    const stepHasError = new Map<string, boolean>()
    for (const edge of graph.edges) {
      if (edge.type !== "step_contains") continue
      toolCount.set(edge.from, (toolCount.get(edge.from) ?? 0) + 1)
      const child = graph.nodes.find((n) => n.id === edge.to)
      if (child?.status === "error") stepHasError.set(edge.from, true)
    }

    for (const n of graph.nodes) {
      if (!allowed.has(n.type)) continue
      const id = sanitizeId(n.id)

      switch (n.type) {
        case "session": {
          // Shorten: "Start (dev)" → "Start"  /  "End (done)" → "End"
          const label = sanitize(n.label.replace(/\s*\(.*\)$/, "").trim() || n.label)
          lines.push(`  ${id}([${label}])`)
          sessions.push(id)
          break
        }
        case "step": {
          const count = toolCount.get(n.id) ?? 0
          const dur = n.duration != null ? ` · ${formatDuration(n.duration)}` : ""
          const label = count > 0 ? `Step ${n.stepIndex} · ${count} tools${dur}` : `Step ${n.stepIndex ?? ""}${dur}`
          lines.push(`  ${id}[${sanitize(label)}]`)
          steps.push(id)
          if (stepHasError.get(n.id)) errors.push(id)
          break
        }
        case "agent_route": {
          // Use agent name only, drop confidence suffix — hexagon = decision/routing point
          const label = sanitize((n.agent ?? n.label).split("(")[0].trim())
          lines.push(`  ${id}{{${label}}}`)
          routes.push(id)
          break
        }
      }
    }

    lines.push("")

    // Only sequence edges between high-level nodes
    for (const edge of graph.edges) {
      if (edge.type !== "sequence") continue
      const fromNode = graph.nodes.find((n) => n.id === edge.from)
      const toNode = graph.nodes.find((n) => n.id === edge.to)
      if (!fromNode || !toNode) continue
      if (!allowed.has(fromNode.type) || !allowed.has(toNode.type)) continue
      lines.push(`  ${sanitizeId(edge.from)} --> ${sanitizeId(edge.to)}`)
    }

    lines.push("")
    lines.push("  classDef error fill:#450a0a,stroke:#f87171,color:#fecaca")
    lines.push("  classDef session fill:#052e16,stroke:#4ade80,color:#bbf7d0")
    lines.push("  classDef step fill:#172554,stroke:#60a5fa,color:#bfdbfe")
    lines.push("  classDef route fill:#2e1065,stroke:#c084fc,color:#e9d5ff")

    if (errors.length > 0) lines.push(`  class ${errors.join(",")} error`)
    if (sessions.length > 0) lines.push(`  class ${sessions.join(",")} session`)
    if (steps.length > 0) lines.push(`  class ${steps.join(",")} step`)
    if (routes.length > 0) lines.push(`  class ${routes.join(",")} route`)

    return lines.join("\n")
  }

  export function gantt(graph: ExecutionGraph.Graph): string {
    const steps = graph.nodes.filter((n) => n.type === "step" && n.duration != null)
    if (steps.length === 0) return "graph LR\n  empty[No execution data yet]"

    const sessionStart = graph.nodes.reduce((min, n) => Math.min(min, n.timestamp), Infinity)
    const totalDur = formatDuration(graph.metadata.duration)

    const lines: string[] = [
      "gantt",
      `  title Execution · ${totalDur} · ${graph.metadata.steps} step${graph.metadata.steps === 1 ? "" : "s"}`,
      "  dateFormat x",
      "  axisFormat %M:%S",
    ]

    // Walk nodes in timestamp order to detect agent changes
    const sorted = [...graph.nodes].sort((a, b) => a.timestamp - b.timestamp)
    let currentAgent = graph.metadata.agents[0] ?? "agent"
    let lastSection = ""

    // Pre-compute tool counts per step
    const toolCount = new Map<string, number>()
    for (const edge of graph.edges) {
      if (edge.type !== "step_contains") continue
      toolCount.set(edge.from, (toolCount.get(edge.from) ?? 0) + 1)
    }

    for (const node of sorted) {
      if (node.type === "agent_route" && node.agent) currentAgent = node.agent
      if (node.type !== "step" || node.duration == null) continue

      const section = agentDisplayName(currentAgent.split("(")[0].trim())
      if (section !== lastSection) {
        lines.push(`  section ${section}`)
        lastSection = section
      }

      const activity = stepActivity(graph, node.id)
      const durLabel = formatDuration(node.duration)
      const label = activity
        ? `Step ${node.stepIndex} · ${activity} · ${durLabel}`
        : `Step ${node.stepIndex} · ${toolCount.get(node.id) ?? 0} tools · ${durLabel}`
      const relStart = node.timestamp - sessionStart
      const relEnd = relStart + node.duration
      const modifier = node.status === "error" ? "crit, " : node.status === "pending" ? "active, " : ""

      lines.push(`    ${label} : ${modifier}${relStart}, ${relEnd}`)
    }

    return lines.join("\n")
  }

  export function svgGantt(graph: ExecutionGraph.Graph): string {
    const steps = [...graph.nodes].filter((n) => n.type === "step").sort((a, b) => a.timestamp - b.timestamp)

    const escSvg = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

    if (steps.length === 0) {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 56" style="width:100%;display:block"><text x="16" y="34" fill="var(--muted)" font-size="13" font-style="italic" font-family="system-ui,sans-serif">No execution data yet</text></svg>`
    }

    const sessionStart = Math.min(...graph.nodes.map((n) => n.timestamp))
    const totalDur = Math.max(graph.metadata.duration, 1)

    // Detect which agent ran each step
    const sorted = [...graph.nodes].sort((a, b) => a.timestamp - b.timestamp)
    let curAgent = graph.metadata.agents[0] ?? "agent"
    const stepAgent = new Map<string, string>()
    for (const n of sorted) {
      if (n.type === "agent_route" && n.agent) curAgent = n.agent
      if (n.type === "step") stepAgent.set(n.id, curAgent)
    }

    const LABEL_W = 76
    const PAD_R = 12
    const HEADER_H = 26
    const ROW_H = 40
    const BAR_H = 22
    const BAR_V = (ROW_H - BAR_H) / 2
    const RX = 4
    const VIEW_W = 760

    const barAreaW = VIEW_W - LABEL_W - PAD_R
    const svgH = HEADER_H + steps.length * ROW_H + 8

    const toX = (ms: number) => LABEL_W + (ms / totalDur) * barAreaW

    const out: string[] = [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_W} ${svgH}" style="width:100%;height:auto;display:block">`,
      `<style>text{font-family:system-ui,ui-sans-serif,sans-serif}</style>`,
      // Gradient defs — subtle fade right for bar depth
      `<defs>`,
      `<linearGradient id="bg-normal" x1="0" x2="1" y1="0" y2="0"><stop offset="0%" stop-color="var(--accent)" stop-opacity="1"/><stop offset="100%" stop-color="var(--accent)" stop-opacity="0.6"/></linearGradient>`,
      `<linearGradient id="bg-error" x1="0" x2="1" y1="0" y2="0"><stop offset="0%" stop-color="var(--high)" stop-opacity="1"/><stop offset="100%" stop-color="var(--high)" stop-opacity="0.6"/></linearGradient>`,
      `<linearGradient id="bg-pending" x1="0" x2="1" y1="0" y2="0"><stop offset="0%" stop-color="var(--warn)" stop-opacity="1"/><stop offset="100%" stop-color="var(--warn)" stop-opacity="0.6"/></linearGradient>`,
      `</defs>`,
    ]

    // Header bottom border — clear axis/chart separation
    out.push(
      `<line x1="0" y1="${HEADER_H}" x2="${VIEW_W}" y2="${HEADER_H}" stroke="var(--line-subtle)" stroke-width="1"/>`,
    )

    // Time axis ticks — first/last anchored to edges to prevent clipping
    for (let i = 0; i <= 4; i++) {
      const frac = i / 4
      const x = toX(frac * totalDur).toFixed(1)
      const anchor = i === 0 ? "start" : i === 4 ? "end" : "middle"
      out.push(
        `<line x1="${x}" y1="${HEADER_H}" x2="${x}" y2="${svgH - 8}" stroke="var(--line-subtle)" stroke-width="1" stroke-dasharray="4 4"/>`,
      )
      out.push(
        `<text x="${x}" y="17" text-anchor="${anchor}" font-size="10" fill="var(--muted)">${escSvg(formatDuration(frac * totalDur))}</text>`,
      )
    }

    // Left column divider
    out.push(
      `<line x1="${LABEL_W}" y1="${HEADER_H}" x2="${LABEL_W}" y2="${svgH - 8}" stroke="var(--line-subtle)" stroke-width="1"/>`,
    )

    let prevAgentKey = ""
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]
      const rowY = HEADER_H + i * ROW_H
      const agentKey = (stepAgent.get(step.id) ?? curAgent).split("(")[0].trim()
      const agLabel = escSvg(agentDisplayName(agentKey))

      // Agent change separator — thin line when agent switches mid-session
      if (agentKey !== prevAgentKey && i > 0) {
        out.push(
          `<line x1="${LABEL_W}" y1="${rowY}" x2="${VIEW_W - PAD_R}" y2="${rowY}" stroke="var(--line)" stroke-width="1" opacity="0.5"/>`,
        )
      }
      prevAgentKey = agentKey

      // Alternating row tint
      if (i % 2 === 1) {
        out.push(`<rect x="0" y="${rowY}" width="${VIEW_W}" height="${ROW_H}" fill="var(--surface)" opacity="0.3"/>`)
      }

      // Left labels
      out.push(
        `<text x="${LABEL_W - 8}" y="${rowY + BAR_V + 13}" text-anchor="end" font-size="11" font-weight="600" fill="var(--text-secondary)">Step ${step.stepIndex ?? i + 1}</text>`,
      )
      out.push(
        `<text x="${LABEL_W - 8}" y="${rowY + BAR_V + 24}" text-anchor="end" font-size="9" fill="var(--muted)">${agLabel}</text>`,
      )

      // Bar
      const relStart = step.timestamp - sessionStart
      const barX = toX(relStart)
      const duration = step.duration ?? 0
      const barW = Math.max(6, (duration / totalDur) * barAreaW)
      const barY = rowY + BAR_V

      const isError = step.status === "error"
      const isPending = step.duration == null
      const gradId = isError ? "bg-error" : isPending ? "bg-pending" : "bg-normal"
      const strokeColor = isError ? "var(--critical)" : isPending ? "var(--warn)" : "var(--accent-light)"

      out.push(
        `<rect x="${barX.toFixed(1)}" y="${barY}" width="${barW.toFixed(1)}" height="${BAR_H}" rx="${RX}" fill="url(#${gradId})" stroke="${strokeColor}" stroke-width="0.75" stroke-opacity="0.4"/>`,
      )

      // Activity text inside bar — pending uses dark text (yellow bg), others white
      if (barW > 52) {
        const act = stepActivity(graph, step.id)
        const labelText = escSvg(isPending ? "in progress…" : act)
        if (labelText) {
          const textFill = isPending ? "rgba(0,0,0,0.8)" : "rgba(255,255,255,0.92)"
          out.push(
            `<clipPath id="bc${i}"><rect x="${barX.toFixed(1)}" y="${barY}" width="${(barW - 10).toFixed(1)}" height="${BAR_H}"/></clipPath>`,
          )
          out.push(
            `<text x="${(barX + 7).toFixed(1)}" y="${barY + 14}" font-size="9.5" font-weight="600" fill="${textFill}" clip-path="url(#bc${i})">${labelText}</text>`,
          )
        }
      }

      // Duration label to the right of bar
      if (duration > 0) {
        const durX = barX + barW + 6
        if (durX < VIEW_W - PAD_R - 22) {
          out.push(
            `<text x="${durX.toFixed(1)}" y="${barY + 14}" font-size="9.5" fill="var(--muted)">${escSvg(formatDuration(duration))}</text>`,
          )
        }
      }
    }

    out.push(`</svg>`)
    return out.join("\n")
  }

  export function markdown(graph: ExecutionGraph.Graph): string {
    if (graph.nodes.length === 0) return "No events recorded for this session."

    const lines: string[] = []
    const m = graph.metadata

    lines.push(`## Session ${graph.sessionID}`)
    lines.push("")
    lines.push(
      `Duration: ${formatDuration(m.duration)} | Risk: ${m.risk.level} (${m.risk.score}/100) | Tokens: ${m.tokens.input.toLocaleString()} in / ${m.tokens.output.toLocaleString()} out`,
    )
    if (m.agents.length > 0) lines.push(`Agents: ${m.agents.join(", ")}`)
    if (m.errors > 0) lines.push(`Errors: ${m.errors}`)
    lines.push("")

    const stepIndices = graph.nodes
      .filter((n) => n.type === "step" && n.stepIndex != null)
      .map((n) => n.stepIndex!)
      .sort((a, b) => a - b)

    const preStep = lead(graph)

    for (const n of preStep) {
      if (n.type === "session") lines.push(`**${n.label}**`)
      if (n.type === "agent_route") {
        const conf = n.confidence != null ? ` (confidence: ${n.confidence.toFixed(2)})` : ""
        lines.push(`Route: ${n.label}${conf}`)
      }
    }
    if (preStep.length > 0) lines.push("")

    for (const idx of stepIndices) {
      const stepNode = graph.nodes.find((n) => n.id === `step-${idx}`)
      if (!stepNode) continue

      const dur = stepNode.duration != null ? ` (${formatDuration(stepNode.duration)})` : ""
      const tok = stepNode.tokens ? ` | tokens: ${stepNode.tokens.input}/${stepNode.tokens.output}` : ""
      lines.push(`### Step ${idx}${dur}${tok}`)
      lines.push("")

      const children = kids(graph, stepNode.id)

      const stepRoutes = children.filter((n) => n.type === "agent_route")
      for (const route of stepRoutes) {
        const conf = route.confidence != null ? ` (confidence: ${route.confidence.toFixed(2)})` : ""
        lines.push(`- **Route:** ${route.label}${conf}`)
      }

      const calls = children.filter((n) => n.type === "tool_call")
      for (const call of calls) {
        const result = pair(graph, call.id)
        const status = result?.status === "error" ? "ERR" : result ? "ok" : "pending"
        const dur = result?.duration != null ? ` (${result.duration}ms)` : ""
        lines.push(`- ${call.label} \u2192 ${status}${dur}`)
      }

      const llms = children.filter((n) => n.type === "llm")
      for (const llm of llms) {
        lines.push(`- ${llm.label}`)
      }

      const errs = children.filter((n) => n.type === "error")
      for (const err of errs) {
        lines.push(`- **ERROR:** ${err.label}`)
      }

      lines.push("")
    }

    lines.push("### Risk Assessment")
    lines.push("")
    lines.push(`- **Level:** ${m.risk.level} (${m.risk.score}/100)`)
    lines.push(`- **Summary:** ${m.risk.summary}`)
    lines.push("")

    return lines.join("\n")
  }
}
