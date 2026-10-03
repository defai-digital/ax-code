import { mkdir, readdir, rm } from "node:fs/promises"
import path from "node:path"
import { atomicWrite, readCompilerConfig } from "./build.js"
import { sha256, stableJson } from "./hash.js"
import { resolveInside, sanitizeWikiDir } from "./paths.js"
import { assertWikiDirectorySafe } from "./safety.js"
import type { WikiPageGenerationResult, WikiPageResultCache } from "./types.js"

const MAX_BYTES = 1024 * 1024
const MAX_ENTRIES = 128

function validResult(value: unknown): value is WikiPageGenerationResult {
  if (!value || typeof value !== "object") return false
  const item = value as Record<string, unknown>
  return (
    typeof item.summary === "string" &&
    item.summary.trim().length > 0 &&
    typeof item.body === "string" &&
    item.body.trim().length >= 80 &&
    (item.symbols === undefined ||
      (Array.isArray(item.symbols) && item.symbols.every((symbol) => typeof symbol === "string"))) &&
    (item.symbolSummaries === undefined ||
      (Array.isArray(item.symbolSummaries) &&
        item.symbolSummaries.every(
          (gloss) =>
            gloss && typeof gloss === "object" && typeof gloss.name === "string" && typeof gloss.summary === "string",
        )))
  )
}

/** Bounded, permission-gated staging. Errors are cache misses, never publication failures. */
export function createWikiPageResultCache(input: {
  root: string
  wikiDir?: string
  allowRead?: (relative: string) => boolean
  allowWrite?: (relative: string) => boolean
  onError?: (error: unknown) => void
}): WikiPageResultCache {
  const directory = path.posix.join(sanitizeWikiDir(input.wikiDir), ".page-cache")
  const slot = (page: string) => path.posix.join(directory, `${sha256(page)}.json`)
  const safe = () => assertWikiDirectorySafe(input.root, directory)
  const report = (error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return
    try {
      input.onError?.(error)
    } catch {
      // Diagnostics cannot turn optional staging into a publication failure.
    }
  }
  const read = async (page: string, key: string): Promise<WikiPageGenerationResult | undefined> => {
    const relative = slot(page)
    try {
      // Permission callbacks are host code: a throw is a cache miss, never a
      // publication failure, so every gate sits inside the try.
      if (input.allowRead?.(relative) === false) return undefined
      await safe()
      const value: unknown = JSON.parse(await readCompilerConfig(resolveInside(input.root, relative), MAX_BYTES))
      if (!value || typeof value !== "object") return undefined
      const entry = value as Record<string, unknown>
      if (entry.schemaVersion !== 1 || entry.key !== key || entry.page !== page || !validResult(entry.result))
        return undefined
      if (entry.resultHash !== sha256(stableJson(entry.result))) return undefined
      return entry.result
    } catch (error) {
      report(error)
      return undefined
    }
  }
  let writes = Promise.resolve()
  return {
    read,
    write(page, key, result) {
      const pending = writes.then(async () => {
        const relative = slot(page)
        try {
          if (input.allowWrite?.(relative) === false || input.allowRead?.(directory) === false) return
          const content =
            JSON.stringify({ schemaVersion: 1, page, key, resultHash: sha256(stableJson(result)), result }) + "\n"
          if (Buffer.byteLength(content) > MAX_BYTES || !validResult(result)) return
          await safe()
          const absoluteDirectory = resolveInside(input.root, directory)
          await mkdir(absoluteDirectory, { recursive: true })
          await safe()
          const files = (await readdir(absoluteDirectory)).filter((file) => /^[a-f0-9]{64}\.json$/.test(file))
          if (files.length >= MAX_ENTRIES && !files.includes(path.posix.basename(relative))) return
          await atomicWrite(resolveInside(input.root, relative), content)
        } catch (error) {
          report(error)
        }
      })
      writes = pending.catch(() => {})
      return pending
    },
    remove(page, key) {
      // Chain onto the write queue so a pending write cannot resurrect an entry
      // after remove deletes it, and remove cannot delete a freshly staged one.
      const pending = writes.then(async () => {
        const relative = slot(page)
        try {
          if (input.allowWrite?.(relative) === false) return
          // The caller's full-pipeline lock excludes concurrent replacement;
          // the key check also preserves entries from a different generation.
          if (!(await read(page, key))) return
          await safe()
          await rm(resolveInside(input.root, relative), { force: true })
        } catch (error) {
          report(error)
        }
      })
      writes = pending.catch(() => {})
      return pending
    },
  }
}
