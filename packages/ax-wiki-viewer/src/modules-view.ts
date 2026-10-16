import type { WikiGraph, WikiGraphModules, WikiGraphPage } from "@ax-code/ax-wiki/graph"

/** Styles for the modules view. Scoped under the `.axwv` ancestor, which owns the color variables. */
export const modulesCss = `
.axwv .modules{display:flex;flex-direction:column;gap:4px;min-width:0;color:var(--text)}
.axwv .modules h2{font-size:15px;font-weight:650;margin:16px 0 0;letter-spacing:-.01em}
.axwv .modules h2:first-child{margin-top:0}
.axwv .modules h3{font-size:13px;font-weight:650;margin:10px 0 4px}
.axwv .modules .caption{margin:2px 0 8px;color:var(--muted);font-size:12px;max-width:78ch}
.axwv .modules .empty{margin:4px 0 8px;padding:12px 14px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--muted)}
.axwv .modules .scroll{overflow:auto;max-width:100%;width:fit-content;margin:0 0 8px;border:1px solid var(--line);border-radius:12px;background:var(--canvas);scrollbar-width:thin;scrollbar-color:var(--line-2) transparent}
.axwv .modules svg.chart{display:block;width:auto;height:auto;max-width:none}
.axwv .modules svg.chart text{font-family:inherit;font-size:11px;fill:var(--text);pointer-events:none}
.axwv .modules svg.chart text.count{font-size:10px;text-anchor:middle;font-variant-numeric:tabular-nums}
.axwv .modules svg.chart text.diag-num{fill:var(--muted)}
.axwv .modules svg.chart text.col-label{fill:var(--muted);text-anchor:start}
.axwv .modules svg.chart text.col-num{fill:var(--muted);text-anchor:middle;font-size:10px;pointer-events:auto}
.axwv .modules svg.chart text.row-text{text-anchor:end}
.axwv .modules .row-label{cursor:pointer}
.axwv .modules .hit{fill:transparent}
.axwv .modules .row-label:hover .hit,.axwv .modules .row-label:focus .hit{fill:var(--accent);fill-opacity:.14}
.axwv .modules .row-label:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.axwv .modules .cell{stroke:var(--line);stroke-width:1px;shape-rendering:crispEdges}
.axwv .modules .cell.off{fill:var(--surface)}
.axwv .modules .cell.diag{fill:var(--surface-2)}
.axwv .modules .cell.on{fill:var(--accent)}
.axwv .modules .cell.cycle{stroke:var(--amber);stroke-width:1.5px}
.axwv .modules .cycle-mark{fill:var(--amber)}
.axwv .modules .hot{fill:var(--accent);fill-opacity:.16;pointer-events:none}
.axwv .modules .cycles{margin:2px 0 8px;font-size:13px}
.axwv .modules .cycles p{margin:0;color:var(--muted)}
.axwv .modules .cycles ol{margin:4px 0 0;padding-left:1.25em}
.axwv .modules .cycles li{margin:2px 0;overflow-wrap:anywhere}
.axwv .modules .more{margin:4px 0 0;color:var(--muted);font-size:12px}
@media (prefers-reduced-motion:reduce){.axwv .modules,.axwv .modules *{transition:none!important;animation:none!important}}
`

const SVG_NS = "http://www.w3.org/2000/svg"
const MAX_GROUPS = 40
const MAX_PAGES = 500
const HEATMAP_ROWS = 60
const CELL_MIN = 14
const CELL_MAX = 28
const GRID_BUDGET = 720
const COUNT_MIN_CELL = 18
/** Over-estimate of an 11px glyph so rotated labels stay inside the svg viewport. */
const CHAR_PX = 7.2

type ModuleAnalysis = {
  order: string[]
  cycles: string[][]
  levels: Map<string, number>
  inbound: Map<string, number>
  outbound: Map<string, number>
}

