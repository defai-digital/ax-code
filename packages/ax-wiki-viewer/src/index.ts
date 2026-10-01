import { parseWikiGraph } from "@ax-code/ax-wiki/graph"
import type { WikiGraphEdge, WikiGraphNode } from "@ax-code/ax-wiki/graph"
import { fitCamera, wheelZoomFactor, zoomAbout } from "./camera.js"
import { LAYOUT_WORLD, createForceLayout } from "./force-layout.js"
import type { ForceLayout, LayoutNode } from "./force-layout.js"
import {
  citingTopics,
  countOutlineSymbols,
  countsBarText,
  defaultFilters,
  focusDirection,
  isDefaultFilters,
  isNodeVisible,
  overlayText,
  viewCounts,
  viewState,
} from "./visibility.js"
import type { CitingTopic, FreshnessState, NodeKind, OutlineSymbol, ViewFilters } from "./visibility.js"

export const viewerCss = `
.axwv{display:flex;flex-direction:column;height:100%;min-height:100%;font:14px system-ui,sans-serif;color:#dce6f2;background:#101923;padding:12px 16px 16px;box-sizing:border-box}
.axwv *{box-sizing:border-box}.axwv h1{font-size:18px;margin:0;letter-spacing:-.01em}.axwv p{line-height:1.45;overflow-wrap:anywhere;margin:4px 0}
.axwv button,.axwv input,.axwv select{font:inherit;color:inherit;background:#1c2c3c;border:1px solid #3d5166;border-radius:6px;padding:6px 8px}
.axwv button{cursor:pointer}.axwv button:hover{background:#30455c}.axwv :focus-visible{outline:3px solid #78dacc;outline-offset:2px}
.axwv .controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0 0}
.axwv .layout{order:1;flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) minmax(220px,300px);gap:12px;margin-top:8px}
.axwv > details,.axwv > .notice{order:2}
.axwv .canvas{position:relative;height:100%;min-height:420px;overflow:hidden;border:1px solid #2c4156;border-radius:10px;background:#0c141d;touch-action:none}
.axwv svg{width:100%;height:100%;display:block}
.axwv .node{cursor:grab;touch-action:none}.axwv .node.dragging{cursor:grabbing}
.axwv svg text{pointer-events:none;font-size:11px;text-anchor:middle;fill:#edf6ff}
.axwv svg .node>text{paint-order:stroke;stroke:#0c141d;stroke-width:4px;stroke-linejoin:round}
.axwv svg .node.page>text{text-anchor:end;font-size:13px;font-weight:600}
.axwv .legend .topic{width:10px;height:10px;border-radius:50%;display:inline-block;border:1px solid #8ea0b3}
.axwv .edge{fill:none;stroke:#64778b}.axwv .arrow{fill:none;stroke:#b5c5d7}
.axwv .badge text{font-size:7.5px;font-weight:700;fill:#dce6f2}
.axwv .legend{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:center;margin:6px 0 0;font-size:12px;color:#8ea0b3}
.axwv .side{min-height:0;overflow:auto;padding-right:2px}
.axwv .side h2{font-size:13px;margin:0 0 6px;letter-spacing:.04em;text-transform:uppercase;color:#8ea0b3}
.axwv .list{max-height:none;overflow:visible;padding:0;margin:0 0 12px;list-style:none}
.axwv .list button{width:100%;text-align:left;margin:0 0 2px;padding:5px 8px;background:transparent;border-color:transparent;overflow-wrap:anywhere}
.axwv .list button:hover{background:#243246;border-color:#3d5166}
.axwv .detail{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;font-size:13px}
.axwv .muted{color:#b5c5d7}.axwv .selected{border-color:#78dacc;background:#1a3144}
.axwv .chips{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0 0}
.axwv .dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}
.axwv .chip[aria-pressed="false"],.axwv .kind[aria-pressed="false"]{opacity:.45;text-decoration:line-through}
.axwv .counts{font-variant-numeric:tabular-nums;color:#8ea0b3;font-size:12px}
.axwv .notice{border:1px solid #3d5166;border-radius:8px;padding:8px 12px;color:#b5c5d7}
.axwv .overlay{position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;text-align:center;background:rgba(12,20,29,.94);padding:24px}
.axwv .overlay p{margin:0;max-width:52ch}
.axwv .hud{position:absolute;right:10px;bottom:10px;z-index:2;display:grid;grid-template-columns:auto auto;gap:4px;margin:0}
.axwv .hud button{padding:6px 8px;background:rgba(16,25,35,.9)}
.axwv details{margin:8px 0 0}
.axwv details summary{cursor:pointer;color:#b5c5d7}
.axwv .outline ul{list-style:none;margin:2px 0;padding-left:18px}
.axwv .outline>ul{padding-left:0}
.axwv .outline button{background:none;border-color:transparent;padding:4px 8px;text-align:left;overflow-wrap:anywhere}
.axwv .outline button:hover{background:#30455c;border-color:#64778b}
@media(max-width:760px){.axwv .layout{grid-template-columns:1fr}.axwv .canvas{height:420px;min-height:420px}.axwv .hud{right:8px;bottom:8px}.axwv .legend .note{display:none}}
`

