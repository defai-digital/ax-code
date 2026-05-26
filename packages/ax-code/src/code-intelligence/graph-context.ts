import { readFile } from "fs/promises"
import path from "path"
import { CodeIntelligence } from "."
import { CodeNodeID } from "./id"
import type { ProjectID } from "../project/schema"
import type { CodeNodeKind } from "./schema.sql"

type Seed = { kind: "symbol"; value: string } | { kind: "file"; value: string } | { kind: "name"; value: string }

type BuildContextOptions = {
  query: string
  seeds?: Seed[]
  maxSymbols?: number
  maxSnippets?: number
  maxDepth?: number
  includeImpact?: boolean
  freshness?: "preferGraph" | "requireFresh" | "allowStaleWithWarning"
  scope?: CodeIntelligence.Scope
}

type RelationshipProvenance = {
  source: "lsp" | "static" | "framework" | "heuristic"
  confidence: "high" | "medium" | "low"
  explanation: string
}

type Relationship = {
  kind: "caller" | "callee" | "reference"
  from?: CodeIntelligence.Symbol
  to?: CodeIntelligence.Symbol
  file?: string
  line?: number
  provenance: RelationshipProvenance
}

type Snippet = {
  symbol: CodeIntelligence.Symbol
  file: string
  startLine: number
  endLine: number
  text: string
  truncated: boolean
}

type FrameworkBinding = {
  framework: "express" | "fastapi" | "flask" | "nextjs"
  method: string
  route: string
  file: string
  line: number
  symbolID: string
  provenance: RelationshipProvenance
}

type HeuristicBinding = {
  kind: "event-channel" | "callback-registration"
  label: string
  file: string
  line: number
  symbolID: string
  provenance: RelationshipProvenance
}

type ImpactSummary = {
  seedCount: number
  affectedSymbolCount: number
  affectedFileCount: number
  truncated: boolean
  symbols: Array<{ symbol: CodeIntelligence.Symbol; distance: number }>
}

export type GraphContextPack = {
  query: string
  output: string
  symbols: CodeIntelligence.Symbol[]
  relationships: Relationship[]
  snippets: Snippet[]
  frameworkBindings: FrameworkBinding[]
  heuristicBindings: HeuristicBinding[]
  impact?: ImpactSummary
  omitted: {
    symbols: number
    snippets: number
    relationships: number
  }
  recommendations: string[]
  envelope: CodeIntelligence.GraphEnvelope<unknown>
}

const DEFAULT_MAX_SYMBOLS = 8
const DEFAULT_MAX_SNIPPETS = 6
const MAX_CANDIDATES = 40
const MAX_RELATIONSHIPS_PER_SYMBOL = 8
const STOP_WORDS = new Set([
  "about",
  "after",
  "before",
  "call",
  "called",
  "calls",
  "class",
  "code",
  "context",
  "does",
  "file",
  "find",
  "from",
  "function",
  "handler",
  "impact",
  "into",
  "method",
  "please",
  "route",
  "show",
  "symbol",
  "that",
  "this",
  "what",
  "where",
  "with",
  "work",
])

function uniqueByID(symbols: CodeIntelligence.Symbol[]): CodeIntelligence.Symbol[] {
  const seen = new Set<string>()
  const out: CodeIntelligence.Symbol[] = []
  for (const symbol of symbols) {
    if (seen.has(symbol.id)) continue
    seen.add(symbol.id)
    out.push(symbol)
  }
  return out
}

function queryTerms(query: string): string[] {
  const terms = query.match(/[A-Za-z_$][A-Za-z0-9_$]{2,}/g) ?? []
  const seen = new Set<string>()
  const out: string[] = []
  for (const term of terms) {
    const lower = term.toLowerCase()
    if (STOP_WORDS.has(lower) || seen.has(lower)) continue
    seen.add(lower)
    out.push(term)
  }
  return out.slice(0, 8)
}

function kindScore(kind: CodeNodeKind): number {
  switch (kind) {
    case "function":
    case "method":
      return 8
    case "class":
    case "interface":
      return 7
    case "type":
    case "module":
      return 5
    default:
      return 2
  }
}

function rankSymbols(query: string, symbols: CodeIntelligence.Symbol[]): CodeIntelligence.Symbol[] {
  const lowerQuery = query.toLowerCase()
  return [...symbols].sort(
    (a, b) => scoreSymbol(lowerQuery, b) - scoreSymbol(lowerQuery, a) || a.file.localeCompare(b.file),
  )
}

