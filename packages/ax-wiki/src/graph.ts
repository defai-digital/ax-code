/** Browser-safe view projection. No filesystem, hashing, or runtime imports. */
import { provenanceOfSymbol } from "./grounding.js"
import type { SymbolProvenance } from "./grounding.js"

export type { SymbolProvenance } from "./grounding.js"
export type GraphFreshness = "fresh" | "stale" | "unknown"
export type SymbolAnchor = {
  name: string
  provenance: SymbolProvenance
}
export type WikiGraphNodeKind = "page" | "source" | "symbol"
export type WikiGraphEdgeKind = "references-source" | "contains" | "uses"
/** Caller-supplied symbol inventory entry; validated strictly at projection. */
export type InventorySymbol = {
  name: string
  qualified: string
  kind: string
}
export type WikiGraphNode = {
  id: string
  kind: WikiGraphNodeKind
  label: string
  path: string
  freshness: GraphFreshness
  /** Total recorded incident relationships, including those omitted from this view. */
  recordedReferences: number
  observedHash?: string
  /**
   * Page nodes carry the recorded manifest summary verbatim; symbol nodes
   * carry the recorded model-written gloss ("" when absent).
   */
  summary: string
  /** Page nodes carry anchored symbols with provenance (v2; [] when absent). */
  symbols: SymbolAnchor[]
  /** Symbol nodes carry "<kind> <qualified>" ("", otherwise). */
  detail: string
  /** Symbol nodes carry the qualified name ("", otherwise). */
  qualified: string
}
export type WikiGraphEdge = {
  from: string
  to: string
  kind: WikiGraphEdgeKind
  freshness: GraphFreshness
  recordedHash?: string
}
/** Reading view of one page. Projected before the node cap, so every page stays readable. */
export type WikiGraphPage = {
  /** The page node id (`page:<path>`), present in `nodes` only when the cap admitted it. */
  id: string
  path: string
  title: string
  purpose: string
  summary: string
  generatedAt: string
  /** Every cited source path, in recorded order (bounded by `sourcesPerPage`). */
  sources: string[]
  /** Counts over `sources` only, so they never exceed the bounded list they describe. */
  stale: number
  unknown: number
  /** Cited sources whose current bytes differ from the recorded hash or are missing. */
  changed: string[]
  /** Listed citations whose evidence cannot be verified for this page; absent in older snapshots. */
  unverified?: string[]
  /**
   * Recorded citations beyond `sources`, which the bounded list cannot name. `stale`
   * and `unknown` above describe that list alone, so a page whose only changed file
   * sits past the cap would read as unchanged while its node is stale. The page's own
   * state has to fold these in; a page projected by an earlier version parses as zeros.
   */
  omitted: { sources: number; stale: number; unknown: number }
  /** Other pages ranked by the number of cited sources they share; a list, never an edge. */
  related: Array<{ id: string; shared: number }>
  /** Page body without frontmatter; "" when the caller supplied none. */
  markdown: string
  truncated: boolean
}
/** Directory coverage of the manifest's indexed sources by cited sources. */
export type WikiGraphArea = { path: string; indexed: number; cited: number }
export type WikiGraphOverview = {
  generatedAt: string
  repositoryHead: string
  model: string
  indexedSources: number
  citedSources: number
  areas: WikiGraphArea[]
}
/** Cited sources grouped by directory, with recorded static imports summed between groups. */
export type WikiGraphModules = {
  rule: string
  groups: Array<{ path: string; files: number }>
  dependencies: Array<{ from: string; to: string; imports: number }>
}
export type WikiGraph = {
  schemaVersion: 1
  snapshot: string
  scope: "wiki-manifest"
  codeRelationships: "unavailable"
  nodes: WikiGraphNode[]
  edges: WikiGraphEdge[]
  omitted: { nodes: number; edges: number }
  /** Optional reading, coverage and module projections; older producers omit them. */
  pages?: WikiGraphPage[]
  overview?: WikiGraphOverview
  modules?: WikiGraphModules
}
export const GRAPH_LIMITS = {
  nodes: 200,
  edges: 500,
  pages: 10_000,
  references: 50_000,
  symbolsPerNode: 32,
  symbolGlosses: 64,
  symbolName: 256,
  summary: 2048,
  detail: 512,
  qualified: 1024,
  pageInfos: 500,
  sourcesPerPage: 400,
  related: 8,
  markdown: 96 * 1024,
  markdownTotal: 1024 * 1024,
  areas: 400,
  areaDepth: 4,
  moduleGroups: 40,
  moduleDependencies: 800,
} as const

