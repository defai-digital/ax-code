import { mergeSorted } from "../../context/sync-util"

type Entry = { info: { id: string; role: string }; parts: unknown[] }

export class MissingRevertMessageError extends Error {
  constructor() {
    super("The undo message is missing from stored history. Retry or use Restore all.")
    this.name = "MissingRevertMessageError"
  }
}

/** Read bounded pages until the undo boundary and a preceding user turn are available. */
export async function loadRevertHistory<T extends Entry>(input: {
  messageID: string
  signal: AbortSignal
  fetchPage: (before?: string) => Promise<{ data: T[] | undefined; response: Response }>
}) {
  const pages: T[][] = []
  const cursors = new Set<string>()
  let before: string | undefined
  let found = false
  while (true) {
    input.signal.throwIfAborted()
    const result = await input.fetchPage(before)
    input.signal.throwIfAborted()
    if (!Array.isArray(result.data)) throw new Error("Invalid message history response")
    pages.push(result.data)
    const index = result.data.findIndex((item) => item.info.id === input.messageID)
    const preceding = (found ? result.data : result.data.slice(0, Math.max(0, index))).some(
      (item) => item.info.role === "user",
    )
    found ||= index >= 0
    const next = result.response.headers.get("X-Next-Cursor") || undefined
    if (found && (!next || preceding)) {
      return { messages: pages.reverse().flat(), truncated: !!next }
    }
    if (!next) throw new MissingRevertMessageError()
    if (cursors.has(next) || result.data.length === 0) throw new Error("Message history pagination made no progress")
    cursors.add(next)
    before = next
  }
}

/** Prepend history without overwriting newer streamed message/part state. */
export function mergeRevertHistory<M extends { id: string }, P>(
  store: { message: Record<string, M[]>; part: Record<string, P[]> },
  sessionID: string,
  history: Array<{ info: M; parts: P[] }>,
) {
  const existing = store.message[sessionID] ?? []
  const ids = new Set(existing.map((item) => item.id))
  const older = history.filter((item) => !ids.has(item.info.id))
  store.message[sessionID] = mergeSorted(
    existing,
    older.map((item) => item.info),
  )
  for (const item of older) store.part[item.info.id] = item.parts
}
