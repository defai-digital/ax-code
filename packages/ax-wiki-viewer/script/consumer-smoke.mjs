import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { build } from "esbuild"
import { chromium } from "playwright-core"

const packageRoot = fileURLToPath(new URL("..", import.meta.url))
const directory = await mkdtemp(path.join(tmpdir(), "wiki-packed-consumer-"))
const packageManager = process.env.npm_execpath
if (!packageManager) throw new Error("Run this check through pnpm run test:consumer")
function run(args, cwd) {
  return execFileSync(process.execPath, [packageManager, ...args], { cwd, encoding: "utf8", stdio: "pipe" })
}
let browser
try {
  run(["pack", "--pack-destination", directory], path.join(packageRoot, "../ax-wiki"))
  run(["pack", "--pack-destination", directory], packageRoot)
  const files = await readdir(directory)
  const wiki = files.find((file) => /ax-wiki-\d.*\.tgz$/.test(file))
  const viewer = files.find((file) => /ax-wiki-viewer-.*\.tgz$/.test(file))
  assert.ok(wiki && viewer)
  const wikiFile = `file:${path.join(directory, wiki)}`
  await writeFile(
    path.join(directory, "package.json"),
    JSON.stringify({
      type: "module",
      dependencies: {
        "@ax-code/ax-wiki": wikiFile,
        "@ax-code/ax-wiki-viewer": `file:${path.join(directory, viewer)}`,
      },
    }),
  )
  await writeFile(
    path.join(directory, "pnpm-workspace.yaml"),
    `overrides:\n  "@ax-code/ax-wiki": ${JSON.stringify(wikiFile)}\n`,
  )
  run(["install", "--offline", "--ignore-scripts"], directory)
  const installedWiki = JSON.parse(
    await readFile(path.join(directory, "node_modules/@ax-code/ax-wiki/package.json"), "utf8"),
  )
  assert.equal(Object.keys(installedWiki.dependencies || {}).length, 0)
  await writeFile(
    path.join(directory, "produce.mjs"),
    `
import { projectWikiManifest } from '@ax-code/ax-wiki/graph';
import { renderWikiGraphHtml } from '@ax-code/ax-wiki-viewer/node';
import { writeFile } from 'node:fs/promises';
const graph = projectWikiManifest({schemaVersion:1,generator:'ax-wiki',pages:{'guide.md':{title:'External consumer',sources:['src/main.ts'],sourceHashes:{}}}},{snapshot:'packed-consumer'});
await writeFile(new URL('./view.html',import.meta.url),renderWikiGraphHtml(graph).html);
await writeFile(new URL('./graph.json',import.meta.url),JSON.stringify(graph));
`,
  )
  execFileSync(process.execPath, [path.join(directory, "produce.mjs")], { cwd: directory, stdio: "pipe" })
  await writeFile(
    path.join(directory, "browser.mjs"),
    `import {mount} from '@ax-code/ax-wiki-viewer'; globalThis.mountWiki=mount;`,
  )
  const result = await build({
    entryPoints: [path.join(directory, "browser.mjs")],
    bundle: true,
    platform: "browser",
    format: "iife",
    write: false,
    metafile: true,
  })
  assert.ok(!Object.keys(result.metafile.inputs).some((file) => file.includes("packages/ax-code/")))
  assert.ok(!/\b(?:require\(|process\.|Buffer\b)|node:/.test(result.outputFiles[0].text))
  browser = await chromium.launch({ executablePath: process.env.AX_WIKI_CHROMIUM || undefined, headless: true })
  const page = await browser.newPage()
  const errors = [],
    requests = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("request", (req) => {
    if (/^https?:/.test(req.url())) requests.push(req.url())
  })
  await page.goto(pathToFileURL(path.join(directory, "view.html")).href)
  await page.getByRole("button", { name: "page: External consumer · unknown" }).waitFor()
  await page.goto("about:blank")
  await page.setContent('<main id="map"></main>')
  await page.addScriptTag({ content: result.outputFiles[0].text })
  const graph = JSON.parse(await readFile(path.join(directory, "graph.json"), "utf8"))
  await page.evaluate((graph) => {
    globalThis.handle = globalThis.mountWiki(document.getElementById("map"), graph)
  }, graph)
  assert.equal(await page.locator(".list button").count(), 2)
  await page.evaluate(() => globalThis.handle.dispose())
  assert.equal(await page.locator(".axwv").count(), 0)
  assert.deepEqual(errors, [])
  assert.deepEqual(requests, [])
  console.log(
    JSON.stringify({
      packedInstall: "passed",
      browserEntry: "passed",
      offlineExport: "passed",
      externalRequests: 0,
      wikiProductionDependencies: 0,
    }),
  )
} finally {
  await browser?.close()
  await rm(directory, { recursive: true, force: true })
}