type ViewOptions = {
  onSelectGroup?(path: string, files: string[]): void
  onSelectPage?(id: string): void
  /** Matrix rows and columns to show; the page heatmap and file attribution always use every group. */
  visibleGroups?: ReadonlySet<string>
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function compareList(a: readonly string[], b: readonly string[]): number {
  const length = Math.min(a.length, b.length)
  for (let index = 0; index < length; index++) {
    const compared = compareText(a[index], b[index])
    if (compared !== 0) return compared
  }
  return a.length - b.length
}

function groupLabel(path: string): string {
  return path === "" ? "(root)" : path
}

/**
 * A slice that never splits a surrogate pair. A lone half renders as U+FFFD,
 * so a truncated astral character (an emoji in a directory name) would garble
 * the label instead of shortening it.
 */
function safeCut(value: string, from: number, to: number): string {
  const cut = value.slice(from, to)
  let start = 0
  let end = cut.length
  const first = cut.charCodeAt(start)
  if (from > 0 && first >= 0xdc00 && first <= 0xdfff) start += 1
  const last = cut.charCodeAt(end - 1)
  if (to < value.length && last >= 0xd800 && last <= 0xdbff) end -= 1
  return cut.slice(start, end)
}

/** Display form of a group path: its last segments, so deep paths do not push the matrix aside. */
export function shortGroupLabel(path: string, max = 32): string {
  if (path === "") return "(root)"
  const parts = path.split("/")
  let label = parts[parts.length - 1]
  for (let index = parts.length - 2; index >= 0; index--) {
    const next = `${parts[index]}/${label}`
    if (next.length > max) break
    label = next
  }
  if (label !== path) label = `…/${label}`
  return label.length > max + 2 ? `…${safeCut(label, label.length - max, label.length)}` : label
}

/**
 * Iterative Tarjan. The DFS call stack is an explicit array: a chain of thousands of
 * nodes must not recurse. Each component is returned in pop order; callers sort.
 */
export function stronglyConnected(nodes: string[], edges: Array<[string, string]>): string[][] {
  const adjacent = new Map<string, string[]>()
  const list: string[] = []
  const seen = new Set<string>()
  const touch = (node: string) => {
    if (seen.has(node)) return
    seen.add(node)
    list.push(node)
    adjacent.set(node, [])
  }
  for (const node of nodes) touch(node)
  for (const [from, to] of edges) {
    touch(from)
    touch(to)
    adjacent.get(from)!.push(to)
  }

  const indexOf = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const components: string[][] = []
  let nextIndex = 0
  // `ei` is the next successor to explore. Frames replace recursive calls.
  const frames: Array<{ node: string; ei: number }> = []

  const push = (node: string) => {
    indexOf.set(node, nextIndex)
    low.set(node, nextIndex)
    nextIndex += 1
    stack.push(node)
    onStack.add(node)
    frames.push({ node, ei: 0 })
  }

  for (const root of list) {
    if (indexOf.has(root)) continue
    push(root)
    while (frames.length > 0) {
      const frame = frames[frames.length - 1]
      const successors = adjacent.get(frame.node) ?? []
      if (frame.ei < successors.length) {
        const next = successors[frame.ei]
        frame.ei += 1
        if (!indexOf.has(next)) push(next)
        else if (onStack.has(next)) low.set(frame.node, Math.min(low.get(frame.node)!, indexOf.get(next)!))
        continue
      }
      frames.pop()
      if (low.get(frame.node) === indexOf.get(frame.node)) {
        const component: string[] = []
        for (;;) {
          const member = stack.pop()!
          onStack.delete(member)
          component.push(member)
          if (member === frame.node) break
        }
        components.push(component)
      }
      const parent = frames[frames.length - 1]
      if (parent) low.set(parent.node, Math.min(low.get(parent.node)!, low.get(frame.node)!))
    }
  }
  return components
}

/** Pure: order groups for a dependency structure matrix and find cycles. */
export function analyzeModules(modules: WikiGraphModules): ModuleAnalysis {
  const paths: string[] = []
  const known = new Set<string>()
  for (const group of modules.groups) {
    if (known.has(group.path)) continue
    known.add(group.path)
    paths.push(group.path)
  }
  const inbound = new Map<string, number>(paths.map((path) => [path, 0]))
  const outbound = new Map<string, number>(paths.map((path) => [path, 0]))
  const edges: Array<[string, string]> = []
  for (const dependency of modules.dependencies) {
    if (outbound.has(dependency.from))
      outbound.set(dependency.from, outbound.get(dependency.from)! + dependency.imports)
    if (inbound.has(dependency.to)) inbound.set(dependency.to, inbound.get(dependency.to)! + dependency.imports)
    if (known.has(dependency.from) && known.has(dependency.to) && dependency.from !== dependency.to)
      edges.push([dependency.from, dependency.to])
  }

  // Edge direction is "imports" / depends-on. A sink depends on nothing, so it is a provider.
  const components = stronglyConnected(paths, edges)
  const componentOf = new Map<string, number>()
  components.forEach((members, index) => {
    for (const member of members) componentOf.set(member, index)
  })
  const successors: Array<Set<number>> = components.map(() => new Set())
  for (const [from, to] of edges) {
    const source = componentOf.get(from)!
    const target = componentOf.get(to)!
    if (source !== target) successors[source].add(target)
  }
  const componentLevel = components.map(() => 0)
  const remaining = successors.map((targets) => targets.size)
  const predecessors: Array<number[]> = components.map(() => [])
  successors.forEach((targets, source) => {
    for (const target of targets) predecessors[target].push(source)
  })
  const queue: number[] = []
  for (let index = 0; index < components.length; index++) if (remaining[index] === 0) queue.push(index)
  for (let head = 0; head < queue.length; head++) {
    const done = queue[head]
    for (const predecessor of predecessors[done]) {
      componentLevel[predecessor] = Math.max(componentLevel[predecessor], componentLevel[done] + 1)
      remaining[predecessor] -= 1
      if (remaining[predecessor] === 0) queue.push(predecessor)
    }
  }

  const levels = new Map<string, number>()
  const ranked = components.map((members, index) => {
    const sorted = [...members].sort(compareText)
    for (const member of sorted) levels.set(member, componentLevel[index])
    return { members: sorted, level: componentLevel[index] }
  })
  // Providers (level 0) come first. A tie breaks by path, and a cycle stays one adjacent block.
  ranked.sort((a, b) => a.level - b.level || compareList(a.members, b.members))
  const cycles = ranked
    .map((entry) => entry.members)
    .filter((members) => members.length > 1)
    .sort(compareList)
  return { order: ranked.flatMap((entry) => entry.members), cycles, levels, inbound, outbound }
}

/**
 * Pure: which module group each cited file belongs to.
 * The longest directory prefix wins. The "" group is the root fallback when nothing longer matches.
 */
export function groupOfFile(groups: readonly { path: string }[], file: string): string | undefined {
  let best: string | undefined
  let bestLength = -1
  let root = false
  for (const group of groups) {
    const path = group.path
    if (path === "") {
      root = true
      continue
    }
    if (path.length <= bestLength) continue
    if (file === path || file.startsWith(`${path}/`)) {
      best = path
      bestLength = path.length
    }
  }
  if (best !== undefined) return best
  return root ? "" : undefined
}

/** Pure: page x group matrix of cited-file counts. Rows = pages in input order, columns = analyzeModules order. */
export function pageModuleMatrix(
  pages: readonly WikiGraphPage[],
  modules: WikiGraphModules,
): { columns: string[]; rows: { id: string; title: string; counts: number[] }[] } {
  const columns = analyzeModules(modules).order
  const columnOf = new Map(columns.map((path, index) => [path, index]))
  const rows = pages.map((page) => {
    const counts = columns.map(() => 0)
    for (const file of page.sources) {
      const group = groupOfFile(modules.groups, file)
      const column = group === undefined ? undefined : columnOf.get(group)
      if (column !== undefined) counts[column] += 1
    }
    return { id: page.id, title: page.title, counts }
  })
  return { columns, rows }
}

function html<T extends keyof HTMLElementTagNameMap>(doc: Document, tag: T): HTMLElementTagNameMap[T] {
  return doc.createElement(tag)
}

function svg<T extends keyof SVGElementTagNameMap>(doc: Document, tag: T): SVGElementTagNameMap[T] {
  return doc.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[T]
}

function paragraph(doc: Document, className: string, text: string): HTMLParagraphElement {
  const node = html(doc, "p")
  node.setAttribute("class", className)
  node.textContent = text
  return node
}

function heading(doc: Document, text: string): HTMLHeadingElement {
  const node = html(doc, "h2")
  node.textContent = text
  return node
}

function cellSize(columns: number): number {
  if (columns <= 0) return CELL_MAX
  return Math.max(CELL_MIN, Math.min(CELL_MAX, Math.floor(GRID_BUDGET / columns)))
}

function labelSpan(labels: readonly string[]): number {
  let max = 0
  for (const label of labels) if (label.length > max) max = label.length
  return Math.ceil(max * CHAR_PX)
}

type GridMetrics = {
  cell: number
  rows: number
  cols: number
  rowLabelW: number
  colLabelH: number
  width: number
  height: number
  originX: number
  originY: number
}

function gridMetrics(
  rowLabels: readonly string[],
  colLabels: readonly string[],
  options: { numbered?: boolean } = {},
): GridMetrics {
  const rows = rowLabels.length
  const cols = colLabels.length
  const cell = cellSize(cols)
  const rowLabelW = Math.max(72, labelSpan(rowLabels) + 36)
  // Numbered columns need one short line, not room for rotated paths.
  const colLabelH = options.numbered ? 22 : Math.max(36, Math.ceil(labelSpan(colLabels) * 0.72) + 18)
  // Angled labels lean right past the last column.
  const overhang = options.numbered ? 0 : Math.ceil(labelSpan(colLabels) * 0.72)
  const pad = 4
  return {
    cell,
    rows,
    cols,
    rowLabelW,
    colLabelH,
    width: rowLabelW + cols * cell + pad + overhang,
    height: colLabelH + rows * cell + pad,
    originX: rowLabelW,
    originY: colLabelH,
  }
}

function createChart(doc: Document, metrics: GridMetrics): SVGSVGElement {
  const chart = svg(doc, "svg")
  chart.setAttribute("class", "chart")
  chart.setAttribute("viewBox", `0 0 ${metrics.width} ${metrics.height}`)
  chart.setAttribute("width", String(metrics.width))
  chart.setAttribute("height", String(metrics.height))
  // Numeric box only. Beats a host rule that stretches every svg to its container.
  chart.setAttribute("style", `width:${metrics.width}px;height:${metrics.height}px`)
  return chart
}

function scroller(doc: Document, chart: SVGSVGElement): HTMLDivElement {
  const wrap = html(doc, "div")
  wrap.setAttribute("class", "scroll")
  wrap.append(chart)
  return wrap
}

type CrossHighlight = {
  show(index: number | null): void
}

/** Row (and, for a square matrix, matching column) highlight rects. `index` null hides them. */
function crossHighlight(doc: Document, chart: SVGSVGElement, metrics: GridMetrics, square: boolean): CrossHighlight {
  const band = (x: string, y: string, width: string, height: string) => {
    const rect = svg(doc, "rect")
    rect.setAttribute("class", "hot")
    rect.setAttribute("aria-hidden", "true")
    rect.setAttribute("x", x)
    rect.setAttribute("y", y)
    rect.setAttribute("width", width)
    rect.setAttribute("height", height)
    rect.setAttribute("visibility", "hidden")
    chart.append(rect)
    return rect
  }
  const row = band(String(metrics.originX), "0", String(metrics.cols * metrics.cell), String(metrics.cell))
  const column = square
    ? band("0", String(metrics.originY), String(metrics.cell), String(metrics.rows * metrics.cell))
    : undefined
  return {
    show(index) {
      if (index === null) {
        row.setAttribute("visibility", "hidden")
        column?.setAttribute("visibility", "hidden")
        return
      }
      row.setAttribute("y", String(metrics.originY + index * metrics.cell))
      row.setAttribute("visibility", "visible")
      if (column) {
        column.setAttribute("x", String(metrics.originX + index * metrics.cell))
        column.setAttribute("visibility", "visible")
      }
    },
  }
}

function bindHoverFocus(
  signal: AbortSignal,
  highlight: CrossHighlight,
): { hover(index: number | null): void; focus(index: number | null): void } {
  let hovered: number | null = null
  let focused: number | null = null
  const apply = () => highlight.show(hovered ?? focused)
  return {
    hover(index) {
      hovered = index
      apply()
    },
    focus(index) {
      focused = index
      apply()
    },
  }
}

function addColumnLabels(
  doc: Document,
  chart: SVGSVGElement,
  metrics: GridMetrics,
  labels: readonly string[],
  full?: readonly string[],
  numbered = false,
) {
  for (let column = 0; column < labels.length; column++) {
    if (numbered) {
      const text = svg(doc, "text")
      text.setAttribute("class", "col-num")
      text.setAttribute("x", String(metrics.originX + column * metrics.cell + metrics.cell / 2))
      text.setAttribute("y", String(metrics.colLabelH - 7))
      text.textContent = String(column + 1)
      const tip = svg(doc, "title")
      tip.textContent = full?.[column] ?? labels[column]
      text.append(tip)
      chart.append(text)
      continue
    }
    const text = svg(doc, "text")
    text.setAttribute("class", "col-label")
    const x = metrics.originX + column * metrics.cell + metrics.cell / 2
    const y = metrics.colLabelH - 2
    // 45 degrees needs about 70% of the height a vertical label does.
    text.setAttribute("transform", `translate(${x} ${y}) rotate(-45)`)
    text.setAttribute("x", "4")
    text.setAttribute("y", "0")
    text.setAttribute("text-anchor", "start")
    text.setAttribute("dominant-baseline", "middle")
    text.textContent = labels[column]
    if (full?.[column] && full[column] !== labels[column]) {
      const tip = svg(doc, "title")
      tip.textContent = full[column]
      text.append(tip)
    }
    chart.append(text)
  }
}

function addRowButton(
  doc: Document,
  chart: SVGSVGElement,
  metrics: GridMetrics,
  index: number,
  label: string,
  cycle: boolean,
  signal: AbortSignal,
  hover: (index: number | null) => void,
  focus: (index: number | null) => void,
  activate: () => void,
) {
  const row = svg(doc, "g")
  row.setAttribute("class", "row-label")
  row.setAttribute("role", "button")
  row.setAttribute("tabindex", "0")
  const y = metrics.originY + index * metrics.cell
  const hit = svg(doc, "rect")
  hit.setAttribute("class", "hit")
  hit.setAttribute("x", "0")
  hit.setAttribute("y", String(y))
  hit.setAttribute("width", String(metrics.rowLabelW))
  hit.setAttribute("height", String(metrics.cell))
  row.append(hit)
  if (cycle) {
    const mark = svg(doc, "circle")
    mark.setAttribute("class", "cycle-mark")
    mark.setAttribute("cx", "12")
    mark.setAttribute("cy", String(y + metrics.cell / 2))
    mark.setAttribute("r", "3.5")
    row.append(mark)
  }
  const text = svg(doc, "text")
  text.setAttribute("class", "row-text")
  text.setAttribute("x", String(metrics.rowLabelW - 8))
  text.setAttribute("y", String(y + metrics.cell / 2))
  text.setAttribute("text-anchor", "end")
  text.setAttribute("dominant-baseline", "central")
  text.textContent = label
  row.append(text)
  row.addEventListener("click", activate, { signal })
  row.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Enter" && event.key !== " ") return
      event.preventDefault()
      activate()
    },
    { signal },
  )
  row.addEventListener("mouseenter", () => hover(index), { signal })
  row.addEventListener("mouseleave", () => hover(null), { signal })
  row.addEventListener("focus", () => focus(index), { signal })
  row.addEventListener("blur", () => focus(null), { signal })
  chart.append(row)
  return row
}

