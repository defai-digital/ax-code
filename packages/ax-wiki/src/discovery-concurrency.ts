/** Internal read/hash concurrency cap for repository discovery. */
export const DISCOVERY_READ_CONCURRENCY = 8

/**
 * Run an async mapper with bounded concurrency while preserving input order.
 * The first mapper failure stops new work. Drain in-flight items before rejecting,
 * so callers can safely release locks or dispose providers after this settles.
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
  let failure: unknown
  let failureIndex = Infinity
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (!failed) {
        const index = next++
        if (index >= items.length) return
        try {
          results[index] = await mapper(items[index]!, index)
        } catch (error) {
          if (index < failureIndex) {
            failureIndex = index
            failure = error
          }
          failed = true
        }
      }
    }),
  )
  if (failed) throw failure
  return results
}