/** Overview stays a picture. Names appear for the focused neighborhood, or once the camera is close. */
const LABEL_ZOOM: Record<NodeKind, number> = { page: 1.35, source: 1.7, symbol: 2.4 }
const PAGE_FILL = "#245d65"
/**
 * Stable topic colors on the dark canvas. Page hubs are the light swatch,
 * files cited by only that page use the deeper swatch, and citation edges use
 * the light one. Kept away from the selection strokes #e0a63c, #78dacc, and #64778b.
 */
const TOPIC_PALETTE = [
  { page: "#3db8c4", source: "#2a8a94", edge: "#8fd8e0" },
  { page: "#6aa2e0", source: "#4d7cb4", edge: "#b4d2f2" },
  { page: "#b39adf", source: "#8872b4", edge: "#ddd0f4" },
  { page: "#6fbf8a", source: "#4c9466", edge: "#b7e4c6" },
  { page: "#d4896a", source: "#a86b50", edge: "#f0c4ae" },
  { page: "#d489a8", source: "#a86a86", edge: "#f0c4d4" },
] as const
const SOURCE_FILL = "#30455c"
const SYMBOL_FILL = "#7d6a45"
const PAGE_RING = "#9fb3c8"
const SELECT_RING = "#78dacc"
const STALE_RING = "#e0a63c"
const FRESH_DOT = "#7cc78a"
const UNKNOWN_DOT = "#64778b"
const OUTLINE_ROWS = 50
const FOCUS_OUT = "#e0a63c"
const FOCUS_IN = "#78dacc"
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

/** Width of a 13px page title, including the halo, so fit can keep the name on screen. */
function pageLabelWidth(label: string): number {
  return Math.min(Array.from(label).length, 28) * 9 + 16
}

