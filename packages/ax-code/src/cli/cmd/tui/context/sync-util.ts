import { Binary } from "@ax-code/util/binary"

export function groupBySession<T extends { sessionID: string }>(items: T[]) {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const list = acc[item.sessionID] ?? []
    list.push(item)
    acc[item.sessionID] = list
    return acc
  }, {})
}

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

export function removeByID<T extends { id: string }>(list: T[], id: string): T | undefined {
  const result = Binary.search(list, id, (entry) => entry.id)
  if (!result.found) return
  const [removed] = list.splice(result.index, 1)
  return removed
}

export function shiftOverflow<T>(list: T[], maxSize: number): T | undefined {
  if (list.length <= maxSize) return
  return list.shift()
}

export function appendTextPartDelta<
  T extends {
    id: string
    type?: string
    text?: string
  },
>(list: T[], partID: string, delta: string): boolean {
  const result = Binary.search(list, partID, (entry) => entry.id)
  if (!result.found) return false
  const part = list[result.index]
  if (part.type !== "text" && part.type !== "reasoning") return false
  part.text = (part.text ?? "") + delta
  return true
}
