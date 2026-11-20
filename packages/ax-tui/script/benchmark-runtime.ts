import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

// A package entry may live in a subdirectory (for example `dist/index.js`), so the
// manifest is the nearest `package.json` above the entry, not necessarily its sibling.
const readPackageVersion = (entryPath: string): string => {
  let currentDir = dirname(entryPath)
  while (true) {
    const packageJsonPath = join(currentDir, "package.json")
    if (existsSync(packageJsonPath)) {
      const { version, name } = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
        version?: unknown
        name?: unknown
      }
      // A manifest with neither version nor name is an ESM scope marker
      // (`{"type":"module"}`), not a package manifest; keep walking up.
      if (version !== undefined || name !== undefined) {
        if (typeof version !== "string") {
          throw new Error(`package.json at ${packageJsonPath} has no string version`)
        }
        return version
      }
    }
    const parentDir = dirname(currentDir)
    if (parentDir === currentDir) {
      throw new Error(`No package.json found above ${entryPath}`)
    }
    currentDir = parentDir
  }
}

// One fresh process per package/sample. Both packages use the same public APIs,
// runtime, geometry, content and assertions. No code from the reference is copied.
export async function benchmarkRuntime(directory: string, packageName: string) {
  assert.ok(process.execArgv.includes("--experimental-import-meta-resolve"), "Pass --experimental-import-meta-resolve")
  const parent = pathToFileURL(join(resolve(directory), "package.json")).href
  const entry = import.meta.resolve(packageName, parent)
  const testing = import.meta.resolve(`${packageName}/testing`, parent)
  const { TextRenderable } = await import(entry)
  const { createTestRenderer } = await import(testing)
  const version = readPackageVersion(fileURLToPath(entry))
  const results: { workload: string, msPerOperation: number, iterations: number, frames: number }[] = []
  for (const unicode of [false, true]) {
    const setup = await createTestRenderer({ width: 120, height: 40, useThread: false,
      maxFps: 1000000, useKittyKeyboard: null, consoleMode: "disabled", bufferedOutput: "memory" })
    const { renderer } = setup
    const suffix = unicode ? "中文 cafe\u0301 😀 " : "the quick brown fox "
    const content = (row: number, tick: number) => `ROW-${String(row).padStart(2, "0")} T${tick} ${suffix.repeat(4)}`
    const rows = Array.from({ length: 40 }, (_, row) => new TextRenderable(renderer, {
      height: 1, width: 120, content: content(row, 0),
    }))
    try {
      rows.forEach(row => renderer.root.add(row))
      await setup.renderOnce()
      await renderer.idle()
      // The timing loop excludes assertions; validate the same observable output
      // before and after it, so a skipped render/capture cannot appear faster.
      const verify = () => {
        const lines = renderer.currentRenderBuffer.getSpanLines()
        assert.equal(lines.length, 40)
        for (let row = 0; row < 40; row++) {
          const text = lines[row].spans.map((span: { text: string }) => span.text).join("")
          assert.ok(text.startsWith(`ROW-${String(row).padStart(2, "0")} `), `Missing rendered row ${row}: ${text}`)
          assert.ok(text.includes(unicode ? "中文 cafe\u0301 😀" : "the quick brown fox"), `Corrupted row ${row}: ${text}`)
        }
      }
      verify()
      let checksum = 0
      const capture = () => { checksum += renderer.currentRenderBuffer.getSpanLines().length }
      for (let warmup = 0; warmup < 100; warmup++) capture()
      const iterations = 500
      const before = performance.now()
      for (let iteration = 0; iteration < iterations; iteration++) capture()
      const elapsed = performance.now() - before
      assert.equal(checksum, (100 + iterations) * 40)
      verify()
      results.push({ workload: unicode ? "capture-unicode-120x40" : "capture-ascii-120x40",
        msPerOperation: elapsed / iterations, iterations, frames: 0 })
      if (!unicode) {
        const update = async (tick: number) => {
          for (let row = 0; row < 10; row++) rows[row].content = content(row, tick)
          await renderer.idle()
        }
        for (let warmup = 0; warmup < 50; warmup++) await update(warmup)
        const frameStart = renderer.frameId
        const start = performance.now()
        for (let iteration = 0; iteration < 200; iteration++) await update(1000 + iteration)
        const msPerOperation = (performance.now() - start) / 200
        const frames = renderer.frameId - frameStart
        assert.ok(frames >= 200, "Updates did not produce completed frames")
        verify()
        assert.ok(setup.captureCharFrame().includes("T1199"), "Final update never painted")
        results.push({ workload: "update-10-of-40-text-rows-120x40", msPerOperation, iterations: 200, frames })
      }
    } finally {
      if (setup.dispose) await setup.dispose()
      else renderer.destroy()
    }
  }
  return { packageName, version, node: process.version, results }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await benchmarkRuntime(process.argv[2], process.argv[3])))
}
