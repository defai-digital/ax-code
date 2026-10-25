import { dependencyMetrics, type WikiGraphModules } from "@ax-code/ax-wiki/graph"

export const moduleInsightsCss = `
.axwv .module-scope{padding:10px 12px;border:1px solid var(--line);border-radius:10px;margin:4px 0 12px;background:var(--surface)}
.axwv .module-scope summary{font-size:12px;cursor:pointer;font-weight:600}
.axwv .module-scope p{font-size:12px;color:var(--muted);margin:8px 0 0;overflow-wrap:anywhere}
.axwv .module-insights[hidden]{display:none}
.axwv .module-rankings{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;margin:8px 0 16px}
.axwv .module-ranking{min-width:0}
.axwv .module-ranking ol{list-style:none;padding:0;margin:0;display:grid;gap:6px}
.axwv .module-ranking button{width:100%;text-align:left;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 12px;padding:7px 10px}
.axwv .module-ranking .rank-path{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.axwv .module-ranking .rank-value{font-variant-numeric:tabular-nums}
.axwv .rank-track{grid-column:1/-1;height:4px;background:var(--line);border-radius:3px;overflow:hidden}
.axwv .rank-bar{display:block;height:100%;background:var(--accent)}
.axwv .module-table{width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed}
.axwv .module-table caption{text-align:left;color:var(--muted);padding:8px 0}
.axwv .module-table th,.axwv .module-table td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);overflow-wrap:anywhere;vertical-align:top}
.axwv .module-table th:nth-child(3),.axwv .module-table td:nth-child(3){width:110px;text-align:right;font-variant-numeric:tabular-nums}
.axwv .module-table th:last-child,.axwv .module-table td:last-child{width:96px}
.axwv .module-table td button{white-space:nowrap}
.axwv .module-table th button{max-width:100%;font-size:12px}
.axwv .module-table tr[data-selected=true]{background:var(--surface-2)}
.axwv .module-pager{display:flex;align-items:center;gap:8px;margin:10px 0;font-size:12px;color:var(--muted)}
@media(max-width:700px){.axwv .module-rankings{grid-template-columns:1fr}.axwv .module-table th:nth-child(3),.axwv .module-table td:nth-child(3){width:76px}}
`

const label = (path: string) => path || "(root)"
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

export function renderModuleScope(doc: Document, modules: WikiGraphModules): HTMLElement {
  const scope = doc.createElement("details")
  scope.setAttribute("class", "module-scope")
  const evidence = modules.evidence
  const scan = evidence?.scan
  const status =
    scan?.status === "partial"
      ? "Partial scan"
      : scan?.status === "unavailable"
        ? "Scan unavailable"
        : "Scan coverage unknown"
  const summary = doc.createElement("summary")
  summary.textContent = `${status} · ${modules.groups.reduce((sum, group) => sum + group.files, 0)} cited files · ${modules.groups.length} groups · ${modules.dependencies.length} retained module pairs`
  scope.append(summary)
  const add = (text: string) => {
    const p = doc.createElement("p")
    p.textContent = text
    scope.append(p)
  }
  const count = (value: number | undefined) => (value === undefined ? "unknown" : String(value))
  add(
    `Source files: ${count(scan?.analyzedFiles)} analyzed; ${count(scan?.unsupportedFiles)} unsupported; ${count(scan?.unavailableFiles)} unavailable; ${count(scan?.failedFiles)} failed; ${count(scan?.unscannedFiles)} not scanned.`,
  )
  add(
    `Unresolved import references: ${count(scan?.unresolvedImports)}. Omitted resolved imports at the source cap: ${count(scan?.omittedImports)}. Omitted module pairs: ${count(evidence?.omittedDependencies)} (${count(evidence?.omittedDependencyImports)} file pairs). Within-group file pairs excluded from rankings: ${count(evidence?.internalImports)}.`,
  )
  add(
    "Only cited files participate. Bounded syntactic extraction can miss imports, including references outside the cited inventory. Directory groups adapt to this snapshot; ranks across snapshots are not directly comparable. Counts are observed lower bounds, not runtime hotpaths or defect probabilities.",
  )
  return scope
}

