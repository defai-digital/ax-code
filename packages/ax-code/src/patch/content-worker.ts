import { WorkQueue } from "@ax-code/util/work-queue"
import { NativeAddon } from "../native/addon"
import { NativePerf } from "../perf/native"
import type { Patch } from "./index"
import { hasMixedLineEndings } from "../tool/edit-helpers"

const MAX_BYTES = 32 * 1024 * 1024
export const PATCH_MAX_OUTPUT = 16 * 1024 * 1024
const MAX_LINES = 200_000
export const PATCH_WORKER_THRESHOLD = 65_536
const queue = new WorkQueue(2, { maxQueued: 32, timeoutMs: 30_000 })

export function patchLimit(): Error {
  return new Error("Patch resource limit exceeded; split the patch into smaller changes")
}

/** Bound even the compatibility lane when no new native worker is available. */
export function patchBudget(signal: AbortSignal) {
  let comparisons = 0
  let units = 0
  return (a: string, b: string) => {
    signal.throwIfAborted()
    comparisons++
    units += a.length + b.length
    if (comparisons > 2_000_000 || units > 128 * 1024 * 1024) throw patchLimit()
  }
}

export async function patchContent(
  original: string,
  file: string,
  chunks: Patch.UpdateFileChunk[],
  fallback: (snapshot: Patch.UpdateFileChunk[], signal: AbortSignal, nativeWhitespace: boolean) => string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  if (chunks.length > 4096) throw patchLimit()
  let bytes = Buffer.byteLength(original) + Buffer.byteLength(file)
  if (bytes > MAX_BYTES) throw patchLimit()
  let lines = 1
  for (let at = original.indexOf("\n"); at !== -1; at = original.indexOf("\n", at + 1)) {
    if (++lines > MAX_LINES) throw patchLimit()
  }
  let chunkLines = 0
  let wellFormed = original.isWellFormed() && file.isWellFormed()
  const snapshot: Patch.UpdateFileChunk[] = []
  for (const chunk of chunks) {
    chunkLines += chunk.old_lines.length + chunk.new_lines.length
    if (chunkLines > MAX_LINES) throw patchLimit()
    for (const text of [...chunk.old_lines, ...chunk.new_lines, chunk.change_context ?? ""]) {
      bytes += Buffer.byteLength(text)
      if (bytes > MAX_BYTES) throw patchLimit()
      wellFormed &&= text.isWellFormed()
    }
    snapshot.push({ ...chunk, old_lines: [...chunk.old_lines], new_lines: [...chunk.new_lines] })
  }
  const json = JSON.stringify(snapshot)
  if (Buffer.byteLength(original) + Buffer.byteLength(file) + Buffer.byteLength(json) > MAX_BYTES) throw patchLimit()
  // Many chunks repeatedly search the same snapshot even when the file itself is small.
  const expensive = original.length + json.length >= PATCH_WORKER_THRESHOLD || chunks.length >= 32
  return queue.run(async (workSignal) => {
    const native = NativeAddon.diff()
    // The native lane converts a mixed-ending file wholesale to CRLF; the JS
    // lane keeps untouched lines' own endings.
    if (
      expensive &&
      wellFormed &&
      native?.applyPatchContentAsync &&
      native.PatchCancellation &&
      !hasMixedLineEndings(original)
    ) {
      const cancellation = new native.PatchCancellation()
      const cancel = () => cancellation.cancel()
      workSignal.addEventListener("abort", cancel, { once: true })
      try {
        workSignal.throwIfAborted()
        const result = await NativePerf.runAsync(
          "diff.patchContent",
          { units: original.length, chunks: snapshot.length },
          () => native.applyPatchContentAsync!(file, original, json, cancellation),
        )
        workSignal.throwIfAborted()
        if (Buffer.byteLength(result) > PATCH_MAX_OUTPUT) throw patchLimit()
        return result
      } finally {
        workSignal.removeEventListener("abort", cancel)
      }
    }
    workSignal.throwIfAborted()
    const result = fallback(snapshot, workSignal, !!native)
    workSignal.throwIfAborted()
    if (Buffer.byteLength(result) > PATCH_MAX_OUTPUT) throw patchLimit()
    return result
  }, signal)
}
