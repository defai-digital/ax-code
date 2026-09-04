import { parseJsonResult } from "./json-value"

export interface NameStatusEntry {
  code: string
  file: string
}

export interface NumstatEntry {
  file: string
  additions: number
  deletions: number
  binary: boolean
}

export function decodeGitQuotedPathLiteral(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

export function parseGitQuotedPathLiteral(file: string): string | undefined {
  // Git quotes paths with C escapes, including bell/vertical-tab and octal
  // UTF-8 bytes that JSON does not recognize. Preserve escaped backslashes
  // while translating only those extra forms into valid JSON string escapes.
  const literal = file.replace(/\\(?:[0-7]{1,3}(?:\\[0-7]{1,3})*|.)/g, (escape) => {
    if (escape === "\\a") return "\\u0007"
    if (escape === "\\v") return "\\u000b"
    if (!/^\\[0-7]/.test(escape)) return escape
    const bytes = escape
      .slice(1)
      .split("\\")
      .map((byte) => Number.parseInt(byte, 8))
    if (bytes.some((byte) => byte > 255)) return escape
    try {
      const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Uint8Array.from(bytes))
      return JSON.stringify(text).slice(1, -1)
    } catch {
      // Leave malformed bytes escaped so the safe parser rejects the literal.
      return escape
    }
  })
  const parsed = parseJsonResult(literal)
  if (!parsed.ok) {
    return undefined
  }
  return decodeGitQuotedPathLiteral(parsed.value)
}

export function decodeGitQuotedPath(file: string): string {
  if (!file.startsWith('"')) return file
  return parseGitQuotedPathLiteral(file) ?? file
}

function splitPair(line: string) {
  const idx = line.indexOf("\t")
  if (idx < 0) return
  return [line.slice(0, idx), decodeGitQuotedPath(line.slice(idx + 1))] as const
}

function parseCount(value: string) {
  if (!/^\d+$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

export function parsePathLine(line: string): string | undefined {
  if (!line) return
  const file = decodeGitQuotedPath(line)
  return file || undefined
}

export function parseNameStatusLine(line: string): NameStatusEntry | undefined {
  const parsed = splitPair(line)
  if (!parsed) return
  const [code, file] = parsed
  if (!code || !file) return
  return { code, file }
}

export function parseNumstatLine(line: string): NumstatEntry | undefined {
  const first = line.indexOf("\t")
  if (first < 0) return
  const second = line.indexOf("\t", first + 1)
  if (second < 0) return

  const rawAdditions = line.slice(0, first)
  const rawDeletions = line.slice(first + 1, second)
  const file = decodeGitQuotedPath(line.slice(second + 1))
  if (!file) return

  const binary = rawAdditions === "-" && rawDeletions === "-"
  const additions = binary ? 0 : parseCount(rawAdditions)
  const deletions = binary ? 0 : parseCount(rawDeletions)
  if (additions === undefined || deletions === undefined) return
  return {
    file,
    additions,
    deletions,
    binary,
  }
}

export function parseLsTreeSize(line: string): number | undefined {
  const parsed = splitPair(line)
  const meta = parsed?.[0]
  if (!meta) return

  const parts = meta.trim().split(/\s+/)
  const raw = parts[3]
  if (!raw || raw === "-") return

  return parseCount(raw)
}
