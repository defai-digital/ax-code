// the approaches in this edit tool are sourced from
// https://github.com/cline/cline/blob/main/evals/diff-edits/diff-apply/diff-06-23-25.ts
// https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/utils/editCorrector.ts
// https://github.com/cline/cline/blob/main/evals/diff-edits/diff-apply/diff-06-26-25.ts

import z from "zod"
import * as path from "path"
import * as fs from "fs/promises"
import { Tool } from "./tool"
import { createTwoFilesPatch, diffLines } from "diff"
import DESCRIPTION from "./edit.txt"
import { FileTime } from "../file/time"
import { Filesystem } from "../util/filesystem"
import { Instance } from "../project/instance"
import { Snapshot } from "@/snapshot"
import { assertExternalDirectory, assertSymlinkInsideProject } from "./external-directory"
import { notifyFileEdited, collectDiagnostics } from "./diagnostics"
import { Isolation } from "@/isolation"
import { BlastRadius } from "@/session/blast-radius"
import { NativePerf } from "../perf/native"
import { NativeAddon } from "../native/addon"

function normalizeLineEndings(text: string): string {
  return text.replaceAll("\r\n", "\n")
}

function detectLineEnding(text: string): "\n" | "\r\n" {
  return text.includes("\r\n") ? "\r\n" : "\n"
}

function convertToLineEnding(text: string, ending: "\n" | "\r\n"): string {
  if (ending === "\n") return text
  return text.replaceAll("\n", "\r\n")
}

function normalizeLineEndingsWithOffsets(text: string) {
  let normalized = ""
  const offsets = [0]
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\r" && text[i + 1] === "\n") {
      normalized += "\n"
      i++
      offsets.push(i + 1)
      continue
    }
    normalized += text[i]!
    offsets.push(i + 1)
  }
  return { normalized, offsets }
}

function spliceNormalizedReplacement(input: {
  original: string
  normalizedResult: string
  replacementEnding: "\n" | "\r\n"
}) {
  const { original, normalizedResult, replacementEnding } = input
  const normalizedOriginal = normalizeLineEndingsWithOffsets(original)

  let start = 0
  while (
    start < normalizedOriginal.normalized.length &&
    start < normalizedResult.length &&
    normalizedOriginal.normalized[start] === normalizedResult[start]
  ) {
    start++
  }

  let originalEnd = normalizedOriginal.normalized.length
  let resultEnd = normalizedResult.length
  while (
    originalEnd > start &&
    resultEnd > start &&
    normalizedOriginal.normalized[originalEnd - 1] === normalizedResult[resultEnd - 1]
  ) {
    originalEnd--
    resultEnd--
  }

  const replacement = convertToLineEnding(normalizedResult.slice(start, resultEnd), replacementEnding)
  return (
    original.slice(0, normalizedOriginal.offsets[start]!) +
    replacement +
    original.slice(normalizedOriginal.offsets[originalEnd]!)
  )
}