function importWeights(dependencies: WikiGraphModules["dependencies"]): { weights: Map<string, number>; max: number } {
  const weights = new Map<string, number>()
  let max = 0
  for (const dependency of dependencies) {
    if (dependency.from === dependency.to) continue
    const key = `${dependency.from}\0${dependency.to}`
    const total = (weights.get(key) ?? 0) + dependency.imports
    weights.set(key, total)
    if (total > max) max = total
  }
  return { weights, max }
}

function opacityOf(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0
  return Math.sqrt(count / max)
}

function filesByGroup(
  groups: readonly { path: string }[],
  order: readonly string[],
  pages: readonly WikiGraphPage[],
): Map<string, string[]> {
  const lists = new Map<string, string[]>()
  const seen = new Map<string, Set<string>>()
  for (const path of order) {
    lists.set(path, [])
    seen.set(path, new Set())
  }
  for (const page of pages) {
    for (const file of page.sources) {
      const group = groupOfFile(groups, file)
      const bag = group === undefined ? undefined : seen.get(group)
      const list = group === undefined ? undefined : lists.get(group)
      if (!bag || !list || bag.has(file)) continue
      bag.add(file)
      list.push(file)
    }
  }
  for (const list of lists.values()) list.sort(compareText)
  return lists
}

function boundModules(modules: WikiGraphModules): WikiGraphModules {
  if (modules.groups.length <= MAX_GROUPS && modules.dependencies.length <= 800) return modules
  const groups = modules.groups.slice(0, MAX_GROUPS)
  const known = new Set(groups.map((group) => group.path))
  const dependencies = modules.dependencies
    .filter((dependency) => known.has(dependency.from) && known.has(dependency.to))
    .slice(0, 800)
  return { rule: modules.rule, groups, dependencies }
}

