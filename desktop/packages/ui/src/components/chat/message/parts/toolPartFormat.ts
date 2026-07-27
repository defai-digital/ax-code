import { detectToolOutputLanguage } from "@/lib/toolHelpers"
import type { ToolPart as ToolPartType, ToolState as ToolStateUnion } from "@ax-code/sdk/v2"
import { formatEditOutput } from "../toolRenderers"
import { getPatchText, isRecord } from "./toolDiffUtils"
import { getToolRelativePath, normalizeToolDisplayPath } from "./toolPathDisplay"

export type ToolStateWithMetadata = ToolStateUnion & {
  metadata?: Record<string, unknown>
  input?: Record<string, unknown>
  output?: string
  error?: string
  time?: { start: number; end?: number }
}

export const normalizeToolName = (toolName: string | undefined | null): string => {
  if (typeof toolName !== "string") {
    return ""
  }

  const trimmed = toolName.trim().toLowerCase()
  if (!trimmed) {
    return ""
  }

  if (trimmed.includes(".")) {
    const dotParts = trimmed.split(".").filter(Boolean)
    const last = dotParts[dotParts.length - 1]
    if (last) return last
  }

  return trimmed
}

const MAX_DURATION_MS = 5 * 60 * 1000 // 5 minutes cap

export const formatDuration = (start: number, end?: number, now: number = Date.now()) => {
  const duration = Math.min(Math.max(0, (end ?? now) - start), MAX_DURATION_MS)
  const seconds = duration / 1000

  const displaySeconds = seconds < 0.05 && end !== undefined ? 0.1 : seconds
  return `${displaySeconds.toFixed(1)}s`
}

export const parseDiffStats = (metadata?: Record<string, unknown>): { added: number; removed: number } | null => {
  const diffText = getPatchText((metadata as { patch?: unknown } | undefined)?.patch) ?? getPatchText(metadata?.diff)
  if (!diffText) return null

  let added = 0
  let removed = 0
  let lineStart = 0

  for (let index = 0; index <= diffText.length; index += 1) {
    if (index < diffText.length && diffText.charCodeAt(index) !== 10) {
      continue
    }

    const line = diffText.slice(lineStart, index)
    if (line.startsWith("+") && !line.startsWith("+++")) added++
    if (line.startsWith("-") && !line.startsWith("---")) removed++
    lineStart = index + 1
  }

  if (added === 0 && removed === 0) return null
  return { added, removed }
}

export const parseWriteLineCount = (input?: Record<string, unknown>): number | null => {
  if (!input?.content || typeof input.content !== "string") return null
  let lines = 1
  for (let index = 0; index < input.content.length; index += 1) {
    if (input.content.charCodeAt(index) === 10) {
      lines += 1
    }
  }
  return lines
}

const extractFirstChangedLineFromDiff = (diffText: string): number | undefined => {
  if (!diffText || typeof diffText !== "string") {
    return undefined
  }

  const lines = diffText.split("\n")
  let currentNewLine: number | undefined
  let firstHunkStart: number | undefined

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, "")
    const hunkMatch = line.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/)
    if (hunkMatch) {
      const parsed = Number.parseInt(hunkMatch[1] ?? "", 10)
      if (Number.isFinite(parsed)) {
        currentNewLine = Math.max(1, parsed)
        if (!Number.isFinite(firstHunkStart)) {
          firstHunkStart = currentNewLine
        }
      }
      continue
    }

    if (currentNewLine === undefined || !Number.isFinite(currentNewLine)) {
      continue
    }

    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ")) {
      continue
    }

    if (line.startsWith("+")) {
      return currentNewLine
    }

    if (line.startsWith(" ")) {
      currentNewLine += 1
      continue
    }

    if (line.startsWith("-") || line.startsWith("\\")) {
      continue
    }
  }

  return firstHunkStart
}

export const buildWritePreviewPatch = (filePath: string | undefined, content: string): string | undefined => {
  const normalizedContent = content.replace(/\r\n/g, "\n")
  if (!normalizedContent.trim()) {
    return undefined
  }

  const normalizedPath = (() => {
    const candidate = (filePath ?? "").trim()
    if (!candidate) {
      return "new-file"
    }
    return candidate.startsWith("/") ? candidate.slice(1) : candidate
  })()

  const lines = normalizedContent.split("\n")
  const hunkSize = lines.length
  const body = lines.map((line) => `+${line}`).join("\n")

  return ["--- /dev/null", `+++ b/${normalizedPath}`, `@@ -0,0 +1,${hunkSize} @@`, body].join("\n")
}

