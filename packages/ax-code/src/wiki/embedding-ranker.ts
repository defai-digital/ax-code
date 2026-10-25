import {
  readFilePrefix,
  isWikiSourceOrder,
  wikiSourcePrefixLength,
  sha256,
  stableJson,
  type WikiSourceRanker,
} from "@ax-code/ax-wiki/node"
import { Log } from "../util/log"
import {
  openWikiEmbeddingWorker,
  canUseWikiEmbeddings,
  WIKI_EMBEDDING_MODEL,
  WikiEmbeddingCleanupError,
  type WikiEmbeddingWorker,
} from "./embedding-worker"

import { createWikiEmbeddingRankCache, type WikiEmbeddingRankCache } from "./embedding-cache"

const PROFILE = `${WIKI_EMBEDDING_MODEL.repo}@${WIKI_EMBEDDING_MODEL.revision}:${sha256(stableJson(WIKI_EMBEDDING_MODEL.files))}:last:l2:1024:prefix1024:rank-v3`
const MAX_SOURCES = 128

/** Rank only optional evidence, preserving membership and the entrypoint/test prefix. */
export function createIdleWikiSourceRanker(
  input: {
    root: string
    wikiDir?: string
    allowWrite?: (relative: string) => boolean
    signal?: AbortSignal
    allowSource?: (relative: string) => boolean
  },
  runtime: {
    available?: typeof canUseWikiEmbeddings
    open?: (signal: AbortSignal) => Promise<WikiEmbeddingWorker | undefined>
    read?: typeof readFilePrefix
    timeoutMs?: number
    cache?: WikiEmbeddingRankCache
  } = {},
): WikiSourceRanker {
  return {
    identity: PROFILE,
    async rank(pages, options = { maxTotalBytes: 160_000 }) {
      input.signal?.throwIfAborted()
      const maxBytes = Math.max(1, options.maxTotalBytes)
      const eligible = pages.filter(({ page, sources }) => {
        const prefix = wikiSourcePrefixLength(page, sources)
        const cost = (items: typeof sources) =>
          items.reduce((total, source) => total + Math.min(32_000, source.bytes), 0)
        return (
          sources.slice(prefix).filter((source) => source.bytes > 0).length >= 2 &&
          cost(sources) > maxBytes &&
          cost(sources.slice(0, prefix)) < maxBytes &&
          sources.every((source) => input.allowSource?.(source.path) !== false)
        )
      })
      if (!eligible.length) return new Map()
      // A receipt from a previous installation must not opt an unsupported host
      // or a machine without Engine back into Qwen-derived source ordering.
      if (!(await (runtime.available ?? canUseWikiEmbeddings)(input.signal))) return new Map()
      input.signal?.throwIfAborted()
      const receipts =
        runtime.cache ??
        (input.wikiDir
          ? createWikiEmbeddingRankCache({
              ...input,
              wikiDir: input.wikiDir,
              allowRead: input.allowSource,
            })
          : undefined)
      const cachedOrders = new Map<string, string[]>()
      const keys = new Map<string, string>()
      for (const { page, sources } of eligible) {
        input.signal?.throwIfAborted()
        const key = sha256(stableJson({ profile: PROFILE, page, sources, maxBytes }))
        keys.set(page.path, key)
        const order = await receipts?.read(page.path, key)
        if (order && isWikiSourceOrder(page, sources, order)) cachedOrders.set(page.path, order)
      }
      const pending = eligible.filter(({ page }) => !cachedOrders.has(page.path))
      if (!pending.length) return cachedOrders
      const timeout = new AbortController()
      const timer = setTimeout(
        () => timeout.abort(new Error("Wiki embedding budget exceeded")),
        runtime.timeoutMs ?? 120_000,
      )
      const signal = input.signal ? AbortSignal.any([input.signal, timeout.signal]) : timeout.signal
      let worker: WikiEmbeddingWorker | undefined
      const orders = new Map<string, string[]>()
      try {
        signal.throwIfAborted()
        worker = await (runtime.open ?? openWikiEmbeddingWorker)(signal)
        if (!worker) return cachedOrders
        // Admit candidates round-robin: an overview cannot spend the entire
        // job budget before later module pages get any evidence ranked.
        // Empty files are valid discovered sources, but readFilePrefix returns
        // undefined for them. Keep their slots without spending an embedding or
        // turning that expected absence into a failure of the entire job.
        const candidates = pending.map(({ page, sources }) =>
          sources.slice(wikiSourcePrefixLength(page, sources)).filter((source) => source.bytes > 0),
        )
        const selected = new Map<string, (typeof pages)[number]["sources"][number]>()
        for (let index = 0; index < Math.max(...candidates.map((items) => items.length)); index++) {
          for (const items of candidates) {
            const source = items[index]
            if (source && selected.size < MAX_SOURCES) selected.set(source.path, source)
          }
        }
        const cache = new Map<string, number[]>()
        const selectedSources = [...selected.values()]
        for (let offset = 0; offset < selectedSources.length; offset += 4) {
          signal.throwIfAborted()
          const batch = selectedSources.slice(offset, offset + 4)
          const texts = await Promise.all(
            batch.map(async (source) => {
              if (input.allowSource?.(source.path) === false)
                throw new Error("Wiki embedding source permission changed")
              const content = await (runtime.read ?? readFilePrefix)(input.root, source.path, 1024)
              if (content === undefined) throw new Error("Wiki embedding source unavailable")
              return `${source.path.slice(0, 256)}\n${content}`
            }),
          )
          const vectors = await worker.embed(texts)
          batch.forEach((source, index) => cache.set(source.path, vectors[index]))
        }
        for (const { page, sources } of pending) {
          signal.throwIfAborted()
          const prefix = wikiSourcePrefixLength(page, sources)
          const optional = sources.slice(prefix)
          const scored = optional.filter((source) => cache.has(source.path))
          if (scored.length < 2) continue
          const [query] = await worker.embed([
            `Instruct: Retrieve repository source files that explain the requested architecture or development topic.\nQuery: ${page.title.slice(0, 200)} ${page.purpose.slice(0, 600)}`,
          ])
          const ranked = scored
            .map((source, index) => ({
              source,
              index,
              score: cache.get(source.path)!.reduce((sum, v, i) => sum + v * query[i], 0),
            }))
            .sort((a, b) => b.score - a.score || a.index - b.index)
          let cursor = 0
          const tail = optional.map((source) => (cache.has(source.path) ? ranked[cursor++]!.source : source))
          orders.set(
            page.path,
            [...sources.slice(0, prefix), ...tail].map((source) => source.path),
          )
        }
        signal.throwIfAborted()
      } catch (error) {
        if (WikiEmbeddingCleanupError.isInstance(error)) throw error
        input.signal?.throwIfAborted()
        Log.Default.info("Wiki local embedding ranking unavailable; retaining valid cached evidence order")
        return cachedOrders
      } finally {
        clearTimeout(timer)
        await worker?.close()
        input.signal?.throwIfAborted()
      }
      // Persist only complete results after the owned worker has been reaped.
      for (const [page, order] of orders) {
        input.signal?.throwIfAborted()
        await receipts?.write(page, keys.get(page)!, order)
      }
      return new Map([...cachedOrders, ...orders])
    },
  }
}
