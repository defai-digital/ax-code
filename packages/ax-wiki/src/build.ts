import { constants } from "node:fs"
import { randomUUID } from "node:crypto"
import { mkdir, open, rename, rm } from "node:fs/promises"
import path from "node:path"
import { discoverSources, readSourceEvidence } from "./discovery.js"
import { createWikiBuildLock } from "./lock.js"
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

function isEnoent(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT")
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

/** Shape-check untrusted config JSON; wrong-typed fields fail closed. */
function assertAxWikiConfigShape(value: unknown, file: string): asserts value is AxWikiConfig {
  const invalid = (reason: string) => new Error(`Invalid AX Wiki config: ${reason} (${file})`)
  if (!isPlainObject(value)) throw invalid("expected an object")
  for (const key of ["include", "exclude"] as const) {
    const item = value[key]
    if (item !== undefined && (!Array.isArray(item) || item.some((entry) => typeof entry !== "string"))) {
      throw invalid(`${key} must be an array of strings`)
    }
  }
  for (const key of ["maxPages", "maxSourcesPerPage", "maxSourceBytes", "maxPageSourceBytes"] as const) {
    const item = value[key]
    if (item !== undefined && (typeof item !== "number" || !Number.isFinite(item) || item <= 0)) {
      throw invalid(`${key} must be a positive number`)
    }
  }
  if (value.instructions !== undefined && typeof value.instructions !== "string") {
    throw invalid("instructions must be a string")
  }
  if (value.pages !== undefined) {
    if (!Array.isArray(value.pages)) throw invalid("pages must be an array")
    for (const page of value.pages) {
      if (
        !isPlainObject(page) ||
        typeof page.path !== "string" ||
        typeof page.title !== "string" ||
        typeof page.purpose !== "string" ||
        !Array.isArray(page.selectors) ||
        page.selectors.some((selector) => typeof selector !== "string")
      ) {
        throw invalid("pages entries must have string path/title/purpose and a string selectors array")
      }
    }
  }
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readCompilerConfig(file, 4 * 1024 * 1024)) as T
  } catch (error) {
    // A missing manifest is "no previous build". A corrupt one is a real error:
    // silently treating it as absent would disable the conflict guard and let a
    // full rebuild overwrite manually-edited pages.
    if (isEnoent(error)) return undefined
    throw new Error(`AX Wiki manifest is not valid JSON: ${file}`, { cause: error })
  }
}

async function readCompilerConfig(file: string, limit = 128_000): Promise<string> {
  // O_NOFOLLOW refuses a symlink without a separate lstat/open race.
  let handle
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ELOOP") {
      throw new Error("Wiki compiler config cannot be a symlink", { cause: error })
    }
    throw error
  }
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > limit) throw new Error(`Wiki input must be a regular file within ${limit} bytes`)
    const buffer = Buffer.alloc(limit + 1)
    let size = 0
    while (size < buffer.length) {
      const read = await handle.read(buffer, size, buffer.length - size, size)
      if (!read.bytesRead) break
      size += read.bytesRead
    }
    if (size > limit) throw new Error(`Wiki input exceeds ${limit} bytes`)
    return buffer.subarray(0, size).toString("utf8")
  } finally {
    await handle.close()
  }
}

export async function loadAxWikiConfig(root: string, allowRead?: (relative: string) => boolean): Promise<AxWikiConfig> {
  const configFile = resolveInside(root, AX_WIKI_CONFIG)
  let config: AxWikiConfig | undefined
  try {
    if (allowRead?.(AX_WIKI_CONFIG) !== false) {
      const parsed: unknown = JSON.parse(await readCompilerConfig(configFile))
      assertAxWikiConfigShape(parsed, configFile)
      config = parsed
    }
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw new Error(`Invalid AX Wiki config: ${configFile}`, { cause: error })
    }
  }
  const instructions =
    allowRead?.(AX_WIKI_INSTRUCTIONS) === false
      ? undefined
      : await readCompilerConfig(resolveInside(root, AX_WIKI_INSTRUCTIONS)).catch((error) => {
          if (isEnoent(error)) return undefined
          throw error
        })
  return { ...(config ?? {}), instructions: instructions?.trim() || config?.instructions }
}

export async function loadWikiManifest(root: string, wikiDir = AX_WIKI_DIR_DEFAULT): Promise<WikiManifest | undefined> {
  await assertWikiDirectorySafe(root, wikiDir)
  const file = resolveInside(root, path.posix.join(sanitizeWikiDir(wikiDir), AX_WIKI_MANIFEST))
  const manifest = await readJson<WikiManifest>(file)
  if (!manifest || manifest.generator !== AX_WIKI_GENERATOR || manifest.schemaVersion !== 1) return undefined
  // Valid JSON with a wrong shape is corruption, not "no previous build":
  // treating it as absent would disable the conflict guard.
  if (
    typeof manifest.planHash !== "string" ||
    !isPlainObject(manifest.sources) ||
    !isPlainObject(manifest.pages) ||
    Object.values(manifest.pages).some((page) => !isPlainObject(page) || typeof page.title !== "string")
  ) {
    throw new Error(`AX Wiki manifest has an invalid shape: ${file}`)
  }
  return manifest
}