function scoreSymbol(lowerQuery: string, symbol: CodeIntelligence.Symbol): number {
  const lowerName = symbol.name.toLowerCase()
  const lowerQualified = symbol.qualifiedName.toLowerCase()
  let score = kindScore(symbol.kind)
  if (lowerQuery.includes(lowerName)) score += 20
  if (lowerQuery.includes(lowerQualified)) score += 8
  if (symbol.visibility === "public") score += 2
  if (symbol.explain.completeness === "full") score += 2
  if (symbol.explain.completeness === "partial") score -= 2
  return score
}

function lineRef(file: string, line: number): string {
  return `${file}:${line + 1}`
}

async function readSnippet(symbol: CodeIntelligence.Symbol): Promise<Snippet | undefined> {
  try {
    const text = await readFile(symbol.file, "utf8")
    const lines = text.split(/\r?\n/)
    const startLine = Math.max(0, symbol.range.start.line - 2)
    const endLine = Math.min(lines.length - 1, symbol.range.end.line + 2)
    const selected = lines.slice(startLine, endLine + 1)
    const truncated = selected.length > 80
    const body = (truncated ? selected.slice(0, 80) : selected)
      .map((line, idx) => `${String(startLine + idx + 1).padStart(4, " ")} | ${line}`)
      .join("\n")
    return {
      symbol,
      file: symbol.file,
      startLine,
      endLine: truncated ? startLine + 79 : endLine,
      text: body,
      truncated,
    }
  } catch {
    return undefined
  }
}

async function readFileLines(file: string): Promise<string[] | undefined> {
  try {
    return (await readFile(file, "utf8")).split(/\r?\n/)
  } catch {
    return undefined
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function routeBindings(symbol: CodeIntelligence.Symbol, lines: string[]): FrameworkBinding[] {
  const out: FrameworkBinding[] = []
  const name = escapeRegExp(symbol.name)
  const routeCall = new RegExp(
    `\\b(?:app|router|server)\\.(get|post|put|delete|patch|all|use)\\s*\\(\\s*["'\`]([^"'\`]+)["'\`][^\\n]*\\b${name}\\b`,
    "i",
  )
  const decorator = /^\s*@(app|router)\.(get|post|put|delete|patch|options|head|route)\s*\(\s*["']([^"']+)["']/i
  const flaskDecorator = /^\s*@(?:app|bp|blueprint)\.route\s*\(\s*["']([^"']+)["'][^)]*(?:methods\s*=\s*\[([^\]]+)\])?/i

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx] ?? ""
    const match = line.match(routeCall)
    if (match) {
      out.push({
        framework: "express",
        method: match[1]?.toUpperCase() ?? "ROUTE",
        route: match[2] ?? "",
        file: symbol.file,
        line: idx,
        symbolID: symbol.id,
        provenance: {
          source: "framework",
          confidence: "medium",
          explanation: "Matched an Express-style route call that names the handler symbol.",
        },
      })
      continue
    }

    const nearSymbol = idx < symbol.range.start.line && symbol.range.start.line - idx <= 3
    if (!nearSymbol) continue

    const fastapi = line.match(decorator)
    if (fastapi) {
      out.push({
        framework: "fastapi",
        method: fastapi[2]?.toUpperCase() ?? "ROUTE",
        route: fastapi[3] ?? "",
        file: symbol.file,
        line: idx,
        symbolID: symbol.id,
        provenance: {
          source: "framework",
          confidence: "medium",
          explanation: "Matched a FastAPI-style decorator immediately above the handler.",
        },
      })
      continue
    }

    const flask = line.match(flaskDecorator)
    if (flask) {
      out.push({
        framework: "flask",
        method:
          flask[2]
            ?.replace(/['"\s]/g, "")
            .split(",")
            .filter(Boolean)
            .join(",") || "ROUTE",
        route: flask[1] ?? "",
        file: symbol.file,
        line: idx,
        symbolID: symbol.id,
        provenance: {
          source: "framework",
          confidence: "medium",
          explanation: "Matched a Flask-style route decorator immediately above the handler.",
        },
      })
    }
  }

  const base = path.basename(symbol.file)
  const parts = symbol.file.split(path.sep)
  const appIndex = parts.lastIndexOf("app")
  if (appIndex >= 0 && base === "route.ts" && /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(symbol.name)) {
    out.push({
      framework: "nextjs",
      method: symbol.name,
      route: "/" + parts.slice(appIndex + 1, -1).join("/"),
      file: symbol.file,
      line: symbol.range.start.line,
      symbolID: symbol.id,
      provenance: {
        source: "framework",
        confidence: "medium",
        explanation: "Inferred a Next.js app router handler from app/**/route.ts.",
      },
    })
  }

  return out
}

function heuristicBindings(symbol: CodeIntelligence.Symbol, lines: string[]): HeuristicBinding[] {
  const out: HeuristicBinding[] = []
  const name = escapeRegExp(symbol.name)
  const eventRegistration = new RegExp(`\\.(?:on|once|addListener)\\s*\\(\\s*["'\`]([^"'\`]+)["'\`]\\s*,\\s*${name}\\b`)
  const callbackRegistration = new RegExp(`\\b[A-Za-z_$][A-Za-z0-9_$.]*\\s*\\([^\\n)]*\\b${name}\\b[^\\n)]*\\)`)

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx] ?? ""
    const event = line.match(eventRegistration)
    if (event) {
      out.push({
        kind: "event-channel",
        label: event[1] ?? "event",
        file: symbol.file,
        line: idx,
        symbolID: symbol.id,
        provenance: {
          source: "heuristic",
          confidence: "low",
          explanation: "Matched a static EventEmitter-style registration; runtime emitters are not proven.",
        },
      })
      continue
    }
    if (
      idx !== symbol.range.start.line &&
      callbackRegistration.test(line) &&
      !line.includes(`function ${symbol.name}`)
    ) {
      out.push({
        kind: "callback-registration",
        label: line.trim().slice(0, 120),
        file: symbol.file,
        line: idx,
        symbolID: symbol.id,
        provenance: {
          source: "heuristic",
          confidence: "low",
          explanation: "Matched the symbol passed as a callback argument; runtime invocation is not proven.",
        },
      })
    }
  }

  return out.slice(0, 5)
}

