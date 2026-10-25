import { mkdir, readdir } from "node:fs/promises"
import path from "node:path"
import z from "zod"
import {
  assertWikiDirectorySafe,
  atomicWrite,
  readCompilerConfig,
  resolveInside,
  sanitizeWikiDir,
  sha256,
  stableJson,
} from "@ax-code/ax-wiki/node"
import { parseJsonStrict } from "../util/json-value"
import { Log } from "../util/log"

export type WikiEmbeddingRankCache = {
  read(page: string, key: string): Promise<string[] | undefined>
  write(page: string, key: string, order: string[]): Promise<void>
}

const Receipt = z.object({
  schemaVersion: z.literal(1),
  page: z.string(),
  key: z.string(),
  order: z.array(z.string().max(4096)).max(200),
  checksum: z.string(),
})
const MAX_BYTES = 128 * 1024
const MAX_ENTRIES = 128

/** One bounded, atomic receipt per page. Contains paths, never source text or vectors. */
export function createWikiEmbeddingRankCache(input: {
  root: string
  wikiDir: string
  signal?: AbortSignal
  allowRead?: (relative: string) => boolean
  allowWrite?: (relative: string) => boolean
}): WikiEmbeddingRankCache {
  const directory = path.posix.join(sanitizeWikiDir(input.wikiDir), ".embedding-cache")
  const slot = (page: string) => path.posix.join(directory, `${sha256(page)}.json`)
  const report = () => Log.Default.debug("Wiki embedding ranking cache unavailable")
  return {
    async read(page, key) {
      try {
        input.signal?.throwIfAborted()
        const relative = slot(page)
        if (input.allowRead?.(relative) === false) return undefined
        await assertWikiDirectorySafe(input.root, directory)
        const receipt = Receipt.parse(
          parseJsonStrict(await readCompilerConfig(resolveInside(input.root, relative), MAX_BYTES)),
        )
        input.signal?.throwIfAborted()
        if (receipt.page !== page || receipt.key !== key || receipt.checksum !== sha256(stableJson(receipt.order)))
          return undefined
        return receipt.order
      } catch {
        input.signal?.throwIfAborted()
        return undefined
      }
    },
    async write(page, key, order) {
      try {
        input.signal?.throwIfAborted()
        const relative = slot(page)
        if (input.allowWrite?.(relative) === false || input.allowRead?.(directory) === false) return
        const receipt = Receipt.parse({ schemaVersion: 1, page, key, order, checksum: sha256(stableJson(order)) })
        const content = JSON.stringify(receipt) + "\n"
        if (Buffer.byteLength(content) > MAX_BYTES) return
        await assertWikiDirectorySafe(input.root, directory)
        const absolute = resolveInside(input.root, directory)
        await mkdir(absolute, { recursive: true })
        await assertWikiDirectorySafe(input.root, directory)
        const entries = (await readdir(absolute)).filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
        if (entries.length >= MAX_ENTRIES && !entries.includes(path.posix.basename(relative))) return
        input.signal?.throwIfAborted()
        await atomicWrite(resolveInside(input.root, relative), content)
      } catch {
        input.signal?.throwIfAborted()
        report()
      }
    },
  }
}
