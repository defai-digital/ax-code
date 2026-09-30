// The filesystem-free core of the AX Wiki build pipeline.
//
// `buildPure` is a deterministic compiler over already-resolved inputs: it plans
// pages, selects + requests evidence, runs the injected generator, renders and
// merges protected sections, builds the manifest, validates, and computes removals.
// It performs NO filesystem, git, or network access — all effects cross the injected
// `evidenceReader` and `readExistingPage` callbacks. The Node wiring (`build.ts` →
// `buildAxWiki`) supplies the real fs/git implementations; tests supply in-memory
// ones. This split is what makes the `core` purity invariant enforceable.
//
// Behavior is byte-for-byte the same as the previous inline implementation in
// `build.ts`; only the effect boundaries moved.

import { fingerprintEvidenceBundle, renderEvidenceBundle, type EvidenceBundle } from "./contracts.js"
import { mapWithBoundedConcurrency } from "./discovery-concurrency.js"
import { parseFrontmatter, renderWikiPage } from "./frontmatter.js"
import { sha256, stableJson } from "./hash.js"
import type { EvidenceProvider } from "./ports.js"
import { createWikiPlan, selectPageSources, sourceMatchesPage } from "./plan.js"
import { extractProtectedSections, managedContentHash, mergeProtectedSections } from "./protected.js"
import type {
  AxWikiConfig,
  GeneratorIdentity,
  WikiAction,
  WikiBuildProgress,
  WikiGraphContextProvider,
  WikiManifest,
  WikiManifestPage,
  WikiPageGenerationResult,
  WikiPageGenerator,
  WikiPlan,
  WikiPlanPage,
  WikiSource,
  WikiValidationReport,
} from "./types.js"
import { AX_WIKI_GENERATOR, SYMBOL_SUMMARIES_MAX, SYMBOL_SUMMARY_MAX } from "./types.js"
import type { SymbolSummary } from "./types.js"
import { validateWikiCandidate } from "./validate.js"

/**
 * Bound recorded glosses: trimmed, first per name wins, capped in count and
 * length. Never invents content; over-cap input is cut, not failed.
 */
function sanitizeGlosses(glosses: readonly SymbolSummary[] | undefined): SymbolSummary[] {
  const seen = new Set<string>()
  const output: SymbolSummary[] = []
  for (const gloss of glosses ?? []) {
    if (output.length >= SYMBOL_SUMMARIES_MAX) break
    if (!gloss || typeof gloss.name !== "string" || typeof gloss.summary !== "string") continue
    const name = gloss.name.trim()
    const summary = gloss.summary.trim()
    if (!name || !summary || seen.has(name)) continue
    seen.add(name)
    output.push({ name, summary: summary.slice(0, SYMBOL_SUMMARY_MAX).trimEnd() })
  }
  return output
}

/** A source with the evidence slice read for a page. */
export type WikiSourceEvidence = WikiSource & { content: string; truncated: boolean }

/** Bounded parallelism for existing-page reads (plain file I/O). */
const PAGE_READ_CONCURRENCY = 8
/** Bounded parallelism for evidence prefetch (LSP/graph queries are heavier). */
const EVIDENCE_FETCH_CONCURRENCY = 4

/** Reads evidence content for a set of selected sources. Injected effect. */
export type WikiEvidenceReader = (input: {
  sources: WikiSource[]
  maxTotalBytes: number
}) => Promise<WikiSourceEvidence[]>

export type WikiBuildPureInput = {
  signal?: AbortSignal
  allowWrite?: (relative: string) => boolean
  root: string
  wikiDir: string
  action: WikiAction
  sources: WikiSource[]
  config: AxWikiConfig
  previous?: WikiManifest
  generator: WikiPageGenerator
  evidenceReader: WikiEvidenceReader
  readExistingPage: (pagePath: string) => Promise<string | undefined>
  graphContext?: WikiGraphContextProvider
  /**
   * Canonical typed evidence. When set, each planned page is resolved once and
   * the cached bundle is reused for fingerprinting and generation. Takes
   * precedence over `graphContext`.
   */
  evidenceProvider?: EvidenceProvider
  model?: string
  repositoryHead?: string
  force?: boolean
  now?: () => Date
  onProgress?: (progress: WikiBuildProgress) => void
  /** Gate C5: generator identity folded into each page fingerprint. */
  generatorIdentity?: GeneratorIdentity
  /** Gate C5: content-derived semantic revision (never a timestamp/moving cursor). */
  semanticRevision?: string
}

