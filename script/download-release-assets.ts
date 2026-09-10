import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { lstat, mkdir, mkdtemp, open, rename, rm } from "node:fs/promises"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { parseJsonStrict } from "../packages/ax-code/src/util/json-value"

export type ReleaseDownloadAsset = { name: string; size: number; digest: string; url: string }

export function parseReleaseDownloadAssets(json: string, tag: string): ReleaseDownloadAsset[] {
  const release = parseJsonStrict(json)
  if (!release || typeof release !== "object" || !("tag_name" in release) || release.tag_name !== tag)
    throw new Error("Release download metadata has the wrong tag")
  if (!("draft" in release) || release.draft !== false || !("assets" in release) || !Array.isArray(release.assets))
    throw new Error("Release download requires published assets")
  if (release.assets.length === 0 || release.assets.length > 256) throw new Error("Invalid release asset count")
  const names = new Set<string>()
  return release.assets.map((asset: Record<string, unknown>) => {
    const { name, size, digest, browser_download_url: url } = asset ?? {}
    if (
      typeof name !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,200}$/.test(name) ||
      name.endsWith(".") ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ||
      names.has(name.toLowerCase())
    )
      throw new Error("Unsafe or duplicate release asset name")
    names.add(name.toLowerCase())
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 1 || size > 2 ** 31)
      throw new Error(`Invalid release asset size: ${name}`)
    if (typeof digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(digest))
      throw new Error(`Missing release asset SHA-256: ${name}`)
    if (typeof url !== "string") throw new Error(`Missing release download URL: ${name}`)
    const parsed = new URL(url)
    if (parsed.origin !== "https://github.com" || parsed.username || parsed.password)
      throw new Error(`Invalid release download origin: ${name}`)
    return { name, size, digest, url }
  })
}

async function digest(file: string) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return `sha256:${hash.digest("hex")}`
}

class RetryableDownloadError extends Error {}

export async function downloadReleaseAsset(
  asset: ReleaseDownloadAsset,
  directory: string,
  options: { chunkBytes?: number; requestTimeoutMs?: number; deadlineMs?: number; retryDelayMs?: number } = {},
) {
  const chunkBytes = options.chunkBytes ?? 2 * 1024 * 1024
  const requestTimeoutMs = options.requestTimeoutMs ?? 30_000
  const deadline = AbortSignal.timeout(options.deadlineMs ?? 600_000)
  await mkdir(directory, { recursive: true })
  const destination = path.join(directory, asset.name)
  const existing = await lstat(destination).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error
  })
  if (existing && !existing.isFile()) throw new Error(`Release destination is not a regular file: ${asset.name}`)
  if (existing?.size === asset.size && (await digest(destination)) === asset.digest) return

  const temporary = await mkdtemp(path.join(directory, ".ax-release-download-"))
  const candidate = path.join(temporary, "asset")
  try {
    const file = await open(candidate, "wx")
    try {
      for (let start = 0; start < asset.size; start += chunkBytes) {
        const end = Math.min(start + chunkBytes, asset.size) - 1
        for (let attempt = 0; ; attempt++) {
          deadline.throwIfAborted()
          const signal = AbortSignal.any([deadline, AbortSignal.timeout(requestTimeoutMs)])
          let response: Response | undefined
          try {
            response = await fetch(asset.url, {
              headers: { Range: `bytes=${start}-${end}`, "Accept-Encoding": "identity" },
              signal,
            })
            if ([408, 429, 500, 502, 503, 504].includes(response.status))
              throw new RetryableDownloadError(`HTTP ${response.status}`)
            const entireSmallFile = response.status === 200 && start === 0 && end === asset.size - 1
            if (!entireSmallFile && response.status !== 206) throw new Error(`Unexpected HTTP ${response.status}`)
            if (!entireSmallFile && response.headers.get("content-range") !== `bytes ${start}-${end}/${asset.size}`)
              throw new Error("Invalid release asset Content-Range")
            if (!response.body) throw new RetryableDownloadError("Release download had no body")
            const reader = response.body.getReader()
            const chunks: Uint8Array[] = []
            let bytes = 0
            try {
              while (true) {
                const next = await reader.read()
                if (next.done) break
                bytes += next.value.length
                if (bytes > end - start + 1) throw new Error("Release download exceeded the requested range")
                chunks.push(next.value)
              }
            } finally {
              await reader.cancel().catch(() => {})
              reader.releaseLock()
            }
            if (bytes !== end - start + 1) throw new RetryableDownloadError("Release download was truncated")
            await file.writeFile(Buffer.concat(chunks))
            break
          } catch (error) {
            await response?.body?.cancel().catch(() => {})
            if (
              deadline.aborted ||
              attempt >= 3 ||
              !(error instanceof RetryableDownloadError || error instanceof TypeError || signal.aborted)
            )
              throw error
            await delay(options.retryDelayMs ?? 1_000, undefined, { signal: deadline })
          }
        }
      }
    } finally {
      await file.close()
    }
    if ((await digest(candidate)) !== asset.digest) throw new Error(`Release asset SHA-256 mismatch: ${asset.name}`)
    // Keep any previous file intact until the entire replacement is verified.
    await rename(candidate, destination)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

export async function downloadVerifiedReleaseAssets(assets: ReleaseDownloadAsset[], directory: string) {
  let next = 0
  const workers = Array.from({ length: Math.min(3, assets.length) }, async () => {
    while (next < assets.length) {
      const asset = assets[next++]
      await downloadReleaseAsset(asset, directory)
      console.log(`Verified download: ${asset.name}`)
    }
  })
  const settled = await Promise.allSettled(workers)
  const failed = settled.find((result) => result.status === "rejected")
  if (failed?.status === "rejected") throw failed.reason
}