export const EditTool = Tool.define("edit", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("The absolute path to the file to modify"),
    oldString: z.string().max(500_000).describe("The text to replace"),
    newString: z.string().max(1_000_000).describe("The text to replace it with (must be different from oldString)"),
    replaceAll: z.boolean().optional().describe("Replace all occurrences of oldString (default false)"),
  }),
  async execute(params, ctx) {
    if (params.filePath.includes("\x00")) {
      throw new Error("File path contains null byte")
    }

    if (!params.filePath) {
      throw new Error("filePath is required")
    }

    if (params.oldString === params.newString) {
      throw new Error("No changes to apply: oldString and newString are identical.")
    }

    const filePath = path.isAbsolute(params.filePath) ? params.filePath : path.join(Instance.directory, params.filePath)
    await assertExternalDirectory(ctx, filePath)
    Isolation.assertWrite(ctx.extra?.isolation, filePath, Instance.directory, Instance.worktree)
    BlastRadius.assertWritable(ctx.sessionID, path.relative(Instance.worktree, filePath))

    let diff = ""
    let contentOld = ""
    let contentNew = ""
    await FileTime.withLock(filePath, async () => {
      // Keep symlink validation inside the same per-path lock as the
      // read/permission/write flow, matching write.ts.
      await assertSymlinkInsideProject(filePath)

      if (params.oldString === "") {
        const existed = await Filesystem.exists(filePath)
        // When overwriting an existing file, enforce the "must read
        // before write" protection. Previously the empty-oldString
        // branch skipped FileTime.assert entirely, letting an edit
        // with oldString="" blow away a file the session had never
        // read — bypassing the staleness check that every other
        // write path enforces.
        if (existed) {
          await FileTime.assert(ctx.sessionID, filePath)
          contentOld = await Filesystem.readText(filePath)
        }
        contentNew = params.newString
        diff = trimDiff(createTwoFilesPatch(filePath, filePath, contentOld, contentNew))
        await ctx.ask({
          permission: "edit",
          patterns: [path.relative(Instance.worktree, filePath)],
          always: ["*"],
          metadata: {
            filepath: filePath,
            diff,
          },
        })
        await Filesystem.write(filePath, params.newString)
        await notifyFileEdited(filePath, existed ? "change" : "add")
        await FileTime.read(ctx.sessionID, filePath)
        return
      }

      const stats = await fs.stat(filePath).catch(() => null)
      if (!stats) throw new Error(`File ${filePath} not found`)
      if (stats.isDirectory()) throw new Error(`Path is a directory, not a file: ${filePath}`)
      await FileTime.assert(ctx.sessionID, filePath)
      contentOld = await Filesystem.readText(filePath)

      const ending = detectLineEnding(contentOld)
      // Normalize oldString/newString to match the file's detected line ending.
      // For mixed-ending files, also attempt matching against the raw content
      // so that edits work regardless of which endings are in the target region.
      const old = convertToLineEnding(normalizeLineEndings(params.oldString), ending)
      const next = convertToLineEnding(normalizeLineEndings(params.newString), ending)

      let replaced: string | undefined
      try {
        replaced = replace(contentOld, old, next, params.replaceAll)
      } catch {
        // If the converted ending doesn't match (mixed-ending file),
        // try with normalized endings on both sides.
        const normalizedContent = normalizeLineEndings(contentOld)
        const normalizedOld = normalizeLineEndings(params.oldString)
        const normalizedNext = normalizeLineEndings(params.newString)
        const normalizedResult = replace(normalizedContent, normalizedOld, normalizedNext, params.replaceAll)
        replaced = spliceNormalizedReplacement({
          original: contentOld,
          normalizedResult,
          replacementEnding: ending,
        })
      }
      contentNew = replaced

      diff = trimDiff(
        createTwoFilesPatch(filePath, filePath, normalizeLineEndings(contentOld), normalizeLineEndings(contentNew)),
      )
      await ctx.ask({
        permission: "edit",
        patterns: [path.relative(Instance.worktree, filePath)],
        always: ["*"],
        metadata: {
          filepath: filePath,
          diff,
        },
      })

      await Filesystem.write(filePath, contentNew)
      await notifyFileEdited(filePath, "change")
      // The diff above was already computed from the same `contentOld`
      // and `contentNew` locals — recomputing here produces an
      // identical string and wastes CPU on large files.
      await FileTime.read(ctx.sessionID, filePath)
    })

    const filediff: Snapshot.FileDiff = {
      file: filePath,
      before: contentOld,
      after: contentNew,
      additions: 0,
      deletions: 0,
    }
    for (const change of diffLines(contentOld, contentNew)) {
      if (change.added) filediff.additions += change.count || 0
      if (change.removed) filediff.deletions += change.count || 0
    }
    BlastRadius.recordWriteAndAssert(ctx.sessionID, filePath, filediff.additions + filediff.deletions)

    ctx.metadata({
      metadata: {
        diff,
        filediff,
        diagnostics: {},
      },
    })

    const { diagnostics, output: diagOutput } = await collectDiagnostics([filePath])
    // Show a context snippet around the edit so the LLM sees the new file state.
    // This prevents stale-context bugs when making multiple edits to the same file.
    const newLines = contentNew.split("\n")
    const oldLines = contentOld.split("\n")
    let editIdx = newLines.findIndex((line, i) => oldLines[i] !== line)
    if (editIdx === -1) editIdx = 0
    const snippetStart = Math.max(0, editIdx - 3)
    const snippetEnd = Math.min(newLines.length, editIdx + params.newString.split("\n").length + 3)
    const snippet =
      editIdx >= 0
        ? "\n\nHint: the file now reads (lines " +
          (snippetStart + 1) +
          "-" +
          snippetEnd +
          "):\n" +
          newLines
            .slice(snippetStart, snippetEnd)
            .map((l, i) => `${snippetStart + i + 1}\t${l}`)
            .join("\n")
        : ""
    let output = "Edit applied successfully." + snippet + diagOutput

    return {
      metadata: {
        diagnostics,
        diff,
        filediff,
      },
      title: `${path.relative(Instance.worktree, filePath)}`,
      output,
    }
  },
})

