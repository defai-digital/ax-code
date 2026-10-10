import { sortBy, pipe } from "remeda"

export namespace Wildcard {
  const regexCache = new Map<string, RegExp>()

  const flags = process.platform === "win32" ? "si" : "s"

  // Keyed by the raw pattern so a cache hit skips the escaping work; permission
  // evaluation calls this once per rule per check.
  function getRegex(pattern: string): RegExp {
    let cached = regexCache.get(pattern)
    if (cached) return cached
    let escaped = pattern
      .replaceAll("\\", "/")
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".")

    if (escaped.endsWith(" .*")) {
      escaped = escaped.slice(0, -3) + "( .*)?"
    }
    cached = new RegExp("^" + escaped + "$", flags)
    if (regexCache.size >= 500) {
      const oldest = regexCache.keys().next().value
      if (oldest !== undefined) regexCache.delete(oldest)
    }
    regexCache.set(pattern, cached)
    return cached
  }

  export function match(str: string, pattern: string) {
    if (str) str = str.replaceAll("\\", "/")
    return getRegex(pattern).test(str)
  }

  export function all(input: string, patterns: Record<string, any>) {
    const sorted = pipe(patterns, Object.entries, sortBy([([key]) => key.length, "asc"], [([key]) => key, "asc"]))
    let result = undefined
    for (const [pattern, value] of sorted) {
      if (match(input, pattern)) {
        result = value
        continue
      }
    }
    return result
  }

  export function allStructured(input: { head: string; tail: string[] }, patterns: Record<string, any>) {
    const sorted = pipe(patterns, Object.entries, sortBy([([key]) => key.length, "asc"], [([key]) => key, "asc"]))
    let result = undefined
    for (const [pattern, value] of sorted) {
      const parts = pattern.split(/\s+/)
      if (!match(input.head, parts[0])) continue
      if (parts.length === 1 || matchSequence(input.tail, parts.slice(1))) {
        result = value
        continue
      }
    }
    return result
  }

  function matchSequence(items: string[], patterns: string[], startIdx = 0): boolean {
    if (patterns.length === 0) return true
    const [pattern, ...rest] = patterns
    if (pattern === "*") return matchSequence(items, rest, startIdx)
    for (let i = startIdx; i < items.length; i++) {
      if (match(items[i], pattern) && matchSequence(items, rest, i + 1)) {
        return true
      }
    }
    return false
  }
}