/**
 * Characters no projected graph string may contain: C0/C1 control characters
 * (including newline and tab) and Unicode bidi marks. Exported as the single
 * source of truth so the manifest writer can clean recorded model output the
 * same way this projector rejects it, instead of drifting from it.
 */
export const GRAPH_TEXT_FORBIDDEN = /[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object")
  return value as Record<string, unknown>
}
function text(value: unknown, max = 1024): string {
  if (typeof value !== "string" || !value.length || value.length > max || GRAPH_TEXT_FORBIDDEN.test(value))
    throw new Error("Invalid graph text")
  return value
}

/**
 * `text` rejects anything past `max`; this cuts to it instead, on a code-point
 * boundary so a truncated astral character cannot leave a lone surrogate in the
 * output. For fields composed from other bounded fields, where the composition
 * can exceed the field's own budget (`<kind> <qualified>` against `detail`) and
 * throwing would take the whole projection down.
 */
export function cutGraphText(value: string, max: number = GRAPH_LIMITS.detail): string {
  const candidate = value.slice(0, Math.max(0, max))
  const last = candidate.charCodeAt(candidate.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? candidate.slice(0, -1) : candidate
}
export function graphRelativePath(value: unknown): string {
  const result = text(value)
  if (/[\\:?#]/.test(result) || result.split("/").some((part) => !part || part === "." || part === ".."))
    throw new Error("Expected a root-relative graph path")
  return result
}
function hash(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid content hash")
  return value
}
function freshness(value: unknown): GraphFreshness {
  if (value !== "fresh" && value !== "stale" && value !== "unknown") throw new Error("Invalid freshness")
  return value
}
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Invalid count")
  return value
}
function provenance(value: unknown): SymbolProvenance {
  if (value !== "verified" && value !== "inferred" && value !== "unavailable") throw new Error("Invalid provenance")
  return value
}
function summaryText(value: unknown): string {
  if (value === undefined || value === "") return ""
  return text(value, GRAPH_LIMITS.summary)
}
function detailText(value: unknown): string {
  if (value === undefined || value === "") return ""
  return text(value, GRAPH_LIMITS.detail)
}
function qualifiedText(value: unknown): string {
  if (value === undefined || value === "") return ""
  return text(value, GRAPH_LIMITS.qualified)
}
function symbolAnchors(value: unknown): SymbolAnchor[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > GRAPH_LIMITS.symbolsPerNode) throw new Error("Invalid node symbols")
  const seen = new Set<string>()
  return value.map((raw) => {
    const anchor = record(raw)
    const name = text(anchor.name, GRAPH_LIMITS.symbolName)
    if (seen.has(name)) throw new Error("Duplicate node symbol")
    seen.add(name)
    return { name, provenance: provenance(anchor.provenance) }
  })
}
/** Markdown may carry newlines and tabs; every other forbidden character is rejected. */
const MARKDOWN_FORBIDDEN = /[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/
/** Normalize recorded model prose into projectable markdown instead of rejecting a whole manifest. */
export function cleanGraphMarkdown(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(new RegExp(MARKDOWN_FORBIDDEN.source, "g"), "")
}
function markdownText(value: unknown): string {
  if (typeof value !== "string" || value.length > GRAPH_LIMITS.markdown || MARKDOWN_FORBIDDEN.test(value))
    throw new Error("Invalid page markdown")
  return value
}
function optionalText(value: unknown, max = 1024): string {
  return value === "" ? "" : text(value, max)
}
function list(value: unknown, max: number, what: string): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`Invalid ${what}`)
  return value
}
/** Page-level counts over the citations `sources` cannot list; absent in earlier graphs. */
function parsePageOmitted(value: unknown): { sources: number; stale: number; unknown: number } {
  if (value === undefined) return { sources: 0, stale: 0, unknown: 0 }
  const omitted = record(value)
  return { sources: count(omitted.sources), stale: count(omitted.stale), unknown: count(omitted.unknown) }
}

