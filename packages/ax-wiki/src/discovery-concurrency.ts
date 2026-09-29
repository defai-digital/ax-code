/** Internal read/hash concurrency cap for repository discovery. */
export const DISCOVERY_READ_CONCURRENCY = 8

/**
 * Run an async mapper with bounded concurrency while preserving input order.
 * The first mapper failure rejects the whole run and workers stop picking up
 * new items (in-flight items settle normally, so no rejection goes unobserved).
 * This module is intentionally absent from the package export map.
 */
export async function mapWithBoundedConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []
  const limit = Number.isFinite(concurrency) ? Math.max(1, Math.min(Math.floor(concurrency), items.length)) : 1
  const results = new Array<R>(items.length)
  let next = 0
  let failed = false
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (!failed) {
        const index = next++
        if (index >= items.length) return
        try {
          results[index] = await mapper(items[index]!, index)
        } catch (error) {
          failed = true
          throw error
        }
      }
    }),
  )
  return results
}
