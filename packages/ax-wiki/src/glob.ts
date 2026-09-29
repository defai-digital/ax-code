import { normalizePath } from "./paths.js"

const REGEX_SPECIAL = /[.+^${}()|[\]\\]/g

// `matchesGlob`/`matchesAny` recompile their patterns on every call, and the
// planner evaluates every source against every selector on each build. Cache
// compiled patterns with a simple LRU bound; compiled RegExps are stateless
// here (no global/sticky flags), so sharing instances is safe.
const REGEX_CACHE_LIMIT = 256
const regexCache = new Map<string, RegExp>()

export function globToRegExp(pattern: string): RegExp {
  const normalized = normalizePath(pattern.trim())
  const cached = regexCache.get(normalized)
  if (cached) {
    regexCache.delete(normalized)
    regexCache.set(normalized, cached)
    return cached
  }
  let out = "^"
  for (let index = 0; index < normalized.length; index++) {
    const char = normalized[index]
    if (char === "*") {
      if (normalized[index + 1] === "*") {
        index++
        if (normalized[index + 1] === "/") {
          index++
          out += "(?:.*/)?"
        } else {
          out += ".*"
        }
      } else {
        out += "[^/]*"
      }
      continue
    }
    if (char === "?") {
      out += "[^/]"
      continue
    }
    out += char.replace(REGEX_SPECIAL, "\\$&")
  }
  const compiled = new RegExp(`${out}$`)
  regexCache.set(normalized, compiled)
  if (regexCache.size > REGEX_CACHE_LIMIT) {
    const oldest = regexCache.keys().next().value
    if (oldest !== undefined) regexCache.delete(oldest)
  }
  return compiled
}

export function matchesGlob(file: string, pattern: string): boolean {
  return globToRegExp(pattern).test(normalizePath(file))
}

export function matchesAny(file: string, patterns: string[] | undefined): boolean {
  if (!patterns || patterns.length === 0) return false
  return patterns.some((pattern) => matchesGlob(file, pattern))
}
