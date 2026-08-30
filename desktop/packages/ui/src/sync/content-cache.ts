/**
 * File content LRU cache — dual constraint eviction.
 * Port of AX Code's content-cache.ts.
 *
 * Evicts when either entry count exceeds MAX_FILE_CONTENT_ENTRIES
 * or total byte estimate exceeds MAX_FILE_CONTENT_BYTES.
 * Uses Map insertion order as LRU (oldest = first key).
 */

const MAX_FILE_CONTENT_ENTRIES = 40
const MAX_FILE_CONTENT_BYTES = 20 * 1024 * 1024 // 20 MB

// LRU map: path → approximate bytes. Map insertion order = access order.
const lru = new Map<string, number>()
let total = 0

/** Estimate byte size of a string (UTF-16 → ~2 bytes per char). */
export function approxStringBytes(content: string): number {
  return content.length * 2
}

function setBytes(path: string, nextBytes: number) {
  const prev = lru.get(path)
  if (prev !== undefined) total -= prev
  lru.delete(path)
  lru.set(path, nextBytes)
  total += nextBytes
}

function touch(path: string, bytes?: number) {
  const prev = lru.get(path)
  if (prev === undefined && bytes === undefined) return
  setBytes(path, bytes ?? prev ?? 0)
}

function remove(path: string) {
  const prev = lru.get(path)
  if (prev === undefined) return
  lru.delete(path)
  total -= prev
}

/**
 * Evict entries until both constraints are satisfied.
 * @param keep - paths to preserve (moved to end of LRU if encountered)
 * @param evict - callback to actually remove content from the store
 */
export function evictContentLru(keep: Set<string> | undefined, evict: (path: string) => void) {
  const safeSet = keep ?? new Set<string>()
  // Counts consecutive touches of protected entries with no real eviction in
  // between. `keep` may contain paths that aren't even cached, so comparing
  // against `safeSet.size` (as opposed to how many protected entries are
  // actually still in `lru`) can under-count and stop evicting too early,
  // leaving the cache over budget indefinitely. Counting full rotations
  // around the current `lru` instead is accurate regardless of how `keep`
  // relates to what's cached.
  let protectedStreak = 0

  while (lru.size > MAX_FILE_CONTENT_ENTRIES || total > MAX_FILE_CONTENT_BYTES) {
    const path = lru.keys().next().value
    if (!path) return

    if (safeSet.has(path)) {
      touch(path)
      protectedStreak += 1
      // Every entry currently in the cache is protected — nothing left to evict.
      if (protectedStreak >= lru.size) return
      continue
    }

    protectedStreak = 0
    remove(path)
    evict(path)
  }
}

export function resetContentLru() {
  lru.clear()
  total = 0
}

export function setContentBytes(path: string, bytes: number) {
  setBytes(path, bytes)
}

export function removeContentBytes(path: string) {
  remove(path)
}

export function touchContent(path: string, bytes?: number) {
  touch(path, bytes)
}

export function getContentBytesTotal(): number {
  return total
}

export function getContentEntryCount(): number {
  return lru.size
}

export function hasContent(path: string): boolean {
  return lru.has(path)
}
