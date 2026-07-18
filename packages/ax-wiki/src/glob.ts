import { normalizePath } from "./paths"

const REGEX_SPECIAL = /[.+^${}()|[\]\\]/g

export function globToRegExp(pattern: string): RegExp {
  const normalized = normalizePath(pattern.trim())
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
  return new RegExp(`${out}$`)
}

export function matchesGlob(file: string, pattern: string): boolean {
  return globToRegExp(pattern).test(normalizePath(file))
}

export function matchesAny(file: string, patterns: string[] | undefined): boolean {
  if (!patterns || patterns.length === 0) return false
  return patterns.some((pattern) => matchesGlob(file, pattern))
}
