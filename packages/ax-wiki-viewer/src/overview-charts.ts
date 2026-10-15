import type { WikiGraphArea, WikiGraphPage } from "@ax-code/ax-wiki/graph"

export type BlindSpot = { path: string; indexed: number; cited: number; uncited: number }

/** Share of a directory's uncited files one child must hold for the child to be named instead. */
const CHILD_SHARE = 0.5

/**
 * Directories with the most indexed files no page cites, most specific first: when one child
 * directory holds most of a directory's uncited files, the child is listed instead of the
 * parent. Entries never nest. The repository root is never listed; fully cited directories
 * never appear.
 */
export function blindSpots(areas: readonly WikiGraphArea[], limit = 10): BlindSpot[] {
  const byPath = new Map(areas.map((area) => [area.path, area]))
  const children = new Map<string, WikiGraphArea[]>()
  for (const area of areas) {
    if (area.path === "") continue
    const cut = area.path.lastIndexOf("/")
    const parent = cut < 0 ? "" : area.path.slice(0, cut)
    if (!byPath.has(parent)) continue
    children.set(parent, [...(children.get(parent) ?? []), area])
  }
  const uncited = (area: WikiGraphArea) => area.indexed - area.cited
  const dominated = (area: WikiGraphArea) =>
    (children.get(area.path) ?? []).some((child) => uncited(child) >= uncited(area) * CHILD_SHARE)
  const ranked = areas
    .filter((area) => area.path !== "" && uncited(area) > 0 && !dominated(area))
    .map((area) => ({ path: area.path, indexed: area.indexed, cited: area.cited, uncited: uncited(area) }))
    .sort((a, b) => b.uncited - a.uncited || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  // Entries never nest, so no uncited file is counted twice.
  const nested = (a: string, b: string) => a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
  const chosen: BlindSpot[] = []
  for (const spot of ranked) {
    if (chosen.length >= Math.max(0, limit)) break
    if (!chosen.some((other) => nested(spot.path, other.path))) chosen.push(spot)
  }
  return chosen
}

export type PageOverlap = {
  pages: Array<{ id: string; title: string; files: number }>
  /** shared[row][column]: cited files both pages record; the diagonal is the page's own count. */
  shared: number[][]
  max: number
}

/** Page x page counts of shared cited files over every recorded citation, in the given page order. */
export function pageOverlap(pages: readonly WikiGraphPage[], limit = 40): PageOverlap {
  const kept = pages.slice(0, Math.max(0, limit))
  const sets = kept.map((page) => new Set(page.sources))
  const shared = kept.map((_, row) =>
    kept.map((__, column) => {
      if (row === column) return sets[row].size
      let count = 0
      const [small, large] = sets[row].size <= sets[column].size ? [sets[row], sets[column]] : [sets[column], sets[row]]
      for (const file of small) if (large.has(file)) count++
      return count
    }),
  )
  let max = 0
  for (let row = 0; row < kept.length; row++)
    for (let column = 0; column < kept.length; column++) if (row !== column) max = Math.max(max, shared[row][column])
  return {
    pages: kept.map((page, index) => ({ id: page.id, title: page.title, files: sets[index].size })),
    shared,
    max,
  }
}

/** The cited files two pages share, sorted. */
export function sharedFiles(a: WikiGraphPage, b: WikiGraphPage): string[] {
  const other = new Set(b.sources)
  return [...new Set(a.sources.filter((file) => other.has(file)))].sort()
}

export const overviewChartsCss = `
.axw .spots{list-style:none;margin:0;padding:0}
.axw .spots li{display:grid;grid-template-columns:minmax(0,1fr) 110px 64px;gap:8px;align-items:center;padding:3px 0}
.axw .spots button{background:none;border:0;padding:0;text-align:left;color:#c9d6e4;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere;cursor:pointer}
.axw .spots button:hover{color:var(--accent);background:none}
.axw .spots .bar span.cited{background:var(--accent)}
.axw .spots .bar span.uncited{background:#4a5c70}
.axw .spots .count{font-size:12px;color:var(--muted);text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.axw .overlap .scroll{overflow:auto;max-width:100%}
.axw .overlap svg{display:block}
.axw .overlap text{font-size:11px;fill:#c9d6e4}
.axw .overlap text.col{fill:var(--muted);text-anchor:middle}
.axw .overlap text.num{font-size:10px;text-anchor:middle;dominant-baseline:central;pointer-events:none}
.axw .overlap rect.cell{stroke:var(--line);stroke-width:1px;shape-rendering:crispEdges}
.axw .overlap rect.cell.hit{cursor:pointer}
.axw .overlap rect.cell.hit:hover,.axw .overlap rect.cell.hit:focus{stroke:var(--accent);stroke-width:2px;outline:none}
.axw .overlap g.row{cursor:pointer}
.axw .overlap g.row:hover text,.axw .overlap g.row:focus text{fill:var(--accent)}
.axw .overlap g.row:focus{outline:none}
`

const SVG = "http://www.w3.org/2000/svg"

/** Ranked blind-spot bars. `onSelect` receives a directory path. */
export function renderBlindSpots(
  doc: Document,
  host: HTMLElement,
  spots: readonly BlindSpot[],
  onSelect: (path: string) => void,
): void {
  if (!spots.length) {
    const note = doc.createElement("p")
    note.className = "note"
    note.textContent = "Every indexed directory has at least one cited file in its subtree."
    host.append(note)
    return
  }
  const list = doc.createElement("ul")
  list.className = "spots"
  for (const spot of spots) {
    const item = doc.createElement("li")
    const button = doc.createElement("button")
    button.textContent = spot.path
    button.title = `${spot.path}: ${spot.uncited} of ${spot.indexed} indexed files are not cited by any page`
    button.onclick = () => onSelect(spot.path)
    const bar = doc.createElement("div")
    bar.className = "bar"
    bar.setAttribute("aria-hidden", "true")
    for (const [value, name] of [
      [spot.cited, "cited"],
      [spot.uncited, "uncited"],
    ] as const) {
      if (!value) continue
      const part = doc.createElement("span")
      part.className = name
      // Each bar is its own directory: the ranking carries magnitude, the bar the cited share.
      part.style.width = `${(value / spot.indexed) * 100}%`
      bar.append(part)
    }
    const count = doc.createElement("span")
    count.className = "count"
    count.textContent = `${spot.uncited} / ${spot.indexed}`
    item.append(button, bar, count)
    list.append(item)
  }
  host.append(list)
}

/** Page overlap matrix. Rows open pages; off-diagonal cells list the shared files. */
export function renderPageOverlap(
  doc: Document,
  host: HTMLElement,
  overlap: PageOverlap,
  handlers: { onPage(id: string): void; onPair(a: string, b: string): void },
): void {
  const n = overlap.pages.length
  if (n < 2) {
    const note = doc.createElement("p")
    note.className = "note"
    note.textContent = "Overlap needs at least two pages."
    host.append(note)
    return
  }
  const cell = Math.max(16, Math.min(28, Math.floor(560 / n)))
  const labelW = 230
  const headH = 22
  const width = labelW + n * cell + 4
  const height = headH + n * cell + 4
  const svg = doc.createElementNS(SVG, "svg")
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`)
  svg.setAttribute("width", String(width))
  svg.setAttribute("height", String(height))
  svg.setAttribute("role", "group")
  svg.setAttribute("aria-label", "Cited files shared between pages")
  const node = <K extends string>(tag: K, attrs: Record<string, string | number>) => {
    const element = doc.createElementNS(SVG, tag)
    for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, String(value))
    return element
  }
  const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)
  overlap.pages.forEach((page, column) => {
    const label = node("text", { class: "col", x: labelW + column * cell + cell / 2, y: headH - 7 })
    label.textContent = String(column + 1)
    const tip = doc.createElementNS(SVG, "title")
    tip.textContent = page.title
    label.append(tip)
    svg.append(label)
  })
  overlap.pages.forEach((page, row) => {
    const y = headH + row * cell
    const group = node("g", { class: "row", tabindex: 0, role: "button", "aria-label": `Read ${page.title}` })
    const label = node("text", { x: labelW - 8, y: y + cell / 2, "text-anchor": "end", "dominant-baseline": "central" })
    label.textContent = `${truncate(page.title, 30)}  ${row + 1}`
    group.append(node("rect", { x: 0, y, width: labelW - 2, height: cell, fill: "transparent" }), label)
    group.addEventListener("click", () => handlers.onPage(page.id))
    group.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key !== "Enter" && (event as KeyboardEvent).key !== " ") return
      event.preventDefault()
      handlers.onPage(page.id)
    })
    svg.append(group)
    for (let column = 0; column < n; column++) {
      const value = overlap.shared[row][column]
      const diagonal = row === column
      const x = labelW + column * cell
      const opacity = diagonal || !value || !overlap.max ? 0 : 0.15 + 0.85 * Math.sqrt(value / overlap.max)
      const rect = node("rect", {
        class: value && !diagonal ? "cell hit" : "cell",
        x,
        y,
        width: cell,
        height: cell,
        fill: diagonal ? "#1b2c3f" : "#78dacc",
        "fill-opacity": diagonal ? 1 : opacity,
      })
      const other = overlap.pages[column]
      const tip = doc.createElementNS(SVG, "title")
      tip.textContent = diagonal
        ? `${page.title}: ${value} cited files`
        : `${page.title} and ${other.title} share ${value} cited file${value === 1 ? "" : "s"}`
      rect.append(tip)
      if (value && !diagonal) {
        rect.setAttribute("tabindex", "0")
        rect.setAttribute("role", "button")
        rect.setAttribute("aria-label", tip.textContent)
        const open = () => handlers.onPair(page.id, other.id)
        rect.addEventListener("click", open)
        rect.addEventListener("keydown", (event) => {
          if ((event as KeyboardEvent).key !== "Enter" && (event as KeyboardEvent).key !== " ") return
          event.preventDefault()
          open()
        })
      }
      svg.append(rect)
      if (value && cell >= 18) {
        const number = node("text", { class: "num", x: x + cell / 2, y: y + cell / 2 })
        number.textContent = String(value)
        if (diagonal) number.setAttribute("fill", "#93a6ba")
        else if (opacity > 0.6) number.setAttribute("fill", "#0d1520")
        svg.append(number)
      }
    }
  })
  const scroll = doc.createElement("div")
  scroll.className = "scroll"
  scroll.append(svg)
  host.append(scroll)
}
