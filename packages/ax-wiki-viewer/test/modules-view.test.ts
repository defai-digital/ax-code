import { expect, test } from "vitest"
import type { WikiGraph, WikiGraphModules, WikiGraphPage } from "@ax-code/ax-wiki/graph"
import {
  analyzeModules,
  groupOfFile,
  modulesCss,
  pageModuleMatrix,
  renderModulesView,
  stronglyConnected,
} from "../src/modules-view.js"

function modules(
  groups: string[],
  dependencies: Array<[string, string, number]> = [],
  files: Record<string, number> = {},
): WikiGraphModules {
  return {
    rule: "Cited files grouped by directory",
    groups: groups.map((path) => ({ path, files: files[path] ?? 1 })),
    dependencies: dependencies.map(([from, to, imports]) => ({ from, to, imports })),
  }
}

function page(id: string, title: string, sources: string[]): WikiGraphPage {
  return {
    id,
    path: `${id}.md`,
    title,
    purpose: "",
    summary: "",
    generatedAt: "",
    sources,
    stale: 0,
    unknown: 0,
    related: [],
    markdown: "",
    truncated: false,
  } as unknown as WikiGraphPage
}

function sortedComponents(nodes: string[], edges: Array<[string, string]>): string[][] {
  return stronglyConnected(nodes, edges)
    .map((component) => [...component].sort())
    .sort((a, b) => {
      const length = Math.min(a.length, b.length)
      for (let index = 0; index < length; index++) {
        if (a[index] < b[index]) return -1
        if (a[index] > b[index]) return 1
      }
      return a.length - b.length
    })
}

test("finds a 3-cycle and a self-contained 2-cycle", () => {
  const edges: Array<[string, string]> = [
    ["a", "b"],
    ["b", "c"],
    ["c", "a"],
    ["d", "e"],
    ["e", "d"],
    ["p", "a"],
    ["a", "f"],
  ]
  expect(sortedComponents(["p", "f", "e", "d", "c", "b", "a"], edges)).toEqual([
    ["a", "b", "c"],
    ["d", "e"],
    ["f"],
    ["p"],
  ])

  const analyzed = analyzeModules(
    modules(
      ["p", "f", "e", "d", "c", "b", "a"],
      [
        ["a", "b", 2],
        ["b", "c", 3],
        ["c", "a", 4],
        ["d", "e", 5],
        ["e", "d", 6],
        ["p", "a", 8],
        ["a", "f", 7],
      ],
    ),
  )
  // External edges do not pull p or f into either cycle. Each cycle is sorted, and the list is sorted.
  expect(analyzed.cycles).toEqual([
    ["a", "b", "c"],
    ["d", "e"],
  ])
  expect(analyzed.levels.get("f")).toBe(0)
  expect(analyzed.levels.get("d")).toBe(0)
  expect(analyzed.levels.get("e")).toBe(0)
  expect(analyzed.levels.get("a")).toBe(1)
  expect(analyzed.levels.get("b")).toBe(1)
  expect(analyzed.levels.get("c")).toBe(1)
  expect(analyzed.levels.get("p")).toBe(2)
  // Level 0 is the provider f and the closed 2-cycle. The 3-cycle depends on f. p depends on that cycle.
  expect(analyzed.order).toEqual(["d", "e", "f", "a", "b", "c", "p"])
  expect(analyzed.outbound.get("a")).toBe(9)
  expect(analyzed.inbound.get("a")).toBe(12)
  expect(analyzed.inbound.get("f")).toBe(7)
  expect(analyzed.outbound.get("f")).toBe(0)
  expect(analyzed.outbound.get("p")).toBe(8)
  expect(analyzed.inbound.get("p")).toBe(0)
})

