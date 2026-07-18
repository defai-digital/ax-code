import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { discoverSources, readSourceEvidence } from "./discovery"
import { parseFrontmatter, renderWikiPage } from "./frontmatter"
import { sha256, stableJson } from "./hash"
import { createWikiPlan, selectPageSources, sourceMatchesPage } from "./plan"
import { managedContentHash, mergeProtectedSections, extractProtectedSections } from "./protected"
import {
  AX_WIKI_CONFIG,
  AX_WIKI_DIR_DEFAULT,
  AX_WIKI_INSTRUCTIONS,
  AX_WIKI_MANIFEST,
  resolveInside,
  sanitizeWikiDir,
} from "./paths"
import type {
  AxWikiConfig,
  WikiBuildInput,
  WikiBuildResult,
  WikiManifest,
  WikiManifestPage,
  WikiPageGenerationResult,
  WikiPlanPage,
  WikiSource,
} from "./types"
import { AX_WIKI_GENERATOR } from "./types"
import { validateWikiCandidate } from "./validate"
import { assertWikiDirectorySafe } from "./safety"

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T
  } catch {
    return undefined
  }
}

export async function loadAxWikiConfig(root: string): Promise<AxWikiConfig> {
  const configFile = resolveInside(root, AX_WIKI_CONFIG)
  let config: AxWikiConfig | undefined
  try {
    config = JSON.parse(await readFile(configFile, "utf8")) as AxWikiConfig
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw new Error(`Invalid AX Wiki config: ${configFile}`, { cause: error })
    }
  }
  const instructions = await readFile(resolveInside(root, AX_WIKI_INSTRUCTIONS), "utf8").catch(() => undefined)
  return { ...(config ?? {}), instructions: instructions?.trim() || config?.instructions }
}