/** Rankings and the evidence table use all retained groups, independently of the matrix visibility filter. */
export function renderModuleInsights(
  doc: Document,
  modules: WikiGraphModules,
  options: {
    signal: AbortSignal
    onGroup(path: string): void
    onImports(pairs: WikiGraphModules["dependencies"]): void
  },
): HTMLElement {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
    const node = doc.createElement(tag)
    if (text !== undefined) node.textContent = text
    return node
  }
  const button = (text: string, action: () => void, signal = options.signal) => {
    const node = el("button", text)
    node.type = "button"
    node.addEventListener("click", action, { signal })
    return node
  }
  const root = el("section")
  root.setAttribute("class", "module-insights")
  root.setAttribute("aria-label", "Module insights")
  let rankingEvents = new AbortController()
  let tableEvents = new AbortController()
  options.signal.addEventListener(
    "abort",
    () => {
      rankingEvents.abort()
      tableEvents.abort()
    },
    { once: true },
  )
  const metrics = dependencyMetrics(
    modules.groups.map((group) => group.path),
    modules.dependencies,
  )
  root.append(
    el(
      "p",
      "All retained groups. Neighbor modules count distinct connections; file pairs count distinct importer-file → dependency-file pairs. Neither counts import statements or runtime calls.",
    ),
  )
  const controls = el("div")
  controls.setAttribute("class", "module-views")
  controls.setAttribute("role", "group")
  controls.setAttribute("aria-label", "Ranking unit")
  let weighted = false
  const rankings = el("div")
  rankings.setAttribute("class", "module-rankings")
  const drawRankings = () => {
    rankingEvents.abort()
    rankingEvents = new AbortController()
    rankings.replaceChildren()
    neighborButton.setAttribute("aria-pressed", String(!weighted))
    pairButton.setAttribute("aria-pressed", String(weighted))
    // One scale across both directions makes the bar lengths comparable.
    const value = (id: string, incoming: boolean) => {
      const metric = metrics.get(id)!
      return incoming
        ? weighted
          ? metric.inboundPairs
          : metric.inboundNeighbors
        : weighted
          ? metric.outboundPairs
          : metric.outboundNeighbors
    }
    const max = Math.max(1, ...modules.groups.flatMap(({ path }) => [value(path, true), value(path, false)]))
    for (const incoming of [true, false]) {
      const column = el("section")
      column.setAttribute("class", "module-ranking")
      column.append(el("h3", incoming ? "Incoming dependencies" : "Outgoing dependencies"))
      const sorted = modules.groups
        .map(({ path }) => ({ path, count: value(path, incoming) }))
        .sort((a, b) => b.count - a.count || compare(a.path, b.path))
      column.append(
        el(
          "p",
          `Top ${Math.min(8, sorted.length)} of ${sorted.length} groups · ${weighted ? "file pairs" : "neighbor modules"} · ${incoming ? "imported by" : "imports"}`,
        ),
      )
      const list = el("ol")
      for (const entry of sorted.slice(0, 8)) {
        const item = el("li")
        const select = button("", () => options.onGroup(entry.path), rankingEvents.signal)
        select.setAttribute("title", label(entry.path))
        select.setAttribute(
          "aria-label",
          `${label(entry.path)}: ${entry.count} ${incoming ? "incoming" : "outgoing"} ${weighted ? "file pairs" : "neighbor modules"}`,
        )
        const path = el("span", label(entry.path))
        path.setAttribute("class", "rank-path")
        const count = el("span", String(entry.count))
        count.setAttribute("class", "rank-value")
        const track = el("span")
        track.setAttribute("class", "rank-track")
        track.setAttribute("aria-hidden", "true")
        const bar = el("span")
        bar.setAttribute("class", "rank-bar")
        bar.setAttribute("style", `width:${(entry.count / max) * 100}%`)
        track.append(bar)
        select.append(path, count, track)
        item.append(select)
        list.append(item)
      }
      column.append(list)
      rankings.append(column)
    }
  }
  const neighborButton = button("Neighbor modules", () => {
    weighted = false
    drawRankings()
  })
  const pairButton = button("File pairs", () => {
    weighted = true
    drawRankings()
  })
  controls.append(neighborButton, pairButton)
  drawRankings()
  root.append(controls, rankings, el("h3", "Dependency evidence"))
  const table = el("table")
  table.setAttribute("class", "module-table")
  table.append(
    el(
      "caption",
      "Importer → dependency. Select Inspect for the same recorded evidence used by the matrix and diagram.",
    ),
  )
  const head = el("thead"),
    header = el("tr"),
    body = el("tbody")
  let sort: "from" | "to" | "imports" = "imports"
  let descending = true
  let offset = 0
  let selected = ""
  const headers = new Map<string, HTMLTableCellElement>()
  const PAGE_SIZE = 25
  const pager = el("div")
  pager.setAttribute("class", "module-pager")
  const range = el("span")
  range.setAttribute("aria-live", "polite")
  const previous = button("Previous pairs", () => {
    offset = Math.max(0, offset - PAGE_SIZE)
    drawTable()
  })
  const next = button("Next pairs", () => {
    offset += PAGE_SIZE
    drawTable()
  })
  const drawTable = () => {
    tableEvents.abort()
    tableEvents = new AbortController()
    body.replaceChildren()
    for (const [key, th] of headers)
      th.setAttribute("aria-sort", key === sort ? (descending ? "descending" : "ascending") : "none")
    const sorted = [...modules.dependencies].sort((a, b) => {
      const primary = sort === "imports" ? a.imports - b.imports : compare(a[sort], b[sort])
      return (descending ? -primary : primary) || compare(a.from, b.from) || compare(a.to, b.to)
    })
    const rows: Array<{ element: HTMLTableRowElement; key: string }> = []
    for (const pair of sorted.slice(offset, offset + PAGE_SIZE)) {
      const row = el("tr")
      const key = JSON.stringify([pair.from, pair.to])
      rows.push({ element: row, key })
      row.setAttribute("data-selected", String(selected === key))
      row.append(el("td", label(pair.from)), el("td", label(pair.to)), el("td", String(pair.imports)))
      const cell = el("td")
      const inspect = button(
        "Inspect",
        () => {
          selected = key
          for (const entry of rows) entry.element.setAttribute("data-selected", String(entry.key === selected))
          options.onImports([pair])
        },
        tableEvents.signal,
      )
      inspect.setAttribute("aria-label", `Inspect ${label(pair.from)} → ${label(pair.to)}`)
      cell.append(inspect)
      row.append(cell)
      body.append(row)
    }
    range.textContent = `${sorted.length ? offset + 1 : 0}–${Math.min(offset + PAGE_SIZE, sorted.length)} of ${sorted.length} retained module pairs`
    previous.disabled = offset === 0
    next.disabled = offset + PAGE_SIZE >= sorted.length
  }
  for (const [key, title] of [
    ["from", "Importer"],
    ["to", "Dependency"],
    ["imports", "File pairs"],
  ] as const) {
    const th = el("th")
    th.setAttribute("scope", "col")
    headers.set(key, th)
    th.append(
      button(title, () => {
        descending = sort === key ? !descending : key === "imports"
        sort = key
        offset = 0
        drawTable()
      }),
    )
    header.append(th)
  }
  const action = el("th", "Evidence")
  action.setAttribute("scope", "col")
  header.append(action)
  head.append(header)
  table.append(head, body)
  pager.append(previous, range, next)
  drawTable()
  root.append(table, pager)
  return root
}
