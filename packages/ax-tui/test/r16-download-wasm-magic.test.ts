import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, expect, test, vi } from "vitest"
import { DownloadUtils } from "../src/lib/tree-sitter/download-utils.js"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// downloadOrLoad rejects non-wasm bodies before caching; downloadToPath must
// apply the same magic check before writing, or an HTML error page replaces a
// working grammar on disk.
test("downloadToPath rejects a non-wasm body for a .wasm target without writing it", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ax-tui-wasm-magic-"))
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.stubGlobal("fetch", async () => new Response("<html>not found</html>"))
  try {
    const result = await DownloadUtils.downloadToPath("https://example.test/parser.wasm", path.join(directory, "parser.wasm"))
    expect(result.error).toMatch(/not a valid wasm module/i)
    expect(result.filePath).toBeUndefined()
    expect(await readdir(directory)).toEqual([])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("downloadToPath keeps an existing .wasm target when the body is not wasm", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ax-tui-wasm-magic-"))
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.stubGlobal("fetch", async () => new Response("<html>not found</html>"))
  try {
    const target = path.join(directory, "parser.wasm")
    await writeFile(target, "existing grammar")
    const result = await DownloadUtils.downloadToPath("https://example.test/parser.wasm", target)
    expect(result.error).toMatch(/not a valid wasm module/i)
    expect(await readFile(target, "utf8")).toBe("existing grammar")
    expect(await readdir(directory)).toEqual(["parser.wasm"])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("downloadToPath accepts a body with the wasm magic header", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ax-tui-wasm-magic-"))
  vi.spyOn(console, "log").mockImplementation(() => {})
  const wasmBytes = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])
  vi.stubGlobal("fetch", async () => new Response(wasmBytes))
  try {
    const target = path.join(directory, "parser.wasm")
    const result = await DownloadUtils.downloadToPath("https://example.test/parser.wasm", target)
    expect(result.error).toBeUndefined()
    expect(result.filePath).toBe(target)
    expect(await readFile(target)).toEqual(wasmBytes)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("downloadToPath leaves non-wasm targets untouched by the magic check", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ax-tui-wasm-magic-"))
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.stubGlobal("fetch", async () => new Response("(identifier) @variable"))
  try {
    const target = path.join(directory, "highlights.scm")
    const result = await DownloadUtils.downloadToPath("https://example.test/highlights.scm", target)
    expect(result.error).toBeUndefined()
    expect(result.filePath).toBe(target)
    expect(await readFile(target, "utf8")).toBe("(identifier) @variable")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