type CountMark = { x: number; y: number; text: string; diag: boolean }

function appendCounts(doc: Document, chart: SVGSVGElement, marks: readonly CountMark[]) {
  for (const mark of marks) {
    const text = svg(doc, "text")
    text.setAttribute("class", mark.diag ? "count diag-num" : "count")
    text.setAttribute("x", String(mark.x))
    text.setAttribute("y", String(mark.y))
    text.setAttribute("text-anchor", "middle")
    text.setAttribute("dominant-baseline", "central")
    text.textContent = mark.text
    chart.append(text)
  }
}

function renderMatrix(
  doc: Document,
  modules: WikiGraphModules,
  analysis: ModuleAnalysis,
  pages: readonly WikiGraphPage[],
  options: ViewOptions,
  signal: AbortSignal,
): SVGSVGElement {
  // Columns are numbered to match their rows, so long paths are read once, on the left.
  const labels = analysis.order.map((path, index) => `${shortGroupLabel(path)}  ${index + 1}`)
  const fullLabels = analysis.order.map(groupLabel)
  const metrics = gridMetrics(labels, labels, { numbered: true })
  const chart = createChart(doc, metrics)
  const { weights, max } = importWeights(modules.dependencies)
  const files = new Map<string, number>()
  for (const group of modules.groups) if (!files.has(group.path)) files.set(group.path, group.files)
  const cycleId = new Map<string, number>()
  analysis.cycles.forEach((members, index) => {
    for (const member of members) cycleId.set(member, index)
  })
  const marks: CountMark[] = []
  const showNumber = metrics.cell >= COUNT_MIN_CELL
  for (let row = 0; row < analysis.order.length; row++) {
    for (let column = 0; column < analysis.order.length; column++) {
      const from = analysis.order[row]
      const to = analysis.order[column]
      const x = metrics.originX + column * metrics.cell
      const y = metrics.originY + row * metrics.cell
      const rect = svg(doc, "rect")
      rect.setAttribute("x", String(x))
      rect.setAttribute("y", String(y))
      rect.setAttribute("width", String(metrics.cell))
      rect.setAttribute("height", String(metrics.cell))
      const diagonal = row === column
      if (diagonal) {
        rect.setAttribute("class", "cell diag")
        if (showNumber) {
          marks.push({
            x: x + metrics.cell / 2,
            y: y + metrics.cell / 2,
            text: String(files.get(from) ?? 0),
            diag: true,
          })
        }
      } else {
        const imports = weights.get(`${from}\0${to}`) ?? 0
        const inCycle = imports > 0 && row < column && cycleId.has(from) && cycleId.get(from) === cycleId.get(to)
        rect.setAttribute("class", imports > 0 ? (inCycle ? "cell on cycle" : "cell on") : "cell off")
        if (imports > 0) {
          rect.setAttribute("fill-opacity", String(opacityOf(imports, max)))
          const title = svg(doc, "title")
          title.textContent = `${groupLabel(from)} imports ${groupLabel(to)}: ${imports}`
          rect.append(title)
          if (showNumber) {
            marks.push({
              x: x + metrics.cell / 2,
              y: y + metrics.cell / 2,
              text: String(imports),
              diag: false,
            })
          }
        }
      }
      chart.append(rect)
    }
  }
  const highlight = crossHighlight(doc, chart, metrics, true)
  appendCounts(doc, chart, marks)
  addColumnLabels(doc, chart, metrics, labels, fullLabels, true)
  const listed = filesByGroup(modules.groups, analysis.order, pages)
  const focus = bindHoverFocus(signal, highlight)
  for (let index = 0; index < analysis.order.length; index++) {
    const path = analysis.order[index]
    const row = addRowButton(
      doc,
      chart,
      metrics,
      index,
      labels[index],
      cycleId.has(path),
      signal,
      focus.hover,
      focus.focus,
      () => options.onSelectGroup?.(path, (listed.get(path) ?? []).slice()),
    )
    row.setAttribute("aria-label", `${fullLabels[index]}: show cited files`)
    if (fullLabels[index] !== labels[index]) {
      const tip = svg(doc, "title")
      tip.textContent = fullLabels[index]
      row.append(tip)
    }
  }
  return chart
}

