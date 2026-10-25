import type { WikiGraphModules } from "@ax-code/ax-wiki/graph"
import type { ModuleAnalysis } from "./modules-view.js"

export type ModuleBlock = { id: string; members: string[]; cycle: boolean; x: number; y: number; height: number }
export type ModuleConnection = { from: string; to: string; imports: number; pairs: WikiGraphModules["dependencies"] }

/** Condense recorded cycles into cards; the existing dependency levels supply the horizontal order. */
export function moduleDiagram(
  modules: WikiGraphModules,
  analysis: ModuleAnalysis,
  expanded: ReadonlySet<string> = new Set(),
) {
  const visible = new Set(analysis.order)
  const assigned = new Set<string>()
  const blocks: ModuleBlock[] = []
  const columns = new Map<number, number>()
  const maxLevel = Math.max(0, ...analysis.order.map((path) => analysis.levels.get(path) ?? 0))
  for (const path of analysis.order) {
    if (assigned.has(path)) continue
    const cycle = analysis.cycles.find((members) => members.includes(path))
    const members = (cycle ?? [path]).filter((member) => visible.has(member)).sort()
    for (const member of members) assigned.add(member)
    const id = members[0]
    const column = maxLevel - (analysis.levels.get(path) ?? 0)
    const height = cycle ? (expanded.has(id) ? 58 + members.length * 30 : 78) : 64
    const y = columns.get(column) ?? 24
    blocks.push({ id, members, cycle: cycle !== undefined, x: 24 + column * 310, y, height })
    columns.set(column, y + height + 38)
  }
  const blockOf = new Map(blocks.flatMap((block) => block.members.map((member) => [member, block.id] as const)))
  const connections = new Map<string, ModuleConnection>()
  for (const pair of modules.dependencies) {
    const from = blockOf.get(pair.from),
      to = blockOf.get(pair.to)
    if (from === undefined || to === undefined) continue
    const key = `${from}\0${to}`
    const edge = connections.get(key) ?? { from, to, imports: 0, pairs: [] }
    edge.imports += pair.imports
    edge.pairs.push(pair)
    connections.set(key, edge)
  }
  return {
    blocks,
    connections: [...connections.values()],
    width: Math.max(300, 24 + maxLevel * 310 + 250),
    height: Math.max(150, ...columns.values()),
  }
}

const NS = "http://www.w3.org/2000/svg"