function parsePages(value: unknown): WikiGraphPage[] | undefined {
  if (value === undefined) return undefined
  const ids = new Set<string>()
  let total = 0
  const pages = list(value, GRAPH_LIMITS.pageInfos, "page list").map((raw): WikiGraphPage => {
    const page = record(raw)
    const path = graphRelativePath(page.path)
    const id = text(page.id, 1100)
    if (id !== `page:${path}` || ids.has(id)) throw new Error("Invalid page id")
    ids.add(id)
    const markdown = markdownText(page.markdown)
    if ((total += markdown.length) > GRAPH_LIMITS.markdownTotal) throw new Error("Page markdown exceeds total limit")
    if (typeof page.truncated !== "boolean") throw new Error("Invalid page truncation flag")
    return {
      id,
      path,
      title: text(page.title),
      purpose: summaryText(page.purpose),
      summary: summaryText(page.summary),
      generatedAt: optionalText(page.generatedAt, 64),
      sources: list(page.sources, GRAPH_LIMITS.sourcesPerPage, "page sources").map(graphRelativePath),
      stale: count(page.stale),
      unknown: count(page.unknown),
      changed: list(page.changed, GRAPH_LIMITS.sourcesPerPage, "changed sources").map(graphRelativePath),
      ...(page.unverified === undefined
        ? {}
        : {
            unverified: list(page.unverified, GRAPH_LIMITS.sourcesPerPage, "unverified sources").map(graphRelativePath),
          }),
      // A graph projected before this field existed describes no omitted citations.
      omitted: parsePageOmitted(page.omitted),
      related: list(page.related, GRAPH_LIMITS.related, "related pages").map((entry) => {
        const item = record(entry)
        return { id: text(item.id, 1100), shared: count(item.shared) }
      }),
      markdown,
      truncated: page.truncated,
    }
  })
  for (const page of pages) {
    if (page.unverified === undefined) continue
    const sources = new Set(page.sources)
    const unverified = new Set(page.unverified)
    if (
      unverified.size !== page.unverified.length ||
      unverified.size !== page.unknown ||
      page.unverified.some((source) => !sources.has(source) || page.changed.includes(source))
    )
      throw new Error("Invalid unverified sources")
  }
  for (const page of pages)
    for (const item of page.related)
      if (!ids.has(item.id) || item.id === page.id || item.shared < 1) throw new Error("Invalid related page")
  return pages
}
function parseOverview(value: unknown): WikiGraphOverview | undefined {
  if (value === undefined) return undefined
  const overview = record(value)
  const areas = list(overview.areas, GRAPH_LIMITS.areas, "area list").map((raw) => {
    const area = record(raw)
    const indexed = count(area.indexed),
      cited = count(area.cited)
    if (cited > indexed) throw new Error("Invalid area coverage")
    return { path: area.path === "" ? "" : graphRelativePath(area.path), indexed, cited }
  })
  const indexedSources = count(overview.indexedSources),
    citedSources = count(overview.citedSources)
  return {
    generatedAt: optionalText(overview.generatedAt, 64),
    repositoryHead: optionalText(overview.repositoryHead, 128),
    model: optionalText(overview.model, 256),
    indexedSources,
    citedSources,
    areas,
  }
}
function parseModules(value: unknown): WikiGraphModules | undefined {
  if (value === undefined) return undefined
  const modules = record(value)
  const groups = list(modules.groups, GRAPH_LIMITS.moduleGroups, "module groups").map((raw) => {
    const group = record(raw)
    return { path: group.path === "" ? "" : graphRelativePath(group.path), files: count(group.files) }
  })
  const known = new Set(groups.map((group) => group.path))
  if (known.size !== groups.length) throw new Error("Duplicate module group")
  const pairs = new Set<string>()
  const dependencies = list(modules.dependencies, GRAPH_LIMITS.moduleDependencies, "module dependencies").map((raw) => {
    const dependency = record(raw)
    const from = optionalText(dependency.from),
      to = optionalText(dependency.to)
    const pair = JSON.stringify([from, to])
    if (!known.has(from) || !known.has(to) || from === to || pairs.has(pair))
      throw new Error("Invalid module dependency")
    pairs.add(pair)
    const imports = count(dependency.imports)
    if (imports < 1) throw new Error("Invalid module dependency")
    return { from, to, imports }
  })
  return { rule: text(modules.rule, 256), groups, dependencies }
}
/** Validate and detach an allowlisted graph; extra producer fields never reach exports. */
export function parseWikiGraph(input: unknown): WikiGraph {
  const value = record(input)
  if (value.schemaVersion !== 1 || value.scope !== "wiki-manifest" || value.codeRelationships !== "unavailable")
    throw new Error("Unsupported Wiki graph schema")
  if (
    !Array.isArray(value.nodes) ||
    value.nodes.length > GRAPH_LIMITS.nodes ||
    !Array.isArray(value.edges) ||
    value.edges.length > GRAPH_LIMITS.edges
  )
    throw new Error("Graph exceeds view limits")
  const ids = new Map<string, WikiGraphNode>()
  const nodes = value.nodes.map((raw): WikiGraphNode => {
    const node = record(raw)
    if (node.kind !== "page" && node.kind !== "source" && node.kind !== "symbol")
      throw new Error("Unsupported node kind")
    const id = text(node.id, 1100)
    if (ids.has(id)) throw new Error("Duplicate node id")
    const parsed: WikiGraphNode = {
      id,
      kind: node.kind,
      label: text(node.label),
      path: graphRelativePath(node.path),
      freshness: freshness(node.freshness),
      recordedReferences: count(node.recordedReferences),
      observedHash: hash(node.observedHash),
      summary: summaryText(node.summary),
      symbols: symbolAnchors(node.symbols),
      detail: detailText(node.detail),
      qualified: qualifiedText(node.qualified),
    }
    ids.set(id, parsed)
    return parsed
  })
  const pairs = new Set<string>()
  const edges = value.edges.map((raw): WikiGraphEdge => {
    const edge = record(raw)
    const from = text(edge.from, 1100),
      to = text(edge.to, 1100)
    const kind = edge.kind
    if (kind !== "references-source" && kind !== "contains" && kind !== "uses")
      throw new Error("Invalid graph relationship or endpoint")
    const fromKind = ids.get(from)?.kind
    const toKind = ids.get(to)?.kind
    if (kind === "references-source" && (fromKind !== "page" || toKind !== "source"))
      throw new Error("Invalid graph relationship or endpoint")
    if (kind === "contains" && (fromKind !== "source" || toKind !== "symbol"))
      throw new Error("Invalid graph relationship or endpoint")
    if (kind === "uses" && (fromKind !== "source" || toKind !== "source" || from === to))
      throw new Error("Invalid graph relationship or endpoint")
    const pair = JSON.stringify([from, to])
    if (pairs.has(pair)) throw new Error("Duplicate relationship")
    pairs.add(pair)
    return {
      from,
      to,
      kind,
      freshness: freshness(edge.freshness),
      recordedHash: hash(edge.recordedHash),
    }
  })
  // recordedReferences counts references-source relationships only; contains
  // and uses edges are inventory-derived and covered by omission accounting
  // instead.
  const incidents = new Map<string, number>()
  for (const edge of edges) {
    if (edge.kind !== "references-source") continue
    for (const id of [edge.from, edge.to]) incidents.set(id, (incidents.get(id) ?? 0) + 1)
  }
  for (const node of nodes) {
    if (node.recordedReferences < (incidents.get(node.id) ?? 0) || node.recordedReferences > GRAPH_LIMITS.references)
      throw new Error("Invalid recorded relationship count")
  }
  const omitted = record(value.omitted)
  const graph: WikiGraph = {
    schemaVersion: 1,
    snapshot: text(value.snapshot, 128),
    scope: "wiki-manifest",
    codeRelationships: "unavailable",
    nodes,
    edges,
    omitted: { nodes: count(omitted.nodes), edges: count(omitted.edges) },
  }
  const pages = parsePages(value.pages)
  const overview = parseOverview(value.overview)
  const modules = parseModules(value.modules)
  if (pages) graph.pages = pages
  if (overview) graph.overview = overview
  if (modules) graph.modules = modules
  return graph
}

