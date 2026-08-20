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

import { parseFrontmatter, renderWikiPage } from "./frontmatter.js"
import { sha256, stableJson } from "./hash.js"
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
import { AX_WIKI_GENERATOR } from "./types.js"
import { validateWikiCandidate } from "./validate.js"

/** A source with the evidence slice read for a page. */
export type WikiSourceEvidence = WikiSource & { content: string; truncated: boolean }

/** Reads evidence content for a set of selected sources. Injected effect. */
export type WikiEvidenceReader = (input: {
  sources: WikiSource[]
  maxTotalBytes: number
}) => Promise<WikiSourceEvidence[]>

export type WikiBuildPureInput = {
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

function pageNeedsGeneration(input: {
  action: "generate" | "update"
  page: WikiPlanPage
  previous?: WikiManifest
  planHash: string
  changed: Set<string>
  exists: boolean
}): boolean {
  if (!input.exists || !input.previous) return true
  if (input.action === "generate") return true
  if (input.previous.planHash !== input.planHash) return true
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
  const currentSourceHashes = sourceHashMap(sources)
  const changed = changedSources(previous, currentSourceHashes)
  const existing = new Map<string, string>()
  for (const page of new Set([...plan.pages.map((item) => item.path), ...Object.keys(previous?.pages ?? {})])) {
    const content = await input.readExistingPage(page)
    if (content !== undefined) existing.set(page, content)
  }

  const conflicts: string[] = []
  const targets: WikiPlanPage[] = []
  for (const page of plan.pages) {
    const content = existing.get(page.path)
    if (!pageNeedsGeneration({ action, page, previous, planHash, changed, exists: content !== undefined })) continue
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
  for (let index = 0; index < targets.length; index++) {
    const page = targets[index]!
    onProgress?.({ type: "page_start", path: page.path, index: index + 1, total: targets.length })
    const selected = selectPageSources(sources, page, config.maxSourcesPerPage ?? 80)
    const evidence = await input.evidenceReader({
      sources: selected,
      maxTotalBytes: config.maxPageSourceBytes ?? 160_000,
    })
    const graphContext = await input.graphContext?.({ page, sources: selected })
    const result = await input.generator({
      action,
      root: input.root,
      wikiDir: input.wikiDir,
      page,
      plan,
      sources: evidence,
      sourceInventory: sources,
      graphContext,
      instructions: config.instructions,
      previousContent: existing.get(page.path),
    })
    ensureUsefulResult(page, result)
    const rendered = renderWikiPage({ page, result, sources: evidence })
    const content = mergeProtectedSections(rendered, existing.get(page.path))
    generated.set(page.path, { content, result, sources: evidence })
    onProgress?.({ type: "page_complete", path: page.path, index: index + 1, total: targets.length })
  }

  const candidate = new Map<string, string>()
  for (const page of plan.pages) {
    const content = generated.get(page.path)?.content ?? existing.get(page.path)
    if (content !== undefined) candidate.set(page.path, content)
  }

  const now = (input.now ?? (() => new Date()))().toISOString()
  const manifestPages: Record<string, WikiManifestPage> = {}
  for (const page of plan.pages) {
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
      contentHash: sha256(content),
      managedHash: managedContentHash(content),
      generatedAt: fresh ? now : (previous?.pages[page.path]?.generatedAt ?? now),
      // Gate C5: content-derived fingerprint. Deliberately excludes wall-clock and
      // any moving cursor so unchanged inputs never over-trigger regeneration.
      fingerprint: sha256(
        stableJson({
          config,
          sourceHashes: pageSourceHashes,
          generatorIdentity: input.generatorIdentity ?? null,
          model: input.model ?? null,
          semanticRevision: input.semanticRevision ?? null,
        }),
      ),
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

  const validation = validateWikiCandidate({ plan, pages: candidate, sources, manifest })
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
    unchangedPages: plan.pages.map((page) => page.path).filter((page) => !generated.has(page)),
    existingPages: existing,
  }
}
