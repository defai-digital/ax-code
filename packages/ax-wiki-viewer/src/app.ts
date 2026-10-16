import { parseWikiGraph } from "@ax-code/ax-wiki/graph"
import type { WikiGraph, WikiGraphArea, WikiGraphNode, WikiGraphPage } from "@ax-code/ax-wiki/graph"
import { hierarchy, partition } from "d3-hierarchy"
import type { HierarchyRectangularNode } from "d3-hierarchy"
import { mapCss, mountMap } from "./map.js"
import { parseMarkdown, renderMarkdown } from "./markdown.js"
import type { MarkdownLink } from "./markdown.js"
import { modulesCss, renderModulesView } from "./modules-view.js"
import {
  blindSpots,
  overviewChartsCss,
  pageOverlap,
  renderBlindSpots,
  renderPageOverlap,
  sharedFiles,
} from "./overview-charts.js"

const appCss = `
.axw{--bg:#0d1520;--surface:#142130;--surface-2:#1b2c3f;--canvas:#0a111a;--line:#27394d;--line-2:#3a5068;--text:#e3ecf6;--muted:#93a6ba;--accent:#78dacc;--amber:#e0a63c;--fresh:#7cc78a;--stale:#e0a63c;--unknown:#64778b;display:flex;flex-direction:column;height:100%;min-height:100%;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--text);background:var(--bg);box-sizing:border-box;-webkit-font-smoothing:antialiased}
.axw *{box-sizing:border-box}
.axw button{font:inherit;font-size:13px;color:inherit;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:6px 11px;cursor:pointer}
.axw button:hover{background:var(--surface-2);border-color:var(--line-2)}
.axw :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.axw .app-head{display:flex;flex-wrap:wrap;gap:4px 20px;align-items:flex-end;padding:6px 20px 0;border-bottom:1px solid var(--line)}
.axw .brand{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px;min-width:0;padding-bottom:9px}
.axw .brand h1{margin:0;font-size:15px;font-weight:650;letter-spacing:-.01em}
.axw .brand .meta{font-size:12px;color:var(--muted);overflow-wrap:anywhere}
.axw .tabs{display:flex;gap:2px;margin-left:auto;align-self:flex-end}
.axw .tabs button{border:0;border-radius:8px 8px 0 0;background:transparent;color:var(--muted);padding:8px 14px;box-shadow:none}
.axw .tabs button[aria-selected="true"]{color:var(--text);background:var(--surface);box-shadow:inset 0 -2px 0 var(--accent)}
.axw .panel{flex:1;min-height:0;overflow:auto}
.axw .panel[hidden]{display:none}
.axw .panel-map{overflow:hidden}
.axw .axwv.map{height:100%;padding:8px 20px 12px}
.axw .axwv.map>h1{display:none}
.axw .axwv.map>h1+p{font-size:12px;margin:0}
.axw .axwv.map>.counts{margin-top:2px}
.axw .axwv.map>details:first-of-type{order:3;margin-top:6px}
.axw .axwv.map .controls{margin-top:8px}
.axw .axwv.map .legend{margin-top:4px}
.axw .axwv.map .view-caption{margin-top:4px}
.axw .axwv.map .layout{margin-top:8px}
.axw .page-wrap{max-width:1280px;margin:0 auto;padding:18px 20px 28px}
.axw h2{font-size:12px;font-weight:650;margin:0 0 10px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.axw .card{border:1px solid var(--line);border-radius:12px;background:var(--surface);padding:14px 16px}
.axw .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:16px}
.axw .tile .label{font-size:12px;color:var(--muted)}
.axw .tile .value{font-size:26px;font-weight:650;font-variant-numeric:tabular-nums;line-height:1.2;margin-top:2px}
.axw .tile .sub{font-size:12px;color:var(--muted);margin-top:4px;overflow-wrap:anywhere}
.axw .grid2{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:16px;align-items:start}
.axw .stack{display:flex;flex-direction:column;gap:16px}
.axw .start{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;align-items:center}
.axw .start .lead{color:var(--muted);font-size:13px;margin-right:4px}
.axw .start button{border-color:var(--line-2)}
.axw table{border-collapse:collapse;width:100%;font-size:13px}
.axw th{text-align:left;font-weight:600;color:var(--muted);font-size:12px;padding:6px 8px;border-bottom:1px solid var(--line)}
.axw td{padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}
.axw tr.row{cursor:pointer}
.axw tr.row:hover td{background:var(--surface-2)}
.axw td.num{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
.axw .ptitle{font-weight:600;color:var(--text)}
.axw .psub{color:var(--muted);font-size:12px;margin-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.axw .bar{display:flex;height:8px;border-radius:4px;overflow:hidden;background:var(--canvas);min-width:80px}
.axw td.fresh{width:150px}
.axw td.fresh .note{margin-top:4px;white-space:nowrap}
.axw .bar span{display:block;height:100%}
.axw .badge{display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:2px 9px;border-radius:999px;border:1px solid var(--line-2);color:var(--muted);white-space:nowrap}
.axw .badge::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--unknown)}
.axw .badge.fresh::before{background:var(--fresh)}.axw .badge.stale::before{background:var(--stale)}
.axw .badge.stale{color:var(--text);border-color:var(--stale)}
.axw .note{font-size:12px;color:var(--muted);margin:8px 0 0}
.axw .hot{list-style:none;margin:0;padding:0}
.axw .hot li{display:grid;grid-template-columns:minmax(0,1fr) 90px 22px;gap:8px;align-items:center;padding:4px 0}
.axw .hot button{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;direction:rtl;text-align:left}
.axw .hot button,.axw .linkish{background:none;border:0;padding:0;text-align:left;color:#c9d6e4;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere;cursor:pointer}
.axw .hot button:hover,.axw .linkish:hover{color:var(--accent);background:none}
.axw .hot .count{font-size:12px;color:var(--muted);text-align:right;font-variant-numeric:tabular-nums}
.axw .icicle svg{display:block;width:100%;height:auto}
.axw .icicle rect{stroke:var(--surface);stroke-width:1;cursor:pointer}
.axw .icicle text{font-size:11px;fill:#eaf2fa;pointer-events:none}
.axw .icicle .crumbs{display:flex;flex-wrap:wrap;gap:4px;align-items:center;font-size:12px;color:var(--muted);margin-bottom:8px}
.axw .icicle .crumbs button{padding:1px 8px;font-size:12px;border-radius:999px;background:transparent}
.axw .scale{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--muted);margin-top:8px}
.axw .scale .ramp{height:8px;width:140px;border-radius:4px;background:linear-gradient(90deg,#1c2b3b,#78dacc)}
.axw .reader{display:grid;grid-template-columns:260px minmax(0,1fr) 280px;height:100%;min-height:0}
.axw .reader>*{min-height:0;overflow:auto}
.axw .nav{border-right:1px solid var(--line);padding:14px 12px;background:var(--surface)}
.axw .nav input{width:100%;font:inherit;font-size:13px;color:inherit;background:var(--canvas);border:1px solid var(--line);border-radius:8px;padding:6px 10px;margin-bottom:12px}
.axw .nav .group{font-size:11px;font-weight:650;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:12px 6px 4px}
.axw .nav button{display:block;width:100%;text-align:left;background:transparent;border:0;border-radius:6px;padding:5px 8px;color:#c9d6e4;font-size:13px}
.axw .nav button:hover{background:var(--surface-2)}
.axw .nav button[aria-current="page"]{background:#173342;color:var(--text);box-shadow:inset 2px 0 0 var(--accent)}
.axw .nav .stale-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--stale);margin-left:6px;vertical-align:middle}
.axw .nav .hit{font-size:11px;color:var(--muted);display:block;margin-top:1px;overflow-wrap:anywhere}
.axw .article{padding:22px 36px 48px}
.axw .article .crumb{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted)}
.axw .article>h1{font-size:28px;line-height:1.25;margin:6px 0 10px;letter-spacing:-.015em}
.axw .article .facts{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:14px;font-size:12px;color:var(--muted)}
.axw .callout{border-left:3px solid var(--accent);background:var(--surface);padding:10px 14px;border-radius:0 10px 10px 0;color:#c9d6e4;margin:0 0 18px;font-size:13px}
.axw .callout.warn{border-left-color:var(--stale)}
.axw .md{max-width:860px;color:#d6e1ec;line-height:1.65}
.axw .md h1,.axw .md h2,.axw .md h3,.axw .md h4{color:var(--text);text-transform:none;letter-spacing:-.005em;line-height:1.3;scroll-margin-top:12px}
.axw .md h1{font-size:22px;margin:28px 0 10px}.axw .md h2{font-size:19px;margin:28px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--line)}
.axw .md h3{font-size:16px;margin:22px 0 8px}.axw .md h4{font-size:14px;margin:18px 0 6px}
.axw .md p{margin:0 0 12px}.axw .md ul,.axw .md ol{margin:0 0 12px;padding-left:22px}.axw .md li{margin:3px 0}
.axw .md code{font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--surface-2);border-radius:5px;padding:1px 5px;overflow-wrap:anywhere}
.axw .md pre{background:var(--canvas);border:1px solid var(--line);border-radius:10px;padding:12px 14px;overflow:auto;margin:0 0 14px}
.axw .md pre code{background:none;padding:0;font-size:12.5px;white-space:pre}
.axw .md table{margin:0 0 14px;font-size:13px}.axw .md th{text-transform:none;letter-spacing:0}
.axw .md blockquote{margin:0 0 12px;padding:4px 14px;border-left:3px solid var(--line-2);color:var(--muted)}
.axw .md hr{border:0;border-top:1px solid var(--line);margin:20px 0}
.axw .md a{color:var(--accent);text-decoration:none;border-bottom:1px solid rgba(120,218,204,.35)}
.axw .md a:hover{border-bottom-color:var(--accent)}
.axw .md .md-source{cursor:pointer;color:#bfe9e2;box-shadow:inset 0 -1px 0 rgba(120,218,204,.45)}
.axw .md .md-source:hover{background:#173342}
.axw .rail{border-left:1px solid var(--line);padding:16px 14px;background:var(--surface)}
.axw .rail section{margin-bottom:20px}
.axw .rail ul{list-style:none;margin:0;padding:0}
.axw .rail li{margin:2px 0}
.axw .rail .toc button{background:none;border:0;padding:3px 6px;text-align:left;color:#c9d6e4;font-size:12.5px;width:100%;border-radius:6px}
.axw .rail .toc button:hover{background:var(--surface-2)}
.axw .rail .src{display:flex;gap:6px;align-items:baseline}
.axw .rail .src .dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--fresh)}
.axw .rail .src .linkish{display:flex;flex-direction:column;min-width:0;padding:2px 0}
.axw .rail .src .file{color:#d6e1ec}
.axw .rail .src .dir{font-size:11px;color:var(--muted);overflow-wrap:anywhere}
.axw .rail .src .dot{margin-top:5px}
.axw .rail .src .dot.stale{background:var(--stale)}.axw .rail .src .dot.unknown{background:var(--unknown)}
.axw .rail .rel button{background:none;border:0;padding:3px 6px;text-align:left;color:#c9d6e4;font-size:13px;width:100%;border-radius:6px;display:flex;justify-content:space-between;gap:8px}
.axw .rail .rel button:hover{background:var(--surface-2)}
.axw .rail .rel .count{color:var(--muted);font-size:12px;white-space:nowrap}
.axw .drawer{position:fixed;right:16px;bottom:16px;z-index:10;width:min(420px,calc(100vw - 32px));max-height:min(70vh,560px);overflow:auto;border:1px solid var(--line-2);border-radius:14px;background:rgba(20,33,48,.98);box-shadow:0 18px 40px rgba(0,0,0,.5);padding:14px 16px}
.axw .drawer[hidden]{display:none}
.axw .drawer .path{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere;color:var(--text);margin:0 26px 8px 0}
.axw .drawer .close{position:absolute;top:10px;right:10px;padding:2px 8px}
.axw .drawer .actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.axw .drawer ul{list-style:none;margin:6px 0 0;padding:0}
.axw .drawer li button{background:none;border:0;padding:3px 0;color:#c9d6e4;text-align:left}
.axw .drawer li button:hover{color:var(--accent);background:none}
.axw .empty{color:var(--muted);padding:40px 20px;text-align:center}
@media(max-width:1100px){.axw .reader{grid-template-columns:220px minmax(0,1fr)}.axw .rail{display:none}.axw .grid2{grid-template-columns:1fr}}
@media(max-width:760px){.axw .app-head{padding:10px 12px 0}.axw .tabs{margin-left:0;overflow-x:auto;max-width:100%}.axw .reader{grid-template-columns:1fr}.axw .nav{border-right:0;border-bottom:1px solid var(--line);max-height:220px}.axw .article{padding:16px}.axw .page-wrap{padding:14px 12px}}
@media(prefers-reduced-motion:reduce){.axw *{transition:none!important;animation:none!important}}
`

