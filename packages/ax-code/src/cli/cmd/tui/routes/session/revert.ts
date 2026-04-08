import { parsePatch } from "diff"

type Message = {
  id: string
  role: string
}

type Info = {
  messageID?: string
  diff?: string
}

export type DiffFile = {
  filename: string
  additions: number
  deletions: number
}

export function diffFiles(diff?: string): DiffFile[] {
  const text = diff ?? ""
  if (!text) return []

  try {
    return parsePatch(text)
      .filter((patch) => patch.hunks.length > 0)
      .map((patch) => {
        const filename = patch.newFileName || patch.oldFileName || "unknown"
        return {
          filename: filename.replace(/^[ab]\//, ""),
          additions: patch.hunks.reduce(
            (sum, hunk) => sum + hunk.lines.filter((line) => line.startsWith("+")).length,
            0,
          ),
          deletions: patch.hunks.reduce(
            (sum, hunk) => sum + hunk.lines.filter((line) => line.startsWith("-")).length,
            0,
          ),
        }
      })
  } catch {
    return []
  }
}

export function revertedMessages(messages: Message[], messageID?: string) {
  if (!messageID) return []
  // Use array position rather than lexicographic `>=` on the ID
  // strings. Ascending IDs are fixed-width today so string comparison
  // happens to work, but the format is fragile — a change to ID length
  // or prefix would silently include or exclude the wrong messages.
  // `messages` is already ordered by creation, so slicing from the
  // target onward is both safer and clearer.
  const idx = messages.findIndex((m) => m.id === messageID)
  if (idx === -1) return []
  return messages.slice(idx).filter((item) => item.role === "user")
}

export function hiddenMessageIDs(messages: Message[], messageID?: string): Set<string> {
  if (!messageID) return new Set()
  const idx = messages.findIndex((m) => m.id === messageID)
  if (idx === -1) return new Set()
  const ids = new Set<string>()
  for (let i = idx; i < messages.length; i++) {
    ids.add(messages[i].id)
  }
  return ids
}

export function revertState(info: Info | undefined, messages: Message[]) {
  if (!info?.messageID) return
  return {
    messageID: info.messageID,
    reverted: revertedMessages(messages, info.messageID),
    diff: info.diff,
    diffFiles: diffFiles(info.diff),
  }
}