/** An isolated instance; invalid updates preserve the previous view. */
export function mount(element: HTMLElement, input: unknown, options: { injectStyles?: boolean } = {}) {
  let graph = parseWikiGraph(input)
  let topics = new Map<string, CitingTopic>()
  const topicColor = (id: string) => {
    const topic = topics.get(id)
    return typeof topic === "number" ? TOPIC_PALETTE[topic % TOPIC_PALETTE.length] : undefined
  }
  let layout: ForceLayout | undefined
  let selected: string | undefined
  let hovered: string | undefined
  let suppressClick = false
  let suppressCanvasClick = false
  let lastVisible: WikiGraphNode[] = []
  let matchIndex = 0
  let filters: ViewFilters = defaultFilters(),
    zoom = 1,
    offsetX = 0,
    offsetY = 0,
    disposed = false,
    cameraTouched = false,
    hasFitted = false
  const doc = element.ownerDocument
  const reducedMotion = doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
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
    "Each page has its own color. Files only that page cites match it. Shared files stay blue. Scroll to zoom.",
  )
  const status = html("p", root)
  status.className = "counts"
  status.setAttribute("role", "status")
  status.setAttribute("aria-live", "polite")
  const identity = html("details", root)
  html("summary", identity, "Snapshot details")
  const identityText = html("p", identity)
  const controls = html("div", root)
  controls.className = "controls"
  const searchLabel = html("label", controls, "Search ")
  const search = html("input", searchLabel)
  search.type = "search"
  search.placeholder = "Page or source path"
  const reset = html("button", controls, "Show all / reset")
  const chips = html("div", root)
  chips.className = "chips"
  chips.setAttribute("role", "group")
  chips.setAttribute("aria-label", "Filter by freshness")
  const legend = html("div", root)
  legend.className = "legend"
  legend.setAttribute("aria-label", "Map legend")
  const outlineWrap = html("details", root)
  html("summary", outlineWrap, "Outline")
  const outlineBody = html("div", outlineWrap)
  outlineBody.className = "outline"
  const notice = html("p", root)
  notice.className = "notice"
  notice.style.display = "none"
  const layoutRoot = html("div", root)
  layoutRoot.className = "layout"
  const canvas = html("div", layoutRoot)
  canvas.className = "canvas"
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("role", "img")
  svg.setAttribute(
    "aria-label",
    "Page to source references and source to source imports. Scroll the wheel to zoom toward the pointer, drag empty canvas to pan, or focus and use plus, minus, and arrow keys. Drag nodes to rearrange; activating empty canvas clears the selection.",
  )
  svg.tabIndex = 0
  canvas.append(svg)
  const overlay = html("div", canvas)
  overlay.className = "overlay"
  overlay.style.display = "none"
  const overlayMessage = html("p", overlay)
  const overlayReset = html("button", overlay, "Reset filters")
  const aside = html("div", layoutRoot)
  aside.className = "side"
  html("h2", aside, "Explore")
  const list = html("ul", aside)
  list.className = "list"
  const detailHeading = html("h2", aside, "Evidence")
  detailHeading.tabIndex = -1
  const detail = html("p", aside)
  detail.className = "detail"
  const navigation = html("div", canvas)
  navigation.className = "hud"

  const svgNS = "http://www.w3.org/2000/svg"
  const edgeLayer = doc.createElementNS(svgNS, "g")
  const nodeLayer = doc.createElementNS(svgNS, "g")
  svg.append(edgeLayer, nodeLayer)
  type EdgeEls = { path: SVGPathElement; arrow: SVGPathElement; edge: WikiGraphEdge }
  type NodeEls = { group: SVGGElement; circle: SVGCircleElement; label: SVGTextElement; node: LayoutNode }
  let edgeEls: EdgeEls[] = []
  let nodeEls: NodeEls[] = []
  const nodeElsById = new Map<string, NodeEls>()

  function neighborhoodOf(id: string): Set<string> | undefined {
    if (!layout) return undefined
    const near = new Set([id])
    for (const link of layout.links) {
      if (link.from === id) near.add(link.to)
      else if (link.to === id) near.add(link.from)
    }
    return near
  }

  function neighborhood(): Set<string> | undefined {
    return selected === undefined ? undefined : neighborhoodOf(selected)
  }

  /** Canvas-only focus: selection wins, hover previews, neither touches list or detail. */
  function canvasFocus(): { id: string; near: Set<string> } | undefined {
    const id = selected ?? hovered
    if (id === undefined) return undefined
    const near = neighborhoodOf(id)
    return near === undefined ? undefined : { id, near }
  }

  let visibleById = new Map<string, boolean>()
  function refreshVisibility() {
    visibleById = new Map(graph.nodes.map((node) => [node.id, isNodeVisible(node, filters)]))
  }

  function canvasAspect(): number {
    const rect = canvas.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) return LAYOUT_WORLD.width / LAYOUT_WORLD.height
    return rect.width / rect.height
  }

  function viewBox() {
    const aspect = canvasAspect()
    const viewW = LAYOUT_WORLD.width / zoom
    const viewH = viewW / aspect
    svg.setAttribute("viewBox", `${offsetX} ${offsetY} ${viewW} ${viewH}`)
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
      const drawn = node.kind === "page" ? Math.max(node.radius, 14) : node.radius
      const pad = drawn + 28
      let left = node.x - pad
      if (node.kind === "page") {
        const info = graph.nodes.find((candidate) => candidate.id === node.id)
        const anchor = node.x - (drawn + 12)
        left = Math.min(left, anchor - pageLabelWidth(info?.label ?? ""))
      }
      minX = Math.min(minX, left)
      minY = Math.min(minY, node.y - pad)
      maxX = Math.max(maxX, node.x + pad)
      maxY = Math.max(maxY, node.y + pad)
    }
    const fitted = fitCamera({ minX, minY, maxX, maxY }, canvasAspect(), LAYOUT_WORLD.width)
    zoom = fitted.zoom
    offsetX = fitted.offsetX
    offsetY = fitted.offsetY
    cameraTouched = false
    viewBox()
  }

  /** Scale about a screen point. Falls back to the view center when the SVG has no screen transform yet. */
  function applyZoom(factor: number, clientX: number, clientY: number) {
    const ctm = svg.getScreenCTM()
    const anchor = ctm
      ? new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
      : { x: offsetX + LAYOUT_WORLD.width / zoom / 2, y: offsetY + LAYOUT_WORLD.height / zoom / 2 }
    const next = zoomAbout({ zoom, offsetX, offsetY }, factor, anchor)
    zoom = next.zoom
    offsetX = next.offsetX
    offsetY = next.offsetY
    cameraTouched = true
    viewBox()
    applyEmphasis()
  }

  function zoomBy(factor: number) {
    const rect = canvas.getBoundingClientRect()
    applyZoom(factor, rect.left + rect.width / 2, rect.top + rect.height / 2)
  }

  function edgeCurve(a: LayoutNode, b: LayoutNode): { d: string; head: string } {
    const dx = b.x - a.x,
      dy = b.y - a.y
    const length = Math.hypot(dx, dy) || 1
    const bend = Math.min(16, length * 0.06)
    const cx = (a.x + b.x) / 2 + (-dy / length) * bend
    const cy = (a.y + b.y) / 2 + (dx / length) * bend
    // Shorten the visible line so it meets the bubble rims instead of the centers.
    const rim = (node: LayoutNode) => (node.kind === "page" ? Math.max(node.radius, 14) : node.radius)
    const trimA = Math.min(rim(a) + 2, length / 2 - 1)
    const trimB = Math.min(rim(b) + 4, length / 2 - 1)
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
    const focus = canvasFocus()
    const near = focus?.near
    const focusId = focus?.id
    for (const { path, arrow, edge } of edgeEls) {
      // Filter-hidden always wins: a focused but filtered-out edge stays dimmed.
      const dimmed =
        visibleById.get(edge.from) !== true ||
        visibleById.get(edge.to) !== true ||
        (near !== undefined && (!near.has(edge.from) || !near.has(edge.to)))
      const direction = focusId === undefined ? null : focusDirection(edge, focusId)
      const incident = direction !== null
      const resting = focusId === undefined
      const restOpacity = edge.kind === "references-source" ? 0.75 : edge.kind === "uses" ? 0.45 : 0.14
      path.setAttribute(
        "opacity",
        dimmed ? String(DIMMED_EDGE) : incident ? String(FOCUS_EDGE_OPACITY) : String(resting ? restOpacity : REST_EDGE),
      )
      // At rest, color is the relationship. A selection keeps the tested focus colors.
      const cited = edge.kind === "references-source" ? topicColor(edge.from) : undefined
      const restStroke = edge.kind === "uses" ? "#d2b56a" : edge.kind === "contains" ? "#3e5164" : (cited?.edge ?? "#8fd0d6")
      path.setAttribute(
        "stroke",
        !dimmed && direction === "outgoing"
          ? FOCUS_OUT
          : !dimmed && direction === "incoming"
            ? FOCUS_IN
            : resting
              ? restStroke
              : "#64778b",
      )
      path.setAttribute(
        "stroke-width",
        resting ? (edge.kind === "references-source" ? "1.7" : edge.kind === "uses" ? "1.15" : "0.65") : "1.25",
      )
      arrow.setAttribute(
        "opacity",
        dimmed ? String(DIMMED_EDGE) : incident ? String(FOCUS_EDGE_OPACITY) : String(resting ? restOpacity : REST_EDGE),
      )
      if (!dimmed && incident) arrow.setAttribute("stroke", direction === "outgoing" ? FOCUS_OUT : FOCUS_IN)
      else arrow.removeAttribute("stroke")
    }
    const namedPages = graph.nodes.reduce((count, candidate) => count + (candidate.kind === "page" ? 1 : 0), 0)
    // Page names sit in the empty margin left of each hub. A lower hub drops
    // its label when two pages are close, so the names do not stack.
    const pageLabelY = new Map<string, number>()
    let lastLabelY = -Infinity
    for (const entry of nodeEls.filter((item) => item.node.kind === "page").sort((a, b) => a.node.y - b.node.y)) {
      let y = 4
      if (entry.node.y + y < lastLabelY + 16) y = lastLabelY + 16 - entry.node.y
      pageLabelY.set(entry.node.id, y)
      lastLabelY = entry.node.y + y
    }
    for (const { group, circle, label, node } of nodeEls) {
      const dimmed = visibleById.get(node.id) !== true || (near !== undefined && !near.has(node.id))
      const emphasized = near !== undefined && near.has(node.id)
      // Symbols are detail. They stay faint until the neighborhood or a closer zoom.
      const quietSymbol = node.kind === "symbol" && !emphasized && zoom < LABEL_ZOOM.symbol
      group.setAttribute("opacity", dimmed ? String(DIMMED_NODE) : quietSymbol ? "0.38" : "1")
      if (node.id === selected || (selected === undefined && node.id === hovered)) {
        circle.setAttribute("stroke", SELECT_RING)
        circle.setAttribute("stroke-width", "3")
      } else if (node.kind === "page") {
        circle.setAttribute("stroke", PAGE_RING)
        circle.setAttribute("stroke-width", "1.5")
      } else {
        circle.removeAttribute("stroke")
        circle.removeAttribute("stroke-width")
      }
      const showLabel = emphasized || (node.kind === "page" && namedPages <= 16) || zoom >= LABEL_ZOOM[node.kind]
      label.setAttribute("display", showLabel ? "" : "none")
      if (node.kind === "page") {
        label.setAttribute("text-anchor", "end")
        label.setAttribute("x", String(-(Math.max(node.radius, 14) + 12)))
        label.setAttribute("y", String(pageLabelY.get(node.id) ?? 4))
      }
    }
  }

  function renderCounts() {
    const counts = viewCounts(graph, filters)
    const state = viewState(graph, filters)
    status.textContent = countsBarText(counts, state, filters.query)
    identityText.textContent = `Snapshot: ${graph.snapshot}\nScope: recorded Wiki manifest plus verified JS/TS imports. Code call graph unavailable.\nWiki page → referenced source; source → imported source. Recorded membership and static imports, not a call graph. Node size is visible connections in this snapshot.`
    if (state === "empty" || state === "zero-match" || state === "all-kinds-hidden") {
      overlay.style.display = "flex"
      overlayMessage.textContent = overlayText(state, counts)
      overlayReset.style.display = isDefaultFilters(filters) ? "none" : ""
      notice.style.display = "none"
    } else {
      overlay.style.display = "none"
      if (state === "ok") notice.style.display = "none"
      else {
        notice.style.display = ""
        notice.textContent = overlayText(state, counts)
      }
    }
  }

  function renderList() {
    const near = neighborhood()
    const query = filters.query.trim()
    const visible = graph.nodes.filter((node) => {
      if ((near && !near.has(node.id)) || !isNodeVisible(node, filters)) return false
      // The list follows the picture: pages and files first. Symbols join a search or a selection.
      if (node.kind === "symbol" && !near && query === "") return false
      return true
    })
    lastVisible = visible
    list.replaceChildren()
    for (const node of visible) {
      const item = html("li", list)
      const button = html("button", item, `${node.kind}: ${node.label}`)
      const degree = layout?.byId.get(node.id)?.degree ?? 0
      button.title = `${node.freshness} · ${plural(degree, "connection", "connections")} shown of ${plural(node.recordedReferences, "recorded reference", "recorded references")}`
      if (node.id === selected) button.className = "selected"
      button.onclick = () => select(node)
      previewOn(button, node.id)
    }
  }

  function renderDetail() {
    const node = graph.nodes.find((candidate) => candidate.id === selected)
    if (!node) {
      detail.textContent = graph.nodes.length
        ? "Each wiki page has its own color. Files cited by only that page use the same color. Files cited by several pages stay blue. Gold dots are symbols.\n\nSelect a page, source, or symbol to inspect its recorded evidence. Selection focuses its one-hop neighborhood."
        : "No matching items. Clear search or reset the view."
      return
    }
    const related = graph.edges.filter((edge) => edge.from === node.id || edge.to === node.id)
    const citing = related.filter((edge) => edge.kind === "references-source")
    const usesOut = related.filter((edge) => edge.kind === "uses" && edge.from === node.id)
    const usesIn = related.filter((edge) => edge.kind === "uses" && edge.to === node.id)
    const kindLabel = node.kind === "page" ? "Page" : node.kind === "source" ? "Source" : "Symbol"
    const line =
      node.kind === "page"
        ? `Cites ${citing.length} of ${plural(node.recordedReferences, "source", "sources")} in this snapshot.`
        : node.kind === "source"
          ? `Cited by ${citing.length} of ${plural(node.recordedReferences, "page", "pages")} in this snapshot. Imports ${plural(usesOut.length, "source", "sources")}, imported by ${plural(usesIn.length, "source", "sources")} in this snapshot.`
          : `Contained by ${plural(related.length, "source", "sources")} in this snapshot.`
    const rows = related.map((edge) => {
      if (edge.kind === "contains" && node.kind === "source") {
        const other = graph.nodes.find((candidate) => candidate.id === edge.to)!
        return `→ ${other.detail || other.label}`
      }
      if (edge.kind === "uses") {
        const outgoing = edge.from === node.id
        const other = graph.nodes.find((candidate) => candidate.id === (outgoing ? edge.to : edge.from))!
        return `${outgoing ? "→" : "←"} ${other.label}\n${other.path} · ${edge.freshness} · ${outgoing ? "imports" : "imported by"}`
      }
      const otherId = node.kind === "page" ? edge.to : edge.from
      const other = graph.nodes.find((candidate) => candidate.id === otherId)!
      const marker = node.kind === "page" ? "→" : "←"
      const hash = edge.recordedHash ? `\nRecorded SHA-256: ${edge.recordedHash}` : ""
      return `${marker} ${other.label}\n${other.path} · ${edge.freshness}${hash}`
    })
    const summary = node.summary ? `\n${node.kind === "symbol" ? "Model summary" : "Summary"}: ${node.summary}` : ""
    const extra = node.detail ? `\nDetail: ${node.detail}` : ""
    const anchors =
      node.symbols.length > 0
        ? `\n\nAnchored symbols (${node.symbols.length}):\n${node.symbols.map((anchor) => `- ${anchor.name} (${anchor.provenance})`).join("\n")}`
        : ""
    detail.textContent =
      `${kindLabel}: ${node.label}\nLocation: ${node.path}${summary}${extra}\nFreshness: ${node.freshness} — ${FRESHNESS_NOTE[node.freshness]}\n${line}\nProvenance: Wiki manifest membership` +
      anchors +
      (rows.length ? `\n\n${rows.join("\n")}` : "")
  }

  const FRESHNESS_ORDER: FreshnessState[] = ["fresh", "stale", "unknown"]
  const FRESHNESS_LABEL: Record<FreshnessState, string> = { fresh: "Fresh", stale: "Stale", unknown: "Unknown" }
  const FRESHNESS_DOT: Record<FreshnessState, string> = { fresh: FRESH_DOT, stale: STALE_RING, unknown: UNKNOWN_DOT }
  const KIND_ORDER: NodeKind[] = ["page", "source", "symbol"]
  const KIND_LABEL: Record<NodeKind, string> = { page: "pages", source: "sources", symbol: "symbols" }
  const KIND_DOT: Record<NodeKind, string> = { page: PAGE_FILL, source: SOURCE_FILL, symbol: SYMBOL_FILL }

  /**
   * Toggle structure follows the graph; pressed state follows the filters.
   * Rebuilt only on graph change so toggling never steals keyboard focus.
   */
  function buildToggles() {
    const counts = viewCounts(graph, defaultFilters())
    chips.replaceChildren()
    for (const state of FRESHNESS_ORDER) {
      if (counts.byFreshness[state] === 0) continue
      const button = doc.createElement("button")
      button.className = "chip"
      const dot = doc.createElement("span")
      dot.className = "dot"
      dot.style.background = FRESHNESS_DOT[state]
      dot.setAttribute("aria-hidden", "true")
      button.append(dot, doc.createTextNode(`${FRESHNESS_LABEL[state]} (${counts.byFreshness[state]})`))
      button.setAttribute("aria-pressed", String(filters.freshness[state]))
      button.onclick = () => {
        filters.freshness[state] = !filters.freshness[state]
        button.setAttribute("aria-pressed", String(filters.freshness[state]))
        selected = undefined
        matchIndex = 0
        render()
      }
      chips.append(button)
    }
    legend.replaceChildren()
    for (const kind of KIND_ORDER) {
      const button = doc.createElement("button")
      button.className = "kind"
      const dot = doc.createElement("span")
      dot.className = "dot"
      dot.style.background = KIND_DOT[kind]
      dot.setAttribute("aria-hidden", "true")
      button.append(dot, doc.createTextNode(`${KIND_LABEL[kind]} (${counts.byKind[kind]})`))
      button.setAttribute("aria-pressed", String(filters.kinds[kind]))
      button.onclick = () => {
        filters.kinds[kind] = !filters.kinds[kind]
        button.setAttribute("aria-pressed", String(filters.kinds[kind]))
        selected = undefined
        matchIndex = 0
        render()
      }
      legend.append(button)
    }
    for (const page of graph.nodes.filter((node) => node.kind === "page").sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const color = topicColor(page.id)
      if (!color) continue
      const swatch = doc.createElement("span")
      swatch.className = "topic"
      swatch.setAttribute("role", "img")
      swatch.setAttribute("aria-label", page.label)
      swatch.title = page.label
      swatch.style.background = color.page
      legend.append(swatch)
    }
    for (const text of [
      "size = visible connections",
      "+N = recorded references not in this snapshot",
      "amber edge: selected node depends on target",
      "teal edge: target depends on selected node",
    ]) {
      const item = doc.createElement("span")
      item.className = "note"
      item.textContent = text
      legend.append(item)
    }
  }

  function previewOn(hover: HTMLElement, id: string) {
    hover.onmouseenter = () => {
      hovered = id
      applyEmphasis()
    }
    hover.onmouseleave = () => {
      if (hovered === id) hovered = undefined
      applyEmphasis()
    }
    hover.onfocus = () => {
      hovered = id
      applyEmphasis()
    }
    hover.onblur = () => {
      if (hovered === id) hovered = undefined
      applyEmphasis()
    }
  }

  function renderOutline() {
    const outline = viewCounts(graph, defaultFilters()).outline
    outlineBody.replaceChildren()
    if (outline.length === 0) {
      outlineWrap.style.display = "none"
      return
    }
    outlineWrap.style.display = ""
    let rows = 0
    const addSymbol = (parent: HTMLElement, symbol: OutlineSymbol) => {
      if (rows >= OUTLINE_ROWS) return
      rows++
      const item = doc.createElement("li")
      const button = doc.createElement("button")
      button.textContent = symbol.detail || symbol.label
      button.title = symbol.detail || symbol.label
      if (symbol.id === selected) button.className = "selected"
      previewOn(button, symbol.id)
      button.onclick = () => {
        const target = graph.nodes.find((candidate) => candidate.id === symbol.id)
        if (target) select(target)
      }
      item.append(button)
      if (symbol.children.length > 0) {
        const nested = doc.createElement("ul")
        for (const child of symbol.children) addSymbol(nested, child)
        if (nested.childElementCount > 0) item.append(nested)
      }
      parent.append(item)
    }
    const list = doc.createElement("ul")
    for (const source of outline) {
      if (rows >= OUTLINE_ROWS) break
      const item = doc.createElement("li")
      const button = doc.createElement("button")
      button.textContent = source.path
      button.title = source.path
      if (source.id === selected) button.className = "selected"
      previewOn(button, source.id)
      button.onclick = () => {
        const target = graph.nodes.find((candidate) => candidate.id === source.id)
        if (target) select(target)
      }
      item.append(button)
      const nested = doc.createElement("ul")
      for (const symbol of source.symbols) addSymbol(nested, symbol)
      if (nested.childElementCount > 0) item.append(nested)
      list.append(item)
    }
    outlineBody.append(list)
    const total = countOutlineSymbols(outline)
    if (total > rows) {
      const more = doc.createElement("p")
      more.textContent = `+${total - rows} more symbols`
      outlineBody.append(more)
    }
  }

  function render() {
    refreshVisibility()
    positionElements()
    applyEmphasis()
    renderList()
    renderDetail()
    renderCounts()
    renderOutline()
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
      group.setAttribute("class", node.kind === "page" ? "node page" : "node")
      group.setAttribute("data-id", node.id)
      const drawn = node.kind === "page" ? Math.max(node.radius, 14) : node.kind === "symbol" ? Math.max(5, node.radius - 2) : node.radius
      const circle = doc.createElementNS(svgNS, "circle")
      circle.setAttribute("r", String(drawn))
      const color = topicColor(node.id)
      circle.setAttribute(
        "fill",
        node.kind === "symbol" ? SYMBOL_FILL : node.kind === "page" ? (color?.page ?? PAGE_FILL) : (color?.source ?? SOURCE_FILL),
      )
      const label = doc.createElementNS(svgNS, "text")
      label.setAttribute("y", String(drawn + 14))
      label.textContent = truncateLabel(info.label)
      if (node.kind === "page") label.style.fill = topicColor(node.id)?.page ?? "#edf6ff"
      const title = doc.createElementNS(svgNS, "title")
      title.textContent = `${info.label} (${node.kind}, ${info.freshness}, ${plural(node.degree, "connection", "connections")} shown)`
      group.append(circle, label, title)
      if (info.freshness === "stale") {
        const ring = doc.createElementNS(svgNS, "circle")
        ring.setAttribute("class", "ring")
        ring.setAttribute("r", String(node.radius + 3.5))
        ring.setAttribute("fill", "none")
        ring.setAttribute("stroke", STALE_RING)
        ring.setAttribute("stroke-width", "2")
        ring.setAttribute("aria-hidden", "true")
        group.insertBefore(ring, label)
      }
      const omitted = info.recordedReferences - node.degree
      if (omitted > 0) {
        const badge = doc.createElementNS(svgNS, "g")
        badge.setAttribute("class", "badge")
        const pill = doc.createElementNS(svgNS, "circle")
        pill.setAttribute("cx", String(node.radius * 0.75))
        pill.setAttribute("cy", String(-node.radius * 0.75))
        pill.setAttribute("r", "7.5")
        pill.setAttribute("fill", "#1c2c3c")
        pill.setAttribute("stroke", "#b5c5d7")
        pill.setAttribute("stroke-width", "1.2")
        const count = doc.createElementNS(svgNS, "text")
        count.setAttribute("x", String(node.radius * 0.75))
        count.setAttribute("y", String(-node.radius * 0.75 + 2.5))
        count.textContent = omitted > 99 ? "+99" : `+${omitted}`
        const note = doc.createElementNS(svgNS, "title")
        note.textContent = `+${omitted} recorded references not in this snapshot`
        badge.append(pill, count, note)
        group.append(badge)
      }
      group.addEventListener("click", () => {
        if (suppressClick) {
          suppressClick = false
          return
        }
        select(info)
      })
      group.addEventListener("mouseenter", () => {
        hovered = node.id
        applyEmphasis()
      })
      group.addEventListener("mouseleave", () => {
        if (hovered === node.id) hovered = undefined
        applyEmphasis()
      })
      group.addEventListener("pointerdown", (event) => {
        if (disposed || layout === undefined) return
        // No preventDefault: touch scrolling is already disabled via touch-action,
        // and canceling pointerdown would risk the click-to-select path.
        const pointerId = event.pointerId
        const startX = event.clientX,
          startY = event.clientY
        let moved = false
        try {
          group.setPointerCapture(pointerId)
        } catch {
          // Capture may fail for synthetic or edge-case pointers; the drag
          // still tracks as long as moves reach the group.
        }
        const move = (moveEvent: PointerEvent) => {
          if (moveEvent.pointerId !== pointerId) return
          if (!moved && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 3) return
          moved = true
          group.classList.add("dragging")
          const ctm = svg.getScreenCTM()
          if (!ctm) return
          const world = new DOMPoint(moveEvent.clientX, moveEvent.clientY).matrixTransform(ctm.inverse())
          node.fx = world.x
          node.fy = world.y
          if (reducedMotion) {
            // No simulation ticks run under reduced motion, so a drag positions
            // the node directly; neighbors stay put and no reheating occurs.
            node.x = world.x
            node.y = world.y
          }
          positionElements()
        }
        const up = (upEvent: PointerEvent) => {
          if (upEvent.pointerId !== pointerId) return
          group.removeEventListener("pointermove", move)
          group.removeEventListener("pointerup", up)
          group.removeEventListener("pointercancel", up)
          group.classList.remove("dragging")
          if (moved) {
            suppressClick = true
            if (!reducedMotion && layout !== undefined) layout.reheat(0.3)
          }
        }
        group.addEventListener("pointermove", move)
        group.addEventListener("pointerup", up)
        group.addEventListener("pointercancel", up)
      })
      nodeLayer.append(group)
      const els = { group, circle, label, node }
      nodeEls.push(els)
      nodeElsById.set(node.id, els)
    }
  }

  function buildLayout() {
    topics = citingTopics(graph.nodes, graph.edges)
    layout?.stop()
    hasFitted = false
    layout = createForceLayout(graph, {
      reducedMotion,
      onTick: positionElements,
      onEnd: () => {
        positionElements()
        if (!hasFitted) {
          hasFitted = true
          if (!cameraTouched) fitView()
        }
      },
    })
    if (reducedMotion) positionElements()
    buildElements()
  }

  function select(node: WikiGraphNode) {
    // Selection only changes emphasis, never positions, so a still-running
    // simulation simply settles beneath it instead of reflowing.
    selected = node.id
    render()
    detailHeading.focus()
  }

  function pan(dx: number, dy: number) {
    offsetX += dx
    offsetY += dy
    cameraTouched = true
    viewBox()
    applyEmphasis()
  }
  for (const [label, action] of [
    ["Zoom in", () => zoomBy(1.5)],
    ["Zoom out", () => zoomBy(1 / 1.5)],
    ["Pan left", () => pan(-100 / zoom, 0)],
    ["Pan right", () => pan(100 / zoom, 0)],
    ["Pan up", () => pan(0, -100 / zoom)],
    ["Pan down", () => pan(0, 100 / zoom)],
  ] as const) {
    const button = html("button", navigation, label)
    button.onclick = () => action()
  }
  svg.onkeydown = (event) => {
    const step = 100 / zoom
    if (event.key === "+" || event.key === "=") zoomBy(1.5)
    else if (event.key === "-") zoomBy(1 / 1.5)
    else if (event.key === "ArrowLeft") pan(-step, 0)
    else if (event.key === "ArrowRight") pan(step, 0)
    else if (event.key === "ArrowUp") pan(0, -step)
    else if (event.key === "ArrowDown") pan(0, step)
    else return
    event.preventDefault()
  }

  // Wheel zooms toward the pointer, the same curve as d3-zoom. Buttons and keys zoom toward the canvas center.
  const onWheel = (event: WheelEvent) => {
    if (disposed) return
    const target = event.target
    if (target instanceof Element && target.closest(".hud")) return
    event.preventDefault()
    const factor = wheelZoomFactor(event.deltaY, event.deltaMode, event.ctrlKey)
    if (factor === 1) return
    applyZoom(factor, event.clientX, event.clientY)
  }
  canvas.addEventListener("wheel", onWheel, { passive: false })
  // Refit until the user pans or zooms, so a resize does not leave the picture letterboxed.
  const resize = new ResizeObserver(() => {
    if (disposed) return
    if (!cameraTouched) fitView()
    else viewBox()
  })
  resize.observe(canvas)

  svg.addEventListener("pointerdown", (event) => {
    if (disposed || event.button !== 0) return
    const target = event.target
    if (target instanceof Element && target.closest(".node")) return
    const pointerId = event.pointerId
    const startX = event.clientX
    const startY = event.clientY
    let lastX = startX
    let lastY = startY
    let moved = false
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      if (!moved && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 3) return
      moved = true
      const ctm = svg.getScreenCTM()
      if (ctm) {
        const from = new DOMPoint(lastX, lastY).matrixTransform(ctm.inverse())
        const to = new DOMPoint(moveEvent.clientX, moveEvent.clientY).matrixTransform(ctm.inverse())
        offsetX += from.x - to.x
        offsetY += from.y - to.y
        cameraTouched = true
        viewBox()
      }
      lastX = moveEvent.clientX
      lastY = moveEvent.clientY
    }
    const up = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return
      svg.removeEventListener("pointermove", move)
      svg.removeEventListener("pointerup", up)
      svg.removeEventListener("pointercancel", up)
      if (moved) suppressCanvasClick = true
    }
    svg.addEventListener("pointermove", move)
    svg.addEventListener("pointerup", up)
    svg.addEventListener("pointercancel", up)
  })

  svg.addEventListener("click", (event) => {
    if (suppressCanvasClick) {
      suppressCanvasClick = false
      return
    }
    if (event.target === svg && selected !== undefined) {
      selected = undefined
      render()
    }
  })
  search.oninput = () => {
    selected = undefined
    filters.query = search.value
    matchIndex = 0
    render()
  }
  search.onkeydown = (event) => {
    if (event.key === "Enter" && lastVisible.length > 0) {
      event.preventDefault()
      const node = lastVisible[matchIndex % lastVisible.length]
      matchIndex++
      select(node)
    }
  }
  const doReset = () => {
    selected = undefined
    filters = defaultFilters()
    matchIndex = 0
    search.value = ""
    if (layout)
      for (const node of layout.nodes) {
        node.fx = null
        node.fy = null
      }
    fitView()
    buildToggles()
    render()
  }
  reset.onclick = doReset
  overlayReset.onclick = doReset
  root.onkeydown = (event) => {
    if (event.key === "Escape") {
      if (doc.activeElement === search && selected !== undefined) {
        selected = undefined
        render()
      } else {
        search.focus()
      }
    }
  }
  element.append(root)
  buildLayout()
  buildToggles()
  fitView()
  render()
  return {
    update(input: unknown) {
      if (disposed) throw new Error("Viewer is disposed")
      const next = parseWikiGraph(input)
      matchIndex = 0
      if (next.snapshot !== graph.snapshot) {
        selected = undefined
        filters = defaultFilters()
        search.value = ""
        graph = next
        buildLayout()
        buildToggles()
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
      for (const button of root.querySelectorAll("button")) {
        button.onclick = null
        button.onmouseenter = null
        button.onmouseleave = null
        button.onfocus = null
        button.onblur = null
      }
      root.remove()
      root.replaceChildren()
      root.onkeydown = null
      svg.onkeydown = null
      canvas.removeEventListener("wheel", onWheel)
      resize.disconnect()
      search.oninput = null
      search.onkeydown = null
      reset.onclick = null
      overlayReset.onclick = null
    },
  }
}
export type { WikiGraph } from "@ax-code/ax-wiki/graph"
