import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { discoverSources, readSourceEvidence } from "./discovery.js"
import {
  AX_WIKI_CONFIG,
  AX_WIKI_DIR_DEFAULT,
  AX_WIKI_INSTRUCTIONS,
  AX_WIKI_MANIFEST,
  resolveInside,
  sanitizeWikiDir,
} from "./paths.js"
import type { AxWikiConfig, WikiBuildInput, WikiBuildResult, WikiManifest } from "./types.js"
import { AX_WIKI_GENERATOR } from "./types.js"
import { assertWikiDirectorySafe } from "./safety.js"
import { buildPure } from "./build-pure.js"

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

/**
 * Node filesystem/git wiring of the wiki build. Resolves the root, loads config and
 * the previous manifest, discovers sources, and reads/writes pages on disk, while
 * delegating all deterministic planning/generation/validation logic to the
 * filesystem-free `buildPure` core. Behavior is unchanged from the prior inline
 * implementation.
 */
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

  const readExistingPage = (pagePath: string): Promise<string | undefined> =>
    readFile(resolveInside(root, path.posix.join(wikiDir, pagePath)), "utf8").catch(() => undefined)

  const pure = await buildPure({
    root,
    wikiDir,
    action: input.action,
    sources,
    config,
    previous,
    generator: input.generator,
    evidenceReader: ({ sources: selected, maxTotalBytes }) =>
      readSourceEvidence({ root, sources: selected, maxTotalBytes }),
    readExistingPage,
    graphContext: input.graphContext,
    model: input.model,
    repositoryHead: input.repositoryHead,
    force: input.force,
    now: input.now,
    onProgress: input.onProgress,
    generatorIdentity: input.generatorIdentity,
    semanticRevision: input.semanticRevision,
  })

  const existing = pure.existingPages
  // Gate C7: when a lock is injected, serialize the write critical section so two
  // concurrent builds on the same root cannot race on rename/rm. Released in the
  // finally so a failed/rolled-back build never strands the lock.
  const lockHandle = input.lock ? await input.lock.acquire() : undefined
  try {
    const writtenPages: string[] = []
    const deletedPages: string[] = []
    try {
      for (const [pagePath, item] of pure.generated) {
        const output = resolveInside(root, path.posix.join(wikiDir, pagePath))
        await atomicWrite(output, item.content)
        writtenPages.push(pagePath)
        input.onProgress?.({ type: "write", path: pagePath })
      }
      for (const pagePath of pure.removedPages) {
        await rm(resolveInside(root, path.posix.join(wikiDir, pagePath)), { force: true })
        deletedPages.push(pagePath)
      }
      await atomicWrite(
        resolveInside(root, path.posix.join(wikiDir, AX_WIKI_MANIFEST)),
        `${JSON.stringify(pure.manifest, null, 2)}\n`,
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
      plan: pure.plan,
      generatedPages: pure.generatedPages,
      unchangedPages: pure.unchangedPages,
      removedPages: pure.removedPages,
      conflicts: pure.conflicts,
      manifest: pure.manifest,
      validation: pure.validation,
    }
  } finally {
    if (lockHandle) await lockHandle.release().catch(() => {})
  }
}
