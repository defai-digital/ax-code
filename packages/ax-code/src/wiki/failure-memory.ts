import fs from "node:fs/promises"
import path from "node:path"
import { parseJsonStrict } from "../util/json-value"

/**
 * Durable failure memory for background wiki maintenance (ADR-155 item 5).
 *
 * The in-process idle controller already backs off within one process, but a
 * restart forgets it and immediately re-runs a build that fails
 * deterministically (the "always regenerates or fails" loop). This sidecar
 * carries a capped cooldown across restarts and is cleared whenever the build
 * succeeds, the repository head changes, the generator identity changes, or a
 * watched source file changes - so a genuine source change always retries and
 * the suppression can never become permanent.
 *
 * Driver-owned and observational: it never gates an explicit `wiki update`.
 */
export const WIKI_FAILURE_MEMORY_SCHEMA_VERSION = 1
export const WIKI_FAILURE_MEMORY_FILE = ".failure-memory.json"
/** Capped cooldown ladder: 5m, 15m, 1h, 6h (never permanent). */
export const WIKI_FAILURE_COOLDOWN_LADDER_MS = [5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000] as const

export type WikiFailureMemory = {
  schemaVersion: number
  consecutiveFailures: number
  lastFailureAt: string
  lastHead?: string
  lastGeneratorKey?: string
  lastPlanHash?: string
  error?: string
}

export type WikiFailureKey = {
  head?: string
  generatorKey?: string
  planHash?: string
}

export function wikiFailureMemoryPath(root: string, wikiDir: string): string {
  return path.join(root, wikiDir, WIKI_FAILURE_MEMORY_FILE)
}

export function wikiFailureCooldownMs(consecutiveFailures: number): number {
  const index = Math.min(Math.max(consecutiveFailures, 1) - 1, WIKI_FAILURE_COOLDOWN_LADDER_MS.length - 1)
  return WIKI_FAILURE_COOLDOWN_LADDER_MS[index]
}

/** Tolerant read: a missing, unreadable, or malformed memory is `undefined`. */
export async function readWikiFailureMemory(root: string, wikiDir: string): Promise<WikiFailureMemory | undefined> {
  try {
    const parsed = parseJsonStrict(await fs.readFile(wikiFailureMemoryPath(root, wikiDir), "utf8")) as WikiFailureMemory
    if (typeof parsed !== "object" || parsed === null) return undefined
    if (parsed.schemaVersion !== WIKI_FAILURE_MEMORY_SCHEMA_VERSION) return undefined
    if (typeof parsed.consecutiveFailures !== "number" || typeof parsed.lastFailureAt !== "string") return undefined
    return parsed
  } catch {
    return undefined
  }
}

async function writeWikiFailureMemory(root: string, wikiDir: string, memory: WikiFailureMemory): Promise<void> {
  const target = wikiFailureMemoryPath(root, wikiDir)
  await fs.mkdir(path.dirname(target), { recursive: true })
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
  const handle = await fs.open(tmp, "w")
  try {
    await handle.writeFile(`${JSON.stringify(memory, null, 2)}\n`, "utf8")
    await handle.sync()
  } finally {
    await handle.close()
  }
  await fs.rename(tmp, target)
}

/** Record a failed build, extending the streak only for the same key. */
export async function recordWikiFailure(
  root: string,
  wikiDir: string,
  input: WikiFailureKey & { error?: string; now?: number },
): Promise<WikiFailureMemory> {
  const previous = await readWikiFailureMemory(root, wikiDir)
  const sameKey =
    previous !== undefined &&
    previous.lastHead === input.head &&
    previous.lastGeneratorKey === input.generatorKey &&
    previous.lastPlanHash === input.planHash
  const memory: WikiFailureMemory = {
    schemaVersion: WIKI_FAILURE_MEMORY_SCHEMA_VERSION,
    consecutiveFailures: sameKey ? previous.consecutiveFailures + 1 : 1,
    lastFailureAt: new Date(input.now ?? Date.now()).toISOString(),
    lastHead: input.head,
    lastGeneratorKey: input.generatorKey,
    lastPlanHash: input.planHash,
    error: input.error,
  }
  await writeWikiFailureMemory(root, wikiDir, memory)
  return memory
}

/** Clear the memory after a successful build (or a source change). */
export async function clearWikiFailureMemory(root: string, wikiDir: string): Promise<void> {
  await fs.rm(wikiFailureMemoryPath(root, wikiDir), { force: true })
}

/**
 * True when an automatic run should be skipped. The head and generator key are
 * the only key parts available before a build; `planHash` is compared after the
 * run when recording, which resets the streak for a changed plan.
 */
export function wikiFailureMemorySuppresses(
  memory: WikiFailureMemory | undefined,
  input: { now: number } & WikiFailureKey,
): { suppressed: boolean; reason?: string; retryAt?: number } {
  if (!memory) return { suppressed: false }
  if (input.head !== undefined && memory.lastHead !== undefined && memory.lastHead !== input.head)
    return { suppressed: false }
  if (
    input.generatorKey !== undefined &&
    memory.lastGeneratorKey !== undefined &&
    memory.lastGeneratorKey !== input.generatorKey
  )
    return { suppressed: false }
  if (input.planHash !== undefined && memory.lastPlanHash !== undefined && memory.lastPlanHash !== input.planHash)
    return { suppressed: false }
  const retryAt = Date.parse(memory.lastFailureAt) + wikiFailureCooldownMs(memory.consecutiveFailures)
  if (input.now >= retryAt) return { suppressed: false }
  return {
    suppressed: true,
    reason: `${memory.consecutiveFailures} consecutive failure(s), cooldown until ${new Date(retryAt).toISOString()}`,
    retryAt,
  }
}