export function renderModuleDiagram(
  doc: Document,
  modules: WikiGraphModules,
  analysis: ModuleAnalysis,
  options: {
    signal: AbortSignal
    onGroup(path: string): void
    onImports(pairs: WikiGraphModules["dependencies"]): void
  },
): HTMLElement {
  const host = doc.createElement("div")
  host.className = "module-diagram"
  const expanded = new Set<string>()
  const measure = doc.createElement("canvas").getContext?.("2d")
  if (measure) measure.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif'
  const fitText = (text: string, tail = false) => {
    const chars = Array.from(text)
    const width = (value: string) => measure?.measureText(value).width ?? Array.from(value).length * 11
    if (width(text) <= 206) return text
    while (chars.length) {
      if (tail) chars.shift()
      else chars.pop()
      const value = tail ? `…${chars.join("")}` : `${chars.join("")}…`
      if (width(value) <= 206) return value
    }
    return "…"
  }
  let renderAbort = new AbortController()
  options.signal.addEventListener("abort", () => renderAbort.abort(), { once: true })
  function render(focusId?: string) {
    renderAbort.abort()
    renderAbort = new AbortController()
    if (options.signal.aborted) return
    host.replaceChildren()
    const data = moduleDiagram(modules, analysis, expanded)
    const scroll = doc.createElement("div")
    scroll.className = "scroll"
    const chart = doc.createElementNS(NS, "svg")
    chart.setAttribute("class", "chart dependency-diagram")
    chart.setAttribute("width", String(data.width))
    chart.setAttribute("height", String(data.height))
    chart.setAttribute("viewBox", `0 0 ${data.width} ${data.height}`)
    chart.setAttribute("role", "group")
    chart.setAttribute("aria-label", "Recorded module imports; arrows point from importer to dependency")
    scroll.append(chart)
    host.append(scroll)
    const node = <T extends keyof SVGElementTagNameMap>(
      tag: T,
      attrs: Record<string, string>,
      parent: SVGElement = chart,
    ) => {
      const element = doc.createElementNS(NS, tag)
      for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value)
      parent.append(element)
      return element
    }
    const action = (element: SVGElement, label: string, run: () => void) => {
      element.setAttribute("role", "button")
      element.setAttribute("tabindex", "0")
      element.setAttribute("aria-label", label)
      node("title", {}, element).textContent = label
      element.addEventListener("click", run, { signal: renderAbort.signal })
      element.addEventListener(
        "keydown",
        (event) => {
          if (event.key !== "Enter" && event.key !== " ") return
          event.preventDefault()
          run()
        },
        { signal: renderAbort.signal },
      )
    }
    const byId = new Map(data.blocks.map((block) => [block.id, block]))
    for (const edge of data.connections) {
      if (edge.from === edge.to) continue
      const from = byId.get(edge.from)!,
        to = byId.get(edge.to)!
      const x1 = from.x + 230,
        y1 = from.y + 32,
        x2 = to.x,
        y2 = to.y + 32
      const middle = (x1 + x2) / 2
      const group = node("g", { class: "module-link" })
      const d = `M${x1},${y1} C${middle},${y1} ${middle},${y2} ${x2},${y2}`
      node("path", { d, class: "link-hit" }, group)
      node("path", { d, class: "link-line" }, group)
      node("path", { d: `M${x2 - 8},${y2 - 4} L${x2},${y2} L${x2 - 8},${y2 + 4}`, class: "link-line" }, group)
      node("text", { x: String(middle), y: String((y1 + y2) / 2 - 6), class: "edge-count" }, group).textContent =
        String(edge.imports)
      const label = `${from.members.join(", ") || "(root)"} imports ${to.members.join(", ") || "(root)"}: ${edge.imports} recorded imports`
      action(group, label, () => options.onImports(edge.pairs))
    }
    for (const block of data.blocks) {
      const card = node("g", { class: `module-card${block.cycle ? " cycle-card" : ""}`, "data-block": block.id })
      node(
        "rect",
        { x: String(block.x), y: String(block.y), width: "230", height: String(block.height), rx: "10" },
        card,
      )
      const title = block.cycle ? `Cycle · ${block.members.length} modules` : block.members[0] || "(repository root)"
      node("text", { x: String(block.x + 12), y: String(block.y + 23), "text-anchor": "start" }, card).textContent =
        fitText(title)
      if (block.cycle) {
        const internal = data.connections.find((edge) => edge.from === block.id && edge.to === block.id)
        const toggle = node(
          "g",
          { class: "cycle-toggle", "data-cycle": block.id, "aria-expanded": String(expanded.has(block.id)) },
          card,
        )
        node(
          "rect",
          { x: String(block.x + 8), y: String(block.y + 30), width: "212", height: "26", class: "hit" },
          toggle,
        )
        node("text", { x: String(block.x + 12), y: String(block.y + 48), "text-anchor": "start" }, toggle).textContent =
          `${expanded.has(block.id) ? "Collapse" : "Expand"} cycle · ${internal?.imports ?? 0} imports`
        action(toggle, `${expanded.has(block.id) ? "Collapse" : "Expand"} cycle: ${block.members.join(", ")}`, () => {
          if (expanded.has(block.id)) expanded.delete(block.id)
          else expanded.add(block.id)
          if (internal) options.onImports(internal.pairs)
          render(block.id)
        })
        if (expanded.has(block.id))
          block.members.forEach((path, index) => {
            const row = node("g", { class: "module-member" }, card)
            node(
              "rect",
              {
                x: String(block.x + 8),
                y: String(block.y + 58 + index * 30),
                width: "212",
                height: "28",
                class: "hit",
              },
              row,
            )
            node(
              "text",
              { x: String(block.x + 12), y: String(block.y + 76 + index * 30), "text-anchor": "start" },
              row,
            ).textContent = fitText(path || "(root)", true)
            action(row, `Inspect module ${path || "(root)"}`, () => options.onGroup(path))
          })
      } else {
        const files = modules.groups.find((group) => group.path === block.id)?.files ?? 0
        node(
          "text",
          { x: String(block.x + 12), y: String(block.y + 45), "text-anchor": "start", class: "module-meta" },
          card,
        ).textContent = `${files} cited files · inspect`
        action(card, `Inspect module ${block.id || "(root)"}`, () => options.onGroup(block.id))
      }
    }
    if (focusId !== undefined) {
      const toggle = [...chart.querySelectorAll<SVGGElement>(".cycle-toggle")].find(
        (element) => element.dataset.cycle === focusId,
      )
      toggle?.focus()
    }
  }
  render()
  return host
}
