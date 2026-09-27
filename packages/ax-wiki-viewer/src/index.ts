import { parseWikiGraph } from "@ax-code/ax-wiki/graph"
import type { WikiGraphEdge, WikiGraphNode } from "@ax-code/ax-wiki/graph"
import { LAYOUT_WORLD, createForceLayout } from "./force-layout.js"
import type { ForceLayout, LayoutNode } from "./force-layout.js"

export const viewerCss = `
.axwv{font:14px system-ui,sans-serif;color:#dce6f2;background:#101923;padding:20px;border-radius:12px;box-sizing:border-box}
.axwv *{box-sizing:border-box}.axwv h1{font-size:24px;margin:0 0 8px}.axwv p{line-height:1.5;overflow-wrap:anywhere}
.axwv button,.axwv input,.axwv select{font:inherit;color:inherit;background:#1c2c3c;border:1px solid #64778b;border-radius:6px;padding:8px}
.axwv button{cursor:pointer}.axwv button:hover{background:#30455c}.axwv :focus-visible{outline:3px solid #78dacc;outline-offset:2px}
.axwv .controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:12px 0}.axwv .layout{display:grid;grid-template-columns:minmax(0,2fr) minmax(260px,1fr);gap:16px}
.axwv .canvas{height:520px;overflow:hidden;border:1px solid #64778b;border-radius:8px}.axwv svg{width:100%;height:100%}
.axwv .node{cursor:pointer}.axwv svg text{pointer-events:none;font-size:10px;fill:#edf6ff;text-anchor:middle}
.axwv .edge{fill:none;stroke:#64778b}.axwv .arrow{fill:none;stroke:#b5c5d7}
.axwv .list{max-height:260px;overflow:auto;padding:0;list-style:none}.axwv .list button{width:100%;text-align:left;margin:3px 0;overflow-wrap:anywhere}
.axwv .detail{white-space:pre-wrap;overflow-wrap:anywhere}.axwv .muted{color:#b5c5d7}.axwv .selected{border-color:#78dacc}
@media(max-width:760px){.axwv .layout{grid-template-columns:1fr}.axwv .canvas{height:360px}}
`

const MIN_ZOOM = 0.25
const MAX_ZOOM = 8
const PAGE_FILL = "#245d65"
const SOURCE_FILL = "#30455c"
const PAGE_RING = "#9fb3c8"
const SELECT_RING = "#78dacc"
const FOCUS_EDGE = "#8fa6bb"
const DIMMED_NODE = 0.15
const DIMMED_EDGE = 0.12
const REST_EDGE = 0.35
const FOCUS_EDGE_OPACITY = 0.95

const FRESHNESS_NOTE = {
  fresh: "observed bytes match the recorded hash.",
  stale: "observed bytes differ from the recorded hash.",
  unknown: "current sources are unverified.",
} as const

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

function truncateLabel(label: string, max = 28): string {
  const chars = Array.from(label)
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : label
}

