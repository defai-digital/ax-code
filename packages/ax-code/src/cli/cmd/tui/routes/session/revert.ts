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
          additions: patch.hunks.reduce((sum, hunk) => sum + hunk.lines.filter((line) => line.startsWith("+")).length, 0),
          deletions: patch.hunks.reduce((sum, hunk) => sum + hunk.lines.filter((line) => line.startsWith("-")).length, 0),
        }
      })
  } catch {
    return []
  }
}

export function revertedMessages(messages: Message[], messageID?: string) {
  if (!messageID) return []
  return messages.filter((item) => item.id >= messageID && item.role === "user")
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
