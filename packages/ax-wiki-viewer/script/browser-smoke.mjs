import assert from "node:assert/strict"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { chromium } from "playwright-core"
import { build } from "esbuild"
import { projectWikiManifest } from "@ax-code/ax-wiki/graph"
import { renderWikiGraphHtml } from "../dist/node.js"

const dir = await mkdtemp(path.join(tmpdir(), "wiki-viewer-browser-"))
const browser = await chromium.launch({
  executablePath: process.env.AX_WIKI_CHROMIUM || undefined,
  headless: true,
  // Keep timers and frames flowing so force-layout reheats behave like a visible browser.
  args: [
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
  ],
})
try {
  const graph = projectWikiManifest(
    {
      schemaVersion: 1,
      generator: "ax-wiki",
      pages: {
        "guide.md": {
          title: '</script><img src=x onerror="window.attacked=true">',
          summary: "Guide summary.",
          symbols: ["Foo", "Ghost"],
          sources: ["src/a.ts", "src/b.ts"],
          sourceHashes: {},
        },
        "architecture.md": {
          title: "Architecture",
          summary: "Architecture summary.",
          symbols: ["Widget"],
          sources: ["src/b.ts"],
          sourceHashes: {},
        },
      },
    },
    { snapshot: "browser-fixture", sourceContents: new Map([["src/a.ts", "export class Foo {}"]]) },
  )
  const output = path.join(dir, "wiki.html")
  await writeFile(output, renderWikiGraphHtml(graph).html)
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = [],
    requests = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url())
  })
  await page.route("http://**/*", (route) => route.abort())
  await page.route("https://**/*", (route) => route.abort())
  await page.goto(pathToFileURL(output).href)
  await page.getByRole("heading", { name: "AX Wiki evidence map" }).waitFor()
  assert.equal(await page.locator(".list button").count(), 4)
  assert.equal(await page.locator("svg g.node").count(), 4)
  assert.equal(await page.locator("svg path.edge").count(), 3)
  assert.equal(await page.locator("img").count(), 0)
  assert.equal(await page.evaluate(() => window.attacked), undefined)
  await page.getByRole("searchbox").fill("Architecture")
  assert.equal(await page.locator(".list button").count(), 1)
  assert.equal(await page.locator("svg g.node").count(), 4)
  await page.getByRole("searchbox").fill("")
  assert.match(await page.getByRole("status").innerText(), /4 of 4 nodes · 3 of 3 edges in view/)
  assert.equal(await page.locator(".overlay").isHidden(), true)
  assert.equal(await page.locator(".notice").isHidden(), true)
  await page.getByRole("button", { name: "pages (2)" }).click()
  assert.equal(await page.locator(".list button").count(), 2)
  assert.equal(await page.locator("svg g.node").count(), 4)
  assert.equal(await page.getByRole("button", { name: "pages (2)" }).getAttribute("aria-pressed"), "false")
  assert.match(await page.getByRole("status").innerText(), /2 of 4 nodes · 0 of 3 edges in view/)
  assert.equal(await page.locator(".notice").isHidden(), false)
  assert.match(await page.locator(".notice").innerText(), /no edges in view/)
  await page.getByRole("button", { name: "pages (2)" }).click()
  assert.equal(await page.getByRole("button", { name: "pages (2)" }).getAttribute("aria-pressed"), "true")
  assert.equal(await page.locator(".list button").count(), 4)
  await page.getByRole("button", { name: "Unknown (4)" }).click()
  assert.equal(await page.locator(".list button").count(), 0)
  assert.equal(await page.locator(".overlay").isHidden(), false)
  assert.match(await page.locator(".overlay").innerText(), /No nodes match the current filters/)
  assert.match(await page.getByRole("status").innerText(), /0 of 4 nodes · 0 of 3 edges in view/)
  await page.getByRole("button", { name: "Reset filters" }).click()
  assert.equal(await page.locator(".overlay").isHidden(), true)
  assert.equal(await page.locator(".list button").count(), 4)
  assert.equal(
    await page.evaluate(() =>
      [...document.querySelectorAll(".axwv *")].every((el) =>
        [...el.attributes].every((attr) => !attr.name.startsWith("on")),
      ),
    ),
    true,
  )
  await page.getByRole("searchbox").fill("s")
  assert.equal(await page.locator(".list button").count(), 2)
  assert.match(await page.getByRole("status").innerText(), /2 of 4 match/)
  await page.keyboard.press("Enter")
  assert.match(await page.locator(".Detail").innerText(), /Source: src\/b\.ts/)
  await page.evaluate(() => document.querySelector("svg").dispatchEvent(new MouseEvent("click", { bubbles: true })))
  assert.equal(await page.locator(".list button").count(), 2)
  await page.getByRole("searchbox").focus()
  await page.keyboard.press("Enter")
  assert.match(await page.locator(".Detail").innerText(), /Source: src\/a\.ts/)
  await page.getByRole("searchbox").fill("")
  assert.equal(await page.locator(".list button").count(), 4)
  await page.locator(".list button").first().focus()
  assert.equal(
    await page.evaluate(
      () => [...document.querySelectorAll("svg g.node")].filter((g) => g.getAttribute("opacity") === "0.15").length,
    ),
    2,
  )
  await page.getByRole("searchbox").focus()
  assert.equal(
    await page.evaluate(
      () => [...document.querySelectorAll("svg g.node")].filter((g) => g.getAttribute("opacity") === "0.15").length,
    ),
    0,
  )
  await page.getByRole("button", { name: "Show all / reset" }).click()
  await page.locator(".list button").filter({ hasText: "page: Architecture" }).focus()
  await page.keyboard.press("Enter")
  assert.match(await page.locator(".Detail").innerText(), /Cites 1 of 1 source in this snapshot/)
  assert.match(await page.locator(".Detail").innerText(), /Provenance: Wiki manifest membership/)
  assert.match(await page.locator(".Detail").innerText(), /Summary: Architecture summary\./)
  assert.match(await page.locator(".Detail").innerText(), /Widget \(unavailable\)/)
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Evidence")
  assert.equal(await page.locator(".list button").count(), 2)
  await page.keyboard.press("Escape")
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), "INPUT")
  assert.match(await page.locator(".legend").innerText(), /size = visible connections/)
  await page.getByRole("searchbox").fill("Arch")
  assert.equal(await page.locator(".notice").isHidden(), false)
  assert.match(await page.locator(".notice").innerText(), /single node/)
  await page.keyboard.press("Enter")
  assert.match(await page.locator(".detail").innerText(), /Page: Architecture/)
  assert.equal(await page.locator(".list button").count(), 1)
  await page.evaluate(() => document.querySelector("svg").dispatchEvent(new MouseEvent("click", { bubbles: true })))
  assert.match(await page.locator(".Detail").innerText(), /Select a page or source/)
  assert.equal(await page.locator(".list button").count(), 1)
  await page.getByRole("searchbox").fill("")
  assert.equal(await page.locator(".list button").count(), 4)
  assert.equal(await page.locator(".notice").isHidden(), true)
  await page.locator(".list button").nth(2).click()
  assert.match(await page.locator(".Detail").innerText(), /Summary: Guide summary\./)
  assert.match(await page.locator(".Detail").innerText(), /Foo \(verified\)/)
  assert.match(await page.locator(".Detail").innerText(), /Ghost \(inferred\)/)
  await page.evaluate(() => document.querySelector("svg").dispatchEvent(new MouseEvent("click", { bubbles: true })))
  await page.evaluate(() => document.querySelector("svg g.node").dispatchEvent(new Event("mouseenter")))
  assert.equal(
    await page.evaluate(
      () => [...document.querySelectorAll("svg g.node")].filter((g) => g.getAttribute("opacity") === "0.15").length,
    ),
    2,
  )
  await page.evaluate(() => document.querySelector("svg g.node").dispatchEvent(new Event("mouseleave")))
  assert.equal(
    await page.evaluate(
      () => [...document.querySelectorAll("svg g.node")].filter((g) => g.getAttribute("opacity") === "0.15").length,
    ),
    0,
  )
  // Synthetic pointer drag: exact client coords with no mouse-driver aiming, so the
  // drop point is exact whether the simulation is still settling or already dead.
  // Poll from Node: in-page waitForFunction evaluates strings, which the export CSP blocks.
  const drag = await page.evaluate(() => {
    const group = document.querySelectorAll("svg g.node")[0]
    const box = group.querySelector("circle").getBoundingClientRect()
    const sx = box.x + box.width / 2,
      sy = box.y + box.height / 2
    const opts = (x, y) => ({ clientX: x, clientY: y, pointerId: 7, bubbles: true, isPrimary: true })
    group.dispatchEvent(new PointerEvent("pointerdown", opts(sx, sy)))
    for (const [dx, dy] of [
      [20, 10],
      [40, 20],
      [60, 30],
      [80, 40],
    ])
      group.dispatchEvent(new PointerEvent("pointermove", opts(sx + dx, sy + dy)))
    group.dispatchEvent(new PointerEvent("pointerup", opts(sx + 80, sy + 40)))
    const drop = new DOMPoint(sx + 80, sy + 40).matrixTransform(document.querySelector("svg").getScreenCTM().inverse())
    return {
      before: [...document.querySelectorAll("svg g.node")].map((g) => g.getAttribute("transform")),
      drop: [drop.x, drop.y],
    }
  })
  async function awaitMoved(index, predicate, timeoutMs, message) {
    const start = Date.now()
    for (;;) {
      const current = await page.evaluate(
        (i) => document.querySelectorAll("svg g.node")[i].getAttribute("transform"),
        index,
      )
      if (predicate(current)) return
      if (Date.now() - start > timeoutMs) throw new Error(message)
      await page.waitForTimeout(200)
    }
  }
  await awaitMoved(
    0,
    (transform) => {
      const [, x, y] = /translate\(([^,]+),([^)]+)\)/.exec(transform).map(Number)
      return Math.hypot(x - drag.drop[0], y - drag.drop[1]) < 0.5
    },
    15000,
    "dragged node never reached the drop point",
  )
  await awaitMoved(1, (transform) => transform !== drag.before[1], 15000, "neighbor never moved after reheat")
  // The click right after a drag is suppressed instead of selecting.
  await page.evaluate(() =>
    document.querySelectorAll("svg g.node")[0].dispatchEvent(new MouseEvent("click", { bubbles: true })),
  )
  assert.match(await page.locator(".Detail").innerText(), /Select a page or source/)
  await page.locator("svg g.node circle").first().click()
  assert.match(await page.locator(".Detail").innerText(), /Page: Architecture/)
  assert.deepEqual(
    await page.evaluate(() =>
      [...document.querySelectorAll("svg path.edge")].map((edge) => edge.getAttribute("stroke")),
    ),
    ["#e0a63c", "#64778b", "#64778b"],
  )
  await page.locator(".list button").filter({ hasText: "source: src/b.ts" }).click()
  assert.match(await page.locator(".Detail").innerText(), /Source: src\/b\.ts/)
  assert.deepEqual(
    await page.evaluate(() =>
      [...document.querySelectorAll("svg path.edge")].map((edge) => edge.getAttribute("stroke")),
    ),
    ["#78dacc", "#64778b", "#78dacc"],
  )
  await page.getByRole("button", { name: "Show all / reset" }).click()

  // Reduced motion positions drags synchronously with no reheating.
  const calm = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" })
  await calm.goto(pathToFileURL(output).href)
  await calm.getByRole("heading", { name: "AX Wiki evidence map" }).waitFor()
  const calmDrag = await calm.evaluate(() => {
    const group = document.querySelectorAll("svg g.node")[0]
    const box = group.querySelector("circle").getBoundingClientRect()
    const sx = box.x + box.width / 2,
      sy = box.y + box.height / 2
    const opts = (x, y) => ({ clientX: x, clientY: y, pointerId: 7, bubbles: true, isPrimary: true })
    const before = [...document.querySelectorAll("svg g.node")].map((g) => g.getAttribute("transform"))
    group.dispatchEvent(new PointerEvent("pointerdown", opts(sx, sy)))
    for (const [dx, dy] of [
      [20, 10],
      [40, 20],
      [60, 30],
      [80, 40],
    ])
      group.dispatchEvent(new PointerEvent("pointermove", opts(sx + dx, sy + dy)))
    group.dispatchEvent(new PointerEvent("pointerup", opts(sx + 80, sy + 40)))
    const drop = new DOMPoint(sx + 80, sy + 40).matrixTransform(document.querySelector("svg").getScreenCTM().inverse())
    return {
      before,
      drop: [drop.x, drop.y],
      landed: document.querySelectorAll("svg g.node")[0].getAttribute("transform"),
      neighbor: document.querySelectorAll("svg g.node")[1].getAttribute("transform"),
    }
  })
  const [, landedX, landedY] = /translate\(([^,]+),([^)]+)\)/.exec(calmDrag.landed).map(Number)
  assert.ok(Math.hypot(landedX - calmDrag.drop[0], landedY - calmDrag.drop[1]) < 1e-6)
  assert.equal(calmDrag.neighbor, calmDrag.before[1])
  await calm.evaluate(() =>
    document.querySelectorAll("svg g.node")[0].dispatchEvent(new MouseEvent("click", { bubbles: true })),
  )
  assert.match(await calm.locator(".Detail").innerText(), /Select a page or source/)
  await calm.close()
  await page.getByRole("button", { name: "Show all / reset" }).click()
  if (process.env.AX_WIKI_VIEWER_SCREENSHOT)
    await page.screenshot({ path: process.env.AX_WIKI_VIEWER_SCREENSHOT, fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  assert.deepEqual(errors, [])
  assert.deepEqual(requests, [])

  // Test the public mount/update/dispose API in a real browser, including two instances.
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL("../dist/index.js", import.meta.url))],
    bundle: true,
    platform: "browser",
    format: "iife",
    globalName: "WikiViewer",
    write: false,
  })
  const api = await browser.newPage()
  await api.setContent('<main id="one"></main><main id="two"></main>')
  await api.addScriptTag({ content: bundle.outputFiles[0].text })
  const result = await api.evaluate((graph) => {
    const first = WikiViewer.mount(document.getElementById("one"), graph)
    const second = WikiViewer.mount(document.getElementById("two"), graph)
    let rejected = false
    try {
      first.update({ ...graph, schemaVersion: 99 })
    } catch {
      rejected = true
    }
    const preserved = document.querySelectorAll("#one .list button").length === graph.nodes.length
    first.update({ ...graph, snapshot: "new", nodes: [], edges: [] })
    const empty = document.querySelector("#one .detail").textContent.includes("No matching")
    first.dispose()
    first.dispose()
    let disposed = false
    try {
      first.update(graph)
    } catch {
      disposed = true
    }
    const isolated = document.querySelectorAll("#two .list button").length === graph.nodes.length
    second.dispose()
    return { rejected, preserved, empty, disposed, isolated, cleaned: document.querySelectorAll(".axwv").length === 0 }
  }, graph)
  assert.deepEqual(result, {
    rejected: true,
    preserved: true,
    empty: true,
    disposed: true,
    isolated: true,
    cleaned: true,
  })
  const badges = await api.evaluate(() => {
    const host = document.createElement("main")
    document.body.appendChild(host)
    const handle = WikiViewer.mount(host, {
      schemaVersion: 1,
      snapshot: "badge-fixture",
      scope: "wiki-manifest",
      codeRelationships: "unavailable",
      nodes: [
        { id: "page:g.md", kind: "page", label: "G", path: "g.md", freshness: "unknown", recordedReferences: 5 },
        { id: "source:s.ts", kind: "source", label: "s.ts", path: "s.ts", freshness: "unknown", recordedReferences: 1 },
      ],
      edges: [{ from: "page:g.md", to: "source:s.ts", kind: "references-source", freshness: "unknown" }],
      omitted: { nodes: 4, edges: 4 },
    })
    const found = {
      count: host.querySelectorAll(".badge").length,
      label: host.querySelector(".badge text")?.textContent,
      note: host.querySelector(".badge title")?.textContent,
    }
    handle.dispose()
    host.remove()
    return found
  })
  assert.deepEqual(badges, { count: 1, label: "+4", note: "+4 recorded references not in this snapshot" })
  const stale = await api.evaluate(() => {
    const host = document.createElement("main")
    document.body.appendChild(host)
    const handle = WikiViewer.mount(host, {
      schemaVersion: 1,
      snapshot: "stale-fixture",
      scope: "wiki-manifest",
      codeRelationships: "unavailable",
      nodes: [
        { id: "page:g.md", kind: "page", label: "G", path: "g.md", freshness: "stale", recordedReferences: 1 },
        { id: "source:s.ts", kind: "source", label: "s.ts", path: "s.ts", freshness: "fresh", recordedReferences: 1 },
      ],
      edges: [{ from: "page:g.md", to: "source:s.ts", kind: "references-source", freshness: "stale" }],
      omitted: { nodes: 0, edges: 0 },
    })
    const rings = [...host.querySelectorAll("circle.ring")]
    const found = {
      count: rings.length,
      stroke: rings[0]?.getAttribute("stroke"),
      animation: rings[0] ? getComputedStyle(rings[0]).animationName : "missing",
      hidden: rings[0]?.getAttribute("aria-hidden"),
      freshHasRing: host.querySelectorAll("svg g.node")[1]?.querySelector("circle.ring") !== null,
      tooltip: host.querySelectorAll("svg g.node")[0]?.querySelector("title")?.textContent,
      chips: [...host.querySelectorAll(".chip")].map((chip) => chip.textContent),
    }
    handle.dispose()
    host.remove()
    return found
  })
  assert.equal(stale.count, 1)
  assert.equal(stale.stroke, "#e0a63c")
  assert.equal(stale.animation, "none")
  assert.equal(stale.hidden, "true")
  assert.equal(stale.freshHasRing, false)
  assert.match(stale.tooltip, /stale/)
  assert.deepEqual(stale.chips, ["Fresh (1)", "Stale (1)"])
  console.log(
    JSON.stringify({
      browser: browser.version(),
      offline: "passed",
      keyboard: "passed",
      mobile: "passed",
      lifecycle: "passed",
      externalRequests: requests.length,
      errors: errors.length,
    }),
  )
} finally {
  await browser.close()
  await rm(dir, { recursive: true, force: true })
}
