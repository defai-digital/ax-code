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

const doomLoopDetections = new Map<string, Map<string, number>>()

/**
 * Autonomous doom-loop detections per tool, scoped like the ring. A counter
 * local to `process()` resets every step, so a model that makes one repeated
 * call per step (the usual shape) was warned forever and never escalated.
 */
export function sessionDoomLoopDetections(sessionID: string): Map<string, number> {
  const existing = doomLoopDetections.get(sessionID)
  if (existing) return existing
  const created = new Map<string, number>()
  doomLoopDetections.set(sessionID, created)
  return created
}

const runValues = new Map<string, Map<string, unknown>>()

/**
 * A value that lives for one prompt run of a session (until the next user message),
 * cleared with the ring. For per-run guards such as the WebMCP T2 breaker (ADR-174
 * rule 11), whose counters a per-step processor would reset every model step.
 */
export function sessionRunValue<T>(sessionID: string, key: string, create: () => T): T {
  let values = runValues.get(sessionID)
  if (!values) {
    values = new Map()
    runValues.set(sessionID, values)
  }
  if (values.has(key)) return values.get(key) as T
  const created = create()
  values.set(key, created)
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
  doomLoopDetections.delete(sessionID)
  runValues.delete(sessionID)
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
