// Per-turn changed-files timeline row (ADR-250). Pure view-model: the caller
// resolves the turn's snapshot diff (step-start.snapshot -> step-finish.snapshot
// via Snapshot.diffFull) and this file turns it into the compact row the
// transcript renders.

/** Minimal file-diff shape, matching Snapshot.FileDiff. */
export type TurnFileDiff = {
  file: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
}

/** Minimal part shape needed to find a turn's snapshot boundaries. */
export type TurnPart = {
  type: string
  snapshot?: string
}

export type TurnChangedFiles = {
  /** Number of distinct files changed across the turn. */
  count: number
  /** Total added lines across the turn's files. */
  additions: number
  /** Total removed lines across the turn's files. */
  deletions: number
  /** Changed file paths, in the order the diffs were provided. */
  files: string[]
}

/**
 * Snapshot hashes bracketing a turn: the first `step-start` snapshot as `from`
 * and the last `step-finish` snapshot as `to`. Mirrors Session.Summary's
 * per-turn computation. Returns undefined when either boundary is missing.
 */
export function turnSnapshotRange(parts: readonly TurnPart[]): { from: string; to: string } | undefined {
  let from: string | undefined
  let to: string | undefined
  for (const part of parts) {
    if (!from && part.type === "step-start" && part.snapshot) from = part.snapshot
    if (part.type === "step-finish" && part.snapshot) to = part.snapshot
  }
  return from && to ? { from, to } : undefined
}

/**
 * Compact row for a completed turn, or undefined when the turn changed nothing
 * (no diffs, or an empty result) so the caller renders no row.
 */
export function turnChangedFiles(diffs: readonly TurnFileDiff[]): TurnChangedFiles | undefined {
  const nonEmpty = diffs.filter((diff) => diff.file)
  if (nonEmpty.length === 0) return undefined
  const files: string[] = []
  const seen = new Set<string>()
  let additions = 0
  let deletions = 0
  for (const diff of nonEmpty) {
    additions += Math.max(0, diff.additions)
    deletions += Math.max(0, diff.deletions)
    if (!seen.has(diff.file)) {
      seen.add(diff.file)
      files.push(diff.file)
    }
  }
  return { count: files.length, additions, deletions, files }
}

/** One-line summary: `3 files changed, +12 -4`. */
export function formatTurnChangedFiles(row: TurnChangedFiles): string {
  const files = `${row.count} file${row.count === 1 ? "" : "s"} changed`
  return `${files}, +${row.additions} -${row.deletions}`
}

/**
 * Resolve one turn's changed files from its parts. The caller injects
 * `diffFull` (Snapshot.diffFull) so this stays pure and testable; when the turn
 * has no snapshot boundaries or no files, it returns undefined and no row shows.
 */
export async function resolveTurnChangedFiles(
  parts: readonly TurnPart[],
  diffFull: (from: string, to: string) => Promise<readonly TurnFileDiff[]>,
): Promise<TurnChangedFiles | undefined> {
  const range = turnSnapshotRange(parts)
  if (!range) return undefined
  const diffs = await diffFull(range.from, range.to)
  return turnChangedFiles(diffs)
}

/**
 * Compact row text including the changed file names, capped so a wide turn
 * stays one line. `maxFiles` bounds how many names are listed.
 */
export function formatTurnChangedFilesRow(row: TurnChangedFiles, maxFiles = 3): string {
  const head = formatTurnChangedFiles(row)
  if (row.files.length === 0) return head
  const shown = row.files.slice(0, maxFiles)
  const more = row.files.length - shown.length
  const names = more > 0 ? `${shown.join(", ")} +${more} more` : shown.join(", ")
  return `${head}: ${names}`
}

/** Minimal message shape needed to find the turn an assistant message closes. */
export type TurnMessage = {
  id: string
  role: string
  parentID?: string
  /** A user message carries `{ diffs }`; an assistant message carries a boolean. */
  summary?: unknown
  time?: { created?: number; completed?: number }
}

/**
 * Changed-files row for the assistant message that ENDS a turn: the user
 * message's `summary.diffs` (already computed per turn by the session summary),
 * shown once, under the last completed assistant message of that turn.
 * Returns undefined for earlier steps of the same turn, an unfinished message,
 * or a turn that changed nothing.
 */
export function turnRowForAssistant(
  messages: readonly TurnMessage[],
  assistantID: string,
): TurnChangedFiles | undefined {
  const assistant = messages.find((message) => message.id === assistantID && message.role === "assistant")
  if (!assistant || !assistant.parentID || !assistant.time?.completed) return undefined
  const lastOfTurn = [...messages].reverse().find((m) => m.role === "assistant" && m.parentID === assistant.parentID)
  if (lastOfTurn?.id !== assistant.id) return undefined
  const user = messages.find((message) => message.id === assistant.parentID && message.role === "user")
  const summary = user?.summary
  const diffs =
    summary && typeof summary === "object" && Array.isArray((summary as { diffs?: unknown }).diffs)
      ? ((summary as { diffs: TurnFileDiff[] }).diffs as readonly TurnFileDiff[])
      : []
  return turnChangedFiles(diffs)
}
