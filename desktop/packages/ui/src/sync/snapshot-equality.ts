import type { Session } from "@ax-code/sdk/v2"
import type { SessionStatus } from "@ax-code/sdk/v2/client"
import { isPlainRecord } from "@/lib/record"

// ---------------------------------------------------------------------------
// Sync snapshot equality — structural comparison for session and session-status
// snapshots so the sync layer can skip no-op store writes (and the re-renders
// they would cause) when reconnect/status resyncs return unchanged data.
// ---------------------------------------------------------------------------

const SESSION_SNAPSHOT_KEYS = new Set([
  "id",
  "slug",
  "projectID",
  "directory",
  "parentID",
  "summary",
  "share",
  "title",
  "version",
  "time",
  "permission",
  "revert",
  "metadata",
])

export function haveEquivalentSyncSnapshots(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (isSessionStatusSnapshot(left) && isSessionStatusSnapshot(right)) {
    return areSessionStatusSnapshotsEqual(left, right)
  }
  if (isSessionSnapshot(left) && isSessionSnapshot(right)) {
    return areSessionSnapshotsEqual(left, right)
  }
  return false
}

function isSessionStatusSnapshot(value: unknown): value is SessionStatus {
  if (!isPlainRecord(value) || typeof value.type !== "string") return false
  return value.type === "idle" || value.type === "busy" || value.type === "retry"
}

function areSessionStatusSnapshotsEqual(left: SessionStatus, right: SessionStatus): boolean {
  if (left.type !== right.type) return false
  if (left.type === "idle") return true
  if (left.type === "retry") {
    return (
      right.type === "retry" &&
      left.attempt === right.attempt &&
      left.message === right.message &&
      left.next === right.next
    )
  }
  return (
    right.type === "busy" &&
    left.step === right.step &&
    left.maxSteps === right.maxSteps &&
    left.startedAt === right.startedAt &&
    left.lastActivityAt === right.lastActivityAt &&
    left.activeTool === right.activeTool &&
    left.toolCallID === right.toolCallID &&
    left.waitState === right.waitState
  )
}

function isSessionSnapshot(value: unknown): value is Session {
  return isPlainRecord(value) && typeof value.id === "string" && "time" in value
}

function areSessionSnapshotsEqual(left: Session, right: Session): boolean {
  return (
    left.id === right.id &&
    left.slug === right.slug &&
    left.projectID === right.projectID &&
    left.directory === right.directory &&
    left.parentID === right.parentID &&
    left.title === right.title &&
    left.version === right.version &&
    areSessionTimesEqual(left.time, right.time) &&
    areSessionSummariesEqual(left.summary, right.summary) &&
    left.share?.url === right.share?.url &&
    left.permission === right.permission &&
    areSessionRevertsEqual(left.revert, right.revert) &&
    areFlatUnknownRecordsEqual(left.metadata, right.metadata) &&
    areUnknownSessionKeysEqual(left, right)
  )
}

function areSessionTimesEqual(left: Session["time"] | undefined, right: Session["time"] | undefined): boolean {
  if (left === right) return true
  if (!left || !right) return false
  return (
    left.created === right.created &&
    left.updated === right.updated &&
    left.compacting === right.compacting &&
    left.archived === right.archived
  )
}

function areSessionSummariesEqual(
  left: Session["summary"] | undefined,
  right: Session["summary"] | undefined,
): boolean {
  if (left === right) return true
  if (!left || !right) return false
  return (
    left.additions === right.additions &&
    left.deletions === right.deletions &&
    left.files === right.files &&
    left.diffs === right.diffs
  )
}

function areSessionRevertsEqual(left: Session["revert"] | undefined, right: Session["revert"] | undefined): boolean {
  if (left === right) return true
  if (!left || !right) return false
  return (
    left.messageID === right.messageID &&
    left.partID === right.partID &&
    left.snapshot === right.snapshot &&
    left.diff === right.diff
  )
}

function areFlatUnknownRecordsEqual(
  left: Record<string, unknown> | undefined,
  right: Record<string, unknown> | undefined,
): boolean {
  if (left === right) return true
  if (!left || !right) return false
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  for (const key of leftKeys) {
    if (!Object.is(left[key], right[key])) return false
  }
  return true
}

function areUnknownSessionKeysEqual(left: Session, right: Session): boolean {
  const seen = new Set<string>()
  for (const key of Object.keys(left)) {
    if (SESSION_SNAPSHOT_KEYS.has(key)) continue
    seen.add(key)
    if (!Object.is((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key])) return false
  }
  for (const key of Object.keys(right)) {
    if (SESSION_SNAPSHOT_KEYS.has(key) || seen.has(key)) continue
    if (!Object.is((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key])) return false
  }
  return true
}
