import { expect, test } from "vitest"
import { analyzeModules } from "../src/modules-view.js"
import { moduleDiagram } from "../src/module-diagram.js"

const modules = {
  rule: "fixture",
  groups: ["app", "a", "b", "lib", "alone"].map((path) => ({ path, files: 1 })),
  dependencies: [
    { from: "app", to: "a", imports: 3 },
    { from: "app", to: "b", imports: 2 },
    { from: "a", to: "b", imports: 4 },
    { from: "b", to: "a", imports: 1 },
    { from: "b", to: "lib", imports: 2 },
  ],
}

test("module diagram condenses cycles without losing counts or inventing dependencies", () => {
  const analysis = analyzeModules(modules)
  const data = moduleDiagram(modules, analysis)
  const cycle = data.blocks.find((b) => b.cycle)!
  expect(cycle.members).toEqual(["a", "b"])
  const incoming = data.connections.find((e) => e.from === "app")!
  expect(incoming.imports).toBe(5)
  expect(incoming.pairs).toHaveLength(2)
  expect(data.connections.find((e) => e.from === "a" && e.to === "a")?.imports).toBe(5)
  expect(data.connections.reduce((sum, e) => sum + e.imports, 0)).toBe(12)
  const byId = new Map(data.blocks.map((block) => [block.id, block]))
  for (const edge of data.connections)
    if (edge.from !== edge.to) expect(byId.get(edge.from)!.x).toBeLessThan(byId.get(edge.to)!.x)
  const expanded = moduleDiagram(modules, analysis, new Set([cycle.id]))
  expect(expanded.blocks.find((b) => b.id === cycle.id)!.height).toBeGreaterThan(cycle.height)
  expect(expanded.connections).toEqual(data.connections)
  expect(data).toEqual(moduleDiagram({ ...modules, groups: [...modules.groups].reverse() }, analysis))
})

test("filtered groups and empty diagrams retain only recorded visible endpoints", () => {
  const analysis = analyzeModules(modules)
  const visible = moduleDiagram(modules, { ...analysis, order: ["app", "lib"] })
  expect(visible.connections).toEqual([])
  expect(visible.blocks.map((b) => b.id)).toEqual(["app", "lib"])
  expect(
    moduleDiagram(
      { rule: "", groups: [], dependencies: [] },
      analyzeModules({ rule: "", groups: [], dependencies: [] }),
    ).blocks,
  ).toEqual([])
})
