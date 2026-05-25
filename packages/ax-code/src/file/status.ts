import { parseNumstatLine, parsePathLine } from "../util/git-output"

export type FileStatusKind = "added" | "deleted" | "modified"

export interface FileStatusEntry {
  path: string
  added: number
  removed: number
  status: FileStatusKind
}

export function parseModifiedNumstat(output: string): FileStatusEntry[] {
  const text = output.trim()
  if (!text) return []

  const result: FileStatusEntry[] = []
  for (const line of text.split("\n")) {
    const parsed = parseNumstatLine(line)
    if (!parsed) continue
    result.push({
      path: parsed.file,
      added: parsed.additions,
      removed: parsed.deletions,
      status: "modified",
    })
  }
  return result
}

export function parseDeletedPaths(output: string): string[] {
  const text = output.trim()
  if (!text) return []

  return text
    .split("\n")
    .map((line) => parsePathLine(line))
    .filter((file): file is string => Boolean(file))
}

export function untrackedFileStatus(file: string, content: string): FileStatusEntry {
  const lines = content.split("\n")
  return {
    path: file,
    added: content.endsWith("\n") ? lines.length - 1 : lines.length,
    removed: 0,
    status: "added",
  }
}

export function deletedFileStatus(file: string, numstatOutput: string): FileStatusEntry {
  return {
    path: file,
    added: 0,
    removed: parseNumstatLine(numstatOutput.trim())?.deletions ?? 0,
    status: "deleted",
  }
}