/** All viewer styles: the shell, the evidence map and the module view. */
export const viewerCss = appCss + overviewChartsCss + mapCss + modulesCss

// The map opens first: people want the picture before the prose.
const TABS = [
  { id: "map", label: "Evidence map" },
  { id: "overview", label: "Overview" },
  { id: "read", label: "Read" },
  { id: "modules", label: "Modules" },
] as const
type TabId = (typeof TABS)[number]["id"]

const START_PAGES = ["quickstart.md", "index.md", "README.md", "Index.md"]

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`
}

function shortDate(iso: string): string {
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return ""
  return new Date(time).toISOString().slice(0, 16).replace("T", " ") + " UTC"
}

/** Recorded totals: the cited files `sources` lists plus those the projection could not list. */
function pageTotals(page: WikiGraphPage): { sources: number; stale: number; unknown: number } {
  return {
    sources: page.sources.length + page.omitted.sources,
    stale: page.stale + page.omitted.stale,
    unknown: page.unknown + page.omitted.unknown,
  }
}

/**
 * Recorded freshness of a page: stale wins, then unverified, else current. The
 * bounded counts describe only the citations `sources` lists, so `pageTotals`
 * decides: a page whose only changed file sits past `sourcesPerPage` is stale.
 */
export function pageState(page: WikiGraphPage): "fresh" | "stale" | "unknown" {
  const totals = pageTotals(page)
  if (totals.stale > 0) return "stale"
  if (totals.unknown > 0 || totals.sources === 0) return "unknown"
  return "fresh"
}

/** Page-specific unknown evidence takes precedence over cross-page source aggregates. */
export function sourceUnverified(path: string, page: WikiGraphPage, nodes: readonly WikiGraphNode[]): boolean {
  if (page.unverified !== undefined) return page.unverified.includes(path)
  // Older snapshots lack source identities for the unknown count. A page with
  // no unknown evidence must not inherit another page's unknown source state.
  if (page.unknown === 0 || page.changed.includes(path)) return false
  const node = nodes.find((candidate) => candidate.id === `source:${path}`)
  return node?.freshness !== "fresh"
}

/** Compact table form of the page state. */
function shortState(page: WikiGraphPage): string {
  const totals = pageTotals(page)
  const state = pageState(page)
  if (state === "stale") return `${totals.stale}/${totals.sources} changed`
  if (state === "unknown") return "Unverified"
  return "Unchanged"
}

function stateText(page: WikiGraphPage): string {
  const totals = pageTotals(page)
  const state = pageState(page)
  if (state === "stale") return `${totals.stale} of ${plural(totals.sources, "cited file")} changed`
  if (state === "unknown") return "Unverified"
  return "Cited files unchanged"
}

/** Coverage colour: dark for an uncited area, accent for a fully cited one. */
function coverageColor(ratio: number): string {
  const t = Math.max(0, Math.min(1, ratio)) ** 0.6
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t)
  return `rgb(${mix(28, 120)},${mix(43, 218)},${mix(59, 204)})`
}

type AreaDatum = { path: string; indexed: number; cited: number; own: number; children: AreaDatum[] }

/** Rebuild the directory tree from flat recorded areas; a file count not in any child area stays on its parent. */
export function areaTree(areas: readonly WikiGraphArea[]): AreaDatum | undefined {
  const byPath = new Map<string, AreaDatum>()
  for (const area of areas) byPath.set(area.path, { ...area, own: area.indexed, children: [] })
  const root = byPath.get("")
  if (!root) return undefined
  for (const area of byPath.values()) {
    if (area.path === "") continue
    const cut = area.path.lastIndexOf("/")
    const parent = byPath.get(cut < 0 ? "" : area.path.slice(0, cut))
    if (!parent) continue
    parent.children.push(area)
    parent.own -= area.indexed
  }
  return root
}

/** Pages ordered for reading: start page, then by directory and title. */
export function readingOrder(pages: readonly WikiGraphPage[]): WikiGraphPage[] {
  const rank = (page: WikiGraphPage) => {
    const start = START_PAGES.indexOf(page.path)
    if (start >= 0) return `0${start}`
    const folder = page.path.includes("/") ? page.path.slice(0, page.path.indexOf("/")) : ""
    const order = ["architecture", "development", "guides", "modules"].indexOf(folder)
    return `${order < 0 ? 9 : order + 1}${page.path}`
  }
  return [...pages].sort((a, b) => (rank(a) < rank(b) ? -1 : rank(a) > rank(b) ? 1 : 0))
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Case-insensitive full-text match over a page; returns a short context snippet or undefined. */
export function searchPage(page: WikiGraphPage, query: string): string | undefined {
  const needle = query.trim().toLowerCase()
  if (!needle) return ""
  for (const field of [page.title, page.summary, page.purpose, page.path, page.markdown]) {
    const lowered = field.toLowerCase()
    const at = lowered.indexOf(needle)
    if (at < 0) continue
    if (field !== page.markdown) return ""
    // `at` addresses the lowercased copy, but the snippet is sliced from the
    // original. Case folding can change string length ("İ" lowers to two code
    // units), so when the lengths differ the match is re-located in original
    // coordinates — otherwise the window slides past the match or off the end.
    let index = at
    let length = needle.length
    if (lowered.length !== field.length) {
      const found = new RegExp(escapeRegExp(needle), "i").exec(field)
      index = found ? found.index : Math.min(at, Math.max(0, field.length - needle.length))
      length = found ? found[0].length : needle.length
    }
    const start = Math.max(0, index - 40)
    const line = field.slice(start, index + length + 60).replace(/\s+/g, " ")
    return `${start > 0 ? "…" : ""}${line}…`
  }
  return undefined
}

/** Mount the AX Wiki viewer: overview, reader, module dependencies and the evidence map. */
export function mount(
  element: HTMLElement,
  input: unknown,
  options: {
    injectStyles?: boolean
    initialTab?: TabId
    tour?: { enabled?: boolean; intervalMs?: number }
  } = {},
) {
  let graph: WikiGraph = parseWikiGraph(input)
  const doc = element.ownerDocument
  const root = doc.createElement("section")
  root.className = "axw axwv-app"
  if (options.injectStyles !== false) {
    const style = doc.createElement("style")
    style.textContent = appCss + overviewChartsCss + modulesCss
    root.append(style)
  }
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, parent: Node, text?: string, className?: string) => {
    const node = doc.createElement(tag)
    if (text !== undefined) node.textContent = text
    if (className) node.className = className
    parent.appendChild(node)
    return node
  }

  const head = el("header", root, undefined, "app-head")
  const brand = el("div", head, undefined, "brand")
  el("h1", brand, "AX Wiki")
  const meta = el("div", brand, "", "meta")
  const tabBar = el("div", head, undefined, "tabs")
  tabBar.setAttribute("role", "tablist")
  tabBar.setAttribute("aria-label", "Wiki views")
  const panels = new Map<TabId, HTMLElement>()
  const tabButtons = new Map<TabId, HTMLButtonElement>()
  for (const tab of TABS) {
    const button = el("button", tabBar, tab.label)
    button.id = `axw-tab-${tab.id}`
    button.setAttribute("role", "tab")
    button.setAttribute("aria-controls", `axw-panel-${tab.id}`)
    button.onclick = () => show(tab.id)
    button.onkeydown = (event) => {
      const index = TABS.findIndex((candidate) => candidate.id === tab.id)
      const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0
      if (!delta) return
      event.preventDefault()
      const next = TABS[(index + delta + TABS.length) % TABS.length]
      show(next.id)
      tabButtons.get(next.id)?.focus()
    }
    tabButtons.set(tab.id, button)
    const panel = el("div", root, undefined, `panel panel-${tab.id}`)
    panel.id = `axw-panel-${tab.id}`
    panel.setAttribute("role", "tabpanel")
    panel.setAttribute("aria-labelledby", button.id)
    panels.set(tab.id, panel)
  }
  const drawer = el("aside", root, undefined, "drawer")
  drawer.setAttribute("aria-label", "Cited file")
  drawer.hidden = true

  let current: TabId = options.initialTab ?? "map"
  let map: ReturnType<typeof mountMap> | undefined
  let disposeModules: (() => void) | undefined
  let readPath: string | undefined
  let readQuery = ""
  let icicleFocus = ""
  let connectedOnly = true
  const rendered = new Set<TabId>()

  const pages = () => readingOrder(graph.pages ?? [])
  const pageById = (id: string) => graph.pages?.find((page) => page.id === id)
  const pageByPath = (path: string) => graph.pages?.find((page) => page.path === path)
  const citations = () => {
    const counts = new Map<string, string[]>()
    for (const page of graph.pages ?? [])
      for (const source of page.sources) counts.set(source, [...(counts.get(source) ?? []), page.id])
    return counts
  }

  function show(tab: TabId) {
    current = tab
    for (const [id, button] of tabButtons) {
      button.setAttribute("aria-selected", String(id === tab))
      button.tabIndex = id === tab ? 0 : -1
    }
    for (const [id, panel] of panels) panel.hidden = id !== tab
    if (!rendered.has(tab)) renderTab(tab)
    if (tab === "map") map?.refresh()
  }

  function renderTab(tab: TabId) {
    rendered.add(tab)
    if (tab === "overview") renderOverview()
    else if (tab === "read") renderReader()
    else if (tab === "modules") renderModules()
    else if (!map) {
      map = mountMap(panels.get("map")!, graph, {
        injectStyles: options.injectStyles,
        tour: options.tour,
        onOpenPage: graph.pages?.length ? (path) => openPage(path) : undefined,
      })
      panels.get("map")!.querySelector(".axwv")?.classList.add("map")
    }
  }

  function renderMeta() {
    const overview = graph.overview
    const parts: string[] = []
    if (overview?.generatedAt) parts.push(`Generated ${shortDate(overview.generatedAt)}`)
    if (overview?.model) parts.push(overview.model)
    if (overview?.repositoryHead) parts.push(`commit ${overview.repositoryHead.slice(0, 10)}`)
    parts.push(plural(graph.pages?.length ?? graph.nodes.filter((node) => node.kind === "page").length, "page"))
    meta.textContent = parts.join(" · ")
  }

  // Shared drawer for one cited file: who cites it, whether it changed, and a jump to the map.
  function openSource(path: string) {
    drawer.replaceChildren()
    const close = el("button", drawer, "✕", "close")
    close.setAttribute("aria-label", "Close")
    close.onclick = () => {
      drawer.hidden = true
    }
    el("h2", drawer, "Cited file")
    el("p", drawer, path, "path")
    const citing = (graph.pages ?? []).filter((page) => page.sources.includes(path))
    const changed = citing.some((page) => page.changed.includes(path))
    const unknown = !changed && citing.some((page) => sourceUnverified(path, page, graph.nodes))
    const badge = el(
      "span",
      drawer,
      changed ? "Changed since the wiki was generated" : unknown ? "Unverified" : "Unchanged since generation",
      `badge ${changed ? "stale" : unknown ? "" : "fresh"}`,
    )
    badge.setAttribute("role", "status")
    if (citing.length) {
      el("p", drawer, `Cited by ${plural(citing.length, "page")}`, "note")
      const list = el("ul", drawer)
      for (const page of citing) {
        const button = el("button", el("li", list), page.title)
        button.onclick = () => {
          drawer.hidden = true
          openPage(page.path)
        }
      }
    }
    const actions = el("div", drawer, undefined, "actions")
    const inMap = graph.nodes.some((node) => node.id === `source:${path}`)
    const locate = el("button", actions, inMap ? "Show in evidence map" : "Not in the map view (view cap)")
    locate.disabled = !inMap
    locate.onclick = () => {
      drawer.hidden = true
      show("map")
      map?.focus(`source:${path}`)
    }
    const copy = el("button", actions, "Copy path")
    copy.onclick = () => {
      const done = () => (copy.textContent = "Copied")
      const clip = doc.defaultView?.navigator.clipboard
      if (clip) clip.writeText(path).then(done, () => (copy.textContent = "Copy unavailable"))
    }
    drawer.hidden = false
    close.focus()
  }

  function openPage(path: string, anchor?: string) {
    readPath = path
    show("read")
    renderReader()
    if (anchor) doc.getElementById(anchor)?.scrollIntoView({ block: "start" })
  }

  function renderOverview() {
    const panel = panels.get("overview")!
    panel.replaceChildren()
    const wrap = el("div", panel, undefined, "page-wrap")
    const list = pages()
    const overview = graph.overview
    if (!list.length) {
      el("p", wrap, "This snapshot has no readable pages. Regenerate the wiki with a current AX Code.", "empty")
      return
    }
    const start = el("div", wrap, undefined, "start")
    el("span", start, "Start here:", "lead")
    for (const page of list.slice(0, 4)) {
      const button = el("button", start, page.title)
      button.onclick = () => openPage(page.path)
    }

    const tiles = el("div", wrap, undefined, "tiles")
    const tile = (label: string, value: string, sub: string) => {
      const card = el("div", tiles, undefined, "card tile")
      el("div", card, label, "label")
      el("div", card, value, "value")
      el("div", card, sub, "sub")
    }
    const stale = list.filter((page) => pageState(page) === "stale").length
    const unknown = list.filter((page) => pageState(page) === "unknown").length
    // Root pages share one bucket, matching the reader nav's "Start" group.
    const sections = new Set(list.map((page) => (page.path.includes("/") ? page.path.split("/")[0] : "")))
    tile("Pages", list.length.toLocaleString("en-US"), `${plural(sections.size, "section")}`)
    if (overview) {
      const share = overview.indexedSources ? (overview.citedSources / overview.indexedSources) * 100 : 0
      tile(
        "Cited files",
        overview.citedSources.toLocaleString("en-US"),
        `of ${plural(overview.indexedSources, "indexed file")} (${share.toFixed(1)}%). Citation coverage, not documentation quality.`,
      )
    }
    tile(
      "Freshness",
      stale ? `${stale} stale` : unknown === list.length ? "Unverified" : "Current",
      `${plural(list.length - stale - unknown, "page")} unchanged · ${stale} changed · ${unknown} unverified, by cited file hashes`,
    )
    if (overview?.generatedAt)
      tile(
        "Generated",
        shortDate(overview.generatedAt).slice(0, 10),
        [overview.model, overview.repositoryHead && `commit ${overview.repositoryHead.slice(0, 10)}`]
          .filter(Boolean)
          .join(" · "),
      )

    const grid = el("div", wrap, undefined, "grid2")
    const left = el("div", grid, undefined, "stack")
    const right = el("div", grid, undefined, "stack")

    const pagesCard = el("div", left, undefined, "card")
    el("h2", pagesCard, "Pages")
    const table = el("table", pagesCard)
    const headRow = el("tr", el("thead", table))
    for (const label of ["Page", "Files", "Freshness"]) el("th", headRow, label)
    const body = el("tbody", table)
    for (const page of list) {
      const totals = pageTotals(page)
      const row = el("tr", body, undefined, "row")
      row.tabIndex = 0
      row.onclick = () => openPage(page.path)
      row.onkeydown = (event) => {
        if (event.key === "Enter") openPage(page.path)
      }
      const cell = el("td", row)
      el("div", cell, page.title, "ptitle")
      el("div", cell, page.purpose || page.summary, "psub")
      el("td", row, String(totals.sources), "num")
      const freshCell = el("td", row, undefined, "fresh")
      const bar = el("div", freshCell, undefined, "bar")
      const total = Math.max(1, totals.sources)
      const fresh = Math.max(0, totals.sources - totals.stale - totals.unknown)
      for (const [count, color] of [
        [fresh, "var(--fresh)"],
        [totals.stale, "var(--stale)"],
        [totals.unknown, "var(--unknown)"],
      ] as const) {
        if (!count) continue
        const part = el("span", bar)
        part.style.width = `${(count / total) * 100}%`
        part.style.background = color
      }
      bar.title = `${fresh} unchanged, ${totals.stale} changed, ${totals.unknown} unverified`
      el("div", freshCell, shortState(page), "note")
    }

    const counts = citations()
    const hot = [...counts]
      .filter(([, citing]) => citing.length > 1)
      .sort(([a, x], [b, y]) => y.length - x.length || (a < b ? -1 : 1))
      .slice(0, 12)
    const hotCard = el("div", right, undefined, "card")
    el("h2", hotCard, "Most-cited files")
    if (!hot.length) el("p", hotCard, "No file is cited by more than one page.", "note")
    else {
      const max = hot[0][1].length
      const ul = el("ul", hotCard, undefined, "hot")
      for (const [path, citing] of hot) {
        const li = el("li", ul)
        // The button cuts long paths at the start; the inner span keeps the path itself left to right.
        const button = el("button", li)
        el("span", button, path).dir = "ltr"
        button.title = path
        button.onclick = () => openSource(path)
        const bar = el("div", li, undefined, "bar")
        const fill = el("span", bar)
        fill.style.width = `${(citing.length / max) * 100}%`
        fill.style.background = "var(--accent)"
        el("span", li, String(citing.length), "count")
      }
      el("p", hotCard, "Files several pages rely on. A change here touches more of the wiki.", "note")
    }

    if (overview?.areas.length) {
      const spots = el("div", right, undefined, "card")
      el("h2", spots, "Blind spots")
      renderBlindSpots(doc, spots, blindSpots(overview.areas), (path) => {
        icicleFocus = path
        renderOverview()
        panel.querySelector(".icicle")?.scrollIntoView({ block: "start" })
      })
      el(
        "p",
        spots,
        "Directories with the most indexed files no page cites (uncited / indexed). Click one to zoom the coverage chart.",
        "note",
      )
      const coverage = el("div", right, undefined, "card icicle")
      el("h2", coverage, "Coverage by directory")
      renderIcicle(coverage, overview.areas)
    }

    if (list.length > 1) {
      const overlapCard = el("div", wrap, undefined, "card overlap")
      overlapCard.style.marginTop = "16px"
      el("h2", overlapCard, "Page overlap")
      renderPageOverlap(doc, overlapCard, pageOverlap(list), {
        onPage: (id) => {
          const page = pageById(id)
          if (page) openPage(page.path)
        },
        onPair: (a, b) => {
          const first = pageById(a),
            second = pageById(b)
          if (!first || !second) return
          const files = sharedFiles(first, second)
          drawer.replaceChildren()
          const close = el("button", drawer, "✕", "close")
          close.setAttribute("aria-label", "Close")
          close.onclick = () => (drawer.hidden = true)
          el("h2", drawer, "Shared citations")
          el("p", drawer, `${first.title} and ${second.title}`, "path")
          el("p", drawer, `${plural(files.length, "cited file")} in common`, "note")
          const ul = el("ul", drawer)
          for (const file of files.slice(0, 200)) {
            const button = el("button", el("li", ul), file, "linkish")
            button.onclick = () => openSource(file)
          }
          drawer.hidden = false
          close.focus()
        },
      })
      el(
        "p",
        overlapCard,
        "Cited files each pair of pages shares, from every recorded citation. Darker cells overlap more; the diagonal is each page's own count. Overlap is shared evidence, not a dependency.",
        "note",
      )
    }
  }

  function renderIcicle(host: HTMLElement, areas: readonly WikiGraphArea[]) {
    const tree = areaTree(areas)
    if (!tree) return
    const crumbs = el("div", host, undefined, "crumbs")
    const svgNS = "http://www.w3.org/2000/svg"
    const svg = doc.createElementNS(svgNS, "svg")
    const width = 480,
      height = 320
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`)
    svg.setAttribute("role", "img")
    host.append(svg)
    const scale = el("div", host, undefined, "scale")
    el("span", scale, "0% cited")
    el("span", scale, undefined, "ramp")
    el("span", scale, "100% cited")
    el(
      "p",
      host,
      "Width is the number of indexed files; colour is the share a wiki page cites. Click a directory to zoom.",
      "note",
    )
    const draw = () => {
      svg.replaceChildren()
      crumbs.replaceChildren()
      const find = (node: AreaDatum, path: string): AreaDatum | undefined =>
        node.path === path ? node : node.children.map((child) => find(child, path)).find(Boolean)
      const focus = find(tree, icicleFocus) ?? tree
      const trail = focus.path ? focus.path.split("/") : []
      const top = el("button", crumbs, "repository")
      top.onclick = () => ((icicleFocus = ""), draw())
      trail.forEach((part, index) => {
        el("span", crumbs, "/")
        const button = el("button", crumbs, part)
        button.onclick = () => ((icicleFocus = trail.slice(0, index + 1).join("/")), draw())
      })
      const shape = hierarchy<AreaDatum>(focus, (node) => node.children)
        .sum((node) => Math.max(0, node.own))
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
      // The focused directory is the breadcrumb; its column is laid out off-canvas.
      const columns = Math.max(1, shape.height)
      const column = width / columns
      const laid = partition<AreaDatum>().size([height, width + column])(shape)
      svg.setAttribute(
        "aria-label",
        `Indexed files by directory under ${focus.path || "the repository"}, coloured by the share cited by wiki pages.`,
      )
      laid.each((node: HierarchyRectangularNode<AreaDatum>) => {
        // A horizontal icicle: depth runs left to right, file counts top to bottom.
        if (node.depth === 0) return
        const x = node.y0 - column,
          w = node.y1 - node.y0,
          y = node.x0,
          h = node.x1 - node.x0
        if (h < 0.5) return
        const datum = node.data
        const ratio = datum.indexed ? datum.cited / datum.indexed : 0
        const group = doc.createElementNS(svgNS, "g")
        const rect = doc.createElementNS(svgNS, "rect")
        rect.setAttribute("x", String(x))
        rect.setAttribute("y", String(y))
        rect.setAttribute("width", String(Math.max(0, w - 1)))
        rect.setAttribute("height", String(Math.max(0, h - 1)))
        rect.setAttribute("fill", coverageColor(ratio))
        const title = doc.createElementNS(svgNS, "title")
        const name = datum.path || "repository"
        title.textContent = `${name}: ${datum.cited} of ${datum.indexed} indexed files cited (${(ratio * 100).toFixed(1)}%)`
        rect.append(title)
        group.append(rect)
        if (datum.children.length) {
          rect.setAttribute("tabindex", "0")
          rect.setAttribute("role", "button")
          rect.setAttribute("aria-label", title.textContent)
          const zoom = () => {
            icicleFocus = datum.path
            draw()
          }
          rect.addEventListener("click", zoom)
          rect.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault()
              zoom()
            }
          })
        }
        if (h >= 14 && w >= 40) {
          const label = doc.createElementNS(svgNS, "text")
          label.setAttribute("x", String(x + 5))
          label.setAttribute("y", String(y + 13))
          const base = name.slice(name.lastIndexOf("/") + 1)
          const room = Math.floor((w - 10) / 6.4)
          label.textContent = base.length > room ? `${base.slice(0, Math.max(1, room - 1))}…` : base
          group.append(label)
        }
        svg.append(group)
      })
    }
    draw()
  }

  function renderReader() {
    const panel = panels.get("read")!
    panel.replaceChildren()
    const list = pages()
    if (!list.length) {
      el("p", panel, "This snapshot has no readable pages.", "empty")
      return
    }
    const page = (readPath && pageByPath(readPath)) || list[0]
    readPath = page.path
    const reader = el("div", panel, undefined, "reader")

    // Navigation: full-text search over every page, then pages grouped by section.
    const nav = el("nav", reader, undefined, "nav")
    nav.setAttribute("aria-label", "Wiki pages")
    const search = el("input", nav)
    search.type = "search"
    search.placeholder = "Search the wiki"
    search.setAttribute("aria-label", "Search the wiki")
    search.value = readQuery
    const results = el("div", nav)
    const drawNav = () => {
      results.replaceChildren()
      let lastGroup: string | undefined
      let hits = 0
      for (const candidate of list) {
        const snippet = searchPage(candidate, readQuery)
        if (snippet === undefined) continue
        hits++
        const group = candidate.path.includes("/") ? candidate.path.slice(0, candidate.path.indexOf("/")) : "Start"
        if (group !== lastGroup && !readQuery.trim()) el("div", results, group, "group")
        lastGroup = group
        const button = el("button", results, candidate.title)
        if (candidate.path === page.path) button.setAttribute("aria-current", "page")
        if (pageState(candidate) === "stale") {
          const dot = el("span", button, undefined, "stale-dot")
          dot.title = "Some cited files changed"
        }
        if (snippet) el("span", button, snippet, "hit")
        button.onclick = () => openPage(candidate.path)
      }
      if (!hits) el("p", results, "No page mentions this.", "note")
    }
    search.oninput = () => {
      readQuery = search.value
      drawNav()
    }
    drawNav()

    const article = el("article", reader, undefined, "article")
    el("div", article, page.path, "crumb")
    el("h1", article, page.title)
    const facts = el("div", article, undefined, "facts")
    const totals = pageTotals(page)
    const state = pageState(page)
    el("span", facts, stateText(page), `badge ${state}`)
    el("span", facts, plural(totals.sources, "cited file"))
    if (page.generatedAt) el("span", facts, `generated ${shortDate(page.generatedAt)}`)
    if (page.purpose) el("p", article, page.purpose, "callout")
    if (state === "stale") {
      const warn = el("p", article, undefined, "callout warn")
      warn.textContent = `${plural(totals.stale, "cited file")} changed after this page was written, so parts may be out of date. Run ax-code wiki update to refresh it.`
    }
    const knownPages = new Set((graph.pages ?? []).map((candidate) => candidate.path))
    const knownSources = new Set((graph.pages ?? []).flatMap((candidate) => candidate.sources))
    const body = el("div", article, undefined, "md")
    let headings: Array<{ level: number; text: string; slug: string }> = []
    if (page.markdown) {
      const parsed = parseMarkdown(page.markdown)
      headings = parsed.headings
      // Generated pages open with their title; the article header already shows it.
      const first = parsed.blocks[0]
      const blocks =
        first?.type === "heading" && first.level === 1 && headings[0]?.text.trim() === page.title.trim()
          ? parsed.blocks.slice(1)
          : parsed.blocks
      body.append(
        renderMarkdown(doc, blocks, {
          pagePath: page.path,
          isPage: (path) => knownPages.has(path),
          isSource: (path) => knownSources.has(path),
          onLink: (link: MarkdownLink) => {
            if (link.kind === "page") openPage(link.target)
            else if (link.kind === "source") openSource(link.target)
          },
        }),
      )
      if (page.truncated || parsed.truncated)
        el("p", article, "This page is longer than the viewer limit; the rest is in the wiki file.", "callout warn")
    } else {
      el("p", body, page.summary || "This snapshot carries no page text. Regenerate the wiki to read it here.")
    }

    const rail = el("aside", reader, undefined, "rail")
    rail.setAttribute("aria-label", "Page evidence")
    const sub = headings.filter((heading) => heading.level >= 2 && heading.level <= 3)
    if (sub.length) {
      const toc = el("section", rail, undefined, "toc")
      el("h2", toc, "On this page")
      const ul = el("ul", toc)
      for (const heading of sub.slice(0, 40)) {
        const button = el("button", el("li", ul), heading.text)
        if (heading.level === 3) button.style.paddingLeft = "18px"
        button.onclick = () => doc.getElementById(`axwv-h-${heading.slug}`)?.scrollIntoView({ block: "start" })
      }
    }
    if (page.related.length) {
      const rel = el("section", rail, undefined, "rel")
      el("h2", rel, "Related pages")
      const ul = el("ul", rel)
      for (const item of page.related) {
        const other = pageById(item.id)
        if (!other) continue
        const button = el("button", el("li", ul))
        el("span", button, other.title)
        el("span", button, `${item.shared} shared`, "count")
        button.title = `Shares ${plural(item.shared, "cited file")} with this page`
        button.onclick = () => openPage(other.path)
      }
    }
    const sources = el("section", rail)
    el(
      "h2",
      sources,
      totals.sources > page.sources.length
        ? `Cited files (${page.sources.length} of ${totals.sources})`
        : `Cited files (${page.sources.length})`,
    )
    const ul = el("ul", sources)
    const changed = new Set(page.changed)
    for (const source of page.sources) {
      const li = el("li", ul, undefined, "src")
      const dot = el(
        "span",
        li,
        undefined,
        `dot ${changed.has(source) ? "stale" : sourceUnverified(source, page, graph.nodes) ? "unknown" : ""}`,
      )
      dot.setAttribute("aria-hidden", "true")
      const button = el("button", li, undefined, "linkish")
      const cut = source.lastIndexOf("/")
      el("span", button, source.slice(cut + 1), "file")
      if (cut > 0) el("span", button, source.slice(0, cut), "dir")
      button.title = changed.has(source) ? `${source} (changed)` : source
      button.onclick = () => openSource(source)
    }
    article.scrollTop = 0
    reader.scrollTop = 0
  }

  function renderModules() {
    const panel = panels.get("modules")!
    disposeModules?.()
    panel.replaceChildren()
    const wrap = el("div", panel, undefined, "page-wrap axwv")
    const modules = graph.modules
    const linked = new Set(modules?.dependencies.flatMap((dependency) => [dependency.from, dependency.to]) ?? [])
    const isolated = modules ? modules.groups.filter((group) => !linked.has(group.path)).length : 0
    if (modules && isolated > 0 && linked.size > 1) {
      const bar = el("div", wrap, undefined, "start")
      const toggle = el("button", bar, connectedOnly ? "Show all groups" : "Only groups with recorded imports")
      toggle.setAttribute("aria-pressed", String(!connectedOnly))
      el(
        "span",
        bar,
        connectedOnly
          ? `${plural(isolated, "group")} with no recorded imports hidden.`
          : `${plural(isolated, "group")} have no recorded imports.`,
        "lead",
      )
      toggle.onclick = () => {
        connectedOnly = !connectedOnly
        renderModules()
      }
    }
    const host = el("div", wrap)
    disposeModules = renderModulesView(doc, host, graph, {
      visibleGroups: modules && connectedOnly && linked.size > 1 ? linked : undefined,
      onSelectGroup: (path, files) => {
        drawer.replaceChildren()
        const close = el("button", drawer, "✕", "close")
        close.setAttribute("aria-label", "Close")
        close.onclick = () => (drawer.hidden = true)
        el("h2", drawer, "Module")
        el("p", drawer, path || "(repository root)", "path")
        el("p", drawer, `${plural(files.length, "cited file")}`, "note")
        const list = el("ul", drawer)
        for (const file of files.slice(0, 200)) {
          const button = el("button", el("li", list), file, "linkish")
          button.onclick = () => openSource(file)
        }
        drawer.hidden = false
        close.focus()
      },
      onSelectPage: (id) => {
        const page = pageById(id)
        if (page) openPage(page.path)
      },
    })
  }

  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !drawer.hidden) {
      drawer.hidden = true
      event.stopPropagation()
    }
  })
  element.append(root)
  renderMeta()
  // Snapshots from older producers carry no pages; only the map can show them.
  show(graph.pages?.length || current === "modules" ? current : "map")

  return {
    show,
    update(next: unknown) {
      const parsed = parseWikiGraph(next)
      const changed = parsed.snapshot !== graph.snapshot
      graph = parsed
      if (changed) {
        readPath = undefined
        icicleFocus = ""
        drawer.hidden = true
      }
      map?.update(parsed)
      rendered.clear()
      renderMeta()
      show(current)
    },
    dispose() {
      disposeModules?.()
      map?.dispose()
      root.remove()
      root.replaceChildren()
    },
  }
}
