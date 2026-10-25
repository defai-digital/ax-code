import { createHash } from "node:crypto"
import { constants } from "node:fs"
import { open, realpath, stat } from "node:fs/promises"
import path from "node:path"
import {
  analyzeWikiCodingInsights,
  loadWikiManifest,
  safeRelativePath,
  stableJson,
  type WikiInsightPage,
  type WikiInsightSource,
} from "@ax-code/ax-wiki/node"
import type { Tool } from "../tool/tool"
import { WikiInventory } from "./inventory"

export const CODING_INSIGHT_LIMITS = {
  outputBytes: 24_000,
  knownSources: 5_000,
  pages: 500,
  readAttempts: 1_000,
  readBytes: 10_485_760,
} as const
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex")

function relativePath(value: string): string | undefined {
  if (value.length > 512 || /[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/.test(value)) return undefined
  return safeRelativePath(value)
}

/** Each query observes the active worktree afresh; no model-written findings or source bodies are persisted. */
export async function queryWikiCodingInsights(input: {
  root: string
  wikiDir: string
  targets: readonly string[]
  context: Pick<Tool.Context, "ask" | "abort">
}) {
  const { context } = input
  context.abort.throwIfAborted()
  if (!input.targets.length || input.targets.length > 5)
    throw new Error("repo_wiki insights requires 1 to 5 target paths")
  const targets = [
    ...new Set(
      input.targets.map((value) => {
        const normalized = relativePath(value)
        if (!normalized) throw new Error("repo_wiki insights requires safe repository-relative target paths")
        return normalized
      }),
    ),
  ]
  const manifest = await loadWikiManifest(input.root, input.wikiDir)
  if (!manifest) return undefined
  const pageEntries = Object.entries(manifest.pages)
  let omittedPageSources = 0
  const pages: WikiInsightPage[] = pageEntries.slice(0, CODING_INSIGHT_LIMITS.pages).flatMap(([rawPath, page]) => {
    const pagePath = relativePath(rawPath)
    if (!pagePath || !Array.isArray(page.sources)) return []
    const sources = page.sources.filter(
      (source): source is string => typeof source === "string" && relativePath(source) !== undefined,
    )
    omittedPageSources += page.sources.length - Math.min(sources.length, 400)
    return [
      {
        path: pagePath,
        sources: sources.slice(0, 400).map((source) => relativePath(source)!),
        sourceHashes: page.sourceHashes && typeof page.sourceHashes === "object" ? page.sourceHashes : {},
      },
    ]
  })
  const all = [...new Set([...targets, ...pages.flatMap((page) => page.sources)])]
  const known = all.slice(0, CODING_INSIGHT_LIMITS.knownSources)
  const sources = new Map<string, WikiInsightSource>(
    known.map((file) => [
      file,
      {
        path: file,
        status: "not-scanned",
        imports: [],
        omittedImports: 0,
        unresolvedImports: 0,
      },
    ]),
  )
  const root = await realpath(input.root)
  const reads = new Map<string, { hash?: string; hashScope?: "file" | "prefix"; state: string }>()
  let readAttempts = 0
  let remainingReadBytes: number = CODING_INSIGHT_LIMITS.readBytes
  const read: typeof import("@ax-code/ax-wiki/node").readFilePrefix = async (_root, relative, maxBytes) => {
    context.abort.throwIfAborted()
    const safe = relativePath(relative)
    if (!safe || maxBytes <= 0) return undefined
    if (readAttempts++ >= CODING_INSIGHT_LIMITS.readAttempts || remainingReadBytes <= 0) {
      reads.set(safe, { state: "budget-exhausted" })
      return undefined
    }
    maxBytes = Math.min(maxBytes, remainingReadBytes)
    const absolute = path.resolve(root, safe)
    if (!absolute.startsWith(`${root}${path.sep}`)) return undefined
    // Reject symlinks, including directory aliases. Authorization is for the exact file opened.
    const canonical = await realpath(absolute).catch(() => undefined)
    if (canonical !== absolute) {
      reads.set(safe, { state: "unavailable" })
      return undefined
    }
    await context.ask({
      permission: "read",
      patterns: [absolute, safe],
      always: [absolute],
      metadata: { purpose: "wiki coding insights" },
    })
    context.abort.throwIfAborted()
    const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => undefined)
    if (!handle) {
      reads.set(safe, { state: "unavailable" })
      return undefined
    }
    try {
      const before = await handle.stat({ bigint: true })
      if (!before.isFile() || (await realpath(absolute).catch(() => undefined)) !== absolute) {
        reads.set(safe, { state: "unavailable" })
        return undefined
      }
      const buffer = Buffer.alloc(Math.min(Number(before.size), maxBytes + 1))
      let length = 0
      while (length < buffer.length) {
        context.abort.throwIfAborted()
        const chunk = await handle.read(buffer, length, buffer.length - length, length)
        if (!chunk.bytesRead) break
        length += chunk.bytesRead
      }
      const after = await handle.stat({ bigint: true })
      const current = await stat(absolute, { bigint: true }).catch(() => undefined)
      if (
        !current ||
        current.dev !== before.dev ||
        current.ino !== before.ino ||
        before.mtimeNs !== after.mtimeNs ||
        before.ctimeNs !== after.ctimeNs ||
        before.size !== after.size ||
        (await realpath(absolute).catch(() => undefined)) !== absolute
      ) {
        reads.set(safe, { state: "changed-during-read" })
        return undefined
      }
      const bytes = buffer.subarray(0, Math.min(length, maxBytes))
      remainingReadBytes -= length
      const hashScope =
        before.size > BigInt(maxBytes) || length < Number(before.size) ? ("prefix" as const) : ("file" as const)
      const receipt = { hash: hash(bytes), hashScope, state: "read" }
      reads.set(safe, receipt)
      const source = sources.get(safe)
      if (source) Object.assign(source, { hash: receipt.hash, hashScope })
      return new TextDecoder("utf-8", { fatal: false }).decode(bytes, { stream: hashScope === "prefix" })
    } finally {
      await handle.close()
    }
  }
  const inventory = await WikiInventory.buildAll(root, known, WikiInventory.LIMITS, context.abort, {
    readFile: read,
    priority: targets,
    onSource: (file, state) => Object.assign(sources.get(file)!, state),
  })
  for (const [file, entry] of inventory) sources.get(file)!.imports = entry.imports
  context.abort.throwIfAborted()
  const evidenceId = hash(
    stableJson({
      version: 1,
      root,
      targets,
      known,
      pages,
      reads: [...reads].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      sources: [...sources.values()],
    }),
  )
  const header = {
    evidenceId,
    worktreeId: hash(root),
    observedAt: new Date().toISOString(),
    inventoryLimits: WikiInventory.LIMITS,
    readLimits: { attempts: CODING_INSIGHT_LIMITS.readAttempts, bytes: CODING_INSIGHT_LIMITS.readBytes },
    omittedInput: {
      pages: Math.max(0, pageEntries.length - pages.length),
      pageSources: omittedPageSources,
      sources: all.length - known.length,
    },
    configurationReads: {
      observed: [...reads.keys()].filter((file) => !sources.has(file)).length,
      incomplete: [...reads].filter(
        ([file, receipt]) => !sources.has(file) && (receipt.state !== "read" || receipt.hashScope !== "file"),
      ).length,
    },
  }
  // Rebuild smaller valid records instead of cutting JSON or splitting a cycle witness.
  for (const neighborLimit of [12, 6, 2, 0]) {
    const analysis = analyzeWikiCodingInsights({ targets, sources: [...sources.values()], pages, neighborLimit })
    if (neighborLimit === 0)
      for (const target of analysis.targets) {
        if (target.cycle) {
          target.cycle = undefined
          target.cycleOmitted = true
          target.checks = target.checks.filter((check) => check.kind !== "verify-cycle")
        }
        target.omittedPages += target.relatedPages.length
        target.relatedPages = []
      }
    const used = new Set(
      analysis.targets.flatMap((target) => [
        target.path,
        ...target.dependencies.files,
        ...target.dependents.files,
        ...(target.cycle ?? []),
      ]),
    )
    const evidenceSources = [...used].sort().map((file) => {
      const source = sources.get(file)!
      return { path: file, status: source.status, hash: source.hash, hashScope: source.hashScope }
    })
    const result = { ...header, ...analysis, evidenceSources, outputReduced: neighborLimit < 12 }
    const output = JSON.stringify(result, null, 2)
    if (Buffer.byteLength(output) <= CODING_INSIGHT_LIMITS.outputBytes) return { evidenceId, output }
  }
  throw new Error("Wiki insights exceed the output budget; query fewer or shorter target paths")
}
