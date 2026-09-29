import { expect, test } from "vitest"
import { projectWikiManifest } from "@ax-code/ax-wiki/graph"
import { LAYOUT_LANES, LAYOUT_WORLD, createForceLayout, layoutRadius } from "../src/force-layout.js"

const graph = projectWikiManifest(
  {
    schemaVersion: 1,
    generator: "ax-wiki",
    pages: {
      "guide.md": { title: "Guide", sources: ["src/a.ts", "src/b.ts"], sourceHashes: {} },
      "other.md": { title: "Other", sources: ["src/b.ts"], sourceHashes: {} },
    },
  },
  { snapshot: "layout-fixture" },
)

test("sizes nodes from visible degree with clamped radii", () => {
  expect(layoutRadius(0)).toBe(6)
  expect(layoutRadius(1)).toBe(9)
  expect(layoutRadius(4)).toBe(12)
  expect(layoutRadius(100)).toBe(18)
  expect(layoutRadius(-3)).toBe(6)
})

test("seeds pages and sources into separate lanes", () => {
  const layout = createForceLayout(graph, { reducedMotion: true })
  try {
    for (const node of layout.nodes) {
      expect(node.degree).toBeGreaterThan(0)
      expect(Number.isFinite(node.x) && Number.isFinite(node.y)).toBe(true)
    }
    const pages = layout.nodes.filter((node) => node.kind === "page")
    const sources = layout.nodes.filter((node) => node.kind === "source")
    expect(pages.length).toBe(2)
    expect(sources.length).toBe(2)
    // Lanes hold after settling: every page stays left of every source.
    expect(Math.max(...pages.map((node) => node.x))).toBeLessThan(Math.min(...sources.map((node) => node.x)))
    expect(Math.max(...pages.map((node) => node.x))).toBeLessThan(LAYOUT_WORLD.width / 2)
    expect(Math.min(...sources.map((node) => node.x))).toBeGreaterThan(LAYOUT_WORLD.width / 2)
    expect(LAYOUT_LANES.page).toBeLessThan(LAYOUT_LANES.source)
  } finally {
    layout.stop()
  }
})

test("seeds symbols into the center lane between pages and sources", () => {
  const symbols = projectWikiManifest(
    {
      schemaVersion: 1,
      generator: "ax-wiki",
      pages: {
        "guide.md": { title: "Guide", sources: ["src/a.ts"], sourceHashes: {} },
      },
    },
    {
      snapshot: "symbol-lanes",
      inventory: new Map([
        [
          "src/a.ts",
          [
            { name: "Foo", qualified: "Foo", kind: "class" },
            { name: "bar", qualified: "Foo.bar", kind: "method" },
          ],
        ],
      ]),
    },
  )
  const layout = createForceLayout(symbols, { reducedMotion: true })
  try {
    const page = layout.byId.get("page:guide.md")!
    const source = layout.byId.get("source:src/a.ts")!
    const syms = layout.nodes.filter((node) => node.kind === "symbol")
    expect(syms.length).toBe(2)
    for (const node of layout.nodes) {
      expect(Number.isFinite(node.x) && Number.isFinite(node.y)).toBe(true)
    }
    expect(LAYOUT_LANES.page).toBeLessThan(LAYOUT_LANES.symbol)
    expect(LAYOUT_LANES.symbol).toBeLessThan(LAYOUT_LANES.source)
    expect(page.x).toBeLessThan(Math.min(...syms.map((node) => node.x)))
    expect(Math.max(...syms.map((node) => node.x))).toBeLessThan(source.x)
  } finally {
    layout.stop()
  }
})

test("counts degree from snapshot edges and resolves link endpoints", () => {
  const layout = createForceLayout(graph, { reducedMotion: true })
  try {
    expect(layout.links.length).toBe(3)
    const hub = layout.byId.get("source:src/b.ts")!
    expect(hub.degree).toBe(2)
    expect(hub.radius).toBeGreaterThan(layout.byId.get("source:src/a.ts")!.radius)
    for (const link of layout.links) {
      expect(layout.byId.has(link.from) && layout.byId.has(link.to)).toBe(true)
      expect(link.from).not.toBe(link.to)
    }
  } finally {
    layout.stop()
  }
})

test("settles animated layouts without running forever", async () => {
  let ticks = 0
  const done = new Promise<void>((resolve) => {
    const layout = createForceLayout(graph, {
      reducedMotion: false,
      onTick: () => ticks++,
      onEnd: () => {
        layout.stop()
        resolve()
      },
    })
  })
  await done
  expect(ticks).toBeGreaterThan(0)
  expect(ticks).toBeLessThanOrEqual(300)
})

test("reheat restarts a settled simulation and moves neighbors", async () => {
  let ends = 0
  let resolveSecond!: () => void
  const secondEnd = new Promise<void>((resolve) => (resolveSecond = resolve))
  const layout = createForceLayout(graph, {
    reducedMotion: false,
    onEnd: () => {
      ends++
      if (ends === 2) resolveSecond()
    },
  })
  try {
    while (ends < 1) await new Promise((resolve) => setTimeout(resolve, 100))
    const hub = layout.byId.get("page:guide.md")!
    const neighbor = layout.byId.get("source:src/a.ts")!
    const before = [neighbor.x, neighbor.y]
    hub.fx = hub.x + 100
    hub.fy = hub.y
    layout.reheat(0.3)
    await Promise.race([
      secondEnd,
      new Promise((_, reject) => setTimeout(() => reject(new Error("reheat never settled")), 30000)),
    ])
    expect(ends).toBe(2)
    expect(Math.hypot(hub.x - (hub.fx as number), hub.y - (hub.fy as number))).toBe(0)
    expect(Math.hypot(neighbor.x - before[0], neighbor.y - before[1])).toBeGreaterThan(0.5)
  } finally {
    layout.stop()
  }
}, 60000)