export type Replacer = (content: string, find: string) => Generator<string, void, unknown>

// Similarity thresholds for block anchor fallback matching
const SINGLE_CANDIDATE_SIMILARITY_THRESHOLD = 0.6
const MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD = 0.3

import { levenshtein } from "@/util/levenshtein"

export const SimpleReplacer: Replacer = function* (_content, find) {
  yield find
}

export const LineTrimmedReplacer: Replacer = function* (content, find) {
  const originalLines = content.split("\n")
  const searchLines = find.split("\n")

  if (searchLines[searchLines.length - 1] === "") {
    searchLines.pop()
  }

  for (let i = 0; i <= originalLines.length - searchLines.length; i++) {
    let matches = true

    for (let j = 0; j < searchLines.length; j++) {
      const originalTrimmed = originalLines[i + j].trim()
      const searchTrimmed = searchLines[j].trim()

      if (originalTrimmed !== searchTrimmed) {
        matches = false
        break
      }
    }

    if (matches) {
      let matchStartIndex = 0
      for (let k = 0; k < i; k++) {
        matchStartIndex += originalLines[k].length + 1
      }

      let matchEndIndex = matchStartIndex
      for (let k = 0; k < searchLines.length; k++) {
        matchEndIndex += originalLines[i + k].length
        if (k < searchLines.length - 1) {
          matchEndIndex += 1 // Add newline character except for the last line
        }
      }

      yield content.substring(matchStartIndex, matchEndIndex)
    }
  }
}

