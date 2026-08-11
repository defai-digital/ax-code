import { parseJsonResult } from "@/util/json-value"

/**
 * Normalize ax-engine `--progress-json` NDJSON events into a stable job-facing
 * progress snapshot. The engine emits:
 *   {"event":"progress","done":5,"total":100,"file":"Downloading weights …"}
 * and a final `ax.download_model.v1` (or MTP) summary object without `event`.
 */

export type AxEngineDownloadProgressMode = "determinate" | "indeterminate"

export type AxEngineDownloadProgress = {
  mode: AxEngineDownloadProgressMode
  /** Monotonic percent in [0, 100]. Running jobs are capped at 99. */
  percent: number
  done?: number
  total?: number
  message?: string
  updatedAt: number
}

export type AxEngineProgressEvent = {
  event: "progress"
  done: number
  total: number
  file?: string
}

const RUNNING_PERCENT_CAP = 99

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function percentFromDoneTotal(done: number, total: number): number {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return 0
  return clampPercent((done / total) * 100)
}

/**
 * Merge a newly observed engine progress event into the previous snapshot.
 * Never regresses percent; caps incomplete work at 99 until the job is marked
 * complete by the orchestrator (after exit code + final summary validation).
 */
export function applyProgressEvent(
  previous: AxEngineDownloadProgress | undefined,
  event: { done: number; total: number; message?: string },
  now: number = Date.now(),
): AxEngineDownloadProgress {
  const raw = percentFromDoneTotal(event.done, event.total)
  const capped = Math.min(raw, RUNNING_PERCENT_CAP)
  const percent = previous ? Math.max(previous.percent, capped) : capped
  return {
    mode: "determinate",
    percent,
    done: event.done,
    total: event.total,
    message: event.message?.trim() || previous?.message,
    updatedAt: now,
  }
}

export function completeProgress(
  previous: AxEngineDownloadProgress | undefined,
  now: number = Date.now(),
): AxEngineDownloadProgress {
  return {
    mode: "determinate",
    percent: 100,
    done: previous?.done,
    total: previous?.total,
    message: previous?.message ?? "Ready",
    updatedAt: now,
  }
}

export function indeterminateProgress(
  message?: string,
  now: number = Date.now(),
): AxEngineDownloadProgress {
  return {
    mode: "indeterminate",
    percent: 0,
    message,
    updatedAt: now,
  }
}

/** Parse one stdout line from ax-engine download with --progress-json. */
export function parseProgressJsonLine(line: string):
  | { kind: "progress"; event: AxEngineProgressEvent }
  | { kind: "summary"; value: Record<string, unknown> }
  | { kind: "ignore" } {
  const trimmed = line.trim()
  if (!trimmed.startsWith("{")) return { kind: "ignore" }
  const parsed = parseJsonResult(trimmed)
  if (!parsed.ok) return { kind: "ignore" }
  const value = parsed.value
  if (!value || typeof value !== "object" || Array.isArray(value)) return { kind: "ignore" }
  const record = value as Record<string, unknown>
  if (record.event === "progress") {
    const done = typeof record.done === "number" ? record.done : Number(record.done)
    const total = typeof record.total === "number" ? record.total : Number(record.total)
    if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return { kind: "ignore" }
    return {
      kind: "progress",
      event: {
        event: "progress",
        done,
        total,
        file: typeof record.file === "string" ? record.file : undefined,
      },
    }
  }
  // Final download summary (or intermediate non-progress objects).
  return { kind: "summary", value: record }
}

// ax-engine only emits sparse --progress-json events around snapshot_download
// (typically one ~5% "Starting…" then a jump to 85% after the hub call returns).
// Mid-download UI progress therefore observes HF cache bytes, mapped onto the
// same 5–84 band the engine uses for the weight phase.
const WEIGHT_PHASE_START = 5
const WEIGHT_PHASE_END = 84

const GIB = 1024 ** 3

/** Parse `… (0.0/17.6 GiB, …)` style totals from engine progress messages. */
export function parseGiBTotalFromMessage(message: string | undefined): number | undefined {
  if (!message) return undefined
  const match = message.match(/\/\s*(\d+(?:\.\d+)?)\s*GiB/i)
  if (!match) return undefined
  const gib = Number(match[1])
  if (!Number.isFinite(gib) || gib <= 0) return undefined
  return Math.round(gib * GIB)
}

export function formatGiB(bytes: number): string {
  return (Math.max(0, bytes) / GIB).toFixed(1)
}

export function formatElapsedSeconds(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (minutes <= 0) return `${seconds}s`
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`
}

/**
 * Build a determinate progress event from observed HF-cache bytes.
 * Maps weight download into engine-compatible done/total (5–84 of 100).
 */
export function progressFromCacheBytes(input: {
  downloadedBytes: number
  totalBytes?: number
  startedAt: number
  now?: number
}): { done: number; total: number; message: string } {
  const now = input.now ?? Date.now()
  const elapsed = formatElapsedSeconds(now - input.startedAt)
  const downloaded = Math.max(0, input.downloadedBytes)
  const total = input.totalBytes && input.totalBytes > 0 ? input.totalBytes : undefined
  if (total) {
    const ratio = Math.min(1, downloaded / total)
    const done = WEIGHT_PHASE_START + Math.floor(ratio * (WEIGHT_PHASE_END - WEIGHT_PHASE_START))
    return {
      done,
      total: 100,
      message: `Downloading weights (${formatGiB(downloaded)}/${formatGiB(total)} GiB, elapsed ${elapsed})`,
    }
  }
  // No known total: stay near the start of the weight phase but keep the
  // message useful so the UI doesn't look frozen at "0.0/…".
  return {
    done: WEIGHT_PHASE_START,
    total: 100,
    message: `Downloading weights (${formatGiB(downloaded)} GiB so far, elapsed ${elapsed})`,
  }
}
