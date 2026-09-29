import type { WikiPageGenerationResult, WikiPlanPage, WikiSource } from "./types.js"

/** Single-line JSON double-quoted string; valid as a YAML flow scalar. */
function jsonQuoted(value: string): string {
  return JSON.stringify(value)
}

/** Escape a value embedded in Markdown inline code (`` `...` ``). */
function inlineCode(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/[\r\n]+/g, " ")
}

/** Collapse line breaks so a value cannot inject extra Markdown structure. */
function headingText(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim()
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort()
}

function stripLeadingHeading(body: string): string {
  const trimmed = body.trim()
  if (!trimmed.startsWith("#")) return trimmed
  let i = 0
  while (i < trimmed.length && trimmed[i] === "#") i++
  if (i === 0 || (trimmed[i] !== " " && trimmed[i] !== "\t")) return trimmed
  const nl = trimmed.indexOf("\n", i)
  // A body that is only a heading must not survive: the renderer adds the page
  // title H1 itself, and keeping it would duplicate the heading.
  if (nl < 0) return ""
  let end = nl + 1
  while (end < trimmed.length && trimmed[end] === "\n") end++
  return trimmed.slice(end)
}

export function renderWikiPage(input: {
  page: WikiPlanPage
  result: WikiPageGenerationResult
  sources: WikiSource[]
}): string {
  const symbols = unique(input.result.symbols ?? [])
  const sourcePaths = unique(input.sources.map((source) => source.path))
  const body = stripLeadingHeading(input.result.body)
  const lines = [
    "---",
    `title: ${jsonQuoted(input.page.title)}`,
    `summary: ${jsonQuoted(input.result.summary.trim())}`,
    "generated_by: ax-wiki",
    symbols.length ? "symbols:" : "symbols: []",
    ...symbols.map((symbol) => `  - ${jsonQuoted(symbol)}`),
    sourcePaths.length ? "sources:" : "sources: []",
    ...sourcePaths.map((source) => `  - ${jsonQuoted(source)}`),
    "---",
    "",
    `# ${headingText(input.page.title)}`,
    "",
    body,
    "",
    "## Sources",
    "",
    ...(sourcePaths.length
      ? sourcePaths.map((source) => `- \`${inlineCode(source)}\``)
      : ["- No source files matched this page plan."]),
    "",
  ]
  return lines.join("\n")
}

/** Only matched quote pairs are stripped; mismatched quotes stay visible. */
function stripMatchedQuotes(raw: string): string {
  if (raw.length >= 2) {
    const first = raw[0]
    const last = raw[raw.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return raw.slice(1, -1)
    }
  }
  return raw
}

function parseScalarValue(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw)
    // Only strings are accepted from JSON; a number/boolean/object scalar falls
    // back to its raw text instead of lying about the type downstream.
    if (typeof parsed === "string") return parsed
  } catch {
    // Not JSON — treat as a plain or quoted scalar.
  }
  return stripMatchedQuotes(raw)
}

function keyPattern(key: string): RegExp {
  return new RegExp(`^\\s*${key}\\s*:\\s*(.*)$`)
}

function parseScalar(lines: string[], key: string): string | undefined {
  const pattern = keyPattern(key)
  let raw: string | undefined
  // Duplicate keys resolve to the last occurrence, matching lenient YAML readers.
  for (const line of lines) {
    const match = line.match(pattern)
    if (match) raw = match[1]!.trim()
  }
  return raw === undefined ? undefined : parseScalarValue(raw)
}

function parseList(lines: string[], key: string): string[] {
  const pattern = keyPattern(key)
  let start = -1
  let inline = ""
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index]!.match(pattern)
    if (match) {
      start = index
      inline = match[1]!.trim()
    }
  }
  if (start < 0) return []
  if (inline.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(inline)
      if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === "string")
    } catch {
      // Malformed inline list — fall through to an empty list.
    }
    return []
  }
  // A scalar where a list was expected is not a list.
  if (inline) return []
  const output: string[] = []
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index]!
    // Blank lines and comments inside a block list are skipped, not terminators.
    if (!line.trim() || line.trim().startsWith("#")) continue
    if (!/^\s*-\s+/.test(line)) break
    output.push(parseScalarValue(line.replace(/^\s*-\s+/, "").trim()))
  }
  return output
}

export function parseFrontmatter(content: string): {
  title?: string
  summary?: string
  generatedBy?: string
  symbols: string[]
  sources: string[]
  body: string
} {
  const text = content.replace(/^\uFEFF/, "")
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() !== "---") return { symbols: [], sources: [], body: content }
  // The closing delimiter is a line of its own: `---foo` or a `---` prefix
  // inside a value never ends the frontmatter block.
  let end = -1
  for (let index = 1; index < lines.length; index++) {
    if (lines[index]!.trim() === "---") {
      end = index
      break
    }
  }
  if (end < 0) return { symbols: [], sources: [], body: content }
  const front = lines.slice(1, end)
  return {
    title: parseScalar(front, "title"),
    summary: parseScalar(front, "summary"),
    generatedBy: parseScalar(front, "generated_by"),
    symbols: parseList(front, "symbols"),
    sources: parseList(front, "sources"),
    // Leading blank lines are stripped; the first content line keeps its
    // indentation (a leading indented code block must survive the round trip).
    body: lines
      .slice(end + 1)
      .join("\n")
      .replace(/^(\r?\n)+/, ""),
  }
}
