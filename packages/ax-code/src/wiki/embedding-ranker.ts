import { readFilePrefix, type WikiSourceRanker } from "@ax-code/ax-wiki/node"
import { Log } from "../util/log"
import {
  openWikiEmbeddingWorker,
  WIKI_EMBEDDING_MODEL,
  WikiEmbeddingCleanupError,
  type WikiEmbeddingWorker,
} from "./embedding-worker"

const PROFILE = `${WIKI_EMBEDDING_MODEL.repo}@${WIKI_EMBEDDING_MODEL.revision}:last:l2:1024:prefix1024:rank-v1`
const MAX_SOURCES = 128

/** Rank only optional evidence, preserving membership and the entrypoint/test prefix. */
export function createIdleWikiSourceRanker(
  input: {
    root: string
    signal?: AbortSignal
    allowSource?: (relative: string) => boolean
  },
  runtime: {
    open?: (signal: AbortSignal) => Promise<WikiEmbeddingWorker | undefined>
    read?: typeof readFilePrefix
    timeoutMs?: number
  } = {},
): WikiSourceRanker {
  return {
    identity: PROFILE,
    async rank(pages) {
      const eligible = pages.filter(
        ({ page, sources }) =>
          sources.length > (page.kind === "module" ? 4 : 2) &&
          sources.every((source) => input.allowSource?.(source.path) !== false),
      )
      if (!eligible.length) return new Map()
      const timeout = new AbortController()
      const timer = setTimeout(
        () => timeout.abort(new Error("Wiki embedding budget exceeded")),
        runtime.timeoutMs ?? 120_000,
      )
      const signal = input.signal ? AbortSignal.any([input.signal, timeout.signal]) : timeout.signal
      let worker: WikiEmbeddingWorker | undefined
      try {
        signal.throwIfAborted()
        worker = await (runtime.open ?? openWikiEmbeddingWorker)(signal)
        if (!worker) return new Map()
        const cache = new Map<string, number[]>()
        const orders = new Map<string, string[]>()
        for (const { page, sources } of eligible) {
          signal.throwIfAborted()
          if (sources.some((source) => input.allowSource?.(source.path) === false)) continue
          const protectedCount = page.kind === "module" ? 3 : 1
          const optional = sources.slice(protectedCount)
          const missing = optional.filter((source) => !cache.has(source.path))
          if (cache.size + missing.length > MAX_SOURCES) continue
          for (let offset = 0; offset < missing.length; offset += 4) {
            signal.throwIfAborted()
            const batch = missing.slice(offset, offset + 4)
            const texts = await Promise.all(
              batch.map(async (source) => {
                const content = await (runtime.read ?? readFilePrefix)(input.root, source.path, 1024)
                if (content === undefined) throw new Error("Wiki embedding source unavailable")
                return `${source.path.slice(0, 256)}\n${content}`
              }),
            )
            const vectors = await worker.embed(texts)
            batch.forEach((source, index) => cache.set(source.path, vectors[index]))
          }
          const [query] = await worker.embed([
            `Instruct: Retrieve repository source files that explain the requested architecture or development topic.\nQuery: ${page.title.slice(0, 200)} ${page.purpose.slice(0, 600)}`,
          ])
          const ranked = optional
            .map((source, index) => ({
              source,
              index,
              score: cache.get(source.path)!.reduce((sum, v, i) => sum + v * query[i], 0),
            }))
            .sort((a, b) => b.score - a.score || a.index - b.index)
          orders.set(
            page.path,
            [...sources.slice(0, protectedCount), ...ranked.map((row) => row.source)].map((source) => source.path),
          )
        }
        signal.throwIfAborted()
        return orders
      } catch (error) {
        if (WikiEmbeddingCleanupError.isInstance(error)) throw error
        input.signal?.throwIfAborted()
        Log.Default.info("Wiki local embedding ranking unavailable; using deterministic evidence")
        return new Map()
      } finally {
        clearTimeout(timer)
        await worker?.close()
      }
    },
  }
}