export const BlockAnchorReplacer: Replacer = function* (content, find) {
  const originalLines = content.split("\n")
  const searchLines = find.split("\n")

  if (searchLines.length < 3) {
    return
  }

  if (searchLines[searchLines.length - 1] === "") {
    searchLines.pop()
  }

  if (searchLines.length < 1) return

  const firstLineSearch = searchLines[0].trim()
  const lastLineSearch = searchLines[searchLines.length - 1].trim()
  const searchBlockSize = searchLines.length

  // Collect all candidate positions where both anchors match
  const candidates: Array<{ startLine: number; endLine: number }> = []
  for (let i = 0; i < originalLines.length; i++) {
    if (originalLines[i].trim() !== firstLineSearch) {
      continue
    }

    // Single-line search: first and last line are the same
    if (searchBlockSize === 1) {
      candidates.push({ startLine: i, endLine: i })
      continue
    }

    // Look for the matching last line after this first line. Start at
    // i + 1 so 2-line blocks can match — previously j = i + 2 skipped
    // the line immediately after the anchor, making 2-line searches
    // unfindable even though the guards above permit them.
    for (let j = i + 1; j < originalLines.length; j++) {
      if (originalLines[j].trim() === lastLineSearch) {
        candidates.push({ startLine: i, endLine: j })
        break // Only match the first occurrence of the last line
      }
    }
  }

  // Return immediately if no candidates
  if (candidates.length === 0) {
    return
  }

  // Handle single candidate scenario (using relaxed threshold)
  if (candidates.length === 1) {
    const { startLine, endLine } = candidates[0]
    const actualBlockSize = endLine - startLine + 1

    let similarity = 0
    const linesToCheck = Math.min(searchBlockSize - 2, actualBlockSize - 2)

    if (linesToCheck > 0) {
      let linesChecked = 0
      for (let j = 1; j < searchBlockSize - 1 && j < actualBlockSize - 1; j++) {
        const originalLine = originalLines[startLine + j].trim()
        const searchLine = searchLines[j].trim()
        const maxLen = Math.max(originalLine.length, searchLine.length)
        if (maxLen === 0) {
          continue
        }
        linesChecked++
        const distance = levenshtein(originalLine, searchLine)
        similarity += 1 - distance / maxLen
      }
      similarity = linesChecked > 0 ? similarity / linesChecked : 1.0
    } else {
      similarity = 1.0
    }

    if (similarity >= SINGLE_CANDIDATE_SIMILARITY_THRESHOLD) {
      let matchStartIndex = 0
      for (let k = 0; k < startLine; k++) {
        matchStartIndex += originalLines[k].length + 1
      }
      let matchEndIndex = matchStartIndex
      for (let k = startLine; k <= endLine; k++) {
        matchEndIndex += originalLines[k].length
        if (k < endLine) {
          matchEndIndex += 1 // Add newline character except for the last line
        }
      }
      yield content.substring(matchStartIndex, matchEndIndex)
    }
    return
  }

  // Calculate similarity for multiple candidates
  let bestMatch: { startLine: number; endLine: number } | null = null
  let maxSimilarity = -1

  for (const candidate of candidates) {
    const { startLine, endLine } = candidate
    const actualBlockSize = endLine - startLine + 1

    let similarity = 0
    const linesToCheck = Math.min(searchBlockSize - 2, actualBlockSize - 2) // Middle lines only

    if (linesToCheck > 0) {
      let linesChecked = 0
      for (let j = 1; j < searchBlockSize - 1 && j < actualBlockSize - 1; j++) {
        const originalLine = originalLines[startLine + j].trim()
        const searchLine = searchLines[j].trim()
        const maxLen = Math.max(originalLine.length, searchLine.length)
        if (maxLen === 0) {
          continue
        }
        linesChecked++
        const distance = levenshtein(originalLine, searchLine)
        similarity += 1 - distance / maxLen
      }
      similarity = linesChecked > 0 ? similarity / linesChecked : 1.0
    } else {
      // No middle lines to compare, just accept based on anchors
      similarity = 1.0
    }

    if (similarity > maxSimilarity) {
      maxSimilarity = similarity
      bestMatch = candidate
    }
  }

  // Threshold judgment
  if (maxSimilarity >= MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD && bestMatch) {
    const { startLine, endLine } = bestMatch
    let matchStartIndex = 0
    for (let k = 0; k < startLine; k++) {
      matchStartIndex += originalLines[k].length + 1
    }
    let matchEndIndex = matchStartIndex
    for (let k = startLine; k <= endLine; k++) {
      matchEndIndex += originalLines[k].length
      if (k < endLine) {
        matchEndIndex += 1
      }
    }
    yield content.substring(matchStartIndex, matchEndIndex)
  }
}

export const WhitespaceNormalizedReplacer: Replacer = function* (content, find) {
  const normalizeWhitespace = (text: string) => text.replace(/\s+/g, " ").trim()
  const normalizedFind = normalizeWhitespace(find)

  // Handle single line matches
  const lines = content.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (normalizeWhitespace(line) === normalizedFind) {
      yield line
    } else {
      // Only check for substring matches if the full line doesn't match
      const normalizedLine = normalizeWhitespace(line)
      if (normalizedLine.includes(normalizedFind)) {
        // Find the actual substring in the original line that matches.
        // Build a `word\s+word\s+...` regex from the search text, but cap
        // the word count at 6: combining many short words with flexible
        // `\s+` separators creates exponential-backtracking regexes that
        // can hang the edit tool on adversarial input (ReDoS). For longer
        // searches we fall back to yielding the normalized find text as
        // the match — the caller handles multi-line matching separately
        // via `findLines`, so this branch is only best-effort.
        const words = find.trim().split(/\s+/)
        if (words.length > 6) {
          yield find
        } else if (words.length > 0) {
          const pattern = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+")
          try {
            const regex = new RegExp(pattern)
            const match = line.match(regex)
            if (match) {
              yield match[0]
            }
          } catch (e) {
            // Invalid regex pattern, skip
          }
        }
      }
    }
  }

  // Handle multi-line matches
  const findLines = find.split("\n")
  if (findLines.length > 1) {
    for (let i = 0; i <= lines.length - findLines.length; i++) {
      const block = lines.slice(i, i + findLines.length)
      if (normalizeWhitespace(block.join("\n")) === normalizedFind) {
        yield block.join("\n")
      }
    }
  }
}

