import z from "zod"
import { WorkQueue } from "@ax-code/util/work-queue"
import { parseNativeJson } from "./internal/native-json"
import { codeReasonHostMaybe } from "./host"

export type DuplicateGroup = { indices: number[]; score: number }
export const DUPLICATE_WORKER_THRESHOLD = 256
const MAX_ROWS = 10_000
const MAX_ENTRIES = 200_000
const MAX_BYTES = 16 * 1024 * 1024
const queue = new WorkQueue(2, { maxQueued: 32, timeoutMs: 30_000 })
type NativeDiff = {
  duplicateGroupsAsync?: (tokens: string, threshold: number, cancellation: { cancel(): void }) => Promise<string>
  DiffCancellation?: new () => { cancel(): void }
}
const schema = z.object({
  version: z.literal(1),
  groups: z
    .array(
      z.object({
        indices: z
          .array(
            z
              .number()
              .int()
              .min(0)
              .max(MAX_ROWS - 1),
          )
          .min(2)
          .max(MAX_ROWS),
        score: z.number().min(0).max(1),
      }),
    )
    .max(MAX_ROWS),
})
function limit() {
  return new Error("Duplicate comparison resource limit exceeded; reduce maxCandidates")
}

/** Reference grouping remains ordered, representative-based and non-transitive. */
async function fallback(rows: Set<string>[], threshold: number, signal: AbortSignal): Promise<DuplicateGroup[]> {
  const paired = new Set<number>(),
    groups: DuplicateGroup[] = []
  let pairs = 0,
    work = 0
  for (let i = 0; i < rows.length; i++) {
    signal.throwIfAborted()
    if (paired.has(i)) continue
    const indices = [i]
    let minimum = 1
    for (let j = i + 1; j < rows.length; j++) {
      if (paired.has(j)) continue
      if (++pairs > 50_000_000) throw limit()
      if (pairs % 8192 === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve))
        signal.throwIfAborted()
      }
      const a = rows[i],
        b = rows[j]
      let intersection = 0
      for (const token of a) {
        if (++work > 200_000_000) throw limit()
        if (work % 32_768 === 0) {
          await new Promise<void>((resolve) => setImmediate(resolve))
          signal.throwIfAborted()
        }
        if (b.has(token)) intersection++
      }
      const union = a.size + b.size - intersection
      const score = a.size === 0 && b.size === 0 ? 1 : union === 0 ? 0 : intersection / union
      if (score >= threshold) {
        indices.push(j)
        paired.add(j)
        if (score < minimum) minimum = score
      }
    }
    if (indices.length > 1) {
      paired.add(i)
      groups.push({ indices, score: minimum })
    }
  }
  return groups
}

export async function compareDuplicateGroups(rows: Set<string>[], threshold: number, signal?: AbortSignal) {
  signal?.throwIfAborted()
  if (rows.length > MAX_ROWS) throw limit()
  let entries = 0,
    bytes = 0,
    wellFormed = true
  const snapshot = rows.map((row) => {
    entries += row.size
    if (entries > MAX_ENTRIES) throw limit()
    const values = Array.from(row)
    for (const token of values) {
      bytes += Buffer.byteLength(token)
      if (bytes > MAX_BYTES) throw limit()
      wellFormed &&= token.isWellFormed()
    }
    return values
  })
  const json = JSON.stringify(snapshot)
  if (Buffer.byteLength(json) > MAX_BYTES) throw limit()
  return queue.run(async (workSignal) => {
    const host = codeReasonHostMaybe()
    const native = host?.native?.diff?.() as NativeDiff | undefined
    if (
      rows.length >= DUPLICATE_WORKER_THRESHOLD &&
      wellFormed &&
      Number.isFinite(threshold) &&
      native?.duplicateGroupsAsync &&
      native.DiffCancellation
    ) {
      const cancellation = new native.DiffCancellation()
      const cancel = () => cancellation.cancel()
      workSignal.addEventListener("abort", cancel, { once: true })
      try {
        workSignal.throwIfAborted()
        const run = () => native.duplicateGroupsAsync!(json, threshold, cancellation)
        const output = await (host?.native?.perfRunAsync
          ? host.native.perfRunAsync("diff.duplicateGroups", { rows: snapshot.length }, run)
          : run())
        workSignal.throwIfAborted()
        if (Buffer.byteLength(output) > 1024 * 1024) throw limit()
        const result = parseNativeJson(output, schema, "Invalid native duplicate groups")
        let previous = -1
        const seen = new Set<number>()
        for (const group of result.groups) {
          if (group.indices[0] <= previous) throw new Error("Invalid native duplicate group order")
          previous = group.indices[0]
          let last = -1
          for (const index of group.indices) {
            if (index >= snapshot.length || index <= last || seen.has(index))
              throw new Error("Invalid native duplicate group membership")
            seen.add(index)
            last = index
          }
        }
        return result.groups
      } finally {
        workSignal.removeEventListener("abort", cancel)
      }
    }
    return fallback(
      snapshot.map((values) => new Set(values)),
      threshold,
      workSignal,
    )
  }, signal)
}
