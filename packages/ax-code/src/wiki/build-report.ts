import fs from "node:fs/promises"
import path from "node:path"
import { parseJsonStrict } from "../util/json-value"

/**
 * Per-build report for the native AX Wiki compiler.
 *
 * Observability only (ADR-155 item 7): this sidecar records what each page
 * attempt did so a failure is diagnosable without end-to-end archaeology. It
 * is never read by freshness or generation decisions, and its absence or
 * corruption must never change build behaviour.
 */
export const WIKI_BUILD_REPORT_SCHEMA_VERSION = 1
export const WIKI_BUILD_REPORT_FILE = ".build-report.json"

export type WikiPageFailureClass = "length" | "format" | "transient" | "unclassified"

export type WikiBuildReportPageOutcome = {
  path: string
  status: "written" | "failed"
  attempts: number
  durationMs: number
  failureClass?: WikiPageFailureClass
  finishReason?: string
  responseCharacters?: number
  message?: string
}

export type WikiBuildReport = {
  schemaVersion: number
  action: "generate" | "update"
  /**
   * `partial` means the update published the pages that succeeded while one or
   * more pages failed (ADR-156). `failed` means nothing was published.
   */
  outcome: "completed" | "partial" | "failed"
  model: string
  generator: { version: string; promptVersion: string }
  repositoryHead?: string
  startedAt: string
  finishedAt: string
  durationMs: number
  pageCount?: number
  written: string[]
  /** The first page that failed this build, when the outcome is `failed`. */
  failed?: WikiBuildReportPageOutcome
  notAttemptedCount: number
  planHash?: string
  error?: string
}

export function wikiBuildReportPath(root: string, wikiDir: string): string {
  return path.join(root, wikiDir, WIKI_BUILD_REPORT_FILE)
}

/**
 * Atomic best-effort write: temp file + fsync + rename. A failure to persist
 * the report is logged by the caller and never fails the build.
 */
export async function writeWikiBuildReport(root: string, wikiDir: string, report: WikiBuildReport): Promise<void> {
  const target = wikiBuildReportPath(root, wikiDir)
  await fs.mkdir(path.dirname(target), { recursive: true })
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
  const handle = await fs.open(tmp, "w")
  try {
    await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`, "utf8")
    await handle.sync()
  } finally {
    await handle.close()
  }
  await fs.rename(tmp, target)
}

/** Tolerant read: a missing, unreadable, or malformed report is `undefined`. */
export async function readWikiBuildReport(root: string, wikiDir: string): Promise<WikiBuildReport | undefined> {
  try {
    const raw = await fs.readFile(wikiBuildReportPath(root, wikiDir), "utf8")
    const parsed = parseJsonStrict(raw) as WikiBuildReport
    if (typeof parsed !== "object" || parsed === null) return undefined
    if (parsed.schemaVersion !== WIKI_BUILD_REPORT_SCHEMA_VERSION) return undefined
    if (parsed.outcome !== "completed" && parsed.outcome !== "partial" && parsed.outcome !== "failed") return undefined
    return parsed
  } catch {
    return undefined
  }
}

export function summarizeWikiBuildReport(report: WikiBuildReport): string {
  const suffix = `at ${report.finishedAt}`
  if (report.outcome === "failed") {
    const failed = report.failed ? `${report.failed.path} (${report.failed.failureClass})` : "unknown page"
    const pending = report.notAttemptedCount > 0 ? `, ${report.notAttemptedCount} page(s) not attempted` : ""
    return `last build: failed ${suffix} - ${failed}${pending}`
  }
  if (report.outcome === "partial") {
    const failed = report.failed ? `${report.failed.path} (${report.failed.failureClass})` : "unknown page"
    return `last build: partial ${suffix} - ${report.written.length} page(s) written, ${failed} failed`
  }
  return `last build: completed ${suffix} - ${report.written.length} page(s) written`
}