export const getFirstChangedLineFromMetadata = (
  tool: string,
  metadata?: Record<string, unknown>,
): number | undefined => {
  if (!metadata || (tool !== "edit" && tool !== "multiedit" && tool !== "apply_patch")) {
    return undefined
  }

  const topLevelPatch = getPatchText((metadata as { patch?: unknown }).patch) ?? getPatchText(metadata.diff)
  if (topLevelPatch) {
    const line = extractFirstChangedLineFromDiff(topLevelPatch)
    if (Number.isFinite(line)) {
      return line
    }
  }

  const files = Array.isArray(metadata.files) ? metadata.files : []
  const firstFile = files[0] as { patch?: unknown; diff?: unknown } | undefined
  const filePatch = getPatchText(firstFile?.patch) ?? getPatchText(firstFile?.diff)
  if (filePatch) {
    const line = extractFirstChangedLineFromDiff(filePatch)
    if (Number.isFinite(line)) {
      return line
    }
  }

  return undefined
}

type ToolDiagnostic = {
  message: string
  line: number
  character: number
}

type ToolDiagnosticSection = {
  displayPath: string
  diagnostics: ToolDiagnostic[]
  remaining: number
}

const TOOL_DIAGNOSTICS_MAX_PER_FILE = 5

const normalizeToolDiagnostic = (value: unknown): ToolDiagnostic | null => {
  if (!isRecord(value)) {
    return null
  }

  const message = typeof value.message === "string" ? value.message.trim() : ""
  if (!message) {
    return null
  }

  const severity =
    typeof value.severity === "number" && Number.isFinite(value.severity) ? Math.trunc(value.severity) : undefined
  if (severity !== undefined && severity !== 1) {
    return null
  }

  const range = isRecord(value.range) ? value.range : undefined
  const start = range && isRecord(range.start) ? range.start : undefined
  const rawLine =
    typeof start?.line === "number" && Number.isFinite(start.line) ? Math.max(0, Math.trunc(start.line)) : 0
  const rawCharacter =
    typeof start?.character === "number" && Number.isFinite(start.character)
      ? Math.max(0, Math.trunc(start.character))
      : 0

  return {
    message,
    line: rawLine + 1,
    character: rawCharacter + 1,
  }
}

const getPrimaryToolPath = (
  toolName: string,
  input: Record<string, unknown> | undefined,
  metadata: Record<string, unknown> | undefined,
): string | null => {
  if (toolName === "apply_patch") {
    const files = Array.isArray(metadata?.files) ? metadata.files : []
    const first = files.find((entry) => {
      if (!isRecord(entry)) {
        return false
      }
      return entry.type !== "delete"
    })
    if (!isRecord(first)) {
      return null
    }
    return typeof first.movePath === "string"
      ? first.movePath
      : typeof first.filePath === "string"
        ? first.filePath
        : typeof first.relativePath === "string"
          ? first.relativePath
          : null
  }

  if (toolName === "edit" || toolName === "multiedit") {
    const fileDiff = isRecord(metadata?.filediff) ? metadata.filediff : undefined
    if (isRecord(fileDiff) && typeof fileDiff.file === "string") {
      return fileDiff.file
    }
    return typeof input?.filePath === "string"
      ? input.filePath
      : typeof input?.file_path === "string"
        ? input.file_path
        : typeof input?.path === "string"
          ? input.path
          : null
  }

  if (toolName === "write") {
    return typeof input?.filePath === "string"
      ? input.filePath
      : typeof input?.file_path === "string"
        ? input.file_path
        : typeof input?.path === "string"
          ? input.path
          : null
  }

  return null
}

export const getToolDiagnosticSection = (
  toolName: string,
  input: Record<string, unknown> | undefined,
  metadata: Record<string, unknown> | undefined,
  currentDirectory: string,
): ToolDiagnosticSection | null => {
  if (!["edit", "multiedit", "write", "apply_patch"].includes(toolName)) {
    return null
  }

  const primaryPath = getPrimaryToolPath(toolName, input, metadata)
  if (!primaryPath || !metadata || !isRecord(metadata.diagnostics)) {
    return null
  }

  const normalizedPath = normalizeToolDisplayPath(primaryPath)
  const absolutePath = normalizedPath.startsWith("/")
    ? normalizedPath
    : `${normalizeToolDisplayPath(currentDirectory)}/${normalizedPath}`.replace(/\/+/g, "/")

  const rawDiagnostics =
    (metadata.diagnostics as Record<string, unknown>)[normalizedPath] ??
    (metadata.diagnostics as Record<string, unknown>)[absolutePath]
  if (!Array.isArray(rawDiagnostics)) {
    return null
  }

  const diagnostics = rawDiagnostics
    .map((entry) => normalizeToolDiagnostic(entry))
    .filter((entry): entry is ToolDiagnostic => !!entry)
  if (diagnostics.length === 0) {
    return null
  }

  const visible = diagnostics.slice(0, TOOL_DIAGNOSTICS_MAX_PER_FILE)
  return {
    displayPath: normalizedPath.startsWith("/") ? getToolRelativePath(normalizedPath, currentDirectory) : normalizedPath,
    diagnostics: visible,
    remaining: Math.max(0, diagnostics.length - visible.length),
  }
}

