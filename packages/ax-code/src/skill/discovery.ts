import { createHash } from "crypto"
import { rm } from "fs/promises"
import path from "path"
import z from "zod"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { parseJsonStrict } from "../util/json-value"
import { Log } from "../util/log"
import { Ssrf } from "../util/ssrf"

export namespace Discovery {
  const log = Log.create({ service: "skill-discovery" })
  const skillConcurrency = 4
  const fileConcurrency = 8
  const MAX_SKILL_FILE_BYTES = 1024 * 1024
  const SKILL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
  const SHA256_PATTERN = /^[a-f0-9]{64}$/i

  class DiscoveryError extends Error {
    override readonly name = "SkillDiscoveryError"

    constructor(message: string, options?: { cause?: unknown }) {
      super(message, { cause: options?.cause })
      this.name = "SkillDiscoveryError"
    }
  }

  const asDiscoveryError = (message: string, cause?: unknown) => new DiscoveryError(message, { cause })

  const IndexSkillFile = z.object({
    path: z.string(),
    sha256: z.string().optional(),
  })

  type IndexSkillFile = z.infer<typeof IndexSkillFile>

  const IndexSkillFileEntry = z.union([z.string(), IndexSkillFile])

  const IndexSkill = z.object({
    name: z.string(),
    files: z.array(IndexSkillFileEntry),
  })

  const Index = z.object({
    skills: z.array(IndexSkill),
  })

  export type IndexData = z.infer<typeof Index>

  export function decodeIndexValue(value: unknown): IndexData {
    return Index.parse(value)
  }

  export function parseIndexText(text: string): IndexData {
    return decodeIndexValue(parseJsonStrict(text))
  }

  async function mapWithConcurrency<T, R>(
    items: readonly T[],
    concurrency: number,
    mapper: (item: T) => Promise<R>,
  ): Promise<R[]> {
    const result = new Array<R>(items.length)
    let next = 0
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const index = next++
        result[index] = await mapper(items[index])
      }
    })
    await Promise.all(workers)
    return result
  }

  const isExternalFileReference = (file: string) => /^[A-Za-z][A-Za-z0-9+.-]*:/.test(file) || file.startsWith("//")

  const normalizeFile = (file: string | IndexSkillFile) =>
    typeof file === "string" ? { path: file, sha256: undefined } : file

  const verifyFile = (body: ArrayBuffer | Uint8Array, expectedSha256: string | undefined, source: string) => {
    const buffer = Buffer.from(body instanceof ArrayBuffer ? new Uint8Array(body) : body)
    if (buffer.byteLength > MAX_SKILL_FILE_BYTES) {
      throw asDiscoveryError(`skill-discovery: ${source} exceeds ${MAX_SKILL_FILE_BYTES} bytes`)
    }
    if (!expectedSha256) return buffer
    const expected = expectedSha256.toLowerCase()
    if (!SHA256_PATTERN.test(expected)) {
      throw asDiscoveryError(`skill-discovery: invalid sha256 for ${source}`)
    }
    const actual = createHash("sha256").update(buffer).digest("hex")
    if (actual !== expected) {
      throw asDiscoveryError(`skill-discovery: sha256 mismatch for ${source}`)
    }
    return buffer
  }

  const verifyCachedFile = (body: Uint8Array, expectedSha256: string, source: string) => {
    try {
      verifyFile(body, expectedSha256, source)
      return true
    } catch (err) {
      log.warn("cached skill file failed integrity check", { source, err })
      return false
    }
  }

  async function fetchArrayBuffer(url: string, init?: RequestInit) {
    try {
      const res = await Ssrf.pinnedFetch(url, { ...init, label: "skill-discovery" })
      if (!res.ok) throw asDiscoveryError(`skill-discovery: fetch failed for ${url}: HTTP ${res.status}`)
      return res.arrayBuffer()
    } catch (err) {
      if (err instanceof DiscoveryError) throw err
      throw asDiscoveryError(`skill-discovery: fetch failed for ${url}`, err)
    }
  }

  async function download(url: string, dest: string, expectedSha256?: string) {
    try {
      if (await Filesystem.exists(dest)) {
        if (!expectedSha256) return true

        const cached = await Filesystem.readBytes(dest).catch(() => undefined)
        if (cached && verifyCachedFile(cached, expectedSha256, dest)) {
          return true
        }
        if (cached) await rm(dest, { force: true }).catch(() => undefined)
      }

      const body = await fetchArrayBuffer(url)
      const verified = verifyFile(body, expectedSha256, url)
      await Filesystem.write(dest, verified)
      return true
    } catch (err) {
      log.error("failed to download", { url, err })
      return false
    }
  }

  export async function pull(url: string): Promise<string[]> {
    const base = url.endsWith("/") ? url : `${url}/`
    const index = new URL("index.json", base).href
    const host = base.slice(0, -1)
    const cache = path.join(Global.Path.cache, "skills")

    log.info("fetching index", { url: index })

    const data = await fetchArrayBuffer(index, { headers: { Accept: "application/json" } })
      .then((body) => parseIndexText(Buffer.from(body).toString("utf8")))
      .catch((err) => {
        log.error("failed to fetch index", { url: index, err })
        return null
      })

    if (!data) return []

    const list = data.skills.filter((skill) => {
      if (!SKILL_NAME_PATTERN.test(skill.name)) {
        log.warn("skill entry has unsafe name", { url: index, skill: skill.name })
        return false
      }
      const files = skill.files.map(normalizeFile)
      if (!files.some((file) => file.path === "SKILL.md")) {
        log.warn("skill entry missing SKILL.md", { url: index, skill: skill.name })
        return false
      }
      const hashless = files.find((file) => !file.sha256)
      if (hashless) {
        log.warn("skill entry missing sha256", { url: index, skill: skill.name, file: hashless.path })
        return false
      }
      const invalidHash = files.find((file) => file.sha256 && !SHA256_PATTERN.test(file.sha256))
      if (invalidHash) {
        log.warn("skill entry has invalid sha256", { url: index, skill: skill.name, file: invalidHash.path })
        return false
      }
      return true
    })

    const dirs = await mapWithConcurrency(list, skillConcurrency, async (skill) => {
      const files = skill.files.map(normalizeFile)
      const cacheRoot = path.resolve(cache)
      const root = path.resolve(cache, skill.name)
      const rootPrefix = root + path.sep
      const cachePrefix = cacheRoot + path.sep
      if (root !== cacheRoot && !rootPrefix.startsWith(cachePrefix)) {
        log.warn("skill entry escapes cache root", { url: index, skill: skill.name, root })
        return null
      }

      const safeFiles = files.filter((file) => {
        if (isExternalFileReference(file.path)) {
          log.warn("skill entry has external file reference", { url: index, skill: skill.name, file })
          return false
        }
        if (file.sha256 && !SHA256_PATTERN.test(file.sha256)) {
          log.warn("skill entry has invalid sha256", { url: index, skill: skill.name, file })
          return false
        }
        const resolved = path.resolve(root, file.path)
        return (resolved + path.sep).startsWith(rootPrefix)
      })

      const downloads = await mapWithConcurrency(safeFiles, fileConcurrency, (file) =>
        download(new URL(file.path, `${host}/${skill.name}/`).href, path.join(root, file.path), file.sha256),
      )
      if (!downloads.every(Boolean)) return null

      const md = path.join(root, "SKILL.md")
      return (await Filesystem.exists(md)) ? root : null
    })

    return dirs.filter((dir): dir is string => dir !== null)
  }
}