export const IndentationFlexibleReplacer: Replacer = function* (content, find) {
  const removeIndentation = (text: string) => {
    const lines = text.split("\n")
    const nonEmptyLines = lines.filter((line) => line.trim().length > 0)
    if (nonEmptyLines.length === 0) return text

    const minIndent = Math.min(
      ...nonEmptyLines.map((line) => {
        const match = line.match(/^(\s*)/)
        return match ? match[1].length : 0
      }),
    )

    return lines.map((line) => (line.trim().length === 0 ? line : line.slice(minIndent))).join("\n")
  }

  const normalizedFind = removeIndentation(find)
  const contentLines = content.split("\n")
  const findLines = find.split("\n")

  for (let i = 0; i <= contentLines.length - findLines.length; i++) {
    const block = contentLines.slice(i, i + findLines.length).join("\n")
    if (removeIndentation(block) === normalizedFind) {
      yield block
    }
  }
}

export const EscapeNormalizedReplacer: Replacer = function* (content, find) {
  const unescapeString = (str: string): string => {
    return str.replace(/\\(n|t|r|'|"|`|\\|\$)/g, (match, capturedChar) => {
      switch (capturedChar) {
        case "n":
          return "\n"
        case "t":
          return "\t"
        case "r":
          return "\r"
        case "'":
          return "'"
        case '"':
          return '"'
        case "`":
          return "`"
        case "\\":
          return "\\"
        case "$":
          return "$"
        default:
          return match
      }
    })
  }

  const unescapedFind = unescapeString(find)

  // Try direct match with unescaped find string. If it succeeds, stop
  // here — the multi-line rescan below would otherwise yield the same
  // content a second time as an "escaped version", and the caller's
  // uniqueness check (indexOf !== lastIndexOf) would incorrectly
  // report "multiple matches" for what is really a single match.
  if (content.includes(unescapedFind)) {
    yield unescapedFind
    return
  }

  // Also try finding escaped versions in content that match unescaped find
  const lines = content.split("\n")
  const findLines = unescapedFind.split("\n")

  for (let i = 0; i <= lines.length - findLines.length; i++) {
    const block = lines.slice(i, i + findLines.length).join("\n")
    const unescapedBlock = unescapeString(block)

    if (unescapedBlock === unescapedFind) {
      yield block
    }
  }
}

export const MultiOccurrenceReplacer: Replacer = function* (content, find) {
  // This replacer yields all exact matches, allowing the replace function
  // to handle multiple occurrences based on replaceAll parameter
  let startIndex = 0

  while (true) {
    const index = content.indexOf(find, startIndex)
    if (index === -1) break

    yield find
    startIndex = index + find.length
  }
}

export const TrimmedBoundaryReplacer: Replacer = function* (content, find) {
  const trimmedFind = find.trim()

  if (trimmedFind === find) {
    // Already trimmed, no point in trying
    return
  }

  // Try to find the trimmed version
  if (content.includes(trimmedFind)) {
    yield trimmedFind
  }

  // Also try finding blocks where trimmed content matches
  const lines = content.split("\n")
  const findLines = find.split("\n")

  for (let i = 0; i <= lines.length - findLines.length; i++) {
    const block = lines.slice(i, i + findLines.length).join("\n")

    if (block.trim() === trimmedFind) {
      yield block
    }
  }
}

