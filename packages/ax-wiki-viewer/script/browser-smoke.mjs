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
  await page.getByRole("heading", { name: "AX Wiki", exact: true }).waitFor()
  await page.getByRole("tab", { name: "Evidence map" }).click()
  await page.locator(".panel-map .canvas").waitFor()
  // The map opens on the treemap; the force-layout checks below switch to Force first.
  assert.equal(await page.getByRole("button", { name: "Treemap", exact: true }).getAttribute("aria-pressed"), "true")
  assert.match(await page.locator(".view-caption").innerText(), /^Treemap:/)
  await page.getByRole("button", { name: "Force" }).click()
  assert.equal(await page.locator(".detail").evaluate((el) => getComputedStyle(el).whiteSpace), "pre-wrap")
  assert.equal(await page.locator(".legend .topic").count(), 2)
  // Wait until the force simulation has settled and the camera has framed the names.
  let previousLayout = ""
  let stableFrames = 0
  const labelStart = Date.now()
  for (;;) {
    const layout = await page.evaluate(() =>
      [...document.querySelectorAll("svg g.node")].map((group) => group.getAttribute("transform")).join("|"),
    )
    stableFrames = layout === previousLayout ? stableFrames + 1 : 0
    previousLayout = layout
    if (stableFrames >= 3) break
    if (Date.now() - labelStart > 8000) break
    await page.waitForTimeout(100)
  }
  // Camera affordances: zoom readout, double-click zoom, and a one-click return to the framed view.
  const fitted = await page.locator(".zoom-readout").textContent()
  assert.match(fitted ?? "", /^\d+%$/)
  await page.locator(".canvas svg[role=img]").dblclick({ position: { x: 20, y: 20 } })
  assert.notEqual(await page.locator(".zoom-readout").textContent(), fitted)
  await page.getByRole("button", { name: "Fit to view" }).click()
  assert.equal(await page.locator(".zoom-readout").textContent(), fitted)
  // Custom tooltip: plain text only, follows hover, hides on leave; the native title is suppressed while shown.
  const hoverBox = await page.locator("svg g.node:not(.page) circle").first().boundingBox()
  await page.mouse.move(hoverBox.x + hoverBox.width / 2, hoverBox.y + hoverBox.height / 2)
  await page.locator(".tip").waitFor({ state: "visible" })
  assert.match(await page.locator(".tip").innerText(), /connection/)
  assert.equal(await page.locator(".tip img, .tip script").count(), 0)
  await page.mouse.move(2, 2)
  await page.locator(".tip").waitFor({ state: "hidden" })
  // Explore tree: collapsible, keyboard friendly, and restored to its seed state afterwards.
  assert.equal(await page.locator('.list[role="tree"] [role="treeitem"]').count(), 4)
  const rowsOpen = await page.locator(".list .node-label").count()
  await page.getByRole("button", { name: "Collapse all" }).click()
  assert.equal(await page.locator(".list .node-label").count(), 2)
  assert.equal((await page.locator('.list [role="treeitem"][aria-expanded="false"]').count()) > 0, true)
  await page.getByRole("button", { name: "Expand all" }).click()
  assert.equal(await page.locator(".list .node-label").count(), rowsOpen)
  const firstPage = page.locator(".list .node-label[data-kind=page]").first()
  await firstPage.focus()
  await page.keyboard.press("ArrowLeft")
  assert.ok((await page.locator(".list .node-label").count()) < rowsOpen)
  await page.keyboard.press("ArrowRight")
  assert.equal(await page.locator(".list .node-label").count(), rowsOpen)
  await page.keyboard.press("ArrowDown")
  assert.notEqual(await page.evaluate(() => document.activeElement?.dataset.kind), "page")
  await page.mouse.move(2, 2)
  // Each view explains the question it answers, and the opt-in tour starts off.
  assert.equal(await page.locator(".views button svg.view-icon").count(), 3)
  assert.match(await page.locator(".view-caption").innerText(), /^Force: Who cites what\?/)
  assert.equal(await page.getByRole("button", { name: "Auto-tour" }).getAttribute("aria-pressed"), "false")
  assert.equal(await page.locator(".tour-status").isHidden(), true)
  // View switcher: radial views keep every node, put every cluster leaf on one ring, and return to force.
  const nodeCount = await page.locator("svg g.node").count()
  await page.getByRole("button", { name: "Radial" }).click()
  assert.equal(await page.getByRole("button", { name: "Radial" }).getAttribute("aria-pressed"), "true")
  assert.equal(await page.locator("svg g.node").count(), nodeCount)
  const ring = await page.evaluate(() => {
    const points = [...document.querySelectorAll("svg g.node:not(.page)")].map((group) => {
      const [x, y] = /translate\(([-\d.e]+),([-\d.e]+)\)/.exec(group.getAttribute("transform")).slice(1).map(Number)
      return Math.hypot(x - 450, y - 300)
    })
    return { max: Math.max(...points), min: Math.min(...points) }
  })
  assert.ok(ring.max > 0 && ring.min > 0)
  // Nodes glide to the radial targets; after the tween every non-page node sits at its final ring position.
  await page.waitForTimeout(700)
  const settled = await page.evaluate(() =>
    [...document.querySelectorAll("svg g.node:not(.page)")].map((group) => group.getAttribute("transform")).join("|"),
  )
  await page.waitForTimeout(300)
  assert.equal(
    await page.evaluate(() =>
      [...document.querySelectorAll("svg g.node:not(.page)")].map((group) => group.getAttribute("transform")).join("|"),
    ),
    settled,
  )
  // Treemap: every node is a rectangle and cross links stay hidden until focus.
  await page.getByRole("button", { name: "Treemap", exact: true }).click()
  await page.waitForTimeout(700)
  assert.equal(await page.locator("svg g.node").count(), nodeCount)
  assert.equal((await page.locator("svg g.node rect").count()) >= nodeCount, true)
  assert.equal(await page.locator("svg g.node circle").count(), 0)
  assert.equal(
    await page.evaluate(() =>
      [...document.querySelectorAll("svg path.edge")].every((edge) => edge.getAttribute("display") === "none"),
    ),
    true,
  )
  await page.getByRole("button", { name: "Force" }).click()
  assert.equal(await page.getByRole("button", { name: "Force" }).getAttribute("aria-pressed"), "true")
  assert.equal(await page.locator("svg g.node").count(), nodeCount)
  // Wait for the force layout to settle again before the label checks.
  await page.waitForTimeout(1500)
  const pageLabels = await page.evaluate(() => {
    const svgBox = document.querySelector(".canvas svg[role=img]").getBoundingClientRect()
    return [...document.querySelectorAll("svg g.node.page")].map((group) => {
      const text = group.querySelector("text")
      const box = text.getBoundingClientRect()
      return {
        anchor: getComputedStyle(text).textAnchor,
        fill: text.style.fill,
        inside:
          box.width > 8 &&
          box.left >= svgBox.left - 1 &&
          box.right <= svgBox.right + 1 &&
          box.top >= svgBox.top - 1 &&
          box.bottom <= svgBox.bottom + 1,
      }
    })
  })
  assert.equal(pageLabels.length, 2)
  for (const label of pageLabels) {
    assert.equal(label.anchor, "end")
    assert.equal(label.inside, true)
    assert.match(label.fill, /^rgb\(/)
    assert.notEqual(label.fill, "rgb(237, 246, 255)")
  }
  const topicFills = await page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll("svg g.node")].map((group) => [
        group.getAttribute("data-id"),
        group.querySelector("circle").getAttribute("fill"),
      ]),
    ),
  )
  assert.equal(topicFills["page:architecture.md"], "#3db8c4")
  assert.equal(topicFills["page:guide.md"], "#6aa2e0")
  assert.equal(topicFills["source:src/a.ts"], "#4d7cb4")
  assert.equal(topicFills["source:src/b.ts"], "#30455c")
  assert.equal(await page.locator(".list .node-label").count(), 4)
  assert.equal(await page.locator("svg g.node").count(), 4)
  assert.equal(await page.locator("svg path.edge").count(), 3)
  assert.equal(await page.locator("img").count(), 0)
  assert.equal(await page.evaluate(() => window.attacked), undefined)
  await page.getByRole("searchbox").fill("Architecture")
  assert.equal(await page.locator(".list .node-label").count(), 1)
  assert.equal(await page.locator("svg g.node").count(), 4)
  await page.getByRole("searchbox").fill("")
  assert.match(await page.getByRole("status").innerText(), /4 of 4 nodes · 3 of 3 edges in view/)
  assert.equal(await page.locator(".overlay").isHidden(), true)
  assert.equal(await page.locator(".notice").isHidden(), true)
  assert.equal(await page.locator(".outline").isHidden(), true)
  await page.getByRole("button", { name: "pages (2)" }).click()
  assert.equal(await page.locator(".list .node-label").count(), 2)
  assert.equal(await page.locator("svg g.node").count(), 4)
  assert.equal(await page.getByRole("button", { name: "pages (2)" }).getAttribute("aria-pressed"), "false")
  assert.match(await page.getByRole("status").innerText(), /2 of 4 nodes · 0 of 3 edges in view/)
  assert.equal(await page.locator(".notice").isHidden(), false)
  assert.match(await page.locator(".notice").innerText(), /no edges in view/)
  await page.getByRole("button", { name: "pages (2)" }).click()
  assert.equal(await page.getByRole("button", { name: "pages (2)" }).getAttribute("aria-pressed"), "true")
  assert.equal(await page.locator(".list .node-label").count(), 4)
  await page.getByRole("button", { name: "Unknown (4)" }).click()
  assert.equal(await page.locator(".list .node-label").count(), 0)
  assert.equal(await page.locator(".overlay").isHidden(), false)
  assert.match(await page.locator(".overlay").innerText(), /No nodes match the current filters/)
  assert.match(await page.getByRole("status").innerText(), /0 of 4 nodes · 0 of 3 edges in view/)
  await page.getByRole("button", { name: "Reset filters" }).click()
  assert.equal(await page.locator(".overlay").isHidden(), true)
  assert.equal(await page.locator(".list .node-label").count(), 4)
  assert.equal(
    await page.evaluate(() =>
      [...document.querySelectorAll(".axwv *")].every((el) =>
        [...el.attributes].every((attr) => !attr.name.startsWith("on")),
      ),
    ),
    true,
  )
  // Match only source paths; the hostile page title also contains "s".
  await page.getByRole("searchbox").fill("src/")
  assert.equal(await page.locator(".list .node-label").count(), 2)
  assert.match(await page.getByRole("status").innerText(), /2 of 4 match/)
  await page.keyboard.press("Enter")
  assert.match(await page.locator(".detail").innerText(), /Source: src\/b\.ts/)
  await page.evaluate(() =>
    document.querySelector(".canvas svg[role=img]").dispatchEvent(new MouseEvent("click", { bubbles: true })),
  )
  assert.equal(await page.locator(".list .node-label").count(), 2)
  await page.getByRole("searchbox").focus()
  await page.keyboard.press("Enter")
  assert.match(await page.locator(".detail").innerText(), /Source: src\/a\.ts/)
  await page.getByRole("searchbox").fill("")
  assert.equal(await page.locator(".list .node-label").count(), 4)
  await page.locator(".list .node-label").first().focus()
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
  await page.locator(".list .node-label").filter({ hasText: "page: Architecture" }).focus()
  await page.keyboard.press("Enter")
  assert.match(await page.locator(".detail").innerText(), /Cites 1 of 1 source in this snapshot/)
  assert.match(await page.locator(".detail").innerText(), /Provenance: Wiki manifest membership/)
  assert.match(await page.locator(".detail").innerText(), /Summary: Architecture summary\./)
  assert.match(await page.locator(".detail").innerText(), /Widget \(unavailable\)/)
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Evidence")
  // The Explore tree stays stable on selection instead of shrinking to the neighborhood.
  assert.equal(await page.locator(".list .node-label").count(), 4)
  await page.keyboard.press("Escape")
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), "INPUT")
  await page.locator(".legend details.key summary").click()
  assert.match(await page.locator(".legend").innerText(), /size = visible connections/)
  await page.getByRole("searchbox").fill("Arch")
  assert.equal(await page.locator(".notice").isHidden(), false)
  assert.match(await page.locator(".notice").innerText(), /single node/)
  await page.keyboard.press("Enter")
  assert.match(await page.locator(".detail").innerText(), /Page: Architecture/)
  assert.equal(await page.locator(".list .node-label").count(), 1)
  await page.evaluate(() =>
    document.querySelector(".canvas svg[role=img]").dispatchEvent(new MouseEvent("click", { bubbles: true })),
  )
  assert.match(await page.locator(".detail").innerText(), /Select a page, source, or symbol/)
  assert.equal(await page.locator(".list .node-label").count(), 1)
  await page.getByRole("searchbox").fill("")
  assert.equal(await page.locator(".list .node-label").count(), 4)
  assert.equal(await page.locator(".notice").isHidden(), true)
  await page.locator(".list .node-label").nth(2).click()
  assert.match(await page.locator(".detail").innerText(), /Summary: Guide summary\./)
  assert.match(await page.locator(".detail").innerText(), /Foo \(verified\)/)
  assert.match(await page.locator(".detail").innerText(), /Ghost \(inferred\)/)
  await page.evaluate(() =>
    document.querySelector(".canvas svg[role=img]").dispatchEvent(new MouseEvent("click", { bubbles: true })),
  )
  // Move away from the real list row before synthesizing a canvas hover.
  // Otherwise Chromium can deliver a real row mouseenter between synthetic events.
  await page.mouse.move(2, 2)
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
    group.dispatchEvent(new Event("mouseenter"))
    group.dispatchEvent(new PointerEvent("pointerdown", opts(sx, sy)))
    for (const [dx, dy] of [
      [20, 10],
      [40, 20],
      [60, 30],
      [80, 40],
    ])
      group.dispatchEvent(new PointerEvent("pointermove", opts(sx + dx, sy + dy)))
    group.dispatchEvent(new PointerEvent("pointerup", opts(sx + 80, sy + 40)))
    const drop = new DOMPoint(sx + 80, sy + 40).matrixTransform(
      document.querySelector(".canvas svg[role=img]").getScreenCTM().inverse(),
    )
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
  assert.equal(
    await page.evaluate(
      () => [...document.querySelectorAll("svg g.node")].filter((g) => g.getAttribute("opacity") === "0.15").length,
    ),
    0,
  )
  // The click right after a drag is suppressed instead of selecting.
  await page.evaluate(() =>
    document.querySelectorAll("svg g.node")[0].dispatchEvent(new MouseEvent("click", { bubbles: true })),
  )
  assert.match(await page.locator(".detail").innerText(), /Select a page, source, or symbol/)
  await page.locator("svg g.node circle").first().click()
  assert.match(await page.locator(".detail").innerText(), /Page: Architecture/)
  assert.deepEqual(
    await page.evaluate(() =>
      [...document.querySelectorAll("svg path.edge")].map((edge) => edge.getAttribute("stroke")),
    ),
    ["#e0a63c", "#64778b", "#64778b"],
  )
  await page.locator(".list .node-label").filter({ hasText: "source: src/b.ts" }).click()
  assert.match(await page.locator(".detail").innerText(), /Source: src\/b\.ts/)
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
  await calm.getByRole("tab", { name: "Evidence map" }).click()
  await calm.locator(".panel-map .canvas").waitFor()
  await calm.getByRole("button", { name: "Force" }).click()
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
    const drop = new DOMPoint(sx + 80, sy + 40).matrixTransform(
      document.querySelector(".canvas svg[role=img]").getScreenCTM().inverse(),
    )
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
  const reverted = await calm.evaluate(() => {
    const canvas = document.querySelector(".canvas")
    const group = document.querySelectorAll("svg g.node")[0]
    const before = group.getAttribute("transform")
    const box = group.querySelector("circle").getBoundingClientRect()
    const outside = canvas.getBoundingClientRect()
    const sx = box.x + box.width / 2,
      sy = box.y + box.height / 2
    const opts = (x, y) => ({ clientX: x, clientY: y, pointerId: 8, bubbles: true, isPrimary: true })
    group.dispatchEvent(new PointerEvent("pointerdown", opts(sx, sy)))
    group.dispatchEvent(new PointerEvent("pointermove", opts(sx + 30, sy + 16)))
    group.dispatchEvent(new PointerEvent("pointerup", opts(outside.right + 24, outside.top + 12)))
    return { before, after: group.getAttribute("transform") }
  })
  assert.equal(reverted.after, reverted.before)
  await calm.evaluate(() =>
    document.querySelectorAll("svg g.node")[0].dispatchEvent(new MouseEvent("click", { bubbles: true })),
  )
  assert.match(await calm.locator(".detail").innerText(), /Select a page, source, or symbol/)
  // pointercancel does not deliver a click, so the next click must still select.
  await calm.evaluate(() => {
    const group = document.querySelectorAll("svg g.node")[0]
    const box = group.querySelector("circle").getBoundingClientRect()
    const sx = box.x + box.width / 2,
      sy = box.y + box.height / 2
    const opts = (x, y) => ({ clientX: x, clientY: y, pointerId: 9, bubbles: true, isPrimary: true })
    group.dispatchEvent(new PointerEvent("pointerdown", opts(sx, sy)))
    group.dispatchEvent(new PointerEvent("pointermove", opts(sx + 24, sy + 16)))
    group.dispatchEvent(new PointerEvent("pointercancel", opts(sx + 24, sy + 16)))
    group.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
  assert.match(await calm.locator(".detail").innerText(), /Page: Architecture/)
  await calm.evaluate(() =>
    document.querySelector(".canvas svg[role=img]").dispatchEvent(new MouseEvent("click", { bubbles: true })),
  )
  assert.match(await calm.locator(".detail").innerText(), /Select a page, source, or symbol/)
  // A touch drag targets the node on pointerup but does not emit a click.
  // The next tap must still select.
  await calm.evaluate(() => {
    const group = document.querySelectorAll("svg g.node")[0]
    const box = group.querySelector("circle").getBoundingClientRect()
    const sx = box.x + box.width / 2,
      sy = box.y + box.height / 2
    const touch = (type, x, y) =>
      new PointerEvent(type, {
        clientX: x,
        clientY: y,
        pointerId: 15,
        pointerType: "touch",
        bubbles: true,
        isPrimary: true,
      })
    group.dispatchEvent(touch("pointerdown", sx, sy))
    group.dispatchEvent(touch("pointermove", sx + 28, sy + 18))
    group.dispatchEvent(touch("pointerup", sx + 28, sy + 18))
    group.dispatchEvent(touch("pointerdown", sx, sy))
    group.dispatchEvent(touch("pointerup", sx, sy))
    group.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
  assert.match(await calm.locator(".detail").innerText(), /Page: Architecture/)
  const tracked = await calm.evaluate(() => {
    const group = document.querySelectorAll("svg g.node")[0]
    const before = group.getAttribute("transform")
    const box = group.querySelector("circle").getBoundingClientRect()
    const sx = box.x + box.width / 2,
      sy = box.y + box.height / 2
    const opts = (x, y) => ({ clientX: x, clientY: y, pointerId: 31, bubbles: true, isPrimary: true })
    group.dispatchEvent(new PointerEvent("pointerdown", opts(sx, sy)))
    document
      .querySelector(".canvas svg[role=img]")
      .dispatchEvent(new PointerEvent("pointermove", opts(sx + 48, sy + 22)))
    document.dispatchEvent(new PointerEvent("pointerup", opts(sx + 48, sy + 22)))
    return { before, after: group.getAttribute("transform") }
  })
  assert.notEqual(tracked.after, tracked.before)
  assert.equal(
    await calm.evaluate(
      () => [...document.querySelectorAll("svg g.node")].filter((g) => g.getAttribute("opacity") === "0.15").length,
    ),
    2,
  )
  await calm.close()
  // A pan that ends outside the svg must not stay armed: a later hover must not
  // drag the map. The pointerup below targets the document, the way a release
  // over another panel or past the window edge arrives.
  const abandonedPan = await page.evaluate(() => {
    const svg = document.querySelector(".canvas svg[role=img]")
    const box = svg.getBoundingClientRect()
    const sx = box.x + 30,
      sy = box.y + 30
    const opts = (x, y) => ({ clientX: x, clientY: y, pointerId: 41, bubbles: true, isPrimary: true })
    const before = svg.getAttribute("viewBox")
    svg.dispatchEvent(new PointerEvent("pointerdown", opts(sx, sy)))
    svg.dispatchEvent(new PointerEvent("pointermove", opts(sx + 24, sy + 12)))
    const panned = svg.getAttribute("viewBox")
    document.dispatchEvent(new PointerEvent("pointerup", opts(sx + 24, sy + 12)))
    svg.dispatchEvent(new PointerEvent("pointermove", opts(sx + 320, sy + 260)))
    return { before, panned, afterHover: svg.getAttribute("viewBox") }
  })
  assert.notEqual(abandonedPan.panned, abandonedPan.before)
  assert.equal(abandonedPan.afterHover, abandonedPan.panned)
  // An edge must meet the bubble rim it leaves, not stop inside it: the trim is
  // a distance along the direction to the control point, which is not a unit
  // vector. Retry while the force layout is still settling.
  const edgeSlack = () =>
    page.evaluate(() => {
      const circles = [...document.querySelectorAll("svg g.node")].map((group) => {
        const [, x, y] = /translate\(([^,]+),([^)]+)\)/.exec(group.getAttribute("transform") ?? "").map(Number)
        const circle = group.querySelector("circle")
        return { x, y, r: circle ? Number(circle.getAttribute("r")) : 0 }
      })
      let slack = Infinity
      for (const path of document.querySelectorAll("svg path.edge")) {
        const match = /^M([-\d.]+),([-\d.]+)/.exec(path.getAttribute("d") ?? "")
        if (!match) continue
        const x = Number(match[1]),
          y = Number(match[2])
        for (const circle of circles) slack = Math.min(slack, Math.hypot(x - circle.x, y - circle.y) - circle.r)
      }
      return slack
    })
  let slack = await edgeSlack()
  for (let attempt = 0; slack < 0 && attempt < 20; attempt++) {
    await page.waitForTimeout(250)
    slack = await edgeSlack()
  }
  assert.ok(slack >= 0, `an edge starts ${(-slack).toFixed(2)} units inside a bubble`)
  // Enter cycles through the matches, so the box has to keep focus: otherwise
  // the second Enter goes to the detail heading and the cycle stops at one.
  // Reset first: a live selection narrows the result list to its neighborhood.
  await page.getByRole("button", { name: "Show all / reset" }).click()
  const searchBox = page.locator(".panel-map input[type=search]")
  await searchBox.click()
  await searchBox.fill("src/")
  await page.keyboard.press("Enter")
  const firstMatch = await page.locator(".detail").innerText()
  const keptFocus = await page.evaluate(() => document.activeElement?.getAttribute("type") === "search")
  await page.keyboard.press("Enter")
  const secondMatch = await page.locator(".detail").innerText()
  assert.equal(keptFocus, true, "the search box must keep focus after selecting a match")
  assert.notEqual(secondMatch, firstMatch, "Enter must advance to the next match")
  await page.getByRole("button", { name: "Show all / reset" }).click()
  // Wheel zooms toward the pointer: one notch in shrinks the viewBox, one notch out restores it.
  const wheeled = await page.evaluate(() => {
    const svg = document.querySelector(".canvas svg[role=img]")
    const before = svg.getAttribute("viewBox").split(" ").map(Number)
    const box = svg.getBoundingClientRect()
    const at = { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, bubbles: true, cancelable: true }
    svg.dispatchEvent(new WheelEvent("wheel", { ...at, deltaY: -120 }))
    const zoomed = svg.getAttribute("viewBox").split(" ").map(Number)
    svg.dispatchEvent(new WheelEvent("wheel", { ...at, deltaY: 120 }))
    const restored = svg.getAttribute("viewBox").split(" ").map(Number)
    return { before, zoomed, restored }
  })
  assert.ok(wheeled.zoomed[2] < wheeled.before[2], "wheel up should zoom in")
  assert.ok(Math.abs(wheeled.restored[2] - wheeled.before[2]) < 1e-6, "wheel down should restore the scale")
  // A real mouse drag must not leave a native selection. That selection is the
  // slate rectangle that sometimes stays on the map.
  const dragFrom = await page.evaluate(() => {
    const box = document.querySelector("svg g.node circle").getBoundingClientRect()
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  })
  await page.mouse.move(dragFrom.x, dragFrom.y)
  await page.mouse.down()
  await page.mouse.move(dragFrom.x + 16, dragFrom.y + 110, { steps: 12 })
  await page.mouse.up()
  assert.equal(
    await page.evaluate(() => {
      const selected = document.getSelection()
      return selected === null || selected.isCollapsed
    }),
    true,
  )
  // An outside release restores a pinned node and keeps that pin, so the next
  // reheat does not pull it away.
  const restoredPin = await page.evaluate(() => {
    const nodes = () => [...document.querySelectorAll("svg g.node")]
    const center = (group) => {
      const box = group.querySelector("circle").getBoundingClientRect()
      return [box.x + box.width / 2, box.y + box.height / 2]
    }
    const gesture = (group, pointerId, up) => {
      const [sx, sy] = center(group)
      const opts = (x, y) => ({ clientX: x, clientY: y, pointerId, bubbles: true, isPrimary: true })
      group.dispatchEvent(new PointerEvent("pointerdown", opts(sx, sy)))
      group.dispatchEvent(new PointerEvent("pointermove", opts(sx + 30, sy + 18)))
      group.dispatchEvent(new PointerEvent("pointerup", opts(up[0], up[1])))
    }
    const [sx, sy] = center(nodes()[0])
    gesture(nodes()[0], 21, [sx + 64, sy + 28])
    const canvas = document.querySelector(".canvas").getBoundingClientRect()
    gesture(nodes()[0], 22, [canvas.right + 28, canvas.top + 16])
    const restored = nodes()[0].getAttribute("transform")
    const beforeNeighbor = nodes()[1].getAttribute("transform")
    const [nx, ny] = center(nodes()[1])
    gesture(nodes()[1], 23, [nx + 22, ny + 14])
    return { restored, beforeNeighbor }
  })
  await awaitMoved(
    1,
    (transform) => transform !== restoredPin.beforeNeighbor,
    15000,
    "reheat never moved the other node",
  )
  assert.equal(
    await page.evaluate(() => document.querySelectorAll("svg g.node")[0].getAttribute("transform")),
    restoredPin.restored,
  )
  assert.equal(
    await page.evaluate(
      () => [...document.querySelectorAll("svg g.node")].filter((g) => g.getAttribute("opacity") === "0.15").length,
    ),
    0,
  )
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
    const first = WikiViewer.mountMap(document.getElementById("one"), graph)
    const second = WikiViewer.mountMap(document.getElementById("two"), graph)
    let rejected = false
    try {
      first.update({ ...graph, schemaVersion: 99 })
    } catch {
      rejected = true
    }
    const preserved = document.querySelectorAll("#one .list .node-label").length === graph.nodes.length
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
    const isolated = document.querySelectorAll("#two .list .node-label").length === graph.nodes.length
    second.dispose()
    return { rejected, preserved, empty, disposed, isolated, cleaned: document.querySelectorAll(".axwv").length === 0 }
  }, graph)
  // Auto-tour: opt-in, counts down to the next view, pauses on activity, and announces once.
  const tourPage = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await tourPage.setContent('<main id="t"></main>')
  await tourPage.addScriptTag({ content: bundle.outputFiles[0].text })
  await tourPage.evaluate((graph) => {
    globalThis.tour = WikiViewer.mountMap(document.getElementById("t"), graph, {
      tour: { enabled: true, intervalMs: 2000 },
    })
  }, graph)
  assert.equal(await tourPage.getByRole("button", { name: "Auto-tour" }).getAttribute("aria-pressed"), "true")
  assert.match(await tourPage.locator(".tour-status").innerText(), /^Next: Force · 0:0[12]$/)
  // Activity keeps resetting the idle clock, so the view must not change while the user is active.
  for (let i = 0; i < 6; i++) {
    await tourPage.mouse.move(100 + i * 40, 120 + i * 25)
    await tourPage.waitForTimeout(500)
  }
  assert.equal(await tourPage.getByRole("button", { name: "Treemap" }).getAttribute("aria-pressed"), "true")
  // Pausing holds the view even when idle.
  await tourPage.getByRole("button", { name: "Pause" }).click()
  await tourPage.waitForTimeout(2600)
  assert.equal(await tourPage.getByRole("button", { name: "Treemap" }).getAttribute("aria-pressed"), "true")
  assert.equal(await tourPage.locator(".tour-status").innerText(), "Tour paused")
  // Resuming and staying idle advances to the next view and announces it once, politely.
  await tourPage.getByRole("button", { name: "Resume" }).click()
  await tourPage.mouse.move(1, 1)
  await tourPage.waitForFunction(
    () => document.querySelector(".views button[aria-pressed=true]")?.textContent === "Force",
    null,
    {
      timeout: 6000,
    },
  )
  assert.equal(await tourPage.locator(".sr-only").innerText(), "Switched to Force view")
  assert.match(await tourPage.locator(".view-caption").innerText(), /^Force:/)
  assert.equal(await tourPage.locator(".tour-status").getAttribute("aria-hidden"), "true")
  // Turning it off stops the countdown entirely.
  await tourPage.getByRole("button", { name: "Auto-tour" }).click()
  assert.equal(await tourPage.locator(".tour-status").isHidden(), true)
  await tourPage.evaluate(() => globalThis.tour.dispose())
  await tourPage.close()
  // Reduced motion: the tour cannot be enabled, even by option.
  const calmTour = await browser.newPage({ reducedMotion: "reduce" })
  await calmTour.setContent('<main id="c"></main>')
  await calmTour.addScriptTag({ content: bundle.outputFiles[0].text })
  await calmTour.evaluate((graph) => {
    WikiViewer.mountMap(document.getElementById("c"), graph, { tour: { enabled: true, intervalMs: 1000 } })
  }, graph)
  assert.equal(await calmTour.getByRole("button", { name: "Auto-tour" }).isDisabled(), true)
  assert.equal(await calmTour.getByRole("button", { name: "Auto-tour" }).getAttribute("aria-pressed"), "false")
  await calmTour.close()
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
    const handle = WikiViewer.mountMap(host, {
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
    const handle = WikiViewer.mountMap(host, {
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
    // Page rings are a network-view signal; treemap page cells count changed files in their header.
    const treemapRings = host.querySelectorAll(".ring").length
    ;[...host.querySelectorAll(".views button")].find((button) => button.textContent === "Force")?.click()
    const rings = [...host.querySelectorAll(".ring")]
    const found = {
      count: rings.length,
      stroke: rings[0]?.getAttribute("stroke"),
      animation: rings[0] ? getComputedStyle(rings[0]).animationName : "missing",
      hidden: rings[0]?.getAttribute("aria-hidden"),
      freshHasRing: host.querySelectorAll("svg g.node")[1]?.querySelector(".ring") !== null,
      tooltip: host.querySelectorAll("svg g.node")[0]?.querySelector("title")?.textContent,
      chips: [...host.querySelectorAll(".chip")].map((chip) => chip.textContent),
      treemapRings,
    }
    handle.dispose()
    host.remove()
    return found
  })
  assert.equal(stale.treemapRings, 0)
  assert.equal(stale.count, 1)
  assert.equal(stale.stroke, "#e0a63c")
  assert.equal(stale.animation, "none")
  assert.equal(stale.hidden, "true")
  assert.equal(stale.freshHasRing, false)
  assert.match(stale.tooltip, /stale/)
  assert.deepEqual(stale.chips, ["Fresh (1)", "Stale (1)"])
  const outline = await api.evaluate(() => {
    const host = document.createElement("main")
    document.body.appendChild(host)
    const handle = WikiViewer.mountMap(host, {
      schemaVersion: 1,
      snapshot: "outline-fixture",
      scope: "wiki-manifest",
      codeRelationships: "unavailable",
      nodes: [
        {
          id: "page:g.md",
          kind: "page",
          label: "G",
          path: "g.md",
          freshness: "unknown",
          recordedReferences: 1,
          summary: "",
          symbols: [],
          detail: "",
          qualified: "",
        },
        {
          id: "source:s.ts",
          kind: "source",
          label: "s.ts",
          path: "s.ts",
          freshness: "unknown",
          recordedReferences: 1,
          summary: "",
          symbols: [],
          detail: "",
          qualified: "",
        },
        {
          id: "symbol:s.ts#Foo",
          kind: "symbol",
          label: "Foo",
          path: "s.ts",
          freshness: "unknown",
          recordedReferences: 0,
          summary: "",
          symbols: [],
          detail: "class Foo",
          qualified: "Foo",
        },
        {
          id: "symbol:s.ts#Foo.bar",
          kind: "symbol",
          label: "bar",
          path: "s.ts",
          freshness: "unknown",
          recordedReferences: 0,
          summary: "",
          symbols: [],
          detail: "method Foo.bar",
          qualified: "Foo.bar",
        },
      ],
      edges: [
        { from: "page:g.md", to: "source:s.ts", kind: "references-source", freshness: "unknown" },
        { from: "source:s.ts", to: "symbol:s.ts#Foo", kind: "contains", freshness: "unknown" },
        { from: "source:s.ts", to: "symbol:s.ts#Foo.bar", kind: "contains", freshness: "unknown" },
      ],
      omitted: { nodes: 0, edges: 0 },
    })
    const details = [...host.querySelectorAll("details")].find(
      (d) => d.querySelector("summary")?.textContent === "Outline",
    )
    const buttons = [...host.querySelectorAll(".outline button")]
    const found = {
      outlineShown: details?.style.display !== "none",
      rows: buttons.map((button) => button.textContent),
      nested: host.querySelectorAll(".outline ul ul").length,
      symbolFill: host.querySelectorAll("svg g.node")[2]?.firstElementChild?.getAttribute("fill"),
      legend: [...host.querySelectorAll(".legend button")].map((button) => button.textContent),
    }
    buttons.find((button) => button.textContent === "method Foo.bar")?.click()
    found.detail = host.querySelector(".detail")?.textContent
    found.afterSelect = host.querySelectorAll(".list .node-label").length
    handle.dispose()
    host.remove()
    return found
  })
  assert.equal(outline.outlineShown, true)
  assert.deepEqual(outline.rows, ["s.ts", "class Foo", "method Foo.bar"])
  assert.equal(outline.nested, 2)
  assert.equal(outline.symbolFill, "#7d6a45")
  assert.deepEqual(outline.legend, ["pages (1)", "sources (1)", "symbols (2)"])
  assert.match(outline.detail, /Symbol: bar/)
  assert.match(outline.detail, /Detail: method Foo\.bar/)
  assert.match(outline.detail, /Contained by 1 source/)
  // Selecting a symbol reveals it in the Explore tree: page, source, class and method are all shown.
  assert.equal(outline.afterSelect, 4)
  // The reading workspace: overview, reader, citations, module matrix and the map, offline.
  const workspaceGraph = projectWikiManifest(
    {
      schemaVersion: 1,
      generator: "ax-wiki",
      generatedAt: "2026-10-14T00:00:00.000Z",
      model: "fixture/model",
      sources: {
        "src/a.ts": "a".repeat(64),
        "src/b.ts": "b".repeat(64),
        "lib/c.ts": "c".repeat(64),
        "README.md": "d".repeat(64),
        "docs/x.md": "e".repeat(64),
        "docs/y.md": "f".repeat(64),
      },
      pages: {
        "quickstart.md": {
          title: "Quickstart",
          purpose: "Start here.",
          sources: ["src/a.ts", "lib/c.ts"],
          sourceHashes: { "src/a.ts": "a".repeat(64), "lib/c.ts": "c".repeat(64) },
        },
        "modules/core.md": {
          title: "Core",
          sources: ["src/a.ts", "src/b.ts"],
          sourceHashes: { "src/a.ts": "a".repeat(64), "src/b.ts": "b".repeat(64) },
        },
      },
    },
    {
      snapshot: "workspace-fixture",
      observed: new Map([
        ["src/a.ts", "a".repeat(64)],
        ["src/b.ts", "f".repeat(64)],
      ]),
      imports: new Map([["src/a.ts", ["lib/c.ts"]]]),
      documents: new Map([
        [
          "quickstart.md",
          '# Quickstart\n\nRead `src/a.ts` then [Core](modules/core.md).\n\n<img src=x onerror="window.attacked=true">\n\n[bad](javascript:window.attacked=true)\n\n## Next\n\n- one\n- two',
        ],
        ["modules/core.md", "# Core\n\n| a | b |\n| --- | --- |\n| `src/b.ts` | x |"],
      ]),
    },
  )
  const workspaceFile = path.join(dir, "workspace.html")
  await writeFile(workspaceFile, renderWikiGraphHtml(workspaceGraph).html)
  const work = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const workErrors = []
  work.on("pageerror", (error) => workErrors.push(error.message))
  await work.route("http://**/*", (route) => route.abort())
  await work.route("https://**/*", (route) => route.abort())
  await work.goto(pathToFileURL(workspaceFile).href)
  // The evidence map is the landing view; a selected page opens in the reader.
  assert.equal(await work.getByRole("tab", { name: "Evidence map" }).getAttribute("aria-selected"), "true")
  assert.equal(await work.getByRole("tab", { name: "Evidence map" }).getAttribute("tabindex"), "0")
  await work.locator(".list .node-label").filter({ hasText: "page: Core" }).click()
  await work.getByRole("button", { name: "Read this page" }).click()
  assert.equal(await work.getByRole("tab", { name: "Read" }).getAttribute("aria-selected"), "true")
  assert.equal(await work.locator(".article > h1").innerText(), "Core")
  await work.getByRole("tab", { name: "Overview" }).click()
  assert.match(
    await work.locator(".app-head .meta").innerText(),
    /Generated 2026-10-14 00:00 UTC · fixture\/model · 2 pages/,
  )
  assert.match(await work.locator(".tiles").innerText(), /Cited files\s+3\s+of 6 indexed files/)
  // Blind spots name uncited directories; page overlap lists shared citations for a pair.
  assert.deepEqual(await work.locator(".spots li button").allInnerTexts(), ["docs"])
  assert.equal(await work.locator(".spots .count").innerText(), "2 / 2")
  await work.locator(".spots li button", { hasText: "docs" }).click()
  assert.match(await work.locator(".icicle .crumbs").innerText(), /docs/)
  await work.locator(".overlap rect.cell.hit").first().click()
  assert.match(
    await work.locator(".drawer").innerText(),
    /Shared citations[\s\S]*1 cited file in common[\s\S]*src\/a\.ts/i,
  )
  await work.keyboard.press("Escape")
  assert.match(await work.locator(".tiles").innerText(), /1 stale/)
  // Arrow keys move between tabs.
  await work.getByRole("tab", { name: "Overview" }).focus()
  await work.keyboard.press("ArrowRight")
  assert.equal(await work.getByRole("tab", { name: "Read" }).getAttribute("aria-selected"), "true")
  await work.locator(".nav button", { hasText: "Quickstart" }).click()
  assert.equal(await work.locator(".article > h1").innerText(), "Quickstart")
  // The duplicate title heading is dropped; hostile markdown stays inert text.
  assert.equal(await work.locator(".md h1").count(), 0)
  assert.equal(await work.locator(".md img").count(), 0)
  await work.locator(".md span", { hasText: "bad" }).click()
  assert.equal(await work.evaluate(() => window.attacked), undefined)
  assert.equal(await work.locator(".rail .toc button").innerText(), "Next")
  // A cited path opens the source drawer, which jumps to the evidence map.
  await work.locator(".md code.md-source", { hasText: "src/a.ts" }).click()
  assert.equal(await work.locator(".drawer .path").innerText(), "src/a.ts")
  assert.match(await work.locator(".drawer").innerText(), /Cited by 2 pages/)
  await work.getByRole("button", { name: "Show in evidence map" }).click()
  assert.equal(await work.getByRole("tab", { name: "Evidence map" }).getAttribute("aria-selected"), "true")
  assert.match(await work.locator(".detail").innerText(), /Source: src\/a\.ts/)
  // Page links and search navigate between pages.
  await work.getByRole("tab", { name: "Read" }).click()
  await work.locator(".md a.md-page").click()
  assert.equal(await work.locator(".article > h1").innerText(), "Core")
  assert.match(await work.locator(".article .badge").innerText(), /1 of 2 cited files changed/)
  assert.equal(await work.locator(".md table td code.md-source").count(), 1)
  await work.getByRole("searchbox", { name: "Search the wiki" }).fill("then")
  assert.equal(await work.locator(".nav button").count(), 1)
  // Modules: a matrix row selects its cited files.
  await work.getByRole("tab", { name: "Modules" }).click()
  assert.match(await work.locator(".modules").innerText(), /Module dependencies/i)
  assert.ok((await work.locator(".modules .row-label").count()) >= 2)
  assert.deepEqual(workErrors, [])
  await work.close()

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