export async function atomicWrite(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.tmp-${randomUUID()}`
  try {
    const handle = await open(temporary, "w")
    try {
      await handle.writeFile(content, "utf8")
      // fsync the temp before rename so a power loss immediately after the
      // rename cannot leave an empty or torn file in place.
      await handle.sync()
    } finally {
      await handle.close().catch(() => {})
    }
    await rename(temporary, file)
    await syncDirectory(path.dirname(file))
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

async function syncDirectory(directory: string): Promise<void> {
  // Best-effort: opening a directory for fsync is unsupported on some platforms
  // (notably Windows), so a failure here must not fail the write.
  try {
    const handle = await open(directory, "r")
    try {
      await handle.sync()
    } finally {
      await handle.close().catch(() => {})
    }
  } catch {
    // ignore
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
  input.signal?.throwIfAborted()
  const root = path.resolve(input.root)
  const wikiDir = sanitizeWikiDir(input.wikiDir)
  await assertWikiDirectorySafe(root, wikiDir)
  const diskConfig = await loadAxWikiConfig(root, input.allowSource)
  const explicitConfig = Object.fromEntries(
    Object.entries(input.config ?? {}).filter((entry) => entry[1] !== undefined),
  ) as AxWikiConfig
  const config: AxWikiConfig = { ...diskConfig, ...explicitConfig }
  const previous = await loadWikiManifest(root, wikiDir)
  const sources = await discoverSources({ root, wikiDir, config, signal: input.signal, allowSource: input.allowSource })
  input.onProgress?.({ type: "discover", sourceCount: sources.length })
  if (sources.length === 0) throw new Error("AX Wiki found no readable repository sources")

  const readExistingPage = (pagePath: string): Promise<string | undefined> => {
    input.signal?.throwIfAborted()
    if (input.allowSource?.(`${wikiDir}/${pagePath}`) === false)
      throw new Error("Wiki page read permission is not allowed")
    return readCompilerConfig(resolveInside(root, path.posix.join(wikiDir, pagePath)), 1024 * 1024).catch((error) => {
      if (isEnoent(error)) return undefined
      throw error
    })
  }

  const pure = await buildPure({
    signal: input.signal,
    allowWrite: input.allowWrite,
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
    evidenceProvider: input.evidenceProvider,
    model: input.model,
    repositoryHead: input.repositoryHead,
    force: input.force,
    now: input.now,
    onProgress: input.onProgress,
    generatorIdentity: input.generatorIdentity,
    semanticRevision: input.semanticRevision,
  })

  const existing = pure.existingPages
  // Gate C7: serialize the write critical section so two concurrent builds on
  // the same root cannot race on rename/rm. Callers holding a wider lock (AX
  // Code serializes the full pipeline) pass it through; without an injected
  // lock the write phase falls back to the default filesystem lock. Released
  // in the finally so a failed/rolled-back build never strands the lock.
  const lockHandle = await (input.lock ?? createWikiBuildLock(root, wikiDir)).acquire()
  try {
    input.signal?.throwIfAborted()
    for (const pagePath of new Set([...pure.generated.keys(), ...pure.removedPages])) {
      if (input.allowWrite?.(`${wikiDir}/${pagePath}`) === false)
        throw new Error("Wiki output write permission is not allowed")
      const current = await readExistingPage(pagePath)
      if (current !== pure.existingPages.get(pagePath))
        throw new Error("Wiki content changed during compilation; retry without overwriting manual edits")
    }
    const latestManifest = await loadWikiManifest(root, wikiDir)
    if (JSON.stringify(latestManifest) !== JSON.stringify(previous))
      throw new Error("Wiki manifest changed during compilation; retry")
    const writtenPages: string[] = []
    const deletedPages: string[] = []
    try {
      for (const [pagePath, item] of pure.generated) {
        input.signal?.throwIfAborted()
        const output = resolveInside(root, path.posix.join(wikiDir, pagePath))
        await atomicWrite(output, item.content)
        writtenPages.push(pagePath)
        input.onProgress?.({ type: "write", path: pagePath })
      }
      for (const pagePath of pure.removedPages) {
        input.signal?.throwIfAborted()
        await rm(resolveInside(root, path.posix.join(wikiDir, pagePath)), { force: true })
        deletedPages.push(pagePath)
      }
      input.signal?.throwIfAborted()
      await atomicWrite(
        resolveInside(root, path.posix.join(wikiDir, AX_WIKI_MANIFEST)),
        `${JSON.stringify(pure.manifest, null, 2)}\n`,
      )
    } catch (error) {
      const rollbackFailures: string[] = []
      for (const pagePath of writtenPages.reverse()) {
        const output = resolveInside(root, path.posix.join(wikiDir, pagePath))
        const oldContent = existing.get(pagePath)
        try {
          if (oldContent === undefined) await rm(output, { force: true })
          else await atomicWrite(output, oldContent)
        } catch {
          rollbackFailures.push(pagePath)
        }
      }
      for (const pagePath of deletedPages) {
        const oldContent = existing.get(pagePath)
        if (oldContent === undefined) continue
        try {
          await atomicWrite(resolveInside(root, path.posix.join(wikiDir, pagePath)), oldContent)
        } catch {
          rollbackFailures.push(pagePath)
        }
      }
      if (rollbackFailures.length > 0) {
        throw new Error(
          `AX Wiki build failed and rollback could not restore ${rollbackFailures.length} page(s): ${rollbackFailures.join(", ")}`,
          { cause: error },
        )
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
    await lockHandle.release().catch(() => {})
  }
}