test("levelized order puts providers before consumers and breaks ties by path", () => {
  const input = modules(
    ["app", "util", "core", "lib"],
    [
      ["app", "core", 4],
      ["core", "lib", 2],
      ["app", "lib", 1],
    ],
  )
  const original = input.groups.map((group) => group.path)
  const analyzed = analyzeModules(input)
  expect(input.groups.map((group) => group.path)).toEqual(original)
  expect(analyzed.cycles).toEqual([])
  expect(analyzed.levels.get("lib")).toBe(0)
  expect(analyzed.levels.get("util")).toBe(0)
  expect(analyzed.levels.get("core")).toBe(1)
  expect(analyzed.levels.get("app")).toBe(2)
  expect(analyzed.order).toEqual(["lib", "util", "core", "app"])
  expect(analyzed.inbound.get("lib")).toBe(3)
  expect(analyzed.outbound.get("lib")).toBe(0)
  expect(analyzed.inbound.get("core")).toBe(4)
  expect(analyzed.outbound.get("core")).toBe(2)
  expect(analyzed.outbound.get("app")).toBe(5)
  expect(analyzed.inbound.get("app")).toBe(0)
  expect(analyzed.inbound.get("util")).toBe(0)
  expect(analyzed.outbound.get("util")).toBe(0)

  // Alphabetical order would put the consumer first. Level wins.
  const reversed = analyzeModules(modules(["a", "m"], [["a", "m", 2]]))
  expect(reversed.order).toEqual(["m", "a"])
  expect(reversed.levels.get("m")).toBe(0)
  expect(reversed.levels.get("a")).toBe(1)

  // A provider sorts ahead of a cycle even when its path sorts later. Cycle members stay adjacent.
  const cycle = analyzeModules(
    modules(
      ["a", "b", "z"],
      [
        ["a", "b", 1],
        ["b", "a", 1],
        ["a", "z", 1],
      ],
    ),
  )
  expect(cycle.cycles).toEqual([["a", "b"]])
  expect(cycle.order).toEqual(["z", "a", "b"])
  expect(cycle.levels.get("z")).toBe(0)
  expect(cycle.levels.get("a")).toBe(1)
  expect(cycle.levels.get("b")).toBe(1)
})

test("a self-loop stays a single group and does not invent a cycle", () => {
  const analyzed = analyzeModules(modules(["a", "b"], [["a", "a", 3]]))
  expect(analyzed.cycles).toEqual([])
  expect(analyzed.order).toEqual(["a", "b"])
  expect(analyzed.levels.get("a")).toBe(0)
  expect(analyzed.inbound.get("a")).toBe(3)
  expect(analyzed.outbound.get("a")).toBe(3)
  expect(sortedComponents(["a"], [["a", "a"]])).toEqual([["a"]])
})

test("iterative Tarjan on a 2000-node chain does not overflow", () => {
  const nodes = Array.from({ length: 2000 }, (_, index) => `n${index}`)
  const edges: Array<[string, string]> = []
  for (let index = 0; index < nodes.length - 1; index++) edges.push([nodes[index], nodes[index + 1]])
  const components = stronglyConnected(nodes, edges)
  expect(components).toHaveLength(2000)
  expect(components.every((component) => component.length === 1)).toBe(true)
  expect(new Set(components.map((component) => component[0])).size).toBe(2000)
})

test("iterative Tarjan keeps a 2000-node cycle in one component", () => {
  const nodes = Array.from({ length: 2000 }, (_, index) => `c${index}`)
  const edges = nodes.map((node, index): [string, string] => [node, nodes[(index + 1) % nodes.length]])
  const components = stronglyConnected(nodes, edges)
  expect(components).toHaveLength(1)
  expect(new Set(components[0]).size).toBe(2000)
})

test("groupOfFile uses the longest directory prefix and falls back to root", () => {
  const groups = [{ path: "" }, { path: "packages" }, { path: "packages/ax-wiki" }, { path: "src" }]
  expect(groupOfFile(groups, "packages/ax-wiki/src/graph.ts")).toBe("packages/ax-wiki")
  expect(groupOfFile(groups, "packages/ax-wiki-viewer/src/index.ts")).toBe("packages")
  expect(groupOfFile(groups, "packages/ax-wiki")).toBe("packages/ax-wiki")
  expect(groupOfFile(groups, "src/view.ts")).toBe("src")
  expect(groupOfFile(groups, "src2/view.ts")).toBe("")
  expect(groupOfFile(groups, "README.md")).toBe("")
  expect(groupOfFile(groups, "docs/guide.md")).toBe("")
  expect(groupOfFile([{ path: "" }], "src/a.ts")).toBe("")
  expect(groupOfFile([{ path: "src" }], "lib/a.ts")).toBeUndefined()
  expect(groupOfFile([{ path: "src" }], "README.md")).toBeUndefined()
  expect(groupOfFile([{ path: "src" }, { path: "src/extra" }], "src/extra/a.ts")).toBe("src/extra")
})

