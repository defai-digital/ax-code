import { Binary } from "@ax-code/util/binary"

export function upsert<T extends { id: string }>(list: T[], item: T) {
  const result = Binary.search(list, item.id, (entry) => entry.id)
  if (result.found) {
    list[result.index] = item
    return
  }
  list.splice(result.index, 0, item)
}

/**
 * Merge fetched items into an existing sorted list without dropping
 * entries that arrived via real-time events during the fetch.
 */
export function mergeSorted<T extends { id: string }>(existing: T[], fetched: T[]): T[] {
  const merged = [...existing]
  for (const item of fetched) {
    upsert(merged, item)
  }
  return merged
}
