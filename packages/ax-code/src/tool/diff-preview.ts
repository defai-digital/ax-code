import z from "zod"
import { diffLines, formatPatch, structuredPatch } from "diff"
import type { Change, StructuredPatch } from "diff"
import { WorkQueue } from "@ax-code/util/work-queue"
import { NativeAddon } from "../native/addon"
import { NativePerf } from "../perf/native"
import { parseNativeJson } from "../util/native-json"
import { normalizeLineEndings } from "./edit-helpers"

const MAX_BYTES = 32 * 1024 * 1024
const MAX_OUTPUT = 16 * 1024 * 1024
const MAX_LINES = 200_000
export const DIFF_WORKER_THRESHOLD = 65_536
const queue = new WorkQueue(2, { maxQueued: 32, timeoutMs: 30_000 })
const options = { timeout: 1_000, maxEditLength: 2_048 }
const NativePreview = z.object({
  version: z.literal(1),
  additions: z.number().int().min(0).max(MAX_LINES),
  deletions: z.number().int().min(0).max(MAX_LINES),
  hunks: z
    .array(
      z.object({
        oldStart: z
          .number()
          .int()
          .min(1)
          .max(MAX_LINES + 1),
        newStart: z
          .number()
          .int()
          .min(1)
          .max(MAX_LINES + 1),
        oldLines: z.number().int().min(0).max(MAX_LINES),
        newLines: z.number().int().min(0).max(MAX_LINES),
        lines: z.array(z.string()).max(2 * MAX_LINES + 2),
      }),
    )
    .max(MAX_LINES),
})

function limit(): Error {
  return new Error("Diff resource limit exceeded; split the edit into smaller changes")
}

function admit(before: string, after: string) {
  if (Buffer.byteLength(before) + Buffer.byteLength(after) > MAX_BYTES) throw limit()
  for (const text of [before, after]) {
    let count = text && !text.endsWith("\n") ? 1 : 0
    for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) {
      if (++count > MAX_LINES) throw limit()
    }
  }
}

function hunkCounts(hunks: StructuredPatch["hunks"]) {
  let additions = 0
  let deletions = 0
  for (const hunk of hunks)
    for (const line of hunk.lines) {
      if (line.startsWith("+")) additions++
      if (line.startsWith("-")) deletions++
    }
  return { additions, deletions }
}

function changeCounts(changes: Change[] | undefined) {
  if (!changes) throw limit()
  let additions = 0
  let deletions = 0
  for (const change of changes) {
    if (change.added) additions += change.count
    if (change.removed) deletions += change.count
  }
  return { additions, deletions }
}

function finish(file: string, hunks: StructuredPatch["hunks"], counts: { additions: number; deletions: number }) {
  const diff = formatPatch({ oldFileName: file, newFileName: file, oldHeader: undefined, newHeader: undefined, hunks })
  if (Buffer.byteLength(diff) > MAX_OUTPUT) throw limit()
  return { diff, additions: counts.additions, deletions: counts.deletions }
}

/** Compatibility helper: bounded Myers replaces the legacy quadratic LCS matrix. */
export function diffPreviewSync(file: string, before: string, after: string) {
  admit(before, after)
  const patch = structuredPatch(file, file, before, after, undefined, undefined, options)
  if (!patch) throw limit()
  return finish(file, patch.hunks, hunkCounts(patch.hunks))
}

/** Only data computation crosses the native boundary; approval and writes stay with the caller. */
export async function diffPreview(
  file: string,
  before: string,
  after: string,
  signal?: AbortSignal,
  normalize = false,
) {
  return NativePerf.operation("diff.preview", async (trace) => {
    signal?.throwIfAborted()
    if (trace) trace.run("admit", () => admit(before, after))
    else admit(before, after)
    const expensive = before.length + after.length >= DIFF_WORKER_THRESHOLD
    const endWait = trace?.start("queue")
    let started = false
    try {
      return await queue.run(async (workSignal) => {
        started = true
        endWait?.()
        const native = NativeAddon.diff()
        if (
          expensive &&
          native?.diffPreviewAsync &&
          native.DiffCancellation &&
          before.isWellFormed() &&
          after.isWellFormed()
        ) {
          const cancellation = new native.DiffCancellation()
          const cancel = () => cancellation.cancel()
          workSignal.addEventListener("abort", cancel, { once: true })
          try {
            workSignal.throwIfAborted()
            const run = () =>
              NativePerf.runAsync("diff.preview", { oldUnits: before.length, newUnits: after.length }, () =>
                native.diffPreviewAsync!(before, after, normalize, cancellation),
              )
            const json = await (trace ? trace.runAsync("native", run) : run())
            workSignal.throwIfAborted()
            const decode = () => {
              if (Buffer.byteLength(json) > MAX_OUTPUT) throw limit()
              return parseNativeJson(json, NativePreview, "Invalid native diff preview")
            }
            const result = trace ? trace.run("decode", decode) : decode()
            const format = () => finish(file, result.hunks, result)
            return trace ? trace.run("format", format) : format()
          } finally {
            workSignal.removeEventListener("abort", cancel)
          }
        }

        const fallback = async () => {
          const oldText = normalize ? normalizeLineEndings(before) : before
          const newText = normalize ? normalizeLineEndings(after) : after
          // Callback mode yields between edit lengths; retain the work slot
          // until the callback settles, including after caller cancellation.
          const patch = expensive
            ? await new Promise<StructuredPatch | undefined>((resolve) => {
                structuredPatch(file, file, oldText, newText, undefined, undefined, { ...options, callback: resolve })
              })
            : structuredPatch(file, file, oldText, newText, undefined, undefined, options)
          workSignal.throwIfAborted()
          if (!patch) throw limit()
          let counts = hunkCounts(patch.hunks)
          if (oldText !== before || newText !== after) {
            const changes = expensive
              ? await new Promise<Change[] | undefined>((resolve) => {
                  diffLines(before, after, { ...options, callback: resolve })
                })
              : diffLines(before, after, options)
            workSignal.throwIfAborted()
            counts = changeCounts(changes)
          }
          return { patch, counts }
        }
        const { patch, counts } = await (trace ? trace.runAsync("fallback", fallback) : fallback())
        const format = () => finish(file, patch.hunks, counts)
        return trace ? trace.run("format", format) : format()
      }, signal)
    } finally {
      if (!started) endWait?.(true)
    }
  })
}