/** An isolated instance; invalid updates preserve the previous view. */
export function mount(element: HTMLElement, input: unknown, options: { injectStyles?: boolean } = {}) {
  let graph = parseWikiGraph(input)
  let layout: ForceLayout | undefined
  let selected: string | undefined
  let hovered: string | undefined
  let query = "",
    kind = "all",
    zoom = 1,
    offsetX = 0,
    offsetY = 0,
    disposed = false,
    cameraTouched = false,
    settled = false
  const doc = element.ownerDocument
  const reducedMotion =
    doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
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
  html(
    "p",
    root,
    "Wiki page → referenced source. Recorded membership, not a code dependency or call graph. Node size is how many of those listings are in this snapshot.",
  )
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
  const layoutRoot = html("div", root)
  layoutRoot.className = "layout"
  const canvas = html("div", layoutRoot)
  canvas.className = "canvas"
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("role", "img")
  svg.setAttribute(
    "aria-label",
    "Page to source relationships; use the adjacent list for keyboard navigation. When focused, plus and minus zoom, arrow keys pan.",
  )
  svg.tabIndex = 0
  canvas.append(svg)
  const aside = html("div", layoutRoot)
  html("h2", aside, "Explore")
  const list = html("ul", aside)
  list.className = "list"
  const detailHeading = html("h2", aside, "Evidence")
  detailHeading.tabIndex = -1
  const detail = html("p", aside)
  detail.className = "Detail"
  const navigation = html("div", root)
  navigation.className = "controls"

  const svgNS = "http://www.w3.org/2000/svg"
  const edgeLayer = doc.createElementNS(svgNS, "g")
  const nodeLayer = doc.createElementNS(svgNS, "g")
  svg.append(edgeLayer, nodeLayer)
  type EdgeEls = { path: SVGPathElement; arrow: SVGPathElement; edge: WikiGraphEdge }
  type NodeEls = { group: SVGGElement; circle: SVGCircleElement; label: SVGTextElement; node: LayoutNode }
  let edgeEls: EdgeEls[] = []
  let nodeEls: NodeEls[] = []
  const nodeElsById = new Map<string, NodeEls>()

  function neighborhood(): Set<string> | undefined {
    if (!selected || !layout) return undefined
    const near = new Set([selected])
    for (const link of layout.links) {
      if (link.from === selected) near.add(link.to)
      else if (link.to === selected) near.add(link.from)
    }
    return near
  }

  function matches(node: WikiGraphNode): boolean {
    return !query || `${node.label} ${node.path}`.toLowerCase().includes(query)
  }

  function viewBox() {
    svg.setAttribute("viewBox", `${offsetX} ${offsetY} ${LAYOUT_WORLD.width / zoom} ${LAYOUT_WORLD.height / zoom}`)
  }

  function fitView() {
    if (!layout || layout.nodes.length === 0) {
      zoom = 1
      offsetX = offsetY = 0
      viewBox()
      return
    }
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity
    for (const node of layout.nodes) {
      const pad = node.radius + 24
      minX = Math.min(minX, node.x - pad)
      minY = Math.min(minY, node.y - pad)
      maxX = Math.max(maxX, node.x + pad)
      maxY = Math.max(maxY, node.y + pad)
    }
    zoom = Math.min(
      1,
      LAYOUT_WORLD.width / (maxX - minX),
      LAYOUT_WORLD.height / (maxY - minY),
    )
    zoom = Math.max(MIN_ZOOM, zoom)
    offsetX = (minX + maxX) / 2 - LAYOUT_WORLD.width / zoom / 2
    offsetY = (minY + maxY) / 2 - LAYOUT_WORLD.height / zoom / 2
    cameraTouched = false
    viewBox()
  }

  function edgeCurve(a: LayoutNode, b: LayoutNode): { d: string; head: string } {
    const dx = b.x - a.x,
      dy = b.y - a.y
    const length = Math.hypot(dx, dy) || 1
    const bend = Math.min(16, length * 0.06)
    const cx = (a.x + b.x) / 2 + (-dy / length) * bend
    const cy = (a.y + b.y) / 2 + (dx / length) * bend
    // Shorten the visible line so it meets the bubble rims instead of the centers.
    const trimA = Math.min(a.radius + 2, length / 2 - 1)
    const trimB = Math.min(b.radius + 4, length / 2 - 1)
    const t0x = a.x + ((cx - a.x) / length) * trimA,
      t0y = a.y + ((cy - a.y) / length) * trimA
    const t1x = b.x + ((cx - b.x) / length) * trimB,
      t1y = b.y + ((cy - b.y) / length) * trimB
    const tx = t1x - cx,
      ty = t1y - cy
    const tangent = Math.hypot(tx, ty) || 1
    const ux = tx / tangent,
      uy = ty / tangent
    const size = 9,
      wing = 4.5
    const p1x = t1x - ux * size + -uy * wing,
      p1y = t1y - uy * size + ux * wing
    const p2x = t1x - ux * size - -uy * wing,
      p2y = t1y - uy * size - ux * wing
    return { d: `M${t0x},${t0y} Q${cx},${cy} ${t1x},${t1y}`, head: `M${p1x},${p1y} L${t1x},${t1y} L${p2x},${p2y}` }
  }

  function positionElements() {
    if (!layout) return
    const { byId } = layout
    for (const { path, arrow, edge } of edgeEls) {
      const a = byId.get(edge.from)!,
        b = byId.get(edge.to)!
      const { d, head } = edgeCurve(a, b)
      path.setAttribute("d", d)
      arrow.setAttribute("d", head)
    }
    for (const { group, node } of nodeEls) group.setAttribute("transform", `translate(${node.x},${node.y})`)
  }

  function applyEmphasis() {
    if (!layout) return
    const near = neighborhood()
    for (const { path, arrow, edge } of edgeEls) {
      const a = layout.byId.get(edge.from)!,
        b = layout.byId.get(edge.to)!
      const dimmed =
        (kind !== "all" && (a.kind !== kind || b.kind !== kind)) ||
        (near !== undefined && (!near.has(edge.from) || !near.has(edge.to)))
      const incident = selected !== undefined && (edge.from === selected || edge.to === selected)
      path.setAttribute("opacity", dimmed ? String(DIMMED_EDGE) : incident ? String(FOCUS_EDGE_OPACITY) : String(REST_EDGE))
      path.setAttribute("stroke", incident && !dimmed ? FOCUS_EDGE : "#64778b")
      arrow.setAttribute("opacity", dimmed ? String(DIMMED_EDGE) : incident ? String(FOCUS_EDGE_OPACITY) : String(REST_EDGE))
    }
    for (const { group, circle, label, node } of nodeEls) {
      const info = graph.nodes.find((candidate) => candidate.id === node.id)!
      const dimmed =
        (kind !== "all" && node.kind !== kind) ||
        !matches(info) ||
        (near !== undefined && !near.has(node.id))
      group.setAttribute("opacity", dimmed ? String(DIMMED_NODE) : "1")
      if (node.id === selected) {
        circle.setAttribute("stroke", SELECT_RING)
        circle.setAttribute("stroke-width", "3")
      } else if (node.kind === "page") {
        circle.setAttribute("stroke", PAGE_RING)
        circle.setAttribute("stroke-width", "1.5")
      } else {
        circle.removeAttribute("stroke")
        circle.removeAttribute("stroke-width")
      }
      const showLabel = node.kind === "page" || zoom >= 2 || node.id === hovered || (near !== undefined && near.has(node.id))
      label.setAttribute("display", showLabel ? "" : "none")
    }
  }

  function renderStatus(matchCount: number) {
    let text = `${graph.nodes.length} nodes and ${graph.edges.length} relationships in this snapshot. Not included from the recorded Wiki: ${graph.omitted.nodes} nodes, ${graph.omitted.edges} relationships. Unknown freshness means current sources are unverified.`
    if (query) text += ` ${matchCount} of ${graph.nodes.length} match the search.`
    if (selected) {
      const node = graph.nodes.find((candidate) => candidate.id === selected)
      const near = neighborhood()
      if (node && near) text += ` Focus: ${node.kind} "${node.label}" with ${near.size - 1} connected in this view.`
    }
    status.textContent = text
    identityText.textContent = `Snapshot: ${graph.snapshot}\nScope: recorded Wiki manifest. Code relationships unavailable.`
  }

  function renderList() {
    const near = neighborhood()
    const visible = graph.nodes.filter(
      (node) => (!near || near.has(node.id)) && (kind === "all" || node.kind === kind) && matches(node),
    )
    list.replaceChildren()
    for (const node of visible) {
      const item = html("li", list)
      const button = html("button", item, `${node.kind}: ${node.label} · ${node.freshness}`)
      const degree = layout?.byId.get(node.id)?.degree ?? 0
      button.title = `${plural(degree, "connection", "connections")} shown of ${plural(node.recordedReferences, "recorded reference", "recorded references")}`
      if (node.id === selected) button.className = "selected"
      button.onclick = () => select(node)
    }
    return visible.length
  }

  function renderDetail() {
    const node = graph.nodes.find((candidate) => candidate.id === selected)
    if (!node) {
      detail.textContent = graph.nodes.length
        ? "Select a page or source to inspect its recorded evidence. Selection focuses its one-hop neighborhood."
        : "No matching items. Clear search or reset the view."
      return
    }
    const related = graph.edges.filter((edge) => edge.from === node.id || edge.to === node.id)
    const line =
      node.kind === "page"
        ? `Cites ${related.length} of ${plural(node.recordedReferences, "source", "sources")} in this snapshot.`
        : `Cited by ${related.length} of ${plural(node.recordedReferences, "page", "pages")} in this snapshot.`
    const rows = related.map((edge) => {
      const otherId = node.kind === "page" ? edge.to : edge.from
      const other = graph.nodes.find((candidate) => candidate.id === otherId)!
      const marker = node.kind === "page" ? "→" : "←"
      const hash = edge.recordedHash ? `\nRecorded SHA-256: ${edge.recordedHash}` : ""
      return `${marker} ${other.label}\n${other.path} · ${edge.freshness}${hash}`
    })
    detail.textContent =
      `${node.kind === "page" ? "Page" : "Source"}: ${node.label}\nLocation: ${node.path}\nFreshness: ${node.freshness} — ${FRESHNESS_NOTE[node.freshness]}\n${line}\nProvenance: Wiki manifest membership` +
      (rows.length ? `\n\n${rows.join("\n")}` : "")
  }

  function render() {
    positionElements()
    applyEmphasis()
    const matchCount = renderList()
    renderDetail()
    renderStatus(matchCount)
  }

  function buildElements() {
    edgeLayer.replaceChildren()
    nodeLayer.replaceChildren()
    edgeEls = []
    nodeEls = []
    nodeElsById.clear()
    if (!layout) return
    for (const edge of graph.edges) {
      const path = doc.createElementNS(svgNS, "path")
      path.setAttribute("class", "edge")
      const arrow = doc.createElementNS(svgNS, "path")
      arrow.setAttribute("class", "arrow")
      edgeLayer.append(path, arrow)
      edgeEls.push({ path, arrow, edge })
    }
    for (const node of layout.nodes) {
      const info = graph.nodes.find((candidate) => candidate.id === node.id)!
      const group = doc.createElementNS(svgNS, "g")
      group.setAttribute("class", "node")
      group.setAttribute("data-id", node.id)
      const circle = doc.createElementNS(svgNS, "circle")
      circle.setAttribute("r", String(node.radius))
      circle.setAttribute("fill", node.kind === "page" ? PAGE_FILL : SOURCE_FILL)
      const label = doc.createElementNS(svgNS, "text")
      label.setAttribute("y", String(node.radius + 14))
      label.textContent = `${node.kind === "page" ? "Page → " : ""}${truncateLabel(info.label)}`
      const title = doc.createElementNS(svgNS, "title")
      title.textContent = `${info.label} (${node.kind}, ${info.freshness}, ${plural(node.degree, "connection", "connections")} shown)`
      group.append(circle, label, title)
      group.addEventListener("click", () => select(info))
      group.addEventListener("mouseenter", () => {
        hovered = node.id
        applyEmphasis()
      })
      group.addEventListener("mouseleave", () => {
        if (hovered === node.id) hovered = undefined
        applyEmphasis()
      })
      nodeLayer.append(group)
      const els = { group, circle, label, node }
      nodeEls.push(els)
      nodeElsById.set(node.id, els)
    }
  }

  function buildLayout() {
    layout?.stop()
    settled = false
    layout = createForceLayout(graph, {
      reducedMotion,
      onTick: positionElements,
      onEnd: () => {
        settled = true
        positionElements()
        if (!cameraTouched) fitView()
      },
    })
    if (reducedMotion) {
      settled = true
      positionElements()
    }
    buildElements()
  }

  function select(node: WikiGraphNode) {
    selected = node.id
    // Pin positions so a still-running simulation cannot reflow under the cursor.
    if (layout && !settled) for (const pinned of layout.nodes) {
      pinned.fx = pinned.x
      pinned.fy = pinned.y
    }
    render()
    detailHeading.focus()
  }

  function clearCamera() {
    zoom = 1
    offsetX = offsetY = 0
    cameraTouched = false
    viewBox()
  }

  for (const [label, action] of [
    [
      "Zoom in",
      () => {
        zoom = Math.min(MAX_ZOOM, zoom * 1.5)
      },
    ],
    [
      "Zoom out",
      () => {
        zoom = Math.max(MIN_ZOOM, zoom / 1.5)
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
      cameraTouched = true
      viewBox()
      applyEmphasis()
    }
  }
  svg.onkeydown = (event) => {
    const step = 100 / zoom
    if (event.key === "+" || event.key === "=") zoom = Math.min(MAX_ZOOM, zoom * 1.5)
    else if (event.key === "-") zoom = Math.max(MIN_ZOOM, zoom / 1.5)
    else if (event.key === "ArrowLeft") offsetX -= step
    else if (event.key === "ArrowRight") offsetX += step
    else if (event.key === "ArrowUp") offsetY -= step
    else if (event.key === "ArrowDown") offsetY += step
    else return
    event.preventDefault()
    cameraTouched = true
    viewBox()
    applyEmphasis()
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
    if (layout) for (const node of layout.nodes) {
      node.fx = null
      node.fy = null
    }
    fitView()
    render()
  }
  root.onkeydown = (event) => {
    if (event.key === "Escape") {
      search.focus()
    }
  }
  element.append(root)
  buildLayout()
  fitView()
  render()
  return {
    update(input: unknown) {
      if (disposed) throw new Error("Viewer is disposed")
      const next = parseWikiGraph(input)
      if (next.snapshot !== graph.snapshot) {
        selected = undefined
        query = ""
        kind = "all"
        search.value = ""
        filter.value = "all"
        graph = next
        buildLayout()
        fitView()
      } else {
        graph = next
        if (!next.nodes.some((node) => node.id === selected)) selected = undefined
      }
      render()
    },
    dispose() {
      if (disposed) return
      disposed = true
      layout?.stop()
      layout = undefined
      for (const button of root.querySelectorAll("button")) button.onclick = null
      root.remove()
      root.replaceChildren()
      root.onkeydown = null
      svg.onkeydown = null
      search.oninput = null
      filter.onchange = null
      reset.onclick = null
    },
  }
}
export type { WikiGraph } from "@ax-code/ax-wiki/graph"
