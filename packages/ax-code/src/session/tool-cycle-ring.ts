import type { RingEntry } from "./cycle-detection"

/**
 * Run-scoped tool-call ring for doom-loop / no-progress detection.
 *
 * SessionProcessor is created once per model turn, so a ring local to
 * `process()` cannot see the same bash/grep repeated across turns. This store
 * lives for the outer prompt loop (cleared at prompt start) and is shared by
 * the processor and the stall breaker.
 */
const rings = new Map<string, RingEntry[]>()

export function ensureSessionToolCycleRing(sessionID: string): RingEntry[] {
  const existing = rings.get(sessionID)
  if (existing) return existing
  const created: RingEntry[] = []
  rings.set(sessionID, created)
  return created
}

export function sessionToolCycleSignatures(sessionID: string): Set<string> {
  const ring = rings.get(sessionID)
  if (!ring?.length) return new Set()
  return new Set(ring.map((entry) => toolCycleSignature(entry.tool, entry.input)))
}

export function toolCycleSignature(tool: string, input: unknown): string {
  return `${tool}:${canonicalizeToolCycleInput(input)}`
}

export function clearSessionToolCycleRing(sessionID: string): void {
  rings.delete(sessionID)
}

function canonicalizeToolCycleInput(input: unknown): string {
  if (typeof input === "string") return input.length > 4096 ? input.slice(0, 4096) : input
  try {
    const serialized = JSON.stringify(input)
    if (serialized === undefined) return String(input)
    return serialized.length > 4096 ? serialized.slice(0, 4096) : serialized
  } catch {
    return "[unprintable]"
  }
}