function relationshipProvenance(kind: "caller" | "callee" | "reference"): RelationshipProvenance {
  return {
    source: "lsp",
    confidence: "high",
    explanation:
      kind === "reference"
        ? "Reference edge was indexed from LSP references."
        : "Call edge was indexed from LSP references and callable-symbol attribution.",
  }
}

function buildImpactSummary(
  selected: CodeIntelligence.Symbol[],
  callersBySeed: Map<string, CodeIntelligence.CallChainNode[]>,
  maxDepth: number,
): ImpactSummary {
  const seen = new Map<string, { symbol: CodeIntelligence.Symbol; distance: number }>()
  for (const seed of selected) {
    const direct = callersBySeed.get(seed.id) ?? []
    for (const caller of direct) {
      const current = seen.get(caller.symbol.id)
      if (!current || current.distance > 1) seen.set(caller.symbol.id, { symbol: caller.symbol, distance: 1 })
    }
  }

  // Keep the MVP bounded: direct callers are always included, and depth
  // greater than one is reported as truncated until a full BFS planner is
  // promoted into this composer.
  const symbols = [...seen.values()].sort(
    (a, b) => a.distance - b.distance || a.symbol.qualifiedName.localeCompare(b.symbol.qualifiedName),
  )
  const files = new Set(symbols.map((item) => item.symbol.file))
  return {
    seedCount: selected.length,
    affectedSymbolCount: symbols.length,
    affectedFileCount: files.size,
    truncated: maxDepth > 1,
    symbols: symbols.slice(0, 20),
  }
}