function renderHeatmap(
  doc: Document,
  columns: readonly string[],
  rows: readonly { id: string; title: string; counts: number[] }[],
  options: ViewOptions,
  signal: AbortSignal,
): SVGSVGElement {
  const colLabels = columns.map((path) => shortGroupLabel(path, 24))
  const fullColumns = columns.map(groupLabel)
  const rowLabels = rows.map((row) => (row.title.length > 40 ? `${safeCut(row.title, 0, 39)}…` : row.title))
  const metrics = gridMetrics(rowLabels, colLabels)
  const chart = createChart(doc, metrics)
  let max = 0
  for (const row of rows) for (const count of row.counts) if (count > max) max = count
  const marks: CountMark[] = []
  const showNumber = metrics.cell >= COUNT_MIN_CELL
  for (let row = 0; row < rows.length; row++) {
    for (let column = 0; column < columns.length; column++) {
      const count = rows[row].counts[column] ?? 0
      const x = metrics.originX + column * metrics.cell
      const y = metrics.originY + row * metrics.cell
      const rect = svg(doc, "rect")
      rect.setAttribute("class", count > 0 ? "cell on" : "cell off")
      rect.setAttribute("x", String(x))
      rect.setAttribute("y", String(y))
      rect.setAttribute("width", String(metrics.cell))
      rect.setAttribute("height", String(metrics.cell))
      if (count > 0) {
        rect.setAttribute("fill-opacity", String(opacityOf(count, max)))
        const title = svg(doc, "title")
        // The full group path, not the shortened column label: two groups can
        // shorten to the same text and the cell tooltip is the only place the
        // cited directory is named.
        title.textContent = `${rows[row].title} cites ${fullColumns[column]}: ${count}`
        rect.append(title)
        if (showNumber) {
          marks.push({ x: x + metrics.cell / 2, y: y + metrics.cell / 2, text: String(count), diag: false })
        }
      }
      chart.append(rect)
    }
  }
  const highlight = crossHighlight(doc, chart, metrics, false)
  appendCounts(doc, chart, marks)
  addColumnLabels(doc, chart, metrics, colLabels, fullColumns)
  const focus = bindHoverFocus(signal, highlight)
  for (let index = 0; index < rows.length; index++) {
    const page = rows[index]
    addRowButton(doc, chart, metrics, index, rowLabels[index], false, signal, focus.hover, focus.focus, () =>
      options.onSelectPage?.(page.id),
    )
  }
  return chart
}

