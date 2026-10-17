// Pure parser for the five new prompt reference forms introduced by
// ADR-236: @diff, @staged, @git:N, @file:<path>:<start>-<end>, @url:<url>.
//
// Kept dependency-free (no I/O, no git, no fetch) so table tests can exercise
// it without filesystem or network fixtures. The runner-coupled code lives in
// prompt-reference-parts.ts and consumes this module.

export type ReferenceKind = "file" | "agent" | "diff" | "staged" | "git" | "file-range" | "url"

export type ReferenceToken =
  | { kind: "file"; path: string }
  | { kind: "agent"; name: string }
  | { kind: "diff" }
  | { kind: "staged" }
  | { kind: "git"; count: number }
  | { kind: "file-range"; path: string; start: number; end?: number }
  | { kind: "url"; href: string }

const MAX_GIT_COUNT = 10
const MAX_LINE_NUMBER = 1_000_000

/**
 * Parse one matched `@name` token from ConfigMarkdown.files() into a
 * discriminated `ReferenceToken`. Returns `undefined` for unrecognized forms
 * so the caller can fall through to the existing file/agent resolution path.
 *
 * Recognized forms:
 *   @diff                     -> unstaged working tree diff
 *   @staged                   -> staged (index) diff
 *   @git:<1..10>              -> last N commits, formatted as patch
 *   @file:<path>:<start>-<end>  or @<path>:<start>-<end>
 *                              -> bounded line range
 *   @url:<http(s)://...>      -> SSRF-pinned fetch
 */
export function parseReferenceToken(raw: string): ReferenceToken | undefined {
  if (!raw) return undefined
  if (raw === "diff") return { kind: "diff" }
  if (raw === "staged") return { kind: "staged" }

  if (raw.startsWith("git:")) {
    const countStr = raw.slice(4)
    if (!/^\d+$/.test(countStr)) return undefined
    const count = Number(countStr)
    if (!Number.isSafeInteger(count) || count < 1) return undefined
    // ADR-236 caps N at 10; clamp rather than reject so an over-large value
    // is a no-op degradation instead of an inline-note surprise.
    return { kind: "git", count: Math.min(count, MAX_GIT_COUNT) }
  }

  if (raw.startsWith("url:")) {
    const href = raw.slice(4)
    if (!href) return undefined
    if (!/^https?:\/\//i.test(href)) return undefined
    return { kind: "url", href }
  }

  // @file:<path>:<start>-<end>  — path may contain colons on Windows drives
  // and on POSIX absolute paths we want the trailing `:digits-digits` form.
  if (raw.startsWith("file:")) {
    const rest = raw.slice(5)
    return parseFileRange(rest, /* prefixFile */ true)
  }

  // @<path>:<start>-<end> (no `file:` prefix)
  // Find the last `:` that precedes `-digits` (the line range separator).
  const rangeMatch = matchTrailingLineRange(raw)
  if (rangeMatch) {
    return parseFileRange(raw, /* prefixFile */ false, rangeMatch)
  }

  return undefined
}

function matchTrailingLineRange(raw: string): { start: number; end?: number; sepIndex: number } | undefined {
  // Greedy from the right: look for ":digits" or ":digits-digits" at the end.
  // The path itself must not be empty and must not contain a newline.
  const m = raw.match(/:(\d+)(?:-(\d+))?$/)
  if (!m) return undefined
  const start = Number(m[1])
  if (!Number.isSafeInteger(start) || start < 1 || start > MAX_LINE_NUMBER) return undefined
  let end: number | undefined
  if (m[2] !== undefined) {
    const parsed = Number(m[2])
    if (!Number.isSafeInteger(parsed) || parsed < start || parsed > MAX_LINE_NUMBER) return undefined
    end = parsed
  }
  const sepIndex = raw.length - m[0].length
  if (sepIndex <= 0) return undefined
  return { start, end, sepIndex }
}

function parseFileRange(
  rest: string,
  prefixFile: boolean,
  precomputed?: { start: number; end?: number; sepIndex: number },
): ReferenceToken | undefined {
  const range = precomputed ?? matchTrailingLineRange(rest)
  if (!range) return undefined
  const path = rest.slice(0, range.sepIndex)
  if (!path) return undefined
  // A colon is legitimate in a path (Windows drive letters, POSIX filenames);
  // only a nested "file:" prefix is malformed.
  if (prefixFile && path.toLowerCase().startsWith("file:")) return undefined
  const trimmed = path.trim()
  if (!trimmed) return undefined
  return {
    kind: "file-range",
    path: trimmed,
    start: range.start,
    end: range.end,
  }
}

/** True when this token is one of the new ADR-236 forms. */
export function isAdr236Reference(token: ReferenceToken): boolean {
  return (
    token.kind === "diff" ||
    token.kind === "staged" ||
    token.kind === "git" ||
    token.kind === "file-range" ||
    token.kind === "url"
  )
}