function formatOutput(pack: Omit<GraphContextPack, "output">): string {
  const lines: string[] = []
  lines.push(`# Graph Context`)
  lines.push("")
  lines.push(`Query: ${pack.query}`)
  lines.push(
    `Graph: source=${pack.envelope.source} completeness=${pack.envelope.completeness} degraded=${pack.envelope.degraded === true ? "true" : "false"}`,
  )
  lines.push("")

  lines.push(`## Selected Symbols`)
  if (pack.symbols.length === 0) {
    lines.push("No indexed symbols matched the query.")
  } else {
    for (const symbol of pack.symbols) {
      lines.push(`- [${symbol.kind}] ${symbol.qualifiedName} (${lineRef(symbol.file, symbol.range.start.line)})`)
    }
  }
  lines.push("")

  if (pack.frameworkBindings.length > 0) {
    lines.push(`## Framework Routes`)
    for (const binding of pack.frameworkBindings) {
      lines.push(
        `- ${binding.framework} ${binding.method} ${binding.route} -> ${lineRef(binding.file, binding.line)} (${binding.provenance.confidence})`,
      )
    }
    lines.push("")
  }

  if (pack.relationships.length > 0) {
    lines.push(`## Relationships`)
    for (const rel of pack.relationships.slice(0, 40)) {
      if (rel.kind === "reference") {
        lines.push(
          `- reference at ${rel.file ? lineRef(rel.file, rel.line ?? 0) : "(unknown)"} [${rel.provenance.source}]`,
        )
      } else {
        const from = rel.from?.qualifiedName ?? "(unknown)"
        const to = rel.to?.qualifiedName ?? "(unknown)"
        lines.push(`- ${rel.kind}: ${from} -> ${to} [${rel.provenance.source}]`)
      }
    }
    lines.push("")
  }

  if (pack.heuristicBindings.length > 0) {
    lines.push(`## Heuristic Signals`)
    for (const binding of pack.heuristicBindings) {
      lines.push(
        `- ${binding.kind}: ${binding.label} at ${lineRef(binding.file, binding.line)} (${binding.provenance.confidence})`,
      )
    }
    lines.push("")
  }

  if (pack.impact) {
    lines.push(`## Impact`)
    lines.push(
      `Seeds=${pack.impact.seedCount}, affectedSymbols=${pack.impact.affectedSymbolCount}, affectedFiles=${pack.impact.affectedFileCount}, truncated=${pack.impact.truncated}`,
    )
    for (const item of pack.impact.symbols.slice(0, 10)) {
      lines.push(
        `- [${item.distance}] ${item.symbol.qualifiedName} (${lineRef(item.symbol.file, item.symbol.range.start.line)})`,
      )
    }
    lines.push("")
  }

  if (pack.snippets.length > 0) {
    lines.push(`## Snippets`)
    for (const snippet of pack.snippets) {
      lines.push(`### ${snippet.symbol.qualifiedName} (${lineRef(snippet.file, snippet.startLine)})`)
      lines.push("```ts")
      lines.push(snippet.text)
      lines.push("```")
    }
    lines.push("")
  }

  lines.push(`## Recommendations`)
  for (const recommendation of pack.recommendations) {
    lines.push(`- ${recommendation}`)
  }
  if (pack.omitted.symbols || pack.omitted.snippets || pack.omitted.relationships) {
    lines.push(
      `- Omitted: symbols=${pack.omitted.symbols}, snippets=${pack.omitted.snippets}, relationships=${pack.omitted.relationships}.`,
    )
  }

  return lines.join("\n")
}

export namespace GraphContext {
  export type SeedInput = Seed
  export type Options = BuildContextOptions
  export type Pack = GraphContextPack

