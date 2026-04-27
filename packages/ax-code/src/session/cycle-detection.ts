import { DOOM_LOOP_THRESHOLD, AUTONOMOUS_MAX_CYCLE_LEN } from "@/constants/session"

export interface RingEntry {
  tool: string
  input: string
}

/**
 * Cycle-aware doom-loop detector. Examines the trailing window of
 * `entries` for any repeating pattern of length k in [1, maxCycleLen].
 *
 * Required repeats: `DOOM_LOOP_THRESHOLD` for k=1 (preserves the legacy
 * "same call N times" behavior); 2 for k>=2 (a longer cycle is itself
 * stronger evidence than a single repeat). Returns the detected cycle
 * length when found, otherwise null.
 */
export function detectCycle(
  entries: ReadonlyArray<RingEntry>,
  maxCycleLen: number = AUTONOMOUS_MAX_CYCLE_LEN,
): number | null {
  const eq = (i: number, j: number) => entries[i]!.tool === entries[j]!.tool && entries[i]!.input === entries[j]!.input
  for (let k = 1; k <= maxCycleLen; k++) {
    const repeats = k === 1 ? DOOM_LOOP_THRESHOLD : 2
    const need = k * repeats
    if (entries.length < need) continue
    const start = entries.length - need
    let isCycle = true
    for (let i = 0; i < need - k; i++) {
      if (!eq(start + i, start + i + k)) {
        isCycle = false
        break
      }
    }
    if (isCycle) return k
  }
  return null
}
