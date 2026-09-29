import { parseWikiGraph } from "@ax-code/ax-wiki/graph"
import type { WikiGraphEdge, WikiGraphNode } from "@ax-code/ax-wiki/graph"
import { LAYOUT_WORLD, createForceLayout } from "./force-layout.js"
import type { ForceLayout, LayoutNode } from "./force-layout.js"
import {
  countsBarText,
  defaultFilters,
  focusDirection,
  isDefaultFilters,
  isNodeVisible,
  overlayText,
  viewCounts,
  viewState,
} from "./visibility.js"
import type { FreshnessState, NodeKind, ViewFilters } from "./visibility.js"

export const viewerCss = `
.axwv{font:14px system-ui,sans-serif;color:#dce6f2;background:#101923;padding:20px;border-radius:12px;box-sizing:border-box}
.axwv *{box-sizing:border-box}.axwv h1{font-size:24px;margin:0 0 8px}.axwv p{line-height:1.5;overflow-wrap:anywhere}
.axwv button,.axwv input,.axwv select{font:inherit;color:inherit;background:#1c2c3c;border:1px solid #64778b;border-radius:6px;padding:8px}
.axwv button{cursor:pointer}.axwv button:hover{background:#30455c}.axwv :focus-visible{outline:3px solid #78dacc;outline-offset:2px}
.axwv .controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:12px 0}.axwv .layout{display:grid;grid-template-columns:minmax(0,2fr) minmax(260px,1fr);gap:16px}
.axwv .canvas{position:relative;height:520px;overflow:hidden;border:1px solid #64778b;border-radius:8px}.axwv svg{width:100%;height:100%}
.axwv .node{cursor:grab;touch-action:none}.axwv .node.dragging{cursor:grabbing}.axwv svg text{pointer-events:none;font-size:10px;fill:#edf6ff;text-anchor:middle}
.axwv .edge{fill:none;stroke:#64778b}.axwv .arrow{fill:none;stroke:#b5c5d7}
.axwv .badge text{font-size:7.5px;font-weight:700;fill:#dce6f2}
.axwv .legend{display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center;margin:8px 0 0;font-size:12px;color:#b5c5d7}
.axwv .list{max-height:260px;overflow:auto;padding:0;list-style:none}.axwv .list button{width:100%;text-align:left;margin:3px 0;overflow-wrap:anywhere}
.axwv .detail{white-space:pre-wrap;overflow-wrap:anywhere}.axwv .muted{color:#b5c5d7}.axwv .selected{border-color:#78dacc}
.axwv .chips{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:12px 0}
.axwv .dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}
.axwv .chip[aria-pressed="false"],.axwv .kind[aria-pressed="false"]{opacity:.6;text-decoration:line-through}
.axwv .counts{font-variant-numeric:tabular-nums}
.axwv .notice{border:1px solid #64778b;border-radius:8px;padding:8px 12px;color:#b5c5d7}
.axwv .overlay{position:absolute;inset:0;display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;text-align:center;background:rgba(16,25,35,.94);padding:24px}
.axwv .overlay p{margin:0;max-width:52ch}
@media(max-width:760px){.axwv .layout{grid-template-columns:1fr}.axwv .canvas{height:360px}}
`

const MIN_ZOOM = 0.25
const MAX_ZOOM = 8
const PAGE_FILL = "#245d65"
const SOURCE_FILL = "#30455c"
const PAGE_RING = "#9fb3c8"
const SELECT_RING = "#78dacc"
const STALE_RING = "#e0a63c"
const FRESH_DOT = "#7cc78a"
const UNKNOWN_DOT = "#64778b"
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