// Parse question tool output: "User has answered your questions: "Q1"="A1", "Q2"="A2". You can now..."
export const parseQuestionOutput = (output: string): Array<{ question: string; answer: string }> | null => {
  const match = output.match(/^User has answered your questions:\s*(.+?)\.\s*You can now/s)
  if (!match) return null

  const pairs: Array<{ question: string; answer: string }> = []
  const content = match[1]

  // Match "question"="answer" pairs, handling multiline answers
  const pairRegex = /"([^"]+)"="([^"]*(?:[^"\\]|\\.)*)"/g
  let pairMatch
  while ((pairMatch = pairRegex.exec(content)) !== null) {
    pairs.push({
      question: pairMatch[1],
      answer: pairMatch[2],
    })
  }

  return pairs.length > 0 ? pairs : null
}

export const getToolDescriptionPath = (
  part: ToolPartType,
  state: ToolStateUnion,
  currentDirectory: string,
): string | null => {
  const stateWithData = state as ToolStateWithMetadata
  const metadata = stateWithData.metadata
  const input = stateWithData.input

  if (part.tool === "apply_patch") {
    const files = Array.isArray(metadata?.files) ? metadata?.files : []
    const firstFile = files[0] as { relativePath?: string; filePath?: string } | undefined
    const filePath = firstFile?.relativePath || firstFile?.filePath
    if (files.length > 1) return null
    if (typeof filePath === "string") {
      return getToolRelativePath(filePath, currentDirectory)
    }
    return null
  }

  if ((part.tool === "edit" || part.tool === "multiedit") && input) {
    const filePath =
      input?.filePath || input?.file_path || input?.path || metadata?.filePath || metadata?.file_path || metadata?.path
    if (typeof filePath === "string") {
      return getToolRelativePath(filePath, currentDirectory)
    }
  }

  if (part.tool === "read" && input) {
    const filePath =
      input?.filePath || input?.file_path || input?.path || metadata?.filePath || metadata?.file_path || metadata?.path
    if (typeof filePath === "string") {
      return getToolRelativePath(filePath, currentDirectory)
    }
  }

  if (["write", "create", "file_write"].includes(part.tool) && input) {
    const filePath = input?.filePath || input?.file_path || input?.path
    if (typeof filePath === "string") {
      return getToolRelativePath(filePath, currentDirectory)
    }
  }

  return null
}

export const getToolDescription = (part: ToolPartType, state: ToolStateUnion, currentDirectory: string): string => {
  const stateWithData = state as ToolStateWithMetadata
  const metadata = stateWithData.metadata
  const input = stateWithData.input

  const filePathLabel = getToolDescriptionPath(part, state, currentDirectory)
  if (filePathLabel) {
    return filePathLabel
  }

  if (part.tool === "apply_patch") {
    const files = Array.isArray(metadata?.files) ? metadata?.files : []
    if (files.length > 1) {
      return `${files.length} files`
    }
    return ""
  }

  // Question tool: show "Asked N question(s)"
  if (part.tool === "question" && input?.questions && Array.isArray(input.questions)) {
    const count = input.questions.length
    return `Asked ${count} question${count !== 1 ? "s" : ""}`
  }

  if (part.tool === "bash" && input?.command && typeof input.command === "string") {
    const firstLine = input.command.split("\n")[0]
    return firstLine.substring(0, 100)
  }

  if (part.tool === "task" && input?.description && typeof input.description === "string") {
    return input.description.substring(0, 80)
  }

  const desc = input?.description || metadata?.description || ("title" in state && state.title) || ""
  return typeof desc === "string" ? desc : ""
}

export const getToolOutputLanguage = (
  output: string,
  part: ToolPartType,
  metadata: Record<string, unknown> | undefined,
  input: Record<string, unknown> | undefined,
): string => {
  if (part.tool === "bash") {
    return "bash"
  }

  return detectToolOutputLanguage(part.tool, formatEditOutput(output, part.tool, metadata), input)
}

export const getToolOutputText = (
  output: string,
  part: ToolPartType,
  metadata: Record<string, unknown> | undefined,
): string => {
  if (part.tool === "bash") {
    return output
  }

  return formatEditOutput(output, part.tool, metadata)
}
