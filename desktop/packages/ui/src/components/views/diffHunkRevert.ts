import { diffAcceptRejectHunk, parseDiffFromFile, type FileContents, type Hunk } from "@pierre/diffs"

function toFileContents(fileName: string, contents: string): FileContents {
  return { name: fileName, contents }
}

/** Parses `original`/`modified` (full file contents) into per-hunk metadata. */
export function getFileHunks(original: string, modified: string, fileName = ""): Hunk[] {
  const diff = parseDiffFromFile(toFileContents(fileName, original), toFileContents(fileName, modified))
  return diff.hunks
}

/**
 * Reconstructs the file's full content with a single hunk reverted back to
 * `original`, leaving every other hunk's change untouched. `modified` is
 * assumed to already be on disk (the agent writes changes directly), so this
 * is a revert, not a pre-apply "reject" the way Copilot Edits/Zed use the term.
 */
export function revertHunk(original: string, modified: string, hunkIndex: number, fileName = ""): string {
  const diff = parseDiffFromFile(toFileContents(fileName, original), toFileContents(fileName, modified))
  // Each entry in `additionLines` already carries its own trailing "\n" (the
  // last line doesn't, matching whether the file ends with a newline) — join
  // with "" here, not "\n", or every line gets doubled.
  const resolved = diffAcceptRejectHunk(diff, hunkIndex, "reject")
  return resolved.additionLines.join("")
}