/** An isolated instance; invalid updates preserve the previous view. */
export function mount(element: HTMLElement, input: unknown, options: { injectStyles?: boolean } = {}) {
  let graph = parseWikiGraph(input)
  let layout: ForceLayout | undefined
  let selected: string | undefined
  let hovered: string | undefined
  let suppressClick = false
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
    "Wiki page → referenced source. Recorded membership, not a code dependency or call graph. Node size is how many of those listings are in this snapshot.",
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
    "Page to source relationships; use the adjacent list for keyboard navigation. When focused, plus and minus zoom, arrow keys pan. Drag nodes to rearrange; activating empty canvas clears the selection.",
  )
  svg.tabIndex = 0
  canvas.append(svg)
  const overlay = html("div", canvas)
  overlay.className = "overlay"
  overlay.style.display = "none"
  const overlayMessage = html("p", overlay)
  const overlayReset = html("button", overlay, "Reset filters")
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
    zoom = Math.min(1, LAYOUT_WORLD.width / (maxX - minX), LAYOUT_WORLD.height / (maxY - minY))
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
      path.setAttribute(
        "opacity",
        dimmed ? String(DIMMED_EDGE) : incident ? String(FOCUS_EDGE_OPACITY) : String(REST_EDGE),
      )
      path.setAttribute(
        "stroke",
        !dimmed && direction === "outgoing" ? FOCUS_OUT : !dimmed && direction === "incoming" ? FOCUS_IN : "#64778b",
      )
      arrow.setAttribute(
        "opacity",
        dimmed ? String(DIMMED_EDGE) : incident ? String(FOCUS_EDGE_OPACITY) : String(REST_EDGE),
      )
      if (!dimmed && incident) arrow.setAttribute("stroke", direction === "outgoing" ? FOCUS_OUT : FOCUS_IN)
      else arrow.removeAttribute("stroke")
    }
    for (const { group, circle, label, node } of nodeEls) {
      const dimmed = visibleById.get(node.id) !== true || (near !== undefined && !near.has(node.id))
      group.setAttribute("opacity", dimmed ? String(DIMMED_NODE) : "1")
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
      const emphasized = near !== undefined && near.has(node.id)
      const showLabel = emphasized || (node.kind === "page" ? zoom >= 0.7 : zoom >= 2)
      label.setAttribute("display", showLabel ? "" : "none")
    }
  }

  function renderCounts() {
    const counts = viewCounts(graph, filters)
    const state = viewState(graph, filters)
    status.textContent = countsBarText(counts, state, filters.query)
    identityText.textContent = `Snapshot: ${graph.snapshot}\nScope: recorded Wiki manifest. Code relationships unavailable.\nWiki page → referenced source. Recorded membership, not a code dependency or call graph. Node size is how many of those listings are in this snapshot.`
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
    const visible = graph.nodes.filter((node) => (!near || near.has(node.id)) && isNodeVisible(node, filters))
    lastVisible = visible
    list.replaceChildren()
    for (const node of visible) {
      const item = html("li", list)
      const button = html("button", item, `${node.kind}: ${node.label} · ${node.freshness}`)
      const degree = layout?.byId.get(node.id)?.degree ?? 0
      button.title = `${plural(degree, "connection", "connections")} shown of ${plural(node.recordedReferences, "recorded reference", "recorded references")}`
      if (node.id === selected) button.className = "selected"
      button.onclick = () => select(node)
      button.onmouseenter = () => {
        hovered = node.id
        applyEmphasis()
      }
      button.onmouseleave = () => {
        if (hovered === node.id) hovered = undefined
        applyEmphasis()
      }
      button.onfocus = () => {
        hovered = node.id
        applyEmphasis()
      }
      button.onblur = () => {
        if (hovered === node.id) hovered = undefined
        applyEmphasis()
      }
    }
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
    const summary = node.summary ? `\nSummary: ${node.summary}` : ""
    const anchors =
      node.symbols.length > 0
        ? `\n\nAnchored symbols (${node.symbols.length}):\n${node.symbols.map((anchor) => `- ${anchor.name} (${anchor.provenance})`).join("\n")}`
        : ""
    detail.textContent =
      `${node.kind === "page" ? "Page" : "Source"}: ${node.label}\nLocation: ${node.path}${summary}\nFreshness: ${node.freshness} — ${FRESHNESS_NOTE[node.freshness]}\n${line}\nProvenance: Wiki manifest membership` +
      anchors +
      (rows.length ? `\n\n${rows.join("\n")}` : "")
  }

  const FRESHNESS_ORDER: FreshnessState[] = ["fresh", "stale", "unknown"]
  const FRESHNESS_LABEL: Record<FreshnessState, string> = { fresh: "Fresh", stale: "Stale", unknown: "Unknown" }
  const FRESHNESS_DOT: Record<FreshnessState, string> = { fresh: FRESH_DOT, stale: STALE_RING, unknown: UNKNOWN_DOT }
  const KIND_ORDER: NodeKind[] = ["page", "source"]

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
      dot.style.background = kind === "page" ? PAGE_FILL : SOURCE_FILL
      dot.setAttribute("aria-hidden", "true")
      button.append(dot, doc.createTextNode(`${kind === "page" ? "pages" : "sources"} (${counts.byKind[kind]})`))
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
    for (const text of [
      "size = visible connections",
      "+N = recorded references not in this snapshot",
      "amber edge: selected node depends on target",
      "teal edge: target depends on selected node",
    ]) {
      const item = doc.createElement("span")
      item.textContent = text
      legend.append(item)
    }
  }

  function render() {
    refreshVisibility()
    positionElements()
    applyEmphasis()
    renderList()
    renderDetail()
    renderCounts()
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

  svg.addEventListener("click", (event) => {
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
      search.oninput = null
      search.onkeydown = null
      reset.onclick = null
      overlayReset.onclick = null
    },
  }
}
export type { WikiGraph } from "@ax-code/ax-wiki/graph"
