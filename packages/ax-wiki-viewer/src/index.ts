import { parseWikiGraph } from "@ax-code/ax-wiki/graph"
import type { WikiGraphEdge, WikiGraphNode } from "@ax-code/ax-wiki/graph"
import { fitCamera, wheelZoomFactor, zoomAbout } from "./camera.js"
import { LAYOUT_WORLD, createForceLayout } from "./force-layout.js"
import { createRadialLayout } from "./radial-layout.js"
import { ARC_MAX_HEIGHT, createArcLayout } from "./arc-layout.js"
import { createTreemapLayout } from "./treemap-layout.js"
import { deriveHierarchy } from "./hierarchy.js"
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
.axwv{--bg:#0d1520;--surface:#142130;--surface-2:#1b2c3f;--canvas:#0a111a;--line:#27394d;--line-2:#3a5068;--text:#e3ecf6;--muted:#93a6ba;--accent:#78dacc;--amber:#e0a63c;display:flex;flex-direction:column;height:100%;min-height:100%;font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--text);background:var(--bg);padding:14px 20px 16px;box-sizing:border-box;-webkit-font-smoothing:antialiased}
.axwv *{box-sizing:border-box}
.axwv h1{font-size:17px;font-weight:650;margin:0;letter-spacing:-.01em;order:0}
.axwv p{overflow-wrap:anywhere;margin:2px 0}
.axwv>h1+p{order:0;color:var(--muted);font-size:13px;margin:2px 0 0}
.axwv button,.axwv input,.axwv select{font:inherit;font-size:13px;color:inherit;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:6px 11px;transition:background .12s,border-color .12s,color .12s}
.axwv button{cursor:pointer}
.axwv button:hover{background:var(--surface-2);border-color:var(--line-2)}
.axwv button:active{transform:translateY(.5px)}
.axwv input{min-width:240px;padding-left:10px}
.axwv input::placeholder{color:#6d8197}
.axwv :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.axwv .controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:12px 0 0;order:1;color:var(--muted);font-size:13px}
.axwv .controls label{display:flex;align-items:center;gap:8px}
.axwv .chips,.axwv .legend{order:1}
.axwv .chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:10px 0 0}
.axwv .chips button,.axwv .legend button{border-radius:999px;padding:3px 11px;font-size:12px;background:transparent}
.axwv .chips button:hover,.axwv .legend button:hover{background:var(--surface)}
.axwv .chip[aria-pressed="false"],.axwv .kind[aria-pressed="false"]{opacity:.5;text-decoration:line-through}
.axwv .legend{display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center;margin:6px 0 0;font-size:12px;color:var(--muted)}
.axwv .legend .topic{width:11px;height:11px;border-radius:50%;display:inline-block;margin:0 1px;box-shadow:0 0 0 2px var(--bg)}
.axwv .counts{font-variant-numeric:tabular-nums;color:var(--muted);font-size:12px;margin-top:8px}
.axwv .counts{order:0}
.axwv>details{order:3;margin:8px 0 0;color:var(--muted);font-size:13px}
.axwv>details:first-of-type{order:0}
.axwv details summary{cursor:pointer;color:var(--muted);padding:2px 0;user-select:none}
.axwv details summary:hover{color:var(--text)}
.axwv .layout{order:2;flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) minmax(240px,320px);gap:14px;margin-top:12px}
.axwv>.notice{order:3}
.axwv .canvas{position:relative;height:100%;min-height:420px;overflow:hidden;border:1px solid var(--line);border-radius:14px;background:radial-gradient(ellipse at 50% 40%,#10202f 0%,var(--canvas) 70%);touch-action:none;user-select:none;-webkit-user-select:none;box-shadow:inset 0 1px 0 rgba(255,255,255,.03)}
.axwv svg{width:100%;height:100%;display:block;-webkit-user-drag:none}
.axwv .node{cursor:grab;touch-action:none}.axwv .node.dragging{cursor:grabbing}
.axwv svg text{pointer-events:none;font-size:11px;text-anchor:middle;fill:#edf6ff;font-family:inherit}
.axwv svg .node>text{paint-order:stroke;stroke:var(--canvas);stroke-width:4px;stroke-linejoin:round}
.axwv svg .node.page>text{text-anchor:end;font-size:22px;font-weight:650;letter-spacing:.01em}
.axwv .edge{fill:none;stroke:#64778b}.axwv .arrow{fill:none;stroke:#b5c5d7}
.axwv .badge text{font-size:7.5px;font-weight:700;fill:#dce6f2}
.axwv .side{min-height:0;overflow:auto;padding:12px;border:1px solid var(--line);border-radius:14px;background:var(--surface);scrollbar-width:thin;scrollbar-color:var(--line-2) transparent}
.axwv .side h2{font-size:11px;font-weight:650;margin:0 0 8px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.axwv .list{max-height:none;overflow:visible;padding:0;margin:0 0 16px;list-style:none}
.axwv .list button{width:100%;text-align:left;margin:0 0 1px;padding:5px 8px;background:transparent;border-color:transparent;border-radius:6px;overflow-wrap:anywhere;font-size:13px;color:#c9d6e4}
.axwv .list button:hover{background:var(--surface-2);border-color:transparent;color:var(--text)}
.axwv .detail{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;font-size:13px;color:#c9d6e4;line-height:1.55}
.axwv .muted{color:#b5c5d7}
.axwv .list button.selected,.axwv .outline button.selected{border-color:var(--accent);background:#173342;color:var(--text)}
.axwv .dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}
.axwv .notice{border:1px solid var(--line-2);border-radius:10px;padding:8px 12px;color:#b5c5d7;background:var(--surface)}
.axwv .overlay{position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;text-align:center;background:rgba(10,17,26,.94);padding:24px}
.axwv .overlay p{margin:0;max-width:52ch;color:var(--muted)}
.axwv .hud{position:absolute;right:12px;bottom:12px;z-index:2;display:grid;grid-template-columns:repeat(3,32px);gap:4px;align-items:center;margin:0;padding:6px;border:1px solid var(--line);border-radius:12px;background:rgba(13,21,32,.82);backdrop-filter:blur(6px)}
.axwv .hud button{padding:0;height:32px;width:32px;line-height:1;font-size:16px;background:transparent;border-color:transparent;border-radius:8px;display:flex;align-items:center;justify-content:center}
.axwv .hud button:hover{background:var(--surface-2)}
.axwv .view-caption{order:1;margin:6px 0 0;font-size:12px;color:var(--muted)}
.axwv .sr-only{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.axwv .views button{display:inline-flex;align-items:center;gap:6px}
.axwv .view-icon{width:14px;height:14px;display:inline-block;fill:none;stroke:currentColor;stroke-width:1.3;stroke-linecap:round;flex:none;opacity:.85}
.axwv .view-icon circle{fill:currentColor;stroke:none}
.axwv .tour{display:inline-flex;align-items:center;gap:8px;margin-left:6px;font-size:12px;color:var(--muted)}
.axwv .tour button{padding:4px 10px;font-size:12px;background:transparent}
.axwv .tour button[aria-pressed="true"]{border-color:var(--accent);color:var(--text)}
.axwv .tour button:disabled{opacity:.45;cursor:not-allowed}
.axwv .tour-status{font-variant-numeric:tabular-nums;white-space:nowrap}
.axwv .views{display:inline-flex;margin-left:6px;border:1px solid var(--line);border-radius:9px;overflow:hidden}
.axwv .views button{border:0;border-radius:0;background:transparent;padding:6px 12px;color:var(--muted)}
.axwv .views button+button{border-left:1px solid var(--line)}
.axwv .views button[aria-pressed="true"]{background:#173342;color:var(--text);box-shadow:inset 0 -2px 0 var(--accent)}
.axwv svg.swap{animation:axwswap .28s ease-out}
@keyframes axwswap{from{opacity:0}to{opacity:1}}
.axwv .tip{position:absolute;z-index:4;pointer-events:none;flex-direction:column;gap:2px;max-width:320px;padding:8px 10px;border:1px solid var(--line-2);border-radius:10px;background:rgba(13,21,32,.96);box-shadow:0 8px 24px rgba(0,0,0,.45);font-size:12px;color:var(--muted)}
.axwv .tip strong{color:var(--text);font-size:13px;overflow-wrap:anywhere}
.axwv .tip code{font:11px ui-monospace,SFMono-Regular,Menlo,monospace;color:#b5c5d7;overflow-wrap:anywhere}
.axwv .zoom-readout{grid-column:span 2;text-align:center;font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}
.axwv .key{display:inline-block;margin:0 0 0 10px;padding-left:12px;border-left:1px solid var(--line);font-size:12px}
.axwv .key[open]{display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center}
.axwv .key summary{font-size:12px}
.axwv .key .note{margin:0!important;padding:0!important;border:0!important;opacity:1}
.axwv .controls .chips{margin:0 0 0 auto}
.axwv .list ul{list-style:none;margin:0;padding:0 0 0 14px;border-left:1px solid var(--line);margin-left:9px}
.axwv .list .row{display:flex;align-items:center;gap:2px}
.axwv .list .row .node-label{flex:1;min-width:0;margin:0}
.axwv .list .twisty,.axwv .list .spacer{flex:none;width:20px;height:24px;padding:0;margin:0;display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--text)}
.axwv .list .twisty::before{content:none}
.axwv .list .twisty .caret{display:inline-block;font-size:13px;line-height:1;transition:transform .12s}
.axwv .list [aria-expanded="true"]>.row .caret{transform:rotate(90deg)}
.axwv .list .meta{flex:none;font-size:11px;color:var(--muted);padding-right:6px;font-variant-numeric:tabular-nums}
.axwv .tree-tools{display:flex;gap:6px;margin:-2px 0 8px}
.axwv .tree-tools button{padding:2px 9px;font-size:11px;border-radius:999px;background:transparent;color:var(--muted)}
.axwv .list .node-label::before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:8px;background:#64778b}
.axwv .list button[data-kind=page]::before{background:#3db8c4}
.axwv .list button[data-kind=source]::before{background:#4d7cb4}
.axwv .list button[data-kind=symbol]::before{background:#b8974f}
.axwv .outline ul{list-style:none;margin:2px 0;padding-left:18px}
.axwv .outline>ul{padding-left:0}
.axwv .outline button{background:none;border-color:transparent;padding:3px 8px;text-align:left;overflow-wrap:anywhere;font-size:13px}
.axwv .outline button:hover{background:var(--surface-2)}
@media(max-width:760px){.axwv{padding:12px}.axwv .layout{grid-template-columns:1fr}.axwv .canvas{height:420px;min-height:420px}.axwv .key{display:none}.axwv input{min-width:0;width:100%}}
@media(prefers-reduced-motion:reduce){.axwv *{transition:none!important;animation:none!important}}
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

/** Layout registry. Adding a view is one entry here plus a layout factory in buildLayout. */
const VIEWS = [
  {
    id: "force",
    label: "Force",
    question: "Who cites what? Pages, files and symbols placed by their connections.",
    hint: "Force-directed lanes: pages, symbols, files",
  },
  {
    id: "radial",
    label: "Radial",
    question: "What surrounds each page? Files fan out on a ring and cross links bundle through the center.",
    hint: "Radial cluster: every file and symbol leaf on the outer ring",
  },
  {
    id: "arc",
    label: "Arc",
    question: "How do files depend on each other? Citations arc above the line, imports below.",
    hint: "Arc diagram: nodes on one line, citations above and imports below",
  },
  {
    id: "treemap",
    label: "Treemap",
    question: "Where is the evidence concentrated? Bigger cells have more connections.",
    hint: "Nested treemap: pages contain files, files contain symbols",
  },
] as const
/** 14x14 stroke glyphs, one per view, so the four choices are recognizable at a glance. */
const VIEW_ICONS: Record<string, string[]> = {
  force: ["M3 7 L11 3.5", "M3 7 L11 10.5", "o 3 7 1.6", "o 11 3.5 1.6", "o 11 10.5 1.6"],
  radial: ["o 7 7 4.8", "o 7 2.2 1", "o 11.8 7 1", "o 7 11.8 1", "o 2.2 7 1"],
  arc: ["M2 10.5 A5 5 0 0 1 12 10.5", "o 2 10.5 1.2", "o 12 10.5 1.2", "o 7 10.5 1.2"],
  treemap: ["r 1.5 1.5 6 11", "r 8.5 1.5 4 5", "r 8.5 8 4 4.5"],
}
type ViewId = (typeof VIEWS)[number]["id"]
/** Radial rings are non-overlapping by construction, so names can appear earlier than on the force map. */
const RADIAL_LABEL_ZOOM: Record<NodeKind, number> = { page: 0, source: 0.85, symbol: 1.4 }
const TREEMAP_LABEL_ZOOM: Record<NodeKind, number> = { page: 0, source: 0.5, symbol: 1.1 }
/** Fixed layouts keep their own positions; there is nothing to drag or reheat. */
const isStatic = (candidate: ForceLayout | undefined) =>
  candidate !== undefined && (candidate.radial !== undefined || candidate.arc !== undefined || candidate.treemap !== undefined)

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

/** Width of a 22px page title, including the halo, so fit can keep the name on screen. */
function pageLabelWidth(label: string): number {
  return Math.min(Array.from(label).length, 28) * 15 + 24
}

/** An isolated instance; invalid updates preserve the previous view. */
export function mount(
  element: HTMLElement,
  input: unknown,
  options: { injectStyles?: boolean; tour?: { enabled?: boolean; intervalMs?: number } } = {},
) {
  let graph = parseWikiGraph(input)
  let topics = new Map<string, CitingTopic>()
  const topicColor = (id: string) => {
    const topic = topics.get(id)
    return typeof topic === "number" ? TOPIC_PALETTE[topic % TOPIC_PALETTE.length] : undefined
  }
  let layout: ForceLayout | undefined
  let view: ViewId = "force"
  /** Explore tree: ids of expanded rows, and whether the next render should scroll the selection into view. */
  const expanded = new Set<string>()
  let scrollSelected = false
  let selected: string | undefined
  let hovered: string | undefined
  let suppressClick = false
  let dragging = false
  // A finished drag must not leave the neighborhood dimmed. The browser may
  // synthesize a mouseenter on whatever is under the cursor as capture ends.
  let hoverLock = false
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
  const viewSwitch = html("div", controls)
  viewSwitch.className = "views"
  viewSwitch.setAttribute("role", "group")
  viewSwitch.setAttribute("aria-label", "Map view")
  const viewButtons = new Map<ViewId, HTMLButtonElement>()
  for (const entry of VIEWS) {
    const button = html("button", viewSwitch, entry.label)
    button.title = `${entry.label}: ${entry.question}`
    button.prepend(viewIcon(entry.id))
    button.setAttribute("aria-pressed", String(entry.id === view))
    button.onclick = () => setView(entry.id)
    viewButtons.set(entry.id, button)
  }
  function viewIcon(id: string): SVGSVGElement {
    const icon = doc.createElementNS("http://www.w3.org/2000/svg", "svg")
    icon.setAttribute("viewBox", "0 0 14 14")
    icon.setAttribute("width", "14")
    icon.setAttribute("height", "14")
    icon.setAttribute("aria-hidden", "true")
    icon.setAttribute("class", "view-icon")
    for (const shape of VIEW_ICONS[id] ?? []) {
      // "o cx cy r" is a circle, "r x y w h" a rectangle, anything else a path.
      const parts = shape.split(" ")
      const kind = parts[0] === "o" ? "circle" : parts[0] === "r" ? "rect" : "path"
      const node = doc.createElementNS("http://www.w3.org/2000/svg", kind)
      if (kind === "circle") {
        node.setAttribute("cx", parts[1])
        node.setAttribute("cy", parts[2])
        node.setAttribute("r", parts[3])
      } else if (kind === "rect") {
        node.setAttribute("x", parts[1])
        node.setAttribute("y", parts[2])
        node.setAttribute("width", parts[3])
        node.setAttribute("height", parts[4])
        node.setAttribute("rx", "1")
      } else node.setAttribute("d", shape)
      icon.append(node)
    }
    return icon
  }
  const tourBox = html("div", controls)
  tourBox.className = "tour"
  const tourToggle = html("button", tourBox, "Auto-tour")
  tourToggle.setAttribute("aria-pressed", "false")
  tourToggle.title = "Cycle through the views while you are idle. Any activity resets the timer."
  const tourStatus = html("span", tourBox)
  tourStatus.className = "tour-status"
  tourStatus.setAttribute("aria-hidden", "true")
  const tourPause = html("button", tourBox, "Pause")
  tourStatus.style.display = tourPause.style.display = "none"
  const chips = html("div", controls)
  chips.className = "chips"
  chips.setAttribute("role", "group")
  chips.setAttribute("aria-label", "Filter by freshness")
  const viewCaption = html("p", root)
  viewCaption.className = "view-caption"
  const liveRegion = html("div", root)
  liveRegion.className = "sr-only"
  liveRegion.setAttribute("aria-live", "polite")
  liveRegion.setAttribute("aria-atomic", "true")
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
  const treeTools = html("div", aside)
  treeTools.className = "tree-tools"
  const expandAllButton = html("button", treeTools, "Expand all")
  const collapseAllButton = html("button", treeTools, "Collapse all")
  const list = html("ul", aside)
  list.className = "list"
  const detailHeading = html("h2", aside, "Evidence")
  detailHeading.tabIndex = -1
  const detail = html("p", aside)
  detail.className = "detail"
  const tip = html("div", canvas)
  tip.className = "tip"
  tip.setAttribute("aria-hidden", "true")
  tip.style.display = "none"
  const navigation = html("div", canvas)
  navigation.className = "hud"
  const zoomReadout = doc.createElement("span")
  zoomReadout.className = "zoom-readout"
  zoomReadout.setAttribute("aria-hidden", "true")

  const svgNS = "http://www.w3.org/2000/svg"
  const edgeLayer = doc.createElementNS(svgNS, "g")
  const nodeLayer = doc.createElementNS(svgNS, "g")
  svg.append(edgeLayer, nodeLayer)
  type EdgeEls = { path: SVGPathElement; arrow: SVGPathElement; edge: WikiGraphEdge }
  type NodeEls = { group: SVGGElement; circle: SVGElement; label: SVGTextElement; node: LayoutNode }
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
    zoomReadout.textContent = `${Math.round(zoom * 100)}%`
  }

  function fitView() {
    if (!layout || layout.nodes.length === 0) {
      zoom = 1
      offsetX = offsetY = 0
      viewBox()
      return
    }
    if (layout.bounds) {
      const fixed = fitCamera(layout.bounds, canvasAspect(), LAYOUT_WORLD.width)
      zoom = fixed.zoom
      offsetX = fixed.offsetX
      offsetY = fixed.offsetY
      cameraTouched = false
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
      if (node.kind === "page" && !layout.radial) {
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

  /**
   * Hierarchical edge bundling, simplified: tree edges stay straight along the
   * hierarchy; cross links bow toward the center in proportion to how far apart
   * their endpoints sit on the ring (beta 0.75 for citations, 0.3 for imports).
   */
  function radialEdgeCurve(a: LayoutNode, b: LayoutNode, edge: WikiGraphEdge): { d: string; head: string } {
    const meta = layout!.radial!
    const isTree = meta.treeParent.get(edge.to) === edge.from
    const beta = isTree ? 0 : edge.kind === "uses" ? 0.3 : 0.75
    const turn = Math.abs((((meta.angles.get(a.id)! - meta.angles.get(b.id)!) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI)
    const k = beta * Math.min(1, turn / (Math.PI / 2))
    const lerp = (n: LayoutNode) => ({ x: n.x + (meta.cx - n.x) * k, y: n.y + (meta.cy - n.y) * k })
    const c0 = lerp(a),
      c1 = lerp(b)
    const rim = (node: LayoutNode) => (node.kind === "page" ? Math.max(node.radius, 14) : node.radius)
    const away = (from: LayoutNode, toward: { x: number; y: number }, trim: number) => {
      const dx = toward.x - from.x,
        dy = toward.y - from.y
      const length = Math.hypot(dx, dy) || 1
      return { x: from.x + (dx / length) * trim, y: from.y + (dy / length) * trim, ux: dx / length, uy: dy / length }
    }
    const start = away(a, c0.x === a.x && c0.y === a.y ? b : c0, rim(a) + 2)
    const end = away(b, c1.x === b.x && c1.y === b.y ? a : c1, rim(b) + 4)
    const size = 9,
      wing = 4.5
    const p1x = end.x - end.ux * size + -end.uy * wing,
      p1y = end.y - end.uy * size + end.ux * wing
    const p2x = end.x - end.ux * size - -end.uy * wing,
      p2y = end.y - end.uy * size - end.ux * wing
    return {
      d: `M${start.x},${start.y} C${c0.x},${c0.y} ${c1.x},${c1.y} ${end.x},${end.y}`,
      head: `M${p1x},${p1y} L${end.x},${end.y} L${p2x},${p2y}`,
    }
  }

  /** Arc diagram edge: a half-ellipse above the baseline (citations) or below it (imports). */
  function arcEdgeCurve(a: LayoutNode, b: LayoutNode, edge: WikiGraphEdge): { d: string; head: string } {
    const dir = edge.kind === "uses" ? 1 : -1
    const rim = (node: LayoutNode) => (node.kind === "page" ? Math.max(node.radius, 14) : node.radius)
    const x1 = a.x,
      y1 = a.y + dir * (rim(a) + 2)
    const x2 = b.x,
      y2 = b.y + dir * (rim(b) + 4)
    const rx = Math.abs(x2 - x1) / 2
    if (rx < 0.5) return { d: `M${x1},${y1} L${x2},${y2}`, head: "" }
    const ry = Math.min(ARC_MAX_HEIGHT, Math.abs(x2 - x1) * 0.5)
    const sweep = (x2 > x1) === (dir === -1) ? 1 : 0
    // The ellipse meets the baseline vertically, so the arrow points straight at the node.
    const uy = -dir
    const size = 9,
      wing = 4.5
    return {
      d: `M${x1},${y1} A${rx},${ry} 0 0 ${sweep} ${x2},${y2}`,
      head: `M${x2 - uy * wing},${y2 - uy * size} L${x2},${y2} L${x2 + uy * wing},${y2 - uy * size}`,
    }
  }

  function positionElements() {
    if (!layout) return
    const { byId } = layout
    for (const { path, arrow, edge } of edgeEls) {
      const a = byId.get(edge.from)!,
        b = byId.get(edge.to)!
      const { d, head } = layout.radial
        ? radialEdgeCurve(a, b, edge)
        : layout.arc
          ? arcEdgeCurve(a, b, edge)
          : edgeCurve(a, b)
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
      const crossLink = layout.radial !== undefined && layout.radial.treeParent.get(edge.to) !== edge.from
      const restOpacity = crossLink
        ? 0.2
        : edge.kind === "references-source"
          ? 0.75
          : edge.kind === "uses"
            ? 0.45
            : 0.14
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
      // A treemap is about containment, so cross links appear only for the focused cell.
      const hideLine = layout.treemap !== undefined && !(incident && !dimmed)
      path.setAttribute("display", hideLine ? "none" : "")
      arrow.setAttribute("display", hideLine ? "none" : "")
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
    const candidates: { label: SVGTextElement; box: Box; priority: number }[] = []
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
      const radial = layout.radial
      const showLabel =
        label.textContent === ""
          ? false
          : layout.treemap
            ? emphasized || zoom >= TREEMAP_LABEL_ZOOM[node.kind]
            : radial || layout.arc
              ? emphasized || zoom >= RADIAL_LABEL_ZOOM[node.kind]
              : emphasized || (node.kind === "page" && namedPages <= 16) || zoom >= LABEL_ZOOM[node.kind]
      label.setAttribute("display", showLabel ? "" : "none")
      if (layout.treemap) {
        // Fixed inside each rectangle when the cell was built.
      } else if (layout.arc) {
        // Names hang below the baseline, reading downward, clear of the arcs above.
        const reach = (node.kind === "page" ? Math.max(node.radius, 14) : node.radius) + 8
        label.style.textAnchor = "start"
        label.setAttribute("x", String(reach))
        label.setAttribute("y", "4")
        label.setAttribute("transform", "rotate(90)")
      } else if (radial) {
        // Rotate with the ring and flip on the left half so text is never upside down.
        const angle = radial.angles.get(node.id) ?? 0
        const degrees = (angle * 180) / Math.PI
        const left = Math.cos(angle) < 0
        const reach = (node.kind === "page" ? Math.max(node.radius, 14) : node.radius) + 8
        label.style.textAnchor = left ? "end" : "start"
        label.setAttribute("x", String(left ? -reach : reach))
        label.setAttribute("y", "4")
        // Pages are few and sit near the center: keep their names horizontal so they cannot stack along a spoke.
        if (node.kind === "page") label.removeAttribute("transform")
        else label.setAttribute("transform", `rotate(${left ? degrees + 180 : degrees})`)
      } else if (node.kind === "page") {
        label.style.textAnchor = "end"
        label.setAttribute("x", String(-(Math.max(node.radius, 14) + 12)))
        label.setAttribute("y", String(pageLabelY.get(node.id) ?? 4))
      }
      if (showLabel && !dimmed) {
        const priority =
          node.id === selected || node.id === hovered
            ? 4
            : emphasized
              ? 3
              : node.kind === "page"
                ? 2
                : node.kind === "source"
                  ? 1
                  : 0
        candidates.push({ label, box: labelBox(node, label, pageLabelY.get(node.id) ?? 4), priority })
      }
    }
    // Greedy declutter: the most important names claim space first; a name that would
    // overlap an accepted one is hidden until zoom or focus makes room.
    candidates.sort((a, b) => b.priority - a.priority)
    const taken: Box[] = []
    for (const candidate of candidates) {
      const clash = taken.some(
        (box) =>
          candidate.box.x0 < box.x1 && candidate.box.x1 > box.x0 && candidate.box.y0 < box.y1 && candidate.box.y1 > box.y0,
      )
      if (clash) candidate.label.setAttribute("display", "none")
      else taken.push(candidate.box)
    }
  }

  type Box = { x0: number; y0: number; x1: number; y1: number }
  /** World-space footprint of a label. Text size is in world units, so this does not depend on zoom. */
  function labelBox(node: LayoutNode, label: SVGTextElement, pageDy: number): Box {
    const treemapBox = layout?.treemap?.rects.get(node.id)
    const size = node.kind === "page" ? (treemapBox ? 15 : 22) : 11
    const width = Array.from(label.textContent ?? "").length * size * 0.58
    const half = size * 0.6
    if (treemapBox) {
      const baseline = node.kind === "page" ? 19 : node.kind === "source" ? 12 : 11
      const x0 = node.x - treemapBox.w / 2 + 5
      const top = node.y - treemapBox.h / 2 + baseline
      return { x0, x1: x0 + width, y0: top - size, y1: top + 3 }
    }
    if (layout?.arc) {
      const reach = (node.kind === "page" ? Math.max(node.radius, 14) : node.radius) + 8
      return { x0: node.x - half, x1: node.x + half, y0: node.y + reach, y1: node.y + reach + width }
    }
    const radial = layout?.radial
    if (radial) {
      const angle = radial.angles.get(node.id) ?? 0
      const ux = Math.cos(angle),
        uy = Math.sin(angle)
      const reach = (node.kind === "page" ? Math.max(node.radius, 14) : node.radius) + 8
      if (node.kind === "page") {
        const left = ux < 0
        const x = node.x + (left ? -reach : reach)
        return { x0: left ? x - width : x, x1: left ? x : x + width, y0: node.y - half, y1: node.y + half }
      }
      const sx = node.x + ux * reach,
        sy = node.y + uy * reach
      const ex = sx + ux * width,
        ey = sy + uy * width
      const padX = Math.abs(uy) * half,
        padY = Math.abs(ux) * half
      return {
        x0: Math.min(sx, ex) - padX,
        x1: Math.max(sx, ex) + padX,
        y0: Math.min(sy, ey) - padY,
        y1: Math.max(sy, ey) + padY,
      }
    }
    if (node.kind === "page") {
      const x = node.x - (Math.max(node.radius, 14) + 12)
      return { x0: x - width, x1: x, y0: node.y + pageDy - half * 1.4, y1: node.y + pageDy + half * 0.5 }
    }
    const drawn = node.kind === "symbol" ? Math.max(5, node.radius - 2) : node.radius
    const y = node.y + drawn + 14
    return { x0: node.x - width / 2, x1: node.x + width / 2, y0: y - half * 1.3, y1: y + half * 0.4 }
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

  /** Page -> source -> symbol parents, rebuilt only when the graph changes. */
  let treeIndex: { graph: typeof graph; parent: Map<string, string>; kids: Map<string, string[]>; cited: Map<string, number> } | undefined
  function tree() {
    if (treeIndex?.graph !== graph) {
      const { treeParent, children } = deriveHierarchy(graph, { x: 0, y: 0 })
      const cited = new Map<string, number>()
      for (const edge of graph.edges) if (edge.kind === "references-source") cited.set(edge.to, (cited.get(edge.to) ?? 0) + 1)
      treeIndex = { graph, parent: treeParent, kids: children, cited }
    }
    return treeIndex
  }

  function seedTree() {
    expanded.clear()
    for (const node of graph.nodes) if (node.kind === "page") expanded.add(node.id)
  }

  /** Expand every ancestor so a selection made elsewhere (canvas, search) is visible in the tree. */
  function revealInTree(id: string) {
    const { parent } = tree()
    for (let up = parent.get(id); up !== undefined; up = parent.get(up)) expanded.add(up)
    scrollSelected = true
  }

  function listNodeLabel(node: WikiGraphNode): HTMLButtonElement {
    const button = doc.createElement("button")
    button.className = node.id === selected ? "node-label selected" : "node-label"
    button.textContent = `${node.kind}: ${node.label}`
    const degree = layout?.byId.get(node.id)?.degree ?? 0
    button.title = `${node.freshness} · ${plural(degree, "connection", "connections")} shown of ${plural(node.recordedReferences, "recorded reference", "recorded references")}`
    button.dataset.kind = node.kind
    button.dataset.id = node.id
    button.tabIndex = -1
    button.onclick = () => select(node)
    previewOn(button, node.id)
    return button
  }

  function renderList() {
    const near = neighborhood()
    const query = filters.query.trim()
    const visible = graph.nodes.filter((node) => {
      if ((near && !near.has(node.id)) || !isNodeVisible(node, filters)) return false
      // The flat result list follows the picture: pages and files first. Symbols join a search or a selection.
      if (node.kind === "symbol" && !near && query === "") return false
      return true
    })
    lastVisible = visible
    list.replaceChildren()
    treeTools.style.display = query === "" ? "" : "none"
    if (query !== "") {
      // Searching shows matches as a flat result list; the tree returns when the query clears.
      list.setAttribute("role", "list")
      list.removeAttribute("aria-label")
      for (const node of visible) html("li", list).append(listNodeLabel(node))
      return
    }
    list.setAttribute("role", "tree")
    list.setAttribute("aria-label", "Explore pages, sources and symbols")
    const { parent, kids, cited } = tree()
    const shown = new Map(graph.nodes.filter((node) => isNodeVisible(node, filters)).map((node) => [node.id, node]))
    const visibleKids = (id: string) => (kids.get(id) ?? []).filter((kid) => shown.has(kid))
    const draw = (container: HTMLElement, node: WikiGraphNode, level: number) => {
      const children = visibleKids(node.id)
      const item = html("li", container)
      item.setAttribute("role", "treeitem")
      item.setAttribute("aria-level", String(level))
      item.setAttribute("aria-selected", String(node.id === selected))
      const row = html("div", item)
      row.className = "row"
      if (children.length > 0) {
        const open = expanded.has(node.id)
        item.setAttribute("aria-expanded", String(open))
        const twisty = html("button", row)
        twisty.className = "twisty"
        twisty.tabIndex = -1
        twisty.setAttribute("aria-label", `${open ? "Collapse" : "Expand"} ${node.label}`)
        const caret = html("span", twisty, "▸")
        caret.className = "caret"
        caret.setAttribute("aria-hidden", "true")
        twisty.onclick = () => toggleRow(node.id)
      } else html("span", row).className = "spacer"
      row.append(listNodeLabel(node))
      const note: string[] = []
      if (children.length > 0) note.push(String(children.length))
      const extra = node.kind === "source" ? (cited.get(node.id) ?? 0) - 1 : 0
      if (extra > 0) note.push(`+${extra} ${extra === 1 ? "page" : "pages"}`)
      if (note.length > 0) html("span", row, note.join(" · ")).className = "meta"
      if (children.length > 0 && expanded.has(node.id)) {
        const group = html("ul", item)
        group.setAttribute("role", "group")
        for (const kid of children) draw(group, shown.get(kid)!, level + 1)
      }
    }
    // A node whose parent is filtered out is promoted to the top so it never disappears with its parent.
    for (const node of shown.values()) {
      const up = parent.get(node.id)
      if (up === undefined || !shown.has(up)) draw(list, node, 1)
    }
    const labels = [...list.querySelectorAll<HTMLButtonElement>(".node-label")]
    const active = labels.find((label) => label.dataset.id === selected) ?? labels[0]
    if (active) active.tabIndex = 0
    if (scrollSelected && selected !== undefined) active?.scrollIntoView?.({ block: "nearest" })
    scrollSelected = false
  }

  function toggleRow(id: string) {
    if (expanded.has(id)) expanded.delete(id)
    else expanded.add(id)
    renderList()
    list.querySelector<HTMLButtonElement>(`.node-label[data-id="${CSS.escape(id)}"]`)?.focus()
  }

  expandAllButton.onclick = () => {
    for (const id of tree().kids.keys()) expanded.add(id)
    renderList()
  }
  collapseAllButton.onclick = () => {
    expanded.clear()
    renderList()
  }
  list.addEventListener("focusin", (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement) || !target.classList.contains("node-label")) return
    for (const label of list.querySelectorAll<HTMLElement>(".node-label")) label.tabIndex = label === target ? 0 : -1
  })
  // WAI-ARIA tree keys: arrows move and expand, Home/End jump; Enter selects through the button itself.
  list.addEventListener("keydown", (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement) || !target.classList.contains("node-label") || list.getAttribute("role") !== "tree")
      return
    const labels = [...list.querySelectorAll<HTMLElement>(".node-label")]
    const index = labels.indexOf(target)
    const id = target.dataset.id ?? ""
    const item = target.closest("li")
    const hasKids = item?.hasAttribute("aria-expanded") === true
    let next: HTMLElement | undefined
    if (event.key === "ArrowDown") next = labels[index + 1]
    else if (event.key === "ArrowUp") next = labels[index - 1]
    else if (event.key === "Home") next = labels[0]
    else if (event.key === "End") next = labels[labels.length - 1]
    else if (event.key === "ArrowRight") {
      if (hasKids && !expanded.has(id)) return void (event.preventDefault(), toggleRow(id))
      if (hasKids) next = labels[index + 1]
    } else if (event.key === "ArrowLeft") {
      if (hasKids && expanded.has(id)) return void (event.preventDefault(), toggleRow(id))
      next = item?.parentElement?.closest("li")?.querySelector<HTMLElement>(":scope > .row .node-label") ?? undefined
    } else return
    event.preventDefault()
    next?.focus()
  })

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
    const key = doc.createElement("details")
    key.className = "key"
    key.append(doc.createElement("summary"))
    key.firstElementChild!.textContent = "How to read"
    for (const text of [
      "size = visible connections",
      "+N = recorded references not in this snapshot",
      "amber edge: selected node depends on target",
      "teal edge: target depends on selected node",
    ]) {
      const item = doc.createElement("span")
      item.className = "note"
      item.textContent = text
      key.append(item)
    }
    legend.append(key)
  }

  /** Plain-text tooltip built from textContent only, so hostile labels stay inert. */
  function showTip(info: WikiGraphNode, degree: number, event: MouseEvent) {
    if (dragging) return
    tip.replaceChildren()
    const title = doc.createElement("strong")
    title.textContent = info.label
    const meta = doc.createElement("span")
    meta.textContent = `${info.kind} · ${info.freshness}`
    const stats = doc.createElement("span")
    stats.textContent = `${plural(degree, "connection", "connections")} shown of ${plural(info.recordedReferences, "recorded reference", "recorded references")}`
    tip.append(title, meta, stats)
    const extra = info.kind === "symbol" ? info.detail : info.path
    if (extra && extra !== info.label) {
      const path = doc.createElement("code")
      path.textContent = truncateLabel(extra, 72)
      tip.append(path)
    }
    tip.style.display = "flex"
    moveTip(event)
  }

  function moveTip(event: MouseEvent) {
    if (tip.style.display === "none") return
    const rect = canvas.getBoundingClientRect()
    const width = tip.offsetWidth,
      height = tip.offsetHeight
    let left = event.clientX - rect.left + 14
    let top = event.clientY - rect.top + 16
    // Flip to the other side of the pointer instead of clipping at the canvas edge.
    if (left + width > rect.width - 8) left = event.clientX - rect.left - width - 14
    if (top + height > rect.height - 8) top = event.clientY - rect.top - height - 16
    tip.style.left = `${Math.max(8, left)}px`
    tip.style.top = `${Math.max(8, top)}px`
  }

  function hideTip() {
    tip.style.display = "none"
  }

  function acceptHover(id: string) {
    if (dragging || hoverLock) return
    hovered = id
    applyEmphasis()
  }

  let unlockHover: ((event: PointerEvent) => void) | undefined
  function lockHover() {
    hoverLock = true
    hovered = undefined
    applyEmphasis()
    if (unlockHover) doc.removeEventListener("pointermove", unlockHover)
    // The pointerup that ends a drag is often followed by a move in the same
    // frame. Ignore that move so the drop does not immediately dim the map.
    const lockedAt = performance.now()
    unlockHover = () => {
      if (performance.now() - lockedAt < 80) return
      hoverLock = false
      if (unlockHover) doc.removeEventListener("pointermove", unlockHover)
      unlockHover = undefined
    }
    doc.addEventListener("pointermove", unlockHover)
  }

  function previewOn(hover: HTMLElement, id: string) {
    hover.onmouseenter = () => {
      acceptHover(id)
    }
    hover.onmouseleave = () => {
      if (hovered === id) hovered = undefined
      applyEmphasis()
    }
    hover.onfocus = () => {
      acceptHover(id)
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
      path.setAttribute("fill", "none")
      const arrow = doc.createElementNS(svgNS, "path")
      arrow.setAttribute("class", "arrow")
      arrow.setAttribute("fill", "none")
      edgeLayer.append(path, arrow)
      edgeEls.push({ path, arrow, edge })
    }
    for (const node of layout.nodes) {
      const info = graph.nodes.find((candidate) => candidate.id === node.id)!
      const group = doc.createElementNS(svgNS, "g")
      group.setAttribute("class", node.kind === "page" ? "node page" : "node")
      group.setAttribute("data-id", node.id)
      const drawn = node.kind === "page" ? Math.max(node.radius, 14) : node.kind === "symbol" ? Math.max(5, node.radius - 2) : node.radius
      const treemapBox = layout.treemap?.rects.get(node.id)
      const circle = doc.createElementNS(svgNS, treemapBox ? "rect" : "circle")
      if (treemapBox) {
        circle.setAttribute("x", String(-treemapBox.w / 2))
        circle.setAttribute("y", String(-treemapBox.h / 2))
        circle.setAttribute("width", String(treemapBox.w))
        circle.setAttribute("height", String(treemapBox.h))
        circle.setAttribute("rx", "3")
        circle.setAttribute("fill-opacity", treemapBox.depth === 0 ? "0.2" : treemapBox.depth === 1 ? "0.5" : "0.92")
      } else circle.setAttribute("r", String(drawn))
      const color = topicColor(node.id)
      circle.setAttribute(
        "fill",
        node.kind === "symbol" ? SYMBOL_FILL : node.kind === "page" ? (color?.page ?? PAGE_FILL) : (color?.source ?? SOURCE_FILL),
      )
      const label = doc.createElementNS(svgNS, "text")
      label.setAttribute("y", String(drawn + 14))
      label.textContent = truncateLabel(info.label)
      if (node.kind === "page") label.style.fill = topicColor(node.id)?.page ?? "#edf6ff"
      if (treemapBox) {
        // Name sits in the cell's header band, cut to what fits.
        const fontSize = node.kind === "page" ? 15 : 11
        const room = Math.floor((treemapBox.w - 10) / (fontSize * 0.58))
        const text = Array.from(info.label)
        label.textContent =
          room < 3 ? "" : text.length > room ? `…${text.slice(text.length - (room - 1)).join("")}` : info.label
        label.style.textAnchor = "start"
        label.setAttribute("x", String(-treemapBox.w / 2 + 5))
        label.setAttribute("y", String(-treemapBox.h / 2 + (node.kind === "page" ? 19 : node.kind === "source" ? 12 : 11)))
        if (node.kind === "page") label.style.fontSize = "15px"
      }
      const title = doc.createElementNS(svgNS, "title")
      title.textContent = `${info.label} (${node.kind}, ${info.freshness}, ${plural(node.degree, "connection", "connections")} shown)`
      group.append(circle, label, title)
      if (info.freshness === "stale") {
        const ring = doc.createElementNS(svgNS, treemapBox ? "rect" : "circle")
        ring.setAttribute("class", "ring")
        if (treemapBox) {
          ring.setAttribute("x", String(-treemapBox.w / 2))
          ring.setAttribute("y", String(-treemapBox.h / 2))
          ring.setAttribute("width", String(treemapBox.w))
          ring.setAttribute("height", String(treemapBox.h))
          ring.setAttribute("rx", "3")
        } else ring.setAttribute("r", String(node.radius + 3.5))
        ring.setAttribute("fill", "none")
        ring.setAttribute("stroke", STALE_RING)
        ring.setAttribute("stroke-width", "2")
        ring.setAttribute("aria-hidden", "true")
        group.insertBefore(ring, label)
      }
      const omitted = info.recordedReferences - node.degree
      if (omitted > 0 && !treemapBox) {
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
      group.addEventListener("mouseenter", (event) => {
        acceptHover(node.id)
        showTip(info, node.degree, event)
        // The custom tooltip replaces the native one; the title stays for assistive tech.
        title.textContent = ""
      })
      group.addEventListener("mousemove", moveTip)
      group.addEventListener("mouseleave", () => {
        hideTip()
        title.textContent = `${info.label} (${node.kind}, ${info.freshness}, ${plural(node.degree, "connection", "connections")} shown)`
        if (hovered === node.id) hovered = undefined
        applyEmphasis()
      })
      group.addEventListener("pointerdown", (event) => {
        // Radial rings are fixed by construction, so there is nothing to rearrange.
        if (disposed || layout === undefined || isStatic(layout) || event.button !== 0) return
        // A touch drag does not produce a click, so a flag set on pointerup would
        // swallow the next tap. The click from a mouse drag arrives before the
        // next pointerdown, and still sees the flag.
        suppressClick = false
        // No preventDefault: touch scrolling is already disabled via touch-action,
        // and canceling pointerdown would risk the click-to-select path.
        const pointerId = event.pointerId
        const startX = event.clientX,
          startY = event.clientY
        const originX = node.x,
          originY = node.y
        const originFx = node.fx ?? null,
          originFy = node.fy ?? null
        let moved = false
        let finished = false
        try {
          group.setPointerCapture(pointerId)
        } catch {
          // Capture may fail for synthetic or edge-case pointers; the document
          // listeners still receive the release.
        }
        const move = (moveEvent: PointerEvent) => {
          if (moveEvent.pointerId !== pointerId) return
          if (!moved && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 3) return
          const ctm = svg.getScreenCTM()
          if (!ctm) return
          const world = new DOMPoint(moveEvent.clientX, moveEvent.clientY).matrixTransform(ctm.inverse())
          if (!Number.isFinite(world.x) || !Number.isFinite(world.y)) return
          if (!moved) {
            moved = true
            dragging = true
            aside.style.pointerEvents = "none"
            group.classList.add("dragging")
            hideTip()
            hovered = undefined
            applyEmphasis()
            // A native text selection or drag image is the slate bar that
            // otherwise stays on the map after some drags.
            moveEvent.preventDefault()
            doc.getSelection()?.removeAllRanges()
          }
          // Pin and paint immediately. A cooled simulation would otherwise
          // leave the node in place until the release reheats it.
          node.fx = world.x
          node.fy = world.y
          node.x = world.x
          node.y = world.y
          positionElements()
        }
        const end = (upEvent: PointerEvent) => {
          if (finished || upEvent.pointerId !== pointerId) return
          finished = true
          group.removeEventListener("pointermove", move)
          group.removeEventListener("pointerup", end)
          group.removeEventListener("pointercancel", end)
          group.removeEventListener("lostpointercapture", onLostCapture)
          doc.removeEventListener("pointermove", move)
          doc.removeEventListener("pointerup", end)
          doc.removeEventListener("pointercancel", end)
          try {
            group.releasePointerCapture(pointerId)
          } catch {
            // Capture was already released, for example after pointercancel.
          }
          group.classList.remove("dragging")
          if (dragging) {
            dragging = false
            aside.style.pointerEvents = ""
          }
          if (disposed || !moved) return
          doc.getSelection()?.removeAllRanges()
          // A click is delivered to this node only when pointerup targets it.
          // pointercancel and a release on another element do not, so they must
          // not swallow the next real click.
          const clickFollows =
            upEvent.type === "pointerup" &&
            upEvent.target instanceof Element &&
            (upEvent.target === group || group.contains(upEvent.target))
          if (clickFollows) suppressClick = true
          // Hit-testing during pointer capture can return the captured node
          // instead of what is painted under the cursor. Use the canvas and
          // the zoom pad rectangles.
          const rect = canvas.getBoundingClientRect()
          const hud = navigation.getBoundingClientRect()
          const overHud =
            upEvent.clientX >= hud.left &&
            upEvent.clientX <= hud.right &&
            upEvent.clientY >= hud.top &&
            upEvent.clientY <= hud.bottom
          // pointercancel and lostpointercapture mean the browser took the
          // gesture (a native selection drag). Put the node back.
          const inside =
            upEvent.type === "pointerup" &&
            upEvent.clientX >= rect.left &&
            upEvent.clientX <= rect.right &&
            upEvent.clientY >= rect.top &&
            upEvent.clientY <= rect.bottom &&
            !overHud
          if (!inside) {
            node.fx = originFx
            node.fy = originFy
            node.x = originX
            node.y = originY
            positionElements()
          }
          lockHover()
          if (inside && !reducedMotion && layout !== undefined) layout.reheat(0.3)
        }
        const onLostCapture = () => {
          // A normal pointerup releases capture and also fires this event.
          // Wait so a real pointerup can commit the drop first. If none
          // arrives, the browser took the gesture and the node goes back.
          queueMicrotask(() => {
            if (finished) return
            end(new PointerEvent("pointercancel", { pointerId, clientX: startX, clientY: startY }))
          })
        }
        group.addEventListener("pointermove", move)
        group.addEventListener("pointerup", end)
        group.addEventListener("pointercancel", end)
        group.addEventListener("lostpointercapture", onLostCapture)
        // Capture can fail. Moves that leave the circle still need a listener.
        doc.addEventListener("pointermove", move)
        doc.addEventListener("pointerup", end)
        doc.addEventListener("pointercancel", end)
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
    cancelTween()
    hasFitted = false
    if (view !== "force") {
      layout = view === "radial" ? createRadialLayout(graph) : view === "arc" ? createArcLayout(graph) : createTreemapLayout(graph)
      hasFitted = true
      buildElements()
      positionElements()
      return
    }
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

  let tweenFrame = 0
  function cancelTween() {
    if (tweenFrame) doc.defaultView?.cancelAnimationFrame(tweenFrame)
    tweenFrame = 0
  }

  /** Glide nodes from their previous positions to the (static) radial targets. */
  function tweenFrom(before: Map<string, { x: number; y: number }>) {
    const win = doc.defaultView
    if (!layout || !win || reducedMotion) return
    const nodes = layout.nodes
    const targets = nodes.map((node) => ({ node, from: before.get(node.id), x: node.x, y: node.y }))
    const started = win.performance.now()
    const duration = 420
    const frame = (now: number) => {
      const t = Math.min(1, (now - started) / duration)
      const eased = 1 - (1 - t) ** 3
      for (const { node, from, x, y } of targets) {
        node.x = from ? from.x + (x - from.x) * eased : x
        node.y = from ? from.y + (y - from.y) * eased : y
      }
      positionElements()
      tweenFrame = t < 1 ? win.requestAnimationFrame(frame) : 0
    }
    tweenFrame = win.requestAnimationFrame(frame)
  }

  function setView(next: ViewId) {
    if (disposed || next === view) return
    cancelTween()
    hideTip()
    markActivity()
    const before = new Map((layout?.nodes ?? []).map((node) => [node.id, { x: node.x, y: node.y }]))
    view = next
    renderViewMeta()
    hovered = undefined
    cameraTouched = false
    buildLayout()
    fitView()
    if (isStatic(layout)) tweenFrom(before)
    else if (!reducedMotion) {
      // The force layout is still moving, so it cannot be tweened; fade it in instead.
      svg.classList.remove("swap")
      void svg.getBoundingClientRect()
      svg.classList.add("swap")
    }
    render()
  }

  function renderViewMeta() {
    for (const [id, button] of viewButtons) button.setAttribute("aria-pressed", String(id === view))
    const entry = VIEWS.find((candidate) => candidate.id === view)!
    viewCaption.textContent = `${entry.label}: ${entry.question}`
  }

  /**
   * Opt-in auto-tour for demos and ambient screens. Analysts keep their view: the tour
   * is off by default, disabled under reduced motion, and any activity (pointer, key,
   * wheel, typing, selection, a manual switch, a hidden tab) restarts the idle clock.
   */
  const win = doc.defaultView
  const tourInterval = Math.max(500, options.tour?.intervalMs ?? 180_000)
  const clock = () => win?.performance.now() ?? Date.now()
  let tourOn = false
  let tourPaused = false
  let tourTimer = 0
  let lastActivity = clock()
  let lastPointer = { x: Number.NaN, y: Number.NaN }
  function markActivity() {
    lastActivity = clock()
  }
  function nextView() {
    const index = VIEWS.findIndex((candidate) => candidate.id === view)
    return VIEWS[(index + 1) % VIEWS.length]
  }
  function formatCountdown(ms: number) {
    const total = Math.max(0, Math.ceil(ms / 1000))
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`
  }
  function renderTour() {
    tourToggle.setAttribute("aria-pressed", String(tourOn))
    tourStatus.style.display = tourPause.style.display = tourOn ? "" : "none"
    if (!tourOn) return
    tourStatus.textContent = tourPaused
      ? "Tour paused"
      : `Next: ${nextView().label} · ${formatCountdown(tourInterval - (clock() - lastActivity))}`
    tourPause.textContent = tourPaused ? "Resume" : "Pause"
  }
  function tourTick() {
    if (!tourOn || disposed) return
    const typing = doc.activeElement instanceof HTMLInputElement || doc.activeElement instanceof HTMLSelectElement
    // Hold the countdown at full while the user could be mid-task.
    if (tourPaused || doc.hidden || dragging || typing) markActivity()
    else if (clock() - lastActivity >= tourInterval) {
      const next = nextView()
      setView(next.id)
      liveRegion.textContent = `Switched to ${next.label} view`
    }
    renderTour()
  }
  function setTour(on: boolean) {
    if (disposed || (on && reducedMotion)) return
    tourOn = on
    tourPaused = false
    markActivity()
    if (tourTimer) win?.clearInterval(tourTimer)
    tourTimer = on && win ? win.setInterval(tourTick, Math.min(1000, tourInterval / 2)) : 0
    renderTour()
  }
  tourToggle.onclick = () => setTour(!tourOn)
  tourPause.onclick = () => {
    tourPaused = !tourPaused
    markActivity()
    renderTour()
  }
  if (reducedMotion) {
    tourToggle.disabled = true
    tourToggle.title = "Auto-tour is off because reduced motion is requested."
  }
  for (const type of ["pointerdown", "keydown", "wheel", "touchstart", "input"] as const)
    root.addEventListener(type, markActivity, { passive: true })
  root.addEventListener(
    "pointermove",
    (event) => {
      // Ignore sensor jitter; only real movement counts as activity.
      if (Math.hypot(event.clientX - lastPointer.x, event.clientY - lastPointer.y) > 5 || Number.isNaN(lastPointer.x)) {
        lastPointer = { x: event.clientX, y: event.clientY }
        markActivity()
      }
    },
    { passive: true },
  )
  const onVisibility = () => {
    if (!doc.hidden) markActivity()
  }
  doc.addEventListener("visibilitychange", onVisibility)

  function select(node: WikiGraphNode) {
    // Selection only changes emphasis, never positions, so a still-running
    // simulation simply settles beneath it instead of reflowing.
    selected = node.id
    markActivity()
    revealInTree(node.id)
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
  for (const [label, glyph, action] of [
    ["Pan up", "↑", () => pan(0, -100 / zoom)],
    ["Zoom in", "+", () => zoomBy(1.5)],
    ["Zoom out", "−", () => zoomBy(1 / 1.5)],
    ["Pan left", "←", () => pan(-100 / zoom, 0)],
    ["Pan down", "↓", () => pan(0, 100 / zoom)],
    ["Pan right", "→", () => pan(100 / zoom, 0)],
    [
      "Fit to view",
      "⤢",
      () => {
        fitView()
        applyEmphasis()
      },
    ],
  ] as const) {
    const button = html("button", navigation, glyph)
    button.setAttribute("aria-label", label)
    button.title = label
    button.onclick = () => action()
  }
  navigation.append(zoomReadout)
  svg.onkeydown = (event) => {
    const step = 100 / zoom
    if (event.key === "+" || event.key === "=") zoomBy(1.5)
    else if (event.key === "-") zoomBy(1 / 1.5)
    else if (event.key === "0") {
      fitView()
      applyEmphasis()
    } else if (event.key === "ArrowLeft") pan(-step, 0)
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
    hideTip()
    const factor = wheelZoomFactor(event.deltaY, event.deltaMode, event.ctrlKey)
    if (factor === 1) return
    applyZoom(factor, event.clientX, event.clientY)
  }
  canvas.addEventListener("wheel", onWheel, { passive: false })
  canvas.addEventListener("selectstart", (event) => event.preventDefault())
  canvas.addEventListener("dragstart", (event) => event.preventDefault())
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
      if (!moved) doc.getSelection()?.removeAllRanges()
      moved = true
      moveEvent.preventDefault()
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

  svg.addEventListener("dblclick", (event) => {
    if (disposed) return
    const target = event.target
    if (target instanceof Element && target.closest(".node")) return
    event.preventDefault()
    applyZoom(event.shiftKey ? 0.5 : 2, event.clientX, event.clientY)
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
    seedTree()
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
  seedTree()
  buildLayout()
  buildToggles()
  fitView()
  renderViewMeta()
  render()
  if (options.tour?.enabled) setTour(true)
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
        seedTree()
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
      if (tourTimer) win?.clearInterval(tourTimer)
      tourTimer = 0
      doc.removeEventListener("visibilitychange", onVisibility)
      cancelTween()
      layout?.stop()
      layout = undefined
      if (unlockHover) doc.removeEventListener("pointermove", unlockHover)
      unlockHover = undefined
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
