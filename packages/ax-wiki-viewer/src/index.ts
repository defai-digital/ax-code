import { parseWikiGraph } from "@ax-code/ax-wiki/graph"
import type { WikiGraphNode } from "@ax-code/ax-wiki/graph"

export const viewerCss = `
.axwv{font:14px system-ui,sans-serif;color:#dce6f2;background:#101923;padding:20px;border-radius:12px;box-sizing:border-box}
.axwv *{box-sizing:border-box}.axwv h1{font-size:24px;margin:0 0 8px}.axwv p{line-height:1.5;overflow-wrap:anywhere}
.axwv button,.axwv input,.axwv select{font:inherit;color:inherit;background:#1c2c3c;border:1px solid #64778b;border-radius:6px;padding:8px}
.axwv button{cursor:pointer}.axwv button:hover{background:#30455c}.axwv :focus-visible{outline:3px solid #78dacc;outline-offset:2px}
.axwv .controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:12px 0}.axwv .layout{display:grid;grid-template-columns:minmax(0,2fr) minmax(260px,1fr);gap:16px}
.axwv .canvas{height:520px;overflow:hidden;border:1px solid #64778b;border-radius:8px}.axwv svg{width:100%;height:100%}
.axwv .list{max-height:260px;overflow:auto;padding:0;list-style:none}.axwv .list button{width:100%;text-align:left;margin:3px 0;overflow-wrap:anywhere}
.axwv .detail{white-space:pre-wrap;overflow-wrap:anywhere}.axwv .muted{color:#b5c5d7}.axwv .selected{border-color:#78dacc}
@media(max-width:760px){.axwv .layout{grid-template-columns:1fr}.axwv .canvas{height:360px}}
`

