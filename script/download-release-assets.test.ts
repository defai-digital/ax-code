import { afterEach, expect, test } from "vitest"
import { createHash } from "node:crypto"
import http from "node:http"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { downloadReleaseAsset, parseReleaseDownloadAssets } from "./download-release-assets"

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

const payload = Buffer.from("published-runtime-content")
const sha = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`
const metadata = {
  name: "runtime.zip",
  size: payload.length,
  digest: sha(payload),
  browser_download_url: "https://github.com/acme/app/releases/download/v1.0.0/runtime.zip",
}
const parse = (assets: unknown[]) =>
  parseReleaseDownloadAssets(JSON.stringify({ tag_name: "v1.0.0", draft: false, assets }), "v1.0.0")

async function fixture(handler: http.RequestListener) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ax-release-download-test-"))
  const server = http.createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address() as { port: number }
  cleanups.push(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    await fs.rm(directory, { recursive: true, force: true })
  })
  return {
    directory,
    destination: path.join(directory, metadata.name),
    asset: { ...metadata, url: `http://127.0.0.1:${address.port}/runtime.zip` },
  }
}

function sendRange(req: http.IncomingMessage, res: http.ServerResponse, bytes = payload) {
  const match = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? "")!
  const start = Number(match[1])
  const end = Number(match[2])
  res.writeHead(206, { "Content-Range": `bytes ${start}-${end}/${bytes.length}` })
  res.end(bytes.subarray(start, end + 1))
}

test("validates published release metadata before downloading", () => {
  expect(parse([metadata])).toEqual([
    { name: metadata.name, size: payload.length, digest: metadata.digest, url: metadata.browser_download_url },
  ])
  expect(() => parseReleaseDownloadAssets("invalid", "v1.0.0")).toThrow()
  expect(() => parseReleaseDownloadAssets(JSON.stringify({ tag_name: "v2.0.0" }), "v1.0.0")).toThrow("wrong tag")
  expect(() =>
    parseReleaseDownloadAssets(JSON.stringify({ tag_name: "v1.0.0", draft: true, assets: [metadata] }), "v1.0.0"),
  ).toThrow("published")
  expect(() => parse([{ ...metadata, digest: null }])).toThrow("SHA-256")
  expect(() => parse([{ ...metadata, browser_download_url: "https://evil.example/file" }])).toThrow("origin")
  expect(() => parse([metadata, { ...metadata, name: "RUNTIME.ZIP" }])).toThrow("duplicate")
})

test.each(["../runtime.zip", "C:\\runtime.zip", "..", "CON.zip", "runtime.zip."])(
  "rejects unsafe filename %s",
  (name) => {
    expect(() => parse([{ ...metadata, name }])).toThrow("Unsafe")
  },
)

test("retries only the interrupted range and reuses the verified archive", async () => {
  const requests: string[] = []
  let interrupted = false
  const f = await fixture((req, res) => {
    requests.push(req.headers.range!)
    if (req.headers.range === "bytes=8-15" && !interrupted) {
      interrupted = true
      res.writeHead(206, { "Content-Range": `bytes 8-15/${payload.length}` })
      res.end(payload.subarray(8, 11))
      return
    }
    sendRange(req, res)
  })
  await downloadReleaseAsset(f.asset, f.directory, { chunkBytes: 8, retryDelayMs: 0 })
  expect(requests).toEqual(["bytes=0-7", "bytes=8-15", "bytes=8-15", "bytes=16-23", "bytes=24-24"])
  expect(await fs.readFile(f.destination)).toEqual(payload)
  await downloadReleaseAsset(f.asset, f.directory)
  expect(requests).toHaveLength(5)
  expect(await fs.readdir(f.directory)).toEqual([metadata.name])
})

test.each([429, 503])("recovers HTTP %s without replacing the previous file early", async (status) => {
  let calls = 0
  const f = await fixture((req, res) => {
    if (++calls === 1) return void res.writeHead(status).end("retry")
    sendRange(req, res)
  })
  await fs.writeFile(f.destination, "previous")
  await downloadReleaseAsset(f.asset, f.directory, { retryDelayMs: 0 })
  expect(calls).toBe(2)
  expect(await fs.readFile(f.destination)).toEqual(payload)
})

test.each([404, 503])("bounds HTTP %s failures and retains the previous archive", async (status) => {
  let calls = 0
  const f = await fixture((_req, res) => {
    calls++
    res.writeHead(status).end("unavailable")
  })
  await fs.writeFile(f.destination, "previous")
  await expect(downloadReleaseAsset(f.asset, f.directory, { retryDelayMs: 0 })).rejects.toThrow(`HTTP ${status}`)
  expect(calls).toBe(status === 404 ? 1 : 4)
  expect(await fs.readFile(f.destination, "utf8")).toBe("previous")
  expect(await fs.readdir(f.directory)).toEqual([metadata.name])
})

test.each(["wrong-range", "ignored-range", "oversized", "digest"])(
  "rejects %s without retry or installation",
  async (mode) => {
    let calls = 0
    const f = await fixture((req, res) => {
      calls++
      if (mode === "ignored-range") return void res.end(payload)
      if (mode === "digest") return sendRange(req, res, Buffer.alloc(payload.length, 120))
      res.writeHead(206, { "Content-Range": mode === "wrong-range" ? "bytes 1-8/25" : "bytes 0-7/25" })
      res.end(Buffer.alloc(9))
    })
    await expect(downloadReleaseAsset(f.asset, f.directory, { chunkBytes: 8, retryDelayMs: 0 })).rejects.toThrow()
    expect(calls).toBe(mode === "digest" ? 4 : 1)
    expect(await fs.readdir(f.directory)).toEqual([])
  },
)

test("times out stalled response bodies within the bounded retry budget", async () => {
  let calls = 0
  const f = await fixture((_req, res) => {
    calls++
    res.writeHead(206, { "Content-Range": `bytes 0-24/${payload.length}` })
    res.flushHeaders()
  })
  await expect(downloadReleaseAsset(f.asset, f.directory, { requestTimeoutMs: 50, retryDelayMs: 0 })).rejects.toThrow()
  expect(calls).toBe(4)
  expect(await fs.readdir(f.directory)).toEqual([])
})
