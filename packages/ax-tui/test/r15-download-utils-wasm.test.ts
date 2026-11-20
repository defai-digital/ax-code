import { createHash } from "node:crypto"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import { DownloadUtils } from "../src/lib/tree-sitter/download-utils.js"

const roots: string[] = []
const tmp = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ax-tui-r15-dl-"))
  roots.push(dir)
  return dir
}
afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const wasmBytes = Buffer.concat([Buffer.from([0x00, 0x61, 0x73, 0x6d]), Buffer.from("grammar payload")])
const cachePath = (dir: string, subdir: string, source: string, ext: string) =>
  path.join(dir, subdir, createHash("sha256").update(source).digest("hex") + ext)

describe("downloadOrLoad wasm validation", () => {
  test("rejects non-wasm downloads and does not poison the cache", async () => {
    const dir = await tmp()
    const source = "https://example.com/evil.wasm"
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>login page</html>")))
    const result = await DownloadUtils.downloadOrLoad(source, dir, "languages", ".wasm", true)
    expect(result.error).toBeDefined()
    expect(result.content).toBeUndefined()
    expect(await readdir(path.join(dir, "languages"))).toEqual([])
  })

  test("caches valid wasm bytes and reuses them without refetching", async () => {
    const dir = await tmp()
    const source = "https://example.com/good.wasm"
    const fetchMock = vi.fn(async () => new Response(wasmBytes))
    vi.stubGlobal("fetch", fetchMock)
    const first = await DownloadUtils.downloadOrLoad(source, dir, "languages", ".wasm", true)
    expect(first.error).toBeUndefined()
    expect(first.content).toEqual(wasmBytes)
    expect(first.filePath).toBe(cachePath(dir, "languages", source, ".wasm"))
    const second = await DownloadUtils.downloadOrLoad(source, dir, "languages", ".wasm", true)
    expect(second.content).toEqual(wasmBytes)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test("query downloads are not subject to the wasm magic check", async () => {
    const dir = await tmp()
    const source = "https://example.com/highlights.scm"
    vi.stubGlobal("fetch", vi.fn(async () => new Response("(comment) @comment")))
    const result = await DownloadUtils.downloadOrLoad(source, dir, "queries", ".scm", true)
    expect(result.error).toBeUndefined()
    expect(result.filePath).toBe(cachePath(dir, "queries", source, ".scm"))
  })
})
