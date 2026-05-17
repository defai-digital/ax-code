import type { ExecutionGraph, ExecutionGraphTopologyLine } from "@ax-code/sdk/v2"

export type Box = {
  id: string
  label: string
  type: ExecutionGraph["nodes"][number]["type"]
  x: number
  y: number
  w: number
  h: number
  lines: string[]
  critical: boolean
}

export type Link = {
  id: string
  from: string
  to: string
  type: ExecutionGraph["edges"][number]["type"]
  x1: number
  y1: number
  x2: number
  y2: number
}

export type Layout = {
  width: number
  height: number
  nodes: Box[]
  edges: Link[]
  path?: string
}

function lane(type: Box["type"]) {
  if (type === "session" || type === "agent_route" || type === "step") return 0
  if (type === "tool_call") return 1
  if (type === "tool_result") return 2
  if (type === "llm") return 3
  return 4
}

function wrap(txt: string, max = 18) {
  const out = [] as string[]
  let row = ""

  for (const part of txt.split(" ")) {
    if (part.length > max) {
      if (row) {
        out.push(row)
        row = ""
      }

      for (let idx = 0; idx < part.length; idx += max) {
        out.push(part.slice(idx, idx + max))
      }
      continue
    }

    const next = row ? `${row} ${part}` : part
    if (next.length <= max) {
      row = next
      continue
    }
    if (row) out.push(row)
    row = part
  }

  if (row) out.push(row)
  return out.slice(0, 3)
}

function marks(topology?: ExecutionGraphTopologyLine[] | null) {
  const out = new Map<string, number>()
  const line = topology?.find((item) => item.kind === "path")
  if (!line || line.kind !== "path") return out
  for (const item of line.nodes) out.set(item, (out.get(item) ?? 0) + 1)
  return out
}

function hit(mark: Map<string, number>, txt: string) {
  const val = mark.get(txt) ?? 0
  if (val <= 0) return false
  mark.set(txt, val - 1)
  return true
}

function path(topology?: ExecutionGraphTopologyLine[] | null) {
  const line = topology?.find((item) => item.kind === "path")
  if (!line || line.kind !== "path") return
  return line.nodes.join(" → ")
}

export function sessionGraphLayout(graph: ExecutionGraph, topology?: ExecutionGraphTopologyLine[] | null): Layout {
  const pad = 24
  const gapx = 88
  const gapy = 76
  const w = 152
  const h = 56
  const mark = marks(topology)

  const nodes = graph.nodes
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((item, idx) => ({
      id: item.id,
      label: item.label,
      type: item.type,
      x: pad + idx * gapx,
      y: pad + lane(item.type) * gapy,
      w,
      h,
      lines: wrap(item.label),
      critical: hit(mark, item.label),
    })) satisfies Box[]

  const by = new Map(nodes.map((item) => [item.id, item]))
  const edges = graph.edges
    .map((item, idx) => {
      const from = by.get(item.from)
      const to = by.get(item.to)
      if (!from || !to) return
      return {
        id: `edge:${idx}`,
        from: item.from,
        to: item.to,
        type: item.type,
        x1: from.x + from.w,
        y1: from.y + from.h / 2,
        x2: to.x,
        y2: to.y + to.h / 2,
      } satisfies Link
    })
    .filter((item): item is Link => !!item)

  const width = nodes.length > 0 ? nodes[nodes.length - 1]!.x + w + pad : pad * 2 + w
  const height = pad * 2 + gapy * 4 + h

  return {
    width,
    height,
    nodes,
    edges,
    path: path(topology),
  }
}