export const ContextAwareReplacer: Replacer = function* (content, find) {
  const findLines = find.split("\n")
  if (findLines.length < 3) {
    // Need at least 3 lines to have meaningful context
    return
  }

  // Remove trailing empty line if present
  if (findLines[findLines.length - 1] === "") {
    findLines.pop()
  }

  if (findLines.length < 2) return

  const contentLines = content.split("\n")

  // Extract first and last lines as context anchors
  const firstLine = findLines[0].trim()
  const lastLine = findLines[findLines.length - 1].trim()

  // Find blocks that start and end with the context anchors
  for (let i = 0; i < contentLines.length; i++) {
    if (contentLines[i].trim() !== firstLine) continue

    // Look for the matching last line. We keep scanning forward even
    // when a wrong-length candidate appears, because the *correct*
    // block for this `i` may begin later in the file. A previous
    // version had a `break` that abandoned `i` as soon as it saw the
    // first `lastLine` regardless of whether the enclosing block
    // matched `findLines.length`, causing valid later matches to be
    // silently dropped.
    let matched = false
    // Start at i + 1 so 2-line blocks can match. j = i + 2 previously
    // skipped the line right after the first anchor, making 2-line
    // context-aware edits unfindable.
    for (let j = i + 1; j < contentLines.length && !matched; j++) {
      if (contentLines[j].trim() !== lastLine) continue

      // Found a candidate block bounded by the context anchors.
      const blockLines = contentLines.slice(i, j + 1)
      if (blockLines.length !== findLines.length) continue

      // Check if the middle content has reasonable similarity
      // (simple heuristic: at least 50% of non-empty lines should
      // match when trimmed).
      let matchingLines = 0
      let totalNonEmptyLines = 0
      for (let k = 1; k < blockLines.length - 1; k++) {
        const blockLine = blockLines[k].trim()
        const findLine = findLines[k].trim()
        if (blockLine.length > 0 || findLine.length > 0) {
          totalNonEmptyLines++
          if (blockLine === findLine) {
            matchingLines++
          }
        }
      }

      if (totalNonEmptyLines === 0 || matchingLines / totalNonEmptyLines >= 0.5) {
        yield blockLines.join("\n")
        matched = true // stop the j-loop; we've yielded the first valid match for this i
      }
    }
  }
}

export function trimDiff(diff: string): string {
  const lines = diff.split("\n")
  const contentLines = lines.filter(
    (line) =>
      (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) &&
      !line.startsWith("---") &&
      !line.startsWith("+++"),
  )

  if (contentLines.length === 0) return diff

  let min = Infinity
  for (const line of contentLines) {
    const content = line.slice(1)
    if (content.trim().length > 0) {
      const match = content.match(/^(\s*)/)
      if (match) min = Math.min(min, match[1].length)
    }
  }
  if (min === Infinity || min === 0) return diff
  const trimmedLines = lines.map((line) => {
    if (
      (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) &&
      !line.startsWith("---") &&
      !line.startsWith("+++")
    ) {
      const prefix = line[0]
      const content = line.slice(1)
      return prefix + content.slice(min)
    }
    return line
  })

  return trimmedLines.join("\n")
}

export function replace(content: string, oldString: string, newString: string, replaceAll = false): string {
  const native = NativeAddon.diff()
  if (native) {
    try {
      const json = NativePerf.run(
        "diff.editReplace",
        {
          contentBytes: content.length,
          oldBytes: oldString.length,
          newBytes: newString.length,
          replaceAll,
        },
        () => native.editReplace(content, oldString, newString, replaceAll ?? false),
      )
      const result = JSON.parse(json)
      if (typeof result.new_content !== "string")
        throw new Error("Native diff returned invalid result: new_content is not a string")
      return result.new_content
    } catch (e: any) {
      if (e?.code !== "MODULE_NOT_FOUND" && e?.code !== "ERR_MODULE_NOT_FOUND") throw e
    }
  }

  if (oldString === newString) {
    throw new Error("No changes to apply: oldString and newString are identical.")
  }

  if (replaceAll) {
    if (!content.includes(oldString)) {
      throw new Error("Could not find oldString in the file. It must match exactly when replaceAll is enabled.")
    }
    return content.replaceAll(oldString, newString)
  }

  let notFound = true

  for (const replacer of [
    SimpleReplacer,
    LineTrimmedReplacer,
    BlockAnchorReplacer,
    WhitespaceNormalizedReplacer,
    IndentationFlexibleReplacer,
    EscapeNormalizedReplacer,
    TrimmedBoundaryReplacer,
    ContextAwareReplacer,
    MultiOccurrenceReplacer,
  ]) {
    for (const search of replacer(content, oldString)) {
      const index = content.indexOf(search)
      if (index === -1) continue
      notFound = false
      const lastIndex = content.lastIndexOf(search)
      if (index !== lastIndex) continue
      return content.substring(0, index) + newString + content.substring(index + search.length)
    }
  }

  if (notFound) {
    throw new Error(
      "Could not find oldString in the file. It must match exactly, including whitespace, indentation, and line endings.",
    )
  }
  throw new Error("Found multiple matches for oldString. Provide more surrounding context to make the match unique.")
}