export async function loadWikiManifest(root: string, wikiDir = AX_WIKI_DIR_DEFAULT): Promise<WikiManifest | undefined> {
  await assertWikiDirectorySafe(root, wikiDir)
  const manifest = await readJson<WikiManifest>(
    resolveInside(root, path.posix.join(sanitizeWikiDir(wikiDir), AX_WIKI_MANIFEST)),
  )
  if (!manifest || manifest.generator !== AX_WIKI_GENERATOR || manifest.schemaVersion !== 1) return undefined
  return manifest
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

async function atomicWrite(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.tmp-${randomUUID()}`
  try {
    await writeFile(temporary, content, "utf8")
    await rename(temporary, file)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

function generatedPageIsUnmodified(content: string, manifestPage: WikiManifestPage | undefined): boolean {
  if (!manifestPage) return false
  return managedContentHash(content) === manifestPage.managedHash
}

export async function buildAxWiki(input: WikiBuildInput): Promise<WikiBuildResult> {
  const root = path.resolve(input.root)
  const wikiDir = sanitizeWikiDir(input.wikiDir)
  await assertWikiDirectorySafe(root, wikiDir)
  const diskConfig = await loadAxWikiConfig(root)
  const explicitConfig = Object.fromEntries(
    Object.entries(input.config ?? {}).filter((entry) => entry[1] !== undefined),
  ) as AxWikiConfig
  const config: AxWikiConfig = { ...diskConfig, ...explicitConfig }
  const previous = await loadWikiManifest(root, wikiDir)
  const sources = await discoverSources({ root, wikiDir, config })
  input.onProgress?.({ type: "discover", sourceCount: sources.length })
  if (sources.length === 0) throw new Error("AX Wiki found no readable repository sources")

  const plan = createWikiPlan(sources, config)
  const planHash = sha256(stableJson(plan))
  input.onProgress?.({ type: "plan", pageCount: plan.pages.length })
  const currentSourceHashes = sourceHashMap(sources)
  const changed = changedSources(previous, currentSourceHashes)
  const existing = new Map<string, string>()
  for (const page of new Set([...plan.pages.map((item) => item.path), ...Object.keys(previous?.pages ?? {})])) {
    const content = await readFile(resolveInside(root, path.posix.join(wikiDir, page)), "utf8").catch(() => undefined)
    if (content !== undefined) existing.set(page, content)
  }

  const conflicts: string[] = []
  const targets: WikiPlanPage[] = []
  for (const page of plan.pages) {
    const content = existing.get(page.path)
    if (
      !pageNeedsGeneration({ action: input.action, page, previous, planHash, changed, exists: content !== undefined })
    )
      continue
    if (
      content !== undefined &&
      previous?.pages[page.path] &&
      !generatedPageIsUnmodified(content, previous.pages[page.path]) &&
      !input.force
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

  const generated = new Map<string, { content: string; result: WikiPageGenerationResult; sources: WikiSource[] }>()
  for (let index = 0; index < targets.length; index++) {
    const page = targets[index]!
    input.onProgress?.({ type: "page_start", path: page.path, index: index + 1, total: targets.length })
    const selected = selectPageSources(sources, page, config.maxSourcesPerPage ?? 80)
    const evidence = await readSourceEvidence({
      root,
      sources: selected,
      maxTotalBytes: config.maxPageSourceBytes ?? 160_000,
    })
    const graphContext = await input.graphContext?.({ page, sources: selected })
    const result = await input.generator({
      action: input.action,
      root,
      wikiDir,
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
    input.onProgress?.({ type: "page_complete", path: page.path, index: index + 1, total: targets.length })
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
    manifestPages[page.path] = {
      title: page.title,
      purpose: page.purpose,
      selectors: page.selectors,
      sources: pageSources.map((source) => source.path),
      sourceHashes: Object.fromEntries(pageSources.map((source) => [source.path, source.hash])),
      summary: fresh?.result.summary.trim() ?? meta.summary ?? previous?.pages[page.path]?.summary ?? "",
      symbols: fresh?.result.symbols ?? meta.symbols,
      contentHash: sha256(content),
      managedHash: managedContentHash(content),
      generatedAt: fresh ? now : (previous?.pages[page.path]?.generatedAt ?? now),
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
  input.onProgress?.({ type: "validate", issueCount: validation.issues.length })
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

  const writtenPages: string[] = []
  const deletedPages: string[] = []
  try {
    for (const [pagePath, item] of generated) {
      const output = resolveInside(root, path.posix.join(wikiDir, pagePath))
      await atomicWrite(output, item.content)
      writtenPages.push(pagePath)
      input.onProgress?.({ type: "write", path: pagePath })
    }
    for (const pagePath of removedPages) {
      await rm(resolveInside(root, path.posix.join(wikiDir, pagePath)), { force: true })
      deletedPages.push(pagePath)
    }
    await atomicWrite(
      resolveInside(root, path.posix.join(wikiDir, AX_WIKI_MANIFEST)),
      `${JSON.stringify(manifest, null, 2)}\n`,
    )
  } catch (error) {
    for (const pagePath of writtenPages.reverse()) {
      const output = resolveInside(root, path.posix.join(wikiDir, pagePath))
      const oldContent = existing.get(pagePath)
      if (oldContent === undefined) await rm(output, { force: true }).catch(() => {})
      else await atomicWrite(output, oldContent).catch(() => {})
    }
    for (const pagePath of deletedPages) {
      const oldContent = existing.get(pagePath)
      if (oldContent !== undefined) {
        await atomicWrite(resolveInside(root, path.posix.join(wikiDir, pagePath)), oldContent).catch(() => {})
      }
    }
    throw error
  }

  return {
    action: input.action,
    root,
    wikiDir,
    plan,
    generatedPages: [...generated.keys()],
    unchangedPages: plan.pages.map((page) => page.path).filter((page) => !generated.has(page)),
    removedPages,
    conflicts,
    manifest,
    validation,
  }
}
