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
const browser = await chromium.launch({ executablePath: process.env.AX_WIKI_CHROMIUM || undefined, headless: true })
try {
  const graph = projectWikiManifest(
    {
      schemaVersion: 1,
      generator: "ax-wiki",
      pages: {
        "guide.md": {
          title: '</script><img src=x onerror="window.attacked=true">',
          sources: ["src/a.ts", "src/b.ts"],
          sourceHashes: {},
        },
        "architecture.md": { title: "Architecture", sources: ["src/b.ts"], sourceHashes: {} },
      },
    },
    { snapshot: "browser-fixture" },
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
  assert.equal(await page.locator("img").count(), 0)
  assert.equal(await page.evaluate(() => window.attacked), undefined)
  await page.getByRole("searchbox").fill("Architecture")
  assert.equal(await page.locator(".list button").count(), 1)
  await page.getByRole("searchbox").fill("")
  await page.getByRole("combobox").selectOption("source")
  assert.equal(await page.locator(".list button").count(), 2)
  await page.getByRole("button", { name: "Show all / reset" }).click()
  await page.locator(".list button").filter({ hasText: "page: Architecture" }).focus()
  await page.keyboard.press("Enter")
  assert.match(await page.locator(".detail").innerText(), /references-source/)
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Evidence")
  assert.equal(await page.locator(".list button").count(), 2)
  await page.keyboard.press("Escape")
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), "INPUT")
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