  export async function build(projectID: ProjectID, opts: BuildContextOptions): Promise<GraphContextPack> {
    const scope = opts.scope ?? "worktree"
    const maxSymbols = Math.min(Math.max(opts.maxSymbols ?? DEFAULT_MAX_SYMBOLS, 1), 20)
    const maxSnippets = Math.min(Math.max(opts.maxSnippets ?? DEFAULT_MAX_SNIPPETS, 0), 12)
    const maxDepth = Math.min(Math.max(opts.maxDepth ?? 1, 1), 3)
    const candidates: CodeIntelligence.Symbol[] = []

    for (const seed of opts.seeds ?? []) {
      if (seed.kind === "symbol") {
        const symbol = CodeIntelligence.getSymbol(projectID, CodeNodeID.make(seed.value), { scope })
        if (symbol) candidates.push(symbol)
      } else if (seed.kind === "file") {
        candidates.push(...CodeIntelligence.symbolsInFile(projectID, seed.value, { scope }))
      } else {
        candidates.push(...CodeIntelligence.findSymbol(projectID, seed.value, { limit: MAX_CANDIDATES, scope }))
        candidates.push(...CodeIntelligence.findSymbolByPrefix(projectID, seed.value, { limit: MAX_CANDIDATES, scope }))
      }
    }

    for (const term of queryTerms(opts.query)) {
      candidates.push(...CodeIntelligence.findSymbol(projectID, term, { limit: MAX_CANDIDATES, scope }))
      candidates.push(...CodeIntelligence.findSymbolByPrefix(projectID, term, { limit: MAX_CANDIDATES, scope }))
    }

    const allSymbols = rankSymbols(opts.query, uniqueByID(candidates))
    const symbols = allSymbols.slice(0, maxSymbols)
    const callersBySeed = new Map<string, CodeIntelligence.CallChainNode[]>()
    const relationships: Relationship[] = []
    let totalRelationships = 0

    for (const symbol of symbols) {
      const callers = CodeIntelligence.findCallers(projectID, symbol.id, { scope }).slice(
        0,
        MAX_RELATIONSHIPS_PER_SYMBOL,
      )
      const callees = CodeIntelligence.findCallees(projectID, symbol.id, { scope }).slice(
        0,
        MAX_RELATIONSHIPS_PER_SYMBOL,
      )
      const refs = CodeIntelligence.findReferences(projectID, symbol.id, { scope }).slice(
        0,
        MAX_RELATIONSHIPS_PER_SYMBOL,
      )
      callersBySeed.set(symbol.id, callers)
      totalRelationships += callers.length + callees.length + refs.length

      for (const caller of callers) {
        relationships.push({
          kind: "caller",
          from: caller.symbol,
          to: symbol,
          provenance: relationshipProvenance("caller"),
        })
      }
      for (const callee of callees) {
        relationships.push({
          kind: "callee",
          from: symbol,
          to: callee.symbol,
          provenance: relationshipProvenance("callee"),
        })
      }
      for (const ref of refs) {
        relationships.push({
          kind: "reference",
          to: symbol,
          file: ref.sourceFile,
          line: ref.range.start.line,
          provenance: relationshipProvenance("reference"),
        })
      }
    }

    const snippets = (await Promise.all(symbols.slice(0, maxSnippets).map((symbol) => readSnippet(symbol)))).filter(
      (item): item is Snippet => item !== undefined,
    )

    const frameworkBindings: FrameworkBinding[] = []
    const heuristicSignals: HeuristicBinding[] = []
    const linesByFile = new Map<string, string[] | undefined>()
    for (const symbol of symbols) {
      if (!linesByFile.has(symbol.file)) linesByFile.set(symbol.file, await readFileLines(symbol.file))
      const lines = linesByFile.get(symbol.file)
      if (!lines) continue
      frameworkBindings.push(...routeBindings(symbol, lines))
      heuristicSignals.push(...heuristicBindings(symbol, lines))
    }

    const impact = opts.includeImpact ? buildImpactSummary(symbols, callersBySeed, maxDepth) : undefined
    const envelope = CodeIntelligence.graphEnvelope(projectID, {
      symbols: symbols.length,
      relationships: relationships.length,
      snippets: snippets.length,
      frameworkBindings: frameworkBindings.length,
      heuristicBindings: heuristicSignals.length,
    })
    const recommendations: string[] = []
    if (symbols.length === 0) {
      recommendations.push("Run or refresh the code index, then retry with a more specific symbol or file seed.")
    } else {
      recommendations.push("Use these graph-selected files and ranges before broad grep/read exploration.")
    }
    if (envelope.degraded || opts.freshness === "requireFresh") {
      recommendations.push(
        "Cross-check reference-sensitive changes with the live lsp tool because the graph may be stale or degraded.",
      )
    }
    if (heuristicSignals.length > 0) {
      recommendations.push("Treat heuristic signals as navigation hints, not proof of runtime behavior.")
    }

    const packWithoutOutput = {
      query: opts.query,
      symbols,
      relationships: relationships.slice(0, 40),
      snippets,
      frameworkBindings: frameworkBindings.slice(0, 20),
      heuristicBindings: heuristicSignals.slice(0, 20),
      impact,
      omitted: {
        symbols: Math.max(0, allSymbols.length - symbols.length),
        snippets: Math.max(0, symbols.length - snippets.length),
        relationships: Math.max(0, totalRelationships - Math.min(totalRelationships, 40)),
      },
      recommendations,
      envelope,
    }

    return {
      ...packWithoutOutput,
      output: formatOutput(packWithoutOutput),
    }
  }
}