test("pageModuleMatrix counts cited files in levelized column order", () => {
  const mods = modules(["app", "lib", ""], [["app", "lib", 1]], { app: 2, lib: 4, "": 1 })
  const matrix = pageModuleMatrix(
    [
      page("p1", "One", ["lib/a.ts", "lib/a.ts", "lib/b.ts", "app/main.ts", "README.md", "other/z.ts"]),
      page("p2", "Two", ["app/x.ts"]),
      page("p3", "Three", []),
    ],
    mods,
  )
  // "" and lib depend on nothing; "" sorts before lib. app consumes lib.
  expect(matrix.columns).toEqual(["", "lib", "app"])
  expect(matrix.rows).toEqual([
    { id: "p1", title: "One", counts: [2, 3, 1] },
    { id: "p2", title: "Two", counts: [0, 0, 1] },
    { id: "p3", title: "Three", counts: [0, 0, 0] },
  ])
})

test("modulesCss is scoped and stays still under reduced motion", () => {
  expect(modulesCss).toContain(".axwv .modules")
  expect(modulesCss).toContain("prefers-reduced-motion")
  expect(modulesCss).toContain("--amber")
  expect(modulesCss).toContain("--accent")
})

type Listener = (event: { key?: string; preventDefault(): void }) => void

class FakeNode {
  textContent: string | null = null
  attrs = new Map<string, string>()
  children: FakeNode[] = []
  parent: FakeNode | null = null
  listeners = new Map<string, Listener[]>()
  innerHTMLWrites = 0
  constructor(readonly tag: string) {}
  set innerHTML(_value: string) {
    this.innerHTMLWrites += 1
    throw new Error("innerHTML")
  }
  setAttribute(name: string, value: string) {
    this.attrs.set(name, String(value))
  }
  append(...nodes: FakeNode[]) {
    for (const node of nodes) {
      node.parent = this
      this.children.push(node)
    }
  }
  replaceChildren(...nodes: FakeNode[]) {
    for (const child of this.children) child.parent = null
    this.children = []
    this.append(...nodes)
  }
  remove() {
    if (!this.parent) return
    this.parent.children = this.parent.children.filter((child) => child !== this)
    this.parent = null
  }
  addEventListener(type: string, fn: Listener, options?: { signal?: AbortSignal }) {
    if (options?.signal?.aborted) return
    const list = this.listeners.get(type) ?? []
    list.push(fn)
    this.listeners.set(type, list)
    options?.signal?.addEventListener("abort", () => {
      const current = this.listeners.get(type) ?? []
      this.listeners.set(
        type,
        current.filter((item) => item !== fn),
      )
    })
  }
}

function walk(node: FakeNode, out: FakeNode[] = []): FakeNode[] {
  out.push(node)
  for (const child of node.children) walk(child, out)
  return out
}

function textOf(node: FakeNode): string {
  let out = node.textContent ?? ""
  for (const child of node.children) out += textOf(child)
  return out
}

function fakeDocument(): Document {
  const create = (tag: string) => new FakeNode(tag)
  return { createElement: create, createElementNS: (_ns: string, tag: string) => create(tag) } as unknown as Document
}

function classes(node: FakeNode): string[] {
  return (node.attrs.get("class") ?? "").split(/\s+/).filter(Boolean)
}

function fire(node: FakeNode, type: string, event: { key?: string; preventDefault(): void }) {
  for (const listener of [...(node.listeners.get(type) ?? [])]) listener(event)
}