/** Project recorded membership only. Missing observations are unknown, never fresh. */
export function projectWikiManifest(
  input: unknown,
  options: {
    snapshot: string
    observed?: ReadonlyMap<string, string | null>
    /** Bounded source excerpts keyed by root-relative path, used for symbol provenance. */
    sourceContents?: ReadonlyMap<string, string>
    /** Caller-supplied symbol inventory keyed by root-relative source path. */
    inventory?: ReadonlyMap<string, InventorySymbol[]>
    /** Caller-supplied resolved import targets keyed by root-relative source path. */
    imports?: ReadonlyMap<string, string[]>
    /** Page bodies without frontmatter, keyed by the manifest page path. */
    documents?: ReadonlyMap<string, string>
  },
): WikiGraph {
  const manifest = record(input)
  if (manifest.schemaVersion !== 1 || manifest.generator !== "ax-wiki") throw new Error("Unsupported Wiki manifest")
  const pages = Object.entries(record(manifest.pages)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  if (pages.length > GRAPH_LIMITS.pages) throw new Error("Manifest exceeds page limit")
  const allNodes = new Map<string, WikiGraphNode>()
  const allEdges: WikiGraphEdge[] = []
  type PageGloss = { name: string; summary: string }
  // One source is visited per citing page; without this guard its
  // inventory-derived edges would repeat and fail pair validation.
  const pushedPairs = new Set<string>()
  const pushEdge = (edge: WikiGraphEdge) => {
    const pair = `${edge.kind} ${edge.from} ${edge.to}`
    if (pushedPairs.has(pair)) return
    pushedPairs.add(pair)
    allEdges.push(edge)
  }
  const citedByPage: Array<{
    id: string
    cited: string[]
    glosses: PageGloss[]
    purpose: string
    generatedAt: string
  }> = []
  let references = 0
  for (const [pagePath, raw] of pages) {
    const page = record(raw)
    const location = graphRelativePath(pagePath)
    if (!Array.isArray(page.sources) || (references += page.sources.length) > GRAPH_LIMITS.references)
      throw new Error("Manifest exceeds reference limit")
    const hashes = record(page.sourceHashes)
    const cited = [...new Set(page.sources.map(graphRelativePath))].sort()
    const reported = page.symbols === undefined ? [] : page.symbols
    if (!Array.isArray(reported)) throw new Error("Invalid page symbols")
    const glossRaw = page.symbolSummaries === undefined ? [] : page.symbolSummaries
    if (!Array.isArray(glossRaw) || glossRaw.length > GRAPH_LIMITS.symbolGlosses)
      throw new Error("Manifest exceeds symbol gloss limit")
    const glosses = glossRaw.map((raw) => {
      const gloss = record(raw)
      return { name: text(gloss.name, GRAPH_LIMITS.symbolName), summary: summaryText(gloss.summary) }
    })
    // The generator records more symbols per page than a node may carry, so
    // the per-node cap is a view cap like nodes and edges, never a reason to
    // reject the manifest. Every recorded name is still validated; glossed
    // names are kept first, then the rest in recorded order.
    const names = [...new Set(reported.map((raw) => text(raw, GRAPH_LIMITS.symbolName)))]
    const glossed = new Set(glosses.map((gloss) => gloss.name))
    const kept = new Set(
      [...new Set([...names.filter((name) => glossed.has(name)), ...names])].slice(0, GRAPH_LIMITS.symbolsPerNode),
    )
    const excerpts = cited
      .map((source) => options.sourceContents?.get(source))
      .filter((value): value is string => value !== undefined)
    const supplied = excerpts.length > 0 ? excerpts : undefined
    const id = `page:${location}`
    const node: WikiGraphNode = {
      id,
      kind: "page",
      path: location,
      label: text(page.title),
      freshness: "unknown",
      recordedReferences: 0,
      summary: summaryText(page.summary),
      symbols: names
        .filter((name) => kept.has(name))
        .map((name) => ({
          name,
          provenance: provenanceOfSymbol(name, supplied),
        })),
      detail: "",
      qualified: "",
    }
    allNodes.set(id, node)
    citedByPage.push({
      id,
      cited,
      glosses,
      purpose: recordedText(page.purpose, GRAPH_LIMITS.summary),
      generatedAt: recordedText(page.generatedAt, 64),
    })
    const states: GraphFreshness[] = []
    for (const source of cited) {
      const recordedHash = hash(Object.hasOwn(hashes, source) ? hashes[source] : undefined)
      const observation = options.observed?.get(source)
      const observed = observation === null ? null : hash(observation)
      const state: GraphFreshness =
        observed === null
          ? "stale"
          : observed === undefined || recordedHash === undefined
            ? "unknown"
            : observed === recordedHash
              ? "fresh"
              : "stale"
      const target = `source:${source}`
      const existing = allNodes.get(target)
      const combined =
        existing?.freshness === "stale" || state === "stale"
          ? "stale"
          : existing?.freshness === "unknown" || state === "unknown"
            ? "unknown"
            : "fresh"
      allNodes.set(target, {
        id: target,
        kind: "source",
        path: source,
        label: source,
        freshness: combined,
        recordedReferences: (existing?.recordedReferences ?? 0) + 1,
        observedHash: observed ?? undefined,
        summary: "",
        symbols: [],
        detail: "",
        qualified: "",
      })
      pushEdge({ from: id, to: target, kind: "references-source", freshness: state, recordedHash })
      states.push(state)
      node.recordedReferences++
    }
    node.freshness = states.includes("stale")
      ? "stale"
      : !states.length || states.includes("unknown")
        ? "unknown"
        : "fresh"
  }
  // Glosses attach by bare symbol name; pages are already sorted, so the
  // first citing page wins deterministically when several gloss one name.
  const glossBySource = new Map<string, Map<string, string>>()
  for (const { cited, glosses } of citedByPage) {
    for (const source of cited) {
      let map = glossBySource.get(source)
      if (!map) {
        map = new Map()
        glossBySource.set(source, map)
      }
      for (const gloss of glosses) if (!map.has(gloss.name)) map.set(gloss.name, gloss.summary)
    }
  }
  // Inventory-derived symbol nodes and edges. Admission order is decided
  // afterwards, so a page's symbol inventory can never starve later pages.
  const symbolsBySource = new Map<string, WikiGraphNode[]>()
  for (const { cited } of citedByPage) {
    for (const source of cited) {
      const target = `source:${source}`
      const sourceNode = allNodes.get(target)
      if (!sourceNode || symbolsBySource.has(source)) continue
      const symbols: WikiGraphNode[] = []
      symbolsBySource.set(source, symbols)
      const seen = new Set<string>()
      for (const raw of options.inventory?.get(source) ?? []) {
        const item = record(raw)
        const name = text(item.name, GRAPH_LIMITS.symbolName)
        const qualified = text(item.qualified, GRAPH_LIMITS.qualified)
        const kind = text(item.kind, 64)
        if (seen.has(qualified)) continue
        seen.add(qualified)
        const symbolId = text(`symbol:${source}#${qualified}`, 1100)
        symbols.push({
          id: symbolId,
          kind: "symbol",
          label: name,
          path: source,
          freshness: sourceNode.freshness,
          recordedReferences: 0,
          summary: glossBySource.get(source)?.get(name) ?? "",
          symbols: [],
          // `qualified` has its own, larger budget, so the composed label is cut
          // to the `detail` field rather than aborting the whole projection.
          detail: cutGraphText(`${kind} ${qualified}`),
          qualified,
        })
        pushEdge({ from: target, to: symbolId, kind: "contains", freshness: sourceNode.freshness })
      }
      // Resolved static imports between cited sources. Targets outside the
      // manifest membership never become edges; self imports are meaningless.
      for (const raw of options.imports?.get(source) ?? []) {
        const resolved = graphRelativePath(raw)
        if (resolved === source) continue
        const targetNode = allNodes.get(`source:${resolved}`)
        if (!targetNode) continue
        const freshness =
          sourceNode.freshness === "stale" || targetNode.freshness === "stale"
            ? "stale"
            : sourceNode.freshness === "unknown" || targetNode.freshness === "unknown"
              ? "unknown"
              : "fresh"
        pushEdge({ from: target, to: `source:${resolved}`, kind: "uses", freshness })
      }
    }
  }
  // Fair admission under the view cap: every page first, then cited sources
  // round-robin across pages (widely shared sources first within a page),
  // then symbols round-robin across admitted sources.
  const ordered: WikiGraphNode[] = []
  const emitted = new Set<string>()
  const emit = (node: WikiGraphNode | undefined) => {
    if (!node || emitted.has(node.id)) return
    emitted.add(node.id)
    ordered.push(node)
  }
  for (const { id } of citedByPage) emit(allNodes.get(id))
  const queues = citedByPage.map(({ cited }) =>
    [...cited].sort(
      (a, b) =>
        allNodes.get(`source:${b}`)!.recordedReferences - allNodes.get(`source:${a}`)!.recordedReferences ||
        compareText(a, b),
    ),
  )
  for (let round = 0; queues.some((queue) => round < queue.length); round++)
    for (const queue of queues) if (round < queue.length) emit(allNodes.get(`source:${queue[round]}`))
  const sourceOrder = ordered.filter((node) => node.kind === "source").map((node) => node.path)
  for (let round = 0; sourceOrder.some((source) => round < (symbolsBySource.get(source)?.length ?? 0)); round++)
    for (const source of sourceOrder) emit(symbolsBySource.get(source)?.[round])
  const nodes = ordered.slice(0, GRAPH_LIMITS.nodes)
  const selected = new Set(nodes.map((node) => node.id))
  const rank = { "references-source": 0, uses: 1, contains: 2 } as const
  const edges = allEdges
    .filter((edge) => selected.has(edge.from) && selected.has(edge.to))
    .sort((a, b) => rank[a.kind] - rank[b.kind])
    .slice(0, GRAPH_LIMITS.edges)
  return parseWikiGraph({
    schemaVersion: 1,
    snapshot: options.snapshot,
    scope: "wiki-manifest",
    codeRelationships: "unavailable",
    nodes,
    edges,
    omitted: { nodes: ordered.length - nodes.length, edges: allEdges.length - edges.length },
    pages: projectPages(citedByPage, allNodes, allEdges, options.documents),
    overview: projectOverview(manifest, allNodes),
    modules: projectModules(allNodes, allEdges),
  })
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Optional recorded prose: kept when projectable, otherwise left out rather than failing the manifest. */
function recordedText(value: unknown, max: number): string {
  return typeof value === "string" && value.length <= max && !GRAPH_TEXT_FORBIDDEN.test(value) ? value : ""
}

function projectPages(
  citedByPage: Array<{ id: string; cited: string[]; purpose: string; generatedAt: string }>,
  allNodes: ReadonlyMap<string, WikiGraphNode>,
  allEdges: readonly WikiGraphEdge[],
  documents: ReadonlyMap<string, string> | undefined,
): WikiGraphPage[] {
  const citing = new Map<string, string[]>()
  for (const { id, cited } of citedByPage)
    for (const source of cited) citing.set(source, [...(citing.get(source) ?? []), id])
  const states = new Map<string, Map<string, GraphFreshness>>()
  for (const edge of allEdges) {
    if (edge.kind !== "references-source") continue
    const map = states.get(edge.from) ?? new Map<string, GraphFreshness>()
    map.set(edge.to, edge.freshness)
    states.set(edge.from, map)
  }
  let budget: number = GRAPH_LIMITS.markdownTotal
  return citedByPage.slice(0, GRAPH_LIMITS.pageInfos).map(({ id, cited, purpose, generatedAt }) => {
    const node = allNodes.get(id)!
    const shared = new Map<string, number>()
    for (const source of cited)
      for (const other of citing.get(source) ?? []) if (other !== id) shared.set(other, (shared.get(other) ?? 0) + 1)
    const related = [...shared]
      .filter(([other]) => citedByPage.findIndex((page) => page.id === other) < GRAPH_LIMITS.pageInfos)
      .sort(([a, x], [b, y]) => y - x || compareText(a, b))
      .slice(0, GRAPH_LIMITS.related)
      .map(([other, count]) => ({ id: other, shared: count }))
    const visible = cited.slice(0, GRAPH_LIMITS.sourcesPerPage)
    const listed = new Set(visible)
    // Freshness describes the same bounded source list the page exposes: with
    // more recorded citations than sourcesPerPage, uncapped counts would exceed
    // the cited-file total the viewer renders (and `changed` could name files
    // missing from `sources`). The citations past the cap are accounted for
    // separately, so the page's own state can still agree with its node: the node
    // aggregates every recorded citation, the bounded counters cannot.
    const listedStates: GraphFreshness[] = []
    const omittedStates: GraphFreshness[] = []
    const listedChanged: string[] = []
    const listedUnverified: string[] = []
    for (const [source, state] of states.get(id) ?? []) {
      const sourcePath = source.slice("source:".length)
      if (!listed.has(sourcePath)) {
        omittedStates.push(state)
        continue
      }
      listedStates.push(state)
      if (state === "stale") listedChanged.push(sourcePath)
      if (state === "unknown") listedUnverified.push(sourcePath)
    }
    const body = cleanGraphMarkdown(documents?.get(node.path) ?? "")
    const allowed = Math.max(0, Math.min(GRAPH_LIMITS.markdown, budget))
    let markdown = body
    if (body.length > allowed) {
      const cut = body.lastIndexOf("\n", allowed)
      markdown = body.slice(0, cut > allowed / 2 ? cut : allowed)
    }
    budget -= markdown.length
    return {
      id,
      path: node.path,
      title: node.label,
      purpose,
      summary: node.summary,
      generatedAt,
      sources: visible,
      stale: listedStates.filter((state) => state === "stale").length,
      unknown: listedStates.filter((state) => state === "unknown").length,
      changed: listedChanged,
      unverified: listedUnverified,
      omitted: {
        sources: omittedStates.length,
        stale: omittedStates.filter((state) => state === "stale").length,
        unknown: omittedStates.filter((state) => state === "unknown").length,
      },
      related,
      markdown,
      truncated: markdown.length < body.length,
    }
  })
}

/** Directory prefixes of a root-relative file path, shallowest first, bounded by `areaDepth`. */
function directories(file: string): string[] {
  const parts = file.split("/").slice(0, -1).slice(0, GRAPH_LIMITS.areaDepth)
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"))
}

function projectOverview(manifest: Record<string, unknown>, allNodes: ReadonlyMap<string, WikiGraphNode>) {
  const cited = new Set([...allNodes.values()].filter((node) => node.kind === "source").map((node) => node.path))
  const inventory =
    manifest.sources && typeof manifest.sources === "object" && !Array.isArray(manifest.sources)
      ? Object.keys(manifest.sources).filter((file) => {
          try {
            return graphRelativePath(file) === file
          } catch {
            return false
          }
        })
      : []
  // A cited file the inventory does not list still exists as recorded evidence.
  const indexed = new Set([...inventory, ...cited])
  const areas = new Map<string, WikiGraphArea>([["", { path: "", indexed: 0, cited: 0 }]])
  for (const file of indexed) {
    for (const directory of ["", ...directories(file)]) {
      const area = areas.get(directory) ?? { path: directory, indexed: 0, cited: 0 }
      area.indexed++
      if (cited.has(file)) area.cited++
      areas.set(directory, area)
    }
  }
  // Keep shallow areas first, then the largest; a kept area's parent is always kept.
  const kept = [...areas.values()]
    .sort(
      (a, b) =>
        (a.path ? a.path.split("/").length : 0) - (b.path ? b.path.split("/").length : 0) ||
        b.indexed - a.indexed ||
        compareText(a.path, b.path),
    )
    .slice(0, GRAPH_LIMITS.areas)
  return {
    generatedAt: recordedText(manifest.generatedAt, 64),
    repositoryHead: recordedText(manifest.repositoryHead, 128),
    model: recordedText(manifest.model, 256),
    indexedSources: indexed.size,
    citedSources: cited.size,
    areas: kept,
  }
}

/**
 * Split the largest directory group into its sizeable child directories until
 * the group budget is reached, so busy trees get finer groups than quiet ones.
 * Child directories with only a few cited files stay in their parent group.
 */
function projectModules(allNodes: ReadonlyMap<string, WikiGraphNode>, allEdges: readonly WikiGraphEdge[]) {
  const files = [...allNodes.values()].filter((node) => node.kind === "source").map((node) => node.path)
  const minimum = Math.max(3, Math.ceil(files.length * 0.015))
  const groupOf = new Map<string, string>(files.map((file) => [file, ""]))
  const childOf = (file: string, group: string) => {
    const rest = (group ? file.slice(group.length + 1) : file).split("/")
    return rest.length > 1 ? (group ? `${group}/${rest[0]}` : rest[0]) : group
  }
  const unsplittable = new Set<string>()
  for (;;) {
    const members = new Map<string, string[]>()
    for (const [file, group] of groupOf) members.set(group, [...(members.get(group) ?? []), file])
    const next = [...members]
      .filter(([group]) => !unsplittable.has(group))
      .sort(([a, x], [b, y]) => y.length - x.length || compareText(a, b))[0]
    if (!next || next[1].length < minimum) break
    const [group, groupFiles] = next
    const children = new Map<string, string[]>()
    for (const file of groupFiles) {
      const child = childOf(file, group)
      if (child !== group) children.set(child, [...(children.get(child) ?? []), file])
    }
    const sizeable = [...children].filter(([, list]) => list.length >= minimum)
    const residual = groupFiles.length - sizeable.reduce((sum, [, list]) => sum + list.length, 0)
    if (!sizeable.length || members.size - 1 + sizeable.length + (residual > 0 ? 1 : 0) > GRAPH_LIMITS.moduleGroups) {
      unsplittable.add(group)
      continue
    }
    for (const [child, list] of sizeable) for (const file of list) groupOf.set(file, child)
    if (residual > 0) unsplittable.add(group)
  }
  const counts = new Map<string, number>()
  for (const group of groupOf.values()) counts.set(group, (counts.get(group) ?? 0) + 1)
  const imports = new Map<string, { from: string; to: string; imports: number }>()
  for (const edge of allEdges) {
    if (edge.kind !== "uses") continue
    const from = groupOf.get(edge.from.slice("source:".length))
    const to = groupOf.get(edge.to.slice("source:".length))
    if (from === undefined || to === undefined || from === to) continue
    const pair = `${from}\u0000${to}`
    const entry = imports.get(pair) ?? { from, to, imports: 0 }
    entry.imports++
    imports.set(pair, entry)
  }
  return {
    rule: `Cited files grouped by directory: the largest groups split first into subdirectories with at least ${minimum} cited files, at most ${GRAPH_LIMITS.moduleGroups} groups`,
    groups: [...counts].sort(([a], [b]) => compareText(a, b)).map(([path, count]) => ({ path, files: count })),
    dependencies: [...imports.values()]
      .sort((a, b) => b.imports - a.imports || compareText(a.from, b.from) || compareText(a.to, b.to))
      .slice(0, GRAPH_LIMITS.moduleDependencies),
  }
}
