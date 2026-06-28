import { expect, test } from "vitest"
import path from "path"
import { readFile } from "node:fs/promises"

test("cache version cleanup creates the cache directory before reading it", async () => {
  const src = await readFile(path.join(import.meta.dirname, "../../src/global/index.ts"), "utf-8")
  const cleanup = src.slice(src.indexOf("const CACHE_VERSION"), src.indexOf("// Sweep trash"))

  expect(cleanup.indexOf("await fs.mkdir(Global.Path.cache, { recursive: true })")).toBeGreaterThan(-1)
  expect(cleanup.indexOf("await fs.mkdir(Global.Path.cache, { recursive: true })")).toBeLessThan(
    cleanup.indexOf("await fs.readdir(Global.Path.cache)"),
  )
})