export type WikiBuildPureResult = {
  plan: WikiPlan
  generated: Map<string, { content: string; result: WikiPageGenerationResult; sources: WikiSourceEvidence[] }>
  candidate: Map<string, string>
  manifest: WikiManifest
  validation: WikiValidationReport
  removedPages: string[]
  conflicts: string[]
  generatedPages: string[]
  unchangedPages: string[]
  existingPages: Map<string, string>
  /**
   * Pages whose generation failed. On the `update` lane the build continues and
   * publishes the pages that succeeded (ADR-156); the `generate` lane throws
   * instead and this stays empty.
   */
  failedPages: { path: string; error: string }[]
}

function sourceHashMap(sources: WikiSource[]): Record<string, string> {
  return Object.fromEntries(sources.map((source) => [source.path, source.hash]))
}

function changedSources(previous: WikiManifest | undefined, current: Record<string, string>): Set<string> {
  if (!previous) return new Set(Object.keys(current))
  const changed = new Set<string>()
  for (const [file, hash] of Object.entries(current)) if (previous.sources[file] !== hash) changed.add(file)
  for (const file of Object.keys(previous.sources)) if (!(file in current)) changed.add(file)
  return changed
}

function pageFingerprint(input: {
  config: AxWikiConfig
  sourceHashes: Record<string, string>
  generatorIdentity?: GeneratorIdentity
  model?: string
  semanticRevision?: string
  evidenceFingerprint?: string
}): string {
  return sha256(
    stableJson({
      config: input.config,
      sourceHashes: input.sourceHashes,
      generatorIdentity: input.generatorIdentity ?? null,
      model: input.model ?? null,
      semanticRevision: input.semanticRevision ?? null,
      ...(input.evidenceFingerprint !== undefined ? { evidence: input.evidenceFingerprint } : {}),
    }),
  )
}

type CachedPageEvidence = {
  selected: WikiSource[]
  bundle?: EvidenceBundle
}

function pageNeedsGeneration(input: {
  action: "generate" | "update"
  page: WikiPlanPage
  previous?: WikiManifest
  planHash: string
  changed: Set<string>
  exists: boolean
  fingerprintChanged: boolean
}): boolean {
  if (!input.exists || !input.previous) return true
  if (input.action === "generate") return true
  if (input.previous.planHash !== input.planHash) return true
  if (input.fingerprintChanged) return true
  return [...input.changed].some((file) => sourceMatchesPage(file, input.page))
}

function ensureUsefulResult(page: WikiPlanPage, result: WikiPageGenerationResult): void {
  if (!result.summary?.trim()) throw new Error(`AX Wiki generator returned no summary for ${page.path}`)
  if (!result.body?.trim() || result.body.trim().length < 80) {
    throw new Error(`AX Wiki generator returned insufficient content for ${page.path}`)
  }
}

function generatedPageIsUnmodified(content: string, manifestPage: WikiManifestPage | undefined): boolean {
  if (!manifestPage) return false
  return managedContentHash(content) === manifestPage.managedHash
}

