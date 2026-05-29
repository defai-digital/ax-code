import { queueSummary } from "./replay"
import type { AppCommandCenterState, AppDiff, AppMessage, AppMultiRunGroup, AppPart, AppQueueItem } from "./types"

const MAX_VISIBLE_MESSAGES = 200
const MAX_VISIBLE_QUEUE_ITEMS = 200

export function createCommandCenterViewModel(state: AppCommandCenterState) {
  const selectedSession =
    state.projection.session.find((session) => session.id === state.selectedSessionID) ?? state.projection.session[0]
  const selectedSessionID = selectedSession?.id
  const messages = selectedSessionID ? (state.projection.message[selectedSessionID] ?? []) : []
  const todos = selectedSessionID ? (state.projection.todo[selectedSessionID] ?? []) : []
  const diffs = selectedSessionID ? (state.projection.session_diff[selectedSessionID] ?? []) : []
  const permissions = selectedSessionID ? (state.projection.permission[selectedSessionID] ?? []) : []
  const questions = selectedSessionID ? (state.projection.question[selectedSessionID] ?? []) : []
  const goal = selectedSessionID ? state.projection.session_goal[selectedSessionID] : undefined
  const evidence = selectedSessionID ? state.evidence[selectedSessionID] : undefined
  const visibleMessages = tailWindow(messages, MAX_VISIBLE_MESSAGES)
  const sortedQueue = [...state.queue].sort(sortQueueItems)

  return {
    branch: state.projection.vcs?.branch ?? "unknown",
    selectedSession,
    sessions: state.projection.session,
    catalog: state.catalog,
    worktrees: state.worktrees,
    multiRunGroups: multiRunGroups(state.queue, state.projection.session_diff),
    terminals: state.terminals,
    scheduledTasks: [...state.scheduledTasks].sort((a, b) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity)),
    queue: sortedQueue.slice(0, MAX_VISIBLE_QUEUE_ITEMS),
    queueHiddenCount: Math.max(0, sortedQueue.length - MAX_VISIBLE_QUEUE_ITEMS),
    queueSummary: queueSummary(state.queue),
    messages: visibleMessages.map((message) => ({
      ...message,
      parts: state.projection.part[message.id] ?? [],
      text: messageText(message, state.projection.part[message.id] ?? []),
    })),
    messageHiddenCount: Math.max(0, messages.length - visibleMessages.length),
    todos,
    diffs,
    permissions,
    questions,
    goal,
    evidence,
    status: selectedSessionID ? state.projection.session_status[selectedSessionID] : undefined,
  }
}

function tailWindow<T>(items: T[], limit: number) {
  return items.length > limit ? items.slice(items.length - limit) : items
}

function multiRunGroups(queue: AppQueueItem[], sessionDiffs: Record<string, AppDiff[]>): AppMultiRunGroup[] {
  const groups = new Map<string, AppQueueItem[]>()
  for (const item of queue) {
    const id = readMultiRunID(item)
    if (!id) continue
    const items = groups.get(id) ?? []
    items.push(item)
    groups.set(id, items)
  }
  return [...groups.entries()]
    .map(([id, items]) => {
      const sorted = [...items].sort(sortQueueItems)
      const groupSessionDiffs = multiRunSessionDiffs(sorted, sessionDiffs)
      const conflictPaths = multiRunConflictPaths(groupSessionDiffs)
      const running = sorted.filter((item) => item.status === "running").length
      const blocked = sorted.filter(
        (item) => item.status === "blocked_permission" || item.status === "blocked_question",
      ).length
      const queued = sorted.filter((item) => item.status === "queued" || item.status === "waiting_for_idle").length
      const completed = sorted.filter((item) => item.status === "completed").length
      const failed = sorted.filter((item) => item.status === "failed" || item.status === "cancelled").length
      return {
        id,
        title: multiRunTitle(sorted),
        attention: multiRunAttention({ running, blocked, queued, completed, failed, conflictPaths }),
        total: sorted.length,
        running,
        blocked,
        queued,
        completed,
        failed,
        sessions: uniqueStrings(sorted.map((item) => item.sessionID)),
        worktrees: uniqueStrings(
          sorted.map((item) => item.worktree ?? readPayloadString(item, "worktree") ?? item.directory),
        ),
        conflictPaths,
        changedFiles: uniqueStrings(groupSessionDiffs.flatMap((item) => item.files)).sort(),
        sessionDiffs: groupSessionDiffs,
        items: sorted,
      } satisfies AppMultiRunGroup
    })
    .sort((a, b) => b.items[0]!.createdAt - a.items[0]!.createdAt)
}

function multiRunSessionDiffs(items: AppQueueItem[], sessionDiffs: Record<string, AppDiff[]>) {
  return uniqueStrings(items.map((item) => item.sessionID))
    .map((sessionID) => {
      const diffs = sessionDiffs[sessionID] ?? []
      return {
        sessionID,
        files: uniqueStrings(diffs.map((diff) => diff.path)).sort(),
        additions: diffs.reduce((sum, diff) => sum + diff.added, 0),
        removals: diffs.reduce((sum, diff) => sum + diff.removed, 0),
      }
    })
    .filter((item) => item.files.length > 0 || item.additions > 0 || item.removals > 0)
}

function multiRunConflictPaths(sessionDiffs: Array<{ files: string[] }>) {
  const counts = new Map<string, number>()
  for (const diff of sessionDiffs) {
    for (const file of new Set(diff.files)) counts.set(file, (counts.get(file) ?? 0) + 1)
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([file]) => file)
    .sort()
}

function multiRunAttention(input: {
  running: number
  blocked: number
  queued: number
  completed: number
  failed: number
  conflictPaths: string[]
}): AppMultiRunGroup["attention"] {
  if (input.failed > 0) return "failed"
  if (input.blocked > 0) return "blocked"
  if (input.conflictPaths.length > 0) return "conflict"
  if (input.running > 0) return "running"
  if (input.queued > 0) return "queued"
  return "ready"
}

function readMultiRunID(item: AppQueueItem) {
  return readPayloadString(item, "multiRunID")
}

function readPayloadString(item: AppQueueItem, key: string) {
  const value = item.payload?.[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function multiRunTitle(items: AppQueueItem[]) {
  const first = items[0]
  if (!first) return "Multi-run"
  const count = first.payload?.["multiRunCount"]
  return typeof count === "number" ? `${first.title} · ${count} variants` : first.title
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

function messageText(message: AppMessage, parts: AppPart[]) {
  const text = parts
    .map((part) => part.text)
    .filter((partText): partText is string => Boolean(partText))
    .join("\n")
    .trim()
  return text || `${message.role} message`
}

function sortQueueItems(a: AppQueueItem, b: AppQueueItem) {
  if (a.priority !== b.priority) return a.priority - b.priority
  if ((a.position ?? 0) !== (b.position ?? 0)) return (a.position ?? 0) - (b.position ?? 0)
  return a.createdAt - b.createdAt
}
