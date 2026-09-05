import type { WikiPageGenerationResult, WikiPlanPage, WikiSource } from "./types.js"

function yamlString(value: string): string {
  return JSON.stringify(value)
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
  if (nl < 0) return trimmed
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
    `title: ${yamlString(input.page.title)}`,
    `summary: ${yamlString(input.result.summary.trim())}`,
    "generated_by: ax-wiki",
    symbols.length ? "symbols:" : "symbols: []",
    ...symbols.map((symbol) => `  - ${yamlString(symbol)}`),
    sourcePaths.length ? "sources:" : "sources: []",
    ...sourcePaths.map((source) => `  - ${yamlString(source)}`),
    "---",
    "",
    `# ${input.page.title}`,
    "",
    body,
    "",
    "## Sources",
    "",
    ...(sourcePaths.length
      ? sourcePaths.map((source) => `- \`${source}\``)
      : ["- No source files matched this page plan."]),
    "",
  ]
  return lines.join("\n")
}

function parseList(lines: string[], key: string): string[] {
  const start = lines.findIndex((line) => line.trim() === `${key}:`)
  if (start < 0) return []
  const output: string[] = []
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index]!
    if (!/^\s+-\s+/.test(line)) break
    const raw = line.replace(/^\s+-\s+/, "").trim()
    try {
      output.push(JSON.parse(raw))
    } catch {
      output.push(raw.replace(/^['"]|['"]$/g, ""))
    }
  }
  return output
}

function parseScalar(lines: string[], key: string): string | undefined {
  const line = lines.find((candidate) => candidate.startsWith(`${key}:`))
  if (!line) return undefined
  const raw = line.slice(key.length + 1).trim()
  try {
    return JSON.parse(raw)
  } catch {
    return raw.replace(/^['"]|['"]$/g, "")
  }
}

export function parseFrontmatter(content: string): {
  title?: string
  summary?: string
  generatedBy?: string
  symbols: string[]
  sources: string[]
  body: string
} {
  if (!content.startsWith("---\n")) return { symbols: [], sources: [], body: content }
  const end = content.indexOf("\n---", 4)
  if (end < 0) return { symbols: [], sources: [], body: content }
  const lines = content.slice(4, end).split(/\r?\n/)
  return {
    title: parseScalar(lines, "title"),
    summary: parseScalar(lines, "summary"),
    generatedBy: parseScalar(lines, "generated_by"),
    symbols: parseList(lines, "symbols"),
    sources: parseList(lines, "sources"),
    body: content.slice(end + 4).replace(/^\s+/, ""),
  }
}