export async function buildPure(input: WikiBuildPureInput): Promise<WikiBuildPureResult> {
  const { sources, config, previous, action, force, onProgress } = input

  const plan = createWikiPlan(sources, config)
  const planHash = sha256(stableJson(plan))
  onProgress?.({ type: "plan", pageCount: plan.pages.length })
  for (const page of plan.pages) {
    if (input.allowWrite?.(`${input.wikiDir}/${page.path}`) === false)
      throw new Error("Wiki output write permission is not allowed")
  }
  if (input.allowWrite?.(`${input.wikiDir}/.manifest.json`) === false)
    throw new Error("Wiki manifest write permission is not allowed")
  const currentSourceHashes = sourceHashMap(sources)
  const changed = changedSources(previous, currentSourceHashes)
  const existing = new Map<string, string>()
  const candidatePaths = [...new Set([...plan.pages.map((item) => item.path), ...Object.keys(previous?.pages ?? {})])]
  const existingReads = await mapWithBoundedConcurrency(candidatePaths, PAGE_READ_CONCURRENCY, async (page) => {
    input.signal?.throwIfAborted()
    return [page, await input.readExistingPage(page)] as const
  })
  for (const [page, content] of existingReads) {
    if (content !== undefined) existing.set(page, content)
  }

  const pageCache = new Map<string, CachedPageEvidence>()
  for (const page of plan.pages) {
    pageCache.set(page.path, { selected: selectPageSources(sources, page, config.maxSourcesPerPage ?? 80) })
  }
  if (input.evidenceProvider) {
    const provider = input.evidenceProvider
    // Prefetch every page's typed evidence with bounded concurrency; results are
    // keyed by page path, so fingerprints stay deterministic regardless of
    // completion order.
    const bundles = await mapWithBoundedConcurrency(plan.pages, EVIDENCE_FETCH_CONCURRENCY, async (page) => {
      input.signal?.throwIfAborted()
      const cached = pageCache.get(page.path)!
      return [page.path, await provider.provide({ root: input.root, page, sources: cached.selected })] as const
    })
    for (const [pagePath, bundle] of bundles) pageCache.get(pagePath)!.bundle = bundle
  }
  const prospectiveFingerprints = new Map<string, string>()
  for (const page of plan.pages) {
    input.signal?.throwIfAborted()
    const cached = pageCache.get(page.path)!
    prospectiveFingerprints.set(
      page.path,
      pageFingerprint({
        config,
        sourceHashes: Object.fromEntries(cached.selected.map((source) => [source.path, source.hash])),
        generatorIdentity: input.generatorIdentity,
        model: input.model,
        semanticRevision: input.semanticRevision,
        evidenceFingerprint: cached.bundle ? fingerprintEvidenceBundle(cached.bundle) : undefined,
      }),
    )
  }

  const conflicts: string[] = []
  const targets: WikiPlanPage[] = []
  for (const page of plan.pages) {
    input.signal?.throwIfAborted()
    const content = existing.get(page.path)
    const previousPage = previous?.pages[page.path]
    const fingerprintChanged =
      previousPage !== undefined && previousPage.fingerprint !== prospectiveFingerprints.get(page.path)
    if (
      !pageNeedsGeneration({
        action,
        page,
        previous,
        planHash,
        changed,
        exists: content !== undefined,
        fingerprintChanged,
      })
    )
      continue
    if (
      content !== undefined &&
      previous?.pages[page.path] &&
      !generatedPageIsUnmodified(content, previous.pages[page.path]) &&
      !force
    ) {
      conflicts.push(page.path)
      continue
    }
    targets.push(page)
  }
  if (conflicts.length) {
    throw new Error(
      `AX Wiki will not overwrite manually modified generated pages: ${conflicts.join(", ")}. ` +
        `Move durable edits into AX-WIKI:PROTECTED markers or rerun with --force.`,
    )
  }

  const generated = new Map<
    string,
    { content: string; result: WikiPageGenerationResult; sources: WikiSourceEvidence[] }
  >()
  const failedPages: { path: string; error: string }[] = []
  for (let index = 0; index < targets.length; index++) {
    input.signal?.throwIfAborted()
    const page = targets[index]!
    onProgress?.({ type: "page_start", path: page.path, index: index + 1, total: targets.length })
    const cached = pageCache.get(page.path)
    const selected = cached?.selected ?? selectPageSources(sources, page, config.maxSourcesPerPage ?? 80)
    const evidence = await input.evidenceReader({
      sources: selected,
      maxTotalBytes: config.maxPageSourceBytes ?? 160_000,
    })
    const typedEvidence = cached?.bundle
    const graphContext = typedEvidence
      ? renderEvidenceBundle(typedEvidence)
      : await input.graphContext?.({ page, sources: selected })
    input.signal?.throwIfAborted()
    try {
      const result = await input.generator({
        action,
        root: input.root,
        wikiDir: input.wikiDir,
        page,
        plan,
        sources: evidence,
        sourceInventory: sources,
        graphContext,
        evidence: typedEvidence,
        instructions: config.instructions,
        previousContent: existing.get(page.path),
      })
      ensureUsefulResult(page, result)
      const rendered = renderWikiPage({ page, result, sources: evidence })
      const content = mergeProtectedSections(rendered, existing.get(page.path))
      generated.set(page.path, { content, result, sources: evidence })
      input.signal?.throwIfAborted()
      onProgress?.({ type: "page_complete", path: page.path, index: index + 1, total: targets.length })
    } catch (error) {
      // ADR-156: an update publishes the pages that succeeded and leaves the
      // failed page at its previous fingerprint, so one pathological page no
      // longer blocks every other page's freshness. The generate lane stays
      // whole-build atomic: an initial wiki is never published torn.
      if (action !== "update") throw error
      input.signal?.throwIfAborted()
      failedPages.push({ path: page.path, error: error instanceof Error ? error.message : String(error) })
      onProgress?.({ type: "page_failed", path: page.path, index: index + 1, total: targets.length })
    }
  }
  const failedPaths = new Set(failedPages.map((page) => page.path))

  const candidate = new Map<string, string>()
  for (const page of plan.pages) {
    input.signal?.throwIfAborted()
    const content = generated.get(page.path)?.content ?? existing.get(page.path)
    if (content !== undefined) candidate.set(page.path, content)
  }

  const now = (input.now ?? (() => new Date()))().toISOString()
  const manifestPages: Record<string, WikiManifestPage> = {}
  for (const page of plan.pages) {
    input.signal?.throwIfAborted()
    const content = candidate.get(page.path)
    if (!content) continue
    const fresh = generated.get(page.path)
    const meta = parseFrontmatter(content)
    const pageSources =
      fresh?.sources ??
      meta.sources
        .map((sourcePath) => sources.find((source) => source.path === sourcePath))
        .filter((source): source is WikiSource => Boolean(source))
    const pageSourceHashes = Object.fromEntries(pageSources.map((source) => [source.path, source.hash]))
    manifestPages[page.path] = {
      title: page.title,
      purpose: page.purpose,
      selectors: page.selectors,
      sources: pageSources.map((source) => source.path),
      sourceHashes: pageSourceHashes,
      summary: fresh?.result.summary.trim() ?? meta.summary ?? previous?.pages[page.path]?.summary ?? "",
      symbols: fresh?.result.symbols ?? meta.symbols,
      symbolSummaries: sanitizeGlosses(
        fresh?.result.symbolSummaries ?? meta.symbolSummaries ?? previous?.pages[page.path]?.symbolSummaries ?? [],
      ),
      contentHash: sha256(content),
      managedHash: managedContentHash(content),
      generatedAt: fresh ? now : (previous?.pages[page.path]?.generatedAt ?? now),
      // Gate C5: same cached per-page fingerprint used for the skip decision.
      // Deliberately excludes wall-clock and any moving cursor.
      fingerprint: prospectiveFingerprints.get(page.path),
    }
  }
  const manifest: WikiManifest = {
    schemaVersion: 1,
    generator: AX_WIKI_GENERATOR,
    generatedAt: now,
    repositoryHead: input.repositoryHead,
    model: input.model,
    planHash,
    sources: currentSourceHashes,
    pages: manifestPages,
  }

  // ADR-156: a failed page keeps its previous manifest entry, so freshness
  // still describes the content actually on disk instead of claiming a page is
  // current while its regenerated content was never written. A failed page with
  // no previous entry (a brand-new page) stays absent until a later build.
  for (const failed of failedPages) {
    const previousPage = previous?.pages[failed.path]
    if (previousPage && existing.has(failed.path)) manifestPages[failed.path] = previousPage
    else delete manifestPages[failed.path]
  }

  const validation = validateWikiCandidate({
    plan,
    pages: candidate,
    sources,
    manifest,
    missingAllowed: [...failedPaths],
  })
  onProgress?.({ type: "validate", issueCount: validation.issues.length })
  if (!validation.ok) {
    const messages = validation.issues
      .filter((issue) => issue.level === "error")
      .map((issue) => `${issue.code}: ${issue.message}`)
    throw new Error(`AX Wiki validation failed before write:\n${messages.join("\n")}`)
  }

  const removedPages: string[] = []
  const plannedPaths = new Set(plan.pages.map((page) => page.path))
  for (const oldPage of Object.keys(previous?.pages ?? {})) {
    if (plannedPaths.has(oldPage)) continue
    const oldContent = existing.get(oldPage)
    if (
      !oldContent ||
      !generatedPageIsUnmodified(oldContent, previous?.pages[oldPage]) ||
      extractProtectedSections(oldContent).length > 0
    )
      continue
    removedPages.push(oldPage)
  }

  return {
    plan,
    generated,
    candidate,
    manifest,
    validation,
    removedPages,
    conflicts,
    generatedPages: [...generated.keys()],
    unchangedPages: plan.pages
      .map((page) => page.path)
      .filter((page) => !generated.has(page) && !failedPaths.has(page)),
    existingPages: existing,
    failedPages,
  }
}