test("renders the matrix, cycles, heatmap, and safe text", () => {
  const poison = `"><img src=x onerror=alert(1)>`
  const selected: Array<{ path: string; files: string[] }> = []
  const pagesSelected: string[] = []
  const container = new FakeNode("div")
  const graph = {
    modules: {
      rule: poison,
      groups: [
        { path: "", files: 1 },
        { path: "a", files: 3 },
        { path: "b", files: 5 },
      ],
      dependencies: [
        { from: "a", to: "b", imports: 1 },
        { from: "b", to: "a", imports: 4 },
      ],
    },
    pages: [page("p1", "Alpha", ["a/one.ts", "a/one.ts", "b/two.ts", "README.md"]), page("p2", poison, ["b/x.ts"])],
  } as unknown as WikiGraph
  const dispose = renderModulesView(fakeDocument(), container as unknown as HTMLElement, graph, {
    onSelectGroup: (path, files) => selected.push({ path, files }),
    onSelectPage: (id) => pagesSelected.push(id),
  })

  const text = textOf(container)
  expect(text).toContain("Module dependencies")
  expect(text).toContain(poison)
  expect(text).toContain("Cells count recorded static imports between cited files. Row imports column.")
  expect(text).toContain("1 cycle")
  expect(text).toContain("a, b")
  expect(text).toContain("(root)")
  expect(text).toContain("Pages x modules")
  expect(text).toContain("Which areas each page cites. Empty columns are areas no page cites.")
  expect(text).not.toContain("No recorded imports")
  expect(text).not.toContain("This snapshot has no module projection")

  const nodes = walk(container)
  for (const node of nodes) {
    expect(node.innerHTMLWrites).toBe(0)
    for (const [name, value] of node.attrs) {
      expect(value.includes("<"), `${node.tag} ${name}`).toBe(false)
      expect(value.includes("onerror"), `${node.tag} ${name}`).toBe(false)
    }
  }
  const buttons = nodes.filter((node) => node.attrs.get("role") === "button")
  expect(buttons.every((button) => button.tag === "g" && button.attrs.get("tabindex") === "0")).toBe(true)
  const titles = nodes.filter((node) => node.tag === "title").map((node) => node.textContent)
  expect(titles).toContain("a imports b: 1")
  expect(titles).toContain("b imports a: 4")
  const cycleCells = nodes.filter((node) => node.tag === "rect" && classes(node).includes("cycle"))
  expect(cycleCells).toHaveLength(1)
  expect(cycleCells[0].attrs.get("fill-opacity")).toBe("0.5")
  const heavy = nodes.filter((node) => node.tag === "rect" && node.attrs.get("fill-opacity") === "1")
  expect(heavy.length).toBeGreaterThan(0)
  expect(nodes.filter((node) => classes(node).includes("cycle-mark"))).toHaveLength(2)
  expect(
    nodes
      .filter((node) => classes(node).includes("diag-num"))
      .map((node) => node.textContent)
      .sort(),
  ).toEqual(["1", "3", "5"])
  expect(nodes.some((node) => node.attrs.get("class") === "scroll")).toBe(true)

  // Matrix rows end with their column number; heatmap rows are plain page titles.
  const labeled = (label: string) =>
    buttons.filter((button) => textOf(button) === label || textOf(button).startsWith(`${label}  `))
  fire(labeled("(root)")[0], "click", { preventDefault() {} })
  fire(labeled("a")[0], "keydown", { key: "Enter", preventDefault() {} })
  const space = {
    key: " ",
    prevented: false,
    preventDefault() {
      this.prevented = true
    },
  }
  fire(labeled("b")[0], "keydown", space)
  expect(space.prevented).toBe(true)
  const ignored = {
    key: "Escape",
    prevented: false,
    preventDefault() {
      this.prevented = true
    },
  }
  fire(labeled("a")[0], "keydown", ignored)
  expect(ignored.prevented).toBe(false)
  fire(labeled("Alpha")[0], "click", { preventDefault() {} })
  expect(selected).toEqual([
    { path: "", files: ["README.md"] },
    { path: "a", files: ["a/one.ts"] },
    { path: "b", files: ["b/two.ts", "b/x.ts"] },
  ])
  expect(pagesSelected).toEqual(["p1"])

  dispose()
  dispose()
  expect(textOf(container)).toBe("")
  fire(labeled("a")[0], "click", { preventDefault() {} })
  expect(selected).toHaveLength(3)
})

test("shows the empty states and the hidden-page note", () => {
  const container = new FakeNode("div")
  const doc = fakeDocument()
  renderModulesView(doc, container as unknown as HTMLElement, { pages: [] } as unknown as WikiGraph, {})
  expect(textOf(container)).toContain("This snapshot has no module projection")
  expect(textOf(container)).not.toContain("Pages x modules")

  const pages = Array.from({ length: 61 }, (_, index) => page(`p${index}`, `Page ${index}`, []))
  renderModulesView(
    doc,
    container as unknown as HTMLElement,
    { modules: modules(["lib", "app"], []), pages } as unknown as WikiGraph,
    {},
  )
  const text = textOf(container)
  expect(text).toContain("No recorded imports")
  expect(text).toContain("No cycles among recorded imports")
  expect(text).toContain("Cells count recorded static imports between cited files. Row imports column.")
  expect(text).toContain("Pages x modules")
  expect(text).toContain("+1 more pages")
  expect(text).toContain("Page 0")
  expect(text).toContain("Page 59")
  expect(text).not.toContain("Page 60")
})