function renderCycles(doc: Document, cycles: readonly (readonly string[])[]): HTMLDivElement {
  const wrap = html(doc, "div")
  wrap.setAttribute("class", "cycles")
  if (cycles.length === 0) {
    wrap.append(paragraph(doc, "", "No cycles among recorded imports"))
    return wrap
  }
  const title = html(doc, "h3")
  title.textContent = cycles.length === 1 ? "1 cycle" : `${cycles.length} cycles`
  wrap.append(title)
  const list = html(doc, "ol")
  for (const cycle of cycles) {
    const item = html(doc, "li")
    item.textContent = cycle.map(groupLabel).join(", ")
    list.append(item)
  }
  wrap.append(list)
  return wrap
}

/** Render the view into `container` (replace its children). Returns a dispose function. */
export function renderModulesView(
  doc: Document,
  container: HTMLElement,
  graph: WikiGraph,
  options: ViewOptions,
): () => void {
  const abort = new AbortController()
  container.replaceChildren()
  const root = html(doc, "div")
  root.setAttribute("class", "modules")
  container.append(root)
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    abort.abort()
    root.remove()
  }

  root.append(heading(doc, "Module dependencies"))
  if (!graph.modules) {
    root.append(paragraph(doc, "empty", "This snapshot has no module projection"))
    return dispose
  }

  const modules = boundModules(graph.modules)
  const rule = modules.rule.trim()
  const sentence = "Cells count recorded static imports between cited files. Row imports column."
  const joiner = rule.length === 0 || /[.!?]$/.test(rule) ? " " : ". "
  root.append(paragraph(doc, "caption", rule.length === 0 ? sentence : `${rule}${joiner}${sentence}`))

  const pages = (graph.pages ?? []).slice(0, MAX_PAGES)
  const analysis = analyzeModules(modules)
  if (modules.dependencies.length === 0) root.append(paragraph(doc, "empty", "No recorded imports"))
  else {
    // Hiding groups only filters matrix rows and columns; file attribution still uses every group.
    const visible = options.visibleGroups
    const shown = visible ? { ...analysis, order: analysis.order.filter((path) => visible.has(path)) } : analysis
    root.append(scroller(doc, renderMatrix(doc, modules, shown, pages, options, abort.signal)))
  }

  root.append(renderCycles(doc, analysis.cycles))
  root.append(heading(doc, "Pages x modules"))
  root.append(paragraph(doc, "caption", "Which areas each page cites. Empty columns are areas no page cites."))
  const matrix = pageModuleMatrix(pages, modules)
  if (matrix.columns.length > 0) {
    root.append(
      scroller(doc, renderHeatmap(doc, matrix.columns, matrix.rows.slice(0, HEATMAP_ROWS), options, abort.signal)),
    )
  }
  if (matrix.rows.length > HEATMAP_ROWS) {
    root.append(paragraph(doc, "more", `+${matrix.rows.length - HEATMAP_ROWS} more pages`))
  }
  return dispose
}