/** An isolated instance; invalid updates preserve the previous view. */
export function mount(element: HTMLElement, input: unknown, options: { injectStyles?: boolean } = {}) {
  let graph = parseWikiGraph(input)
  let selected: string | undefined
  let query = "",
    kind = "all",
    zoom = 1,
    offsetX = 0,
    offsetY = 0,
    disposed = false
  const doc = element.ownerDocument
  const root = doc.createElement("section")
  root.className = "axwv"
  if (options.injectStyles !== false) {
    const style = doc.createElement("style")
    style.textContent = viewerCss
    root.append(style)
  }
  function html<K extends keyof HTMLElementTagNameMap>(tag: K, parent: HTMLElement, value?: string) {
    const el = doc.createElement(tag)
    if (value !== undefined) el.textContent = value
    parent.append(el)
    return el
  }
  html("h1", root, "AX Wiki evidence map")
  html("p", root, "Wiki page → referenced source. Recorded membership, not a code dependency or call graph.")
  const status = html("p", root)
  status.setAttribute("role", "status")
  const identity = html("details", root)
  html("summary", identity, "Snapshot details")
  const identityText = html("p", identity)
  const controls = html("div", root)
  controls.className = "controls"
  const searchLabel = html("label", controls, "Search ")
  const search = html("input", searchLabel)
  search.type = "search"
  search.placeholder = "Page or source path"
  const typeLabel = html("label", controls, "Show ")
  const filter = html("select", typeLabel)
  for (const [value, label] of [
    ["all", "Pages and sources"],
    ["page", "Pages"],
    ["source", "Sources"],
  ]) {
    const option = html("option", filter, label)
    option.value = value
  }
  const reset = html("button", controls, "Show all / reset")
  const layout = html("div", root)
  layout.className = "layout"
  const canvas = html("div", layout)
  canvas.className = "canvas"
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("role", "img")
  svg.setAttribute("aria-label", "Page to source relationships; use the adjacent list for keyboard navigation")
  canvas.append(svg)
  const aside = html("div", layout)
  html("h2", aside, "Explore")
  const list = html("ul", aside)
  list.className = "list"
  const detailHeading = html("h2", aside, "Evidence")
  detailHeading.tabIndex = -1
  const detail = html("p", aside)
  detail.className = "detail"
  const navigation = html("div", root)
  navigation.className = "controls"
  let viewHeight = 500
  function viewBox() {
    svg.setAttribute("viewBox", `${offsetX} ${offsetY} ${900 / zoom} ${viewHeight / zoom}`)
  }
  for (const [label, action] of [
    [
      "Zoom in",
      () => {
        zoom = Math.min(8, zoom * 1.5)
      },
    ],
    [
      "Zoom out",
      () => {
        zoom = Math.max(0.5, zoom / 1.5)
      },
    ],
    [
      "Pan left",
      () => {
        offsetX -= 100 / zoom
      },
    ],
    [
      "Pan right",
      () => {
        offsetX += 100 / zoom
      },
    ],
    [
      "Pan up",
      () => {
        offsetY -= 100 / zoom
      },
    ],
    [
      "Pan down",
      () => {
        offsetY += 100 / zoom
      },
    ],
  ] as const) {
    const button = html("button", navigation, label)
    button.onclick = () => {
      action()
      viewBox()
    }
  }
  function select(node: WikiGraphNode) {
    selected = node.id
    zoom = 1
    offsetX = offsetY = 0
    render()
    detailHeading.focus()
  }
  function render() {
    const neighbors = selected
      ? new Set([
          selected,
          ...graph.edges.filter((e) => e.from === selected || e.to === selected).flatMap((e) => [e.from, e.to]),
        ])
      : undefined
    const nodes = graph.nodes.filter(
      (n) =>
        (!neighbors || neighbors.has(n.id)) &&
        (kind === "all" || n.kind === kind) &&
        (!query || `${n.label} ${n.path}`.toLowerCase().includes(query)),
    )
    const ids = new Set(nodes.map((n) => n.id))
    const edges = graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to))
    status.textContent = `Showing ${nodes.length} of ${graph.nodes.length} nodes and ${edges.length} of ${graph.edges.length} relationships. Not included from the recorded Wiki: ${graph.omitted.nodes} nodes, ${graph.omitted.edges} relationships. Unknown freshness means current sources are unverified.`
    identityText.textContent = `Snapshot: ${graph.snapshot}\nScope: recorded Wiki manifest. Code relationships unavailable.`
    list.replaceChildren()
    svg.replaceChildren()
    const positions = new Map<string, { x: number; y: number }>()
    const counts = { page: 0, source: 0 }
    for (const node of nodes)
      positions.set(node.id, { x: node.kind === "page" ? 40 : 510, y: 35 + counts[node.kind]++ * 45 })
    viewHeight = Math.max(180, Math.max(counts.page, counts.source) * 45 + 40)
    viewBox()
    for (const edge of edges) {
      const a = positions.get(edge.from)!,
        b = positions.get(edge.to)!
      const line = doc.createElementNS(svg.namespaceURI, "path")
      line.setAttribute("d", `M${a.x + 330},${a.y} L${b.x},${b.y}`)
      line.setAttribute("stroke", "#64778b")
      line.setAttribute("fill", "none")
      svg.append(line)
      const arrow = doc.createElementNS(svg.namespaceURI, "path")
      arrow.setAttribute("d", `M${b.x - 8},${b.y - 4} L${b.x},${b.y} L${b.x - 8},${b.y + 4}`)
      arrow.setAttribute("fill", "none")
      arrow.setAttribute("stroke", "#b5c5d7")
      svg.append(arrow)
    }
    for (const node of nodes) {
      const item = html("li", list)
      const button = html("button", item, `${node.kind}: ${node.label} · ${node.freshness}`)
      if (node.id === selected) button.className = "selected"
      button.onclick = () => select(node)
      const p = positions.get(node.id)!
      const group = doc.createElementNS(svg.namespaceURI, "g")
      const rect = doc.createElementNS(svg.namespaceURI, "rect")
      for (const [k, v] of Object.entries({
        x: p.x,
        y: p.y - 16,
        width: 330,
        height: 32,
        rx: 5,
        fill: node.kind === "page" ? "#245d65" : "#30455c",
      }))
        rect.setAttribute(k, String(v))
      const label = doc.createElementNS(svg.namespaceURI, "text")
      label.setAttribute("x", String(p.x + 8))
      label.setAttribute("y", String(p.y + 5))
      label.setAttribute("fill", "#edf6ff")
      label.textContent = `${node.kind === "page" ? "Page → " : "Source: "}${Array.from(node.label).length > 31 ? Array.from(node.label).slice(0, 30).join("") + "…" : node.label}`
      const title = doc.createElementNS(svg.namespaceURI, "title")
      title.textContent = `${node.label} (${node.freshness})`
      group.append(rect, label, title)
      group.addEventListener("click", () => select(node))
      svg.append(group)
    }
    const node = graph.nodes.find((n) => n.id === selected)
    const related = node ? graph.edges.filter((e) => e.from === node.id || e.to === node.id) : []
    detail.textContent = node
      ? `${node.kind}: ${node.label}\nLocation: ${node.path}\nFreshness: ${node.freshness} (all recorded references, including omitted ones)\nRelationships: ${related.length} of ${node.recordedReferences} included in this snapshot\nProvenance: Wiki manifest membership\n${related.map((e) => `${e.from} → ${e.to}\nreferences-source · ${e.freshness}${e.recordedHash ? `\nRecorded SHA-256: ${e.recordedHash}` : ""}`).join("\n")}`
      : nodes.length
        ? "Select a page or source to inspect its recorded evidence. Selection focuses its one-hop neighborhood."
        : "No matching items. Clear search or reset the view."
  }
  search.oninput = () => {
    selected = undefined
    query = search.value.toLowerCase()
    render()
  }
  filter.onchange = () => {
    selected = undefined
    kind = filter.value
    render()
  }
  reset.onclick = () => {
    selected = undefined
    query = ""
    kind = "all"
    search.value = ""
    filter.value = "all"
    zoom = 1
    offsetX = offsetY = 0
    render()
  }
  root.onkeydown = (event) => {
    if (event.key === "Escape") {
      search.focus()
    }
  }
  element.append(root)
  render()
  return {
    update(input: unknown) {
      if (disposed) throw new Error("Viewer is disposed")
      const next = parseWikiGraph(input)
      if (next.snapshot !== graph.snapshot) {
        selected = undefined
        zoom = 1
        offsetX = offsetY = 0
      }
      if (!next.nodes.some((n) => n.id === selected)) selected = undefined
      graph = next
      render()
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const button of root.querySelectorAll("button")) button.onclick = null
      root.remove()
      root.replaceChildren()
      root.onkeydown = null
      search.oninput = null
      filter.onchange = null
      reset.onclick = null
    },
  }
}
export type { WikiGraph } from "@ax-code/ax-wiki/graph"
