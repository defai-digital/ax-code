import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, expect, test, vi } from "vitest"
import { DownloadUtils } from "../src/lib/tree-sitter/download-utils.js"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test.each(["http://example.test/parser", "https://user:private-password@example.test/parser"])(
  "rejects an invalid grammar URL before using cached bytes: %s",
  async (source) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ax-tui-download-"))
    const fetcher = vi.fn()
    vi.stubGlobal("fetch", fetcher)
    vi.spyOn(console, "log").mockImplementation(() => {})
    try {
      await mkdir(path.join(directory, "queries"))
      const filename = createHash("sha256").update(source).digest("hex") + ".scm"
      await writeFile(path.join(directory, "queries", filename), "cached parser")
      const cached = await DownloadUtils.downloadOrLoad(source, directory, "queries", ".scm")
      expect(cached.error).toMatch(/https|credentials/i)
      expect(cached.content).toBeUndefined()
      const direct = await DownloadUtils.downloadToPath(source, path.join(directory, "parser.wasm"))
      expect(direct.error).toMatch(/https|credentials/i)
      expect(JSON.stringify([cached, direct])).not.toContain("private-password")
      expect(fetcher).not.toHaveBeenCalled()
      expect(console.log).not.toHaveBeenCalled()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)

test("different URLs with the same legacy hash never reuse each other's parser bytes", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ax-tui-download-"))
  vi.spyOn(console, "log").mockImplementation(() => {})
  const fetcher = vi.fn(async (url: string) => new Response(url.endsWith("Aa") ? "first" : "second"))
  vi.stubGlobal("fetch", fetcher)
  try {
    const a = await DownloadUtils.downloadOrLoad("https://example.test/Aa", directory, "queries", ".scm")
    const b = await DownloadUtils.downloadOrLoad("https://example.test/BB", directory, "queries", ".scm")
    expect(a.content?.toString()).toBe("first")
    expect(b.content?.toString()).toBe("second")
    expect(a.filePath).not.toBe(b.filePath)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(await readFile(b.filePath!, "utf8")).toBe("second")
    await DownloadUtils.downloadOrLoad("https://example.test/BB", directory, "queries", ".scm")
    expect(fetcher).toHaveBeenCalledTimes(2)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("empty and oversized parser downloads fail without replacing an existing target", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ax-tui-download-"))
  vi.spyOn(console, "log").mockImplementation(() => {})
  const target = path.join(directory, "parser.wasm")
  await writeFile(target, "existing grammar")
  try {
    vi.stubGlobal("fetch", async () => new Response(""))
    expect(
      (await DownloadUtils.downloadToPath("https://example.test/parser", path.join(directory, "parser.wasm"))).error,
    ).toMatch(/empty/i)
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response("x", {
          headers: { "content-length": String(65 * 1024 * 1024) },
        }),
    )
    expect(
      (await DownloadUtils.downloadToPath("https://example.test/parser", path.join(directory, "parser.wasm"))).error,
    ).toMatch(/size limit/i)
    expect(await readFile(target, "utf8")).toBe("existing grammar")
    expect(await readdir(directory)).toEqual(["parser.wasm"])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("unadvertised oversized streams are cancelled and leave no partial files", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ax-tui-download-"))
  const cancel = vi.fn()
  const chunk = new Uint8Array(1024 * 1024)
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(chunk)
          },
          cancel,
        }),
      ),
  )
  try {
    const result = await DownloadUtils.downloadToPath(
      "https://example.test/parser",
      path.join(directory, "parser.wasm"),
    )
    expect(result.error).toMatch(/size limit/i)
    expect(cancel).toHaveBeenCalledOnce()
    expect(await readdir(directory)).toEqual([])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
