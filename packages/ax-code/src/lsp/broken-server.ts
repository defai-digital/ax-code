import { Log } from "../util/log"

const log = Log.create({ service: "lsp" })

// Exponential backoff for broken servers. A server that fails to spawn or
// initialize is marked broken and skipped until nextAttempt. After the
// cooldown expires the entry is kept so the next failure can compound the
// backoff instead of hammering a genuinely unrecoverable server.
const BROKEN_BACKOFF_BASE_MS = 30_000
const BROKEN_BACKOFF_MAX_MS = 60 * 60 * 1000
const BROKEN_SERVER_CACHE_MAX = 100
const BROKEN_SERVER_TTL_MS = 60 * 60 * 1000

export type BrokenEntry = {
  failures: number
  nextAttempt: number
}

export function computeBackoff(failures: number): number {
  if (failures <= 0) return 0
  const raw = BROKEN_BACKOFF_BASE_MS * Math.pow(4, failures - 1)
  return Math.min(raw, BROKEN_BACKOFF_MAX_MS)
}

export function isBroken(broken: Map<string, BrokenEntry>, key: string): boolean {
  const entry = broken.get(key)
  if (!entry) return false
  if (Date.now() >= entry.nextAttempt) {
    return false
  }
  return true
}

function pruneBrokenServers(broken: Map<string, BrokenEntry>, now: number) {
  for (const [key, entry] of broken) {
    if (now - (entry.nextAttempt - computeBackoff(entry.failures)) > BROKEN_SERVER_TTL_MS) {
      broken.delete(key)
    }
  }

  while (broken.size > BROKEN_SERVER_CACHE_MAX) {
    const oldest = broken.keys().next().value
    if (!oldest) break
    broken.delete(oldest)
  }
}

export function markBroken(broken: Map<string, BrokenEntry>, key: string) {
  const now = Date.now()
  pruneBrokenServers(broken, now)
  const existing = broken.get(key)
  const failures = (existing?.failures ?? 0) + 1
  const backoffMs = computeBackoff(failures)
  broken.set(key, {
    failures,
    nextAttempt: now + backoffMs,
  })
  pruneBrokenServers(broken, now)
  log.info("lsp server marked broken", { key, failures, backoffMs })
}
