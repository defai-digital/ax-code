// @mention parsing and per-session confirmed-mention persistence for the chat
// composer. Extracted from ChatInput-impl.tsx — parsing edge cases, storage
// keys, and behavior must stay byte-identical.

import type { AttachedFile } from "@/stores/types/sessionTypes"
import type { MentionRange } from "./composerHighlight"

export const FILE_MENTION_TOKEN = /^@[^\s]+$/

// Per-session confirmed mentions key — tracks which @mentions are confirmed (blue) vs plain text
export const getConfirmedMentionsKey = (sessionId: string | null): string =>
  `openchamber_chat_confirmed_mentions_${sessionId ?? "new"}`

export const saveConfirmedMentions = (sessionId: string | null, mentions: Set<string>): void => {
  try {
    if (mentions.size > 0) {
      localStorage.setItem(getConfirmedMentionsKey(sessionId), JSON.stringify([...mentions]))
    } else {
      localStorage.removeItem(getConfirmedMentionsKey(sessionId))
    }
  } catch {
    // Ignore localStorage errors
  }
}

export const loadConfirmedMentions = (sessionId: string | null): Set<string> => {
  try {
    const raw = localStorage.getItem(getConfirmedMentionsKey(sessionId))
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return new Set(parsed.filter((v): v is string => typeof v === "string"))
      }
    }
  } catch {
    // Ignore localStorage errors
  }
  return new Set()
}

// Keep only the confirmed mentions that are still present in the draft text
export const pruneConfirmedMentions = (confirmedMentions: Set<string>, draft: string): Set<string> => {
  const activeMentions = new Set<string>()
  for (const mention of confirmedMentions) {
    if (draft.includes(`@${mention}`)) {
      activeMentions.add(mention)
    }
  }
  return activeMentions
}

// A mention token only counts when the character before "@" is a boundary
// (whitespace, bracket, quote, or punctuation) — this skips email addresses.
const MENTION_BOUNDARY_CHAR = /(\s|\(|\)|\[|\]|\{|\}|"|'|`|,|\.|;|:)/

export const isMentionBoundaryChar = (charBefore: string | null): boolean =>
  !charBefore || MENTION_BOUNDARY_CHAR.test(charBefore)

// Trailing punctuation is not part of the mention ("@file.ts," → "file.ts")
export const trimMentionTokenEnd = (raw: string): string => String(raw || "").trim().replace(/[),.;:!?`"'>]+$/g, "")

// Both leading wrappers and trailing punctuation stripped (used when extracting
// file mentions to attach)
export const trimMentionToken = (raw: string): string =>
  String(raw || "")
    .trim()
    .replace(/^[`"'<(]+/, "")
    .replace(/[),.;:!?`"'>]+$/g, "")

const MENTION_TOKEN_PATTERN = /@([^\s]+)/g

// @mention spans (file = blue, agent = green). Computed as character ranges
// so they can be merged with markdown highlight ranges in a single overlay.
export const collectComposerMentionRanges = (
  message: string,
  knownAgentNames: Set<string>,
  isConfirmedFilePath: (text: string) => boolean,
): MentionRange[] => {
  const ranges: MentionRange[] = []
  const mentionRegex = new RegExp(MENTION_TOKEN_PATTERN.source, "g")
  let match: RegExpExecArray | null
  while ((match = mentionRegex.exec(message)) !== null) {
    const full = match[0]
    const mention = trimMentionTokenEnd(match[1])
    const start = match.index
    const end = start + full.length
    const charBefore = start > 0 ? message[start - 1] : null
    if (!isMentionBoundaryChar(charBefore) || mention.length === 0) {
      continue
    }
    if (knownAgentNames.has(mention.toLowerCase())) {
      ranges.push({ start, end, kind: "agent" })
    } else if (isConfirmedFilePath(mention)) {
      ranges.push({ start, end, kind: "file" })
    }
  }
  return ranges
}

// Detect an in-progress @mention query at the cursor: the "@" must sit on a
// word boundary and the text after it must not contain whitespace.
// Returns the query text after "@", or null when no mention is being typed.
export const detectMentionQueryAtCursor = (textBeforeCursor: string): string | null => {
  const lastAtSymbol = textBeforeCursor.lastIndexOf("@")
  if (lastAtSymbol === -1) {
    return null
  }
  const charBefore = lastAtSymbol > 0 ? textBeforeCursor[lastAtSymbol - 1] : null
  const textAfterAt = textBeforeCursor.substring(lastAtSymbol + 1)
  const isWordBoundary = !charBefore || /\s/.test(charBefore)
  if (isWordBoundary && !textAfterAt.includes(" ") && !textAfterAt.includes("\n")) {
    return textAfterAt
  }
  return null
}

// Backspace/Delete inside a confirmed file mention removes the whole token.
// Given the probe index (char that would be deleted), returns the removal
// result or null when the token under the probe is not a file mention.
export const resolveFileMentionDeletion = (
  message: string,
  probeIndex: number,
  isKnownAgent: (lowercaseName: string) => boolean,
  isConfirmedFilePath: (text: string) => boolean,
): { nextMessage: string; cursorPosition: number; mentionContent: string } | null => {
  if (probeIndex < 0 || probeIndex >= message.length) {
    return null
  }

  let tokenStart = probeIndex
  while (tokenStart > 0 && !/\s/.test(message[tokenStart - 1])) {
    tokenStart -= 1
  }

  let tokenEnd = probeIndex + 1
  while (tokenEnd < message.length && !/\s/.test(message[tokenEnd])) {
    tokenEnd += 1
  }

  const token = message.slice(tokenStart, tokenEnd)
  const mentionContent = token.slice(1)
  const looksLikeFileMention =
    FILE_MENTION_TOKEN.test(token) && !isKnownAgent(mentionContent.toLowerCase()) && isConfirmedFilePath(mentionContent)

  if (!looksLikeFileMention) {
    return null
  }

  const removeUntil = message[tokenEnd] === " " ? tokenEnd + 1 : tokenEnd
  return {
    nextMessage: `${message.slice(0, tokenStart)}${message.slice(removeUntil)}`,
    cursorPosition: tokenStart,
    mentionContent,
  }
}

// Convert an absolute path to a project-relative mention path when it lives
// under the given root directory; otherwise return it unchanged.
export const toProjectRelativeMentionPath = (absolutePath: string, rootDirectory: string | null | undefined): string => {
  const normalizedAbsolutePath = absolutePath.replace(/\\/g, "/").trim()
  const normalizedRoot = (rootDirectory || "").replace(/\\/g, "/").replace(/\/+$/, "")
  if (!normalizedRoot) {
    return normalizedAbsolutePath
  }
  if (normalizedAbsolutePath === normalizedRoot) {
    return normalizedAbsolutePath
  }
  const rootWithSlash = `${normalizedRoot}/`
  if (normalizedAbsolutePath.startsWith(rootWithSlash)) {
    return normalizedAbsolutePath.slice(rootWithSlash.length)
  }
  return normalizedAbsolutePath
}

// Insert "@mentionText " at the cursor. When the cursor sits right after an
// in-progress @query, the query is replaced; otherwise the mention is inserted
// at the cursor position.
export const insertMentionAtCursor = (
  message: string,
  cursorPosition: number,
  mentionText: string,
): { newMessage: string; nextCursor: number } => {
  const textBeforeCursor = message.substring(0, cursorPosition)
  const lastAtSymbol = textBeforeCursor.lastIndexOf("@")
  if (lastAtSymbol !== -1) {
    return {
      newMessage: message.substring(0, lastAtSymbol) + `@${mentionText} ` + message.substring(cursorPosition),
      nextCursor: lastAtSymbol + mentionText.length + 2,
    }
  }
  return {
    newMessage: message.substring(0, cursorPosition) + `@${mentionText} ` + message.substring(cursorPosition),
    nextCursor: cursorPosition + mentionText.length + 2,
  }
}

// Drop-insert a "@mention" with padding spaces so it never fuses with the
// surrounding text. Returns the next message and cursor position.
export const buildMentionDropInsertion = (
  currentMessage: string,
  selectionStart: number,
  selectionEnd: number,
  mention: string,
): { nextMessage: string; nextCursor: number } => {
  const before = currentMessage.slice(0, selectionStart)
  const after = currentMessage.slice(selectionEnd)
  const needSpaceBefore = before.length > 0 && !/\s$/.test(before)
  const needSpaceAfter = after.length > 0 && !/^\s/.test(after)
  const insert = `${needSpaceBefore ? " " : ""}${mention}${needSpaceAfter ? " " : ""}`
  return { nextMessage: `${before}${insert}${after}`, nextCursor: selectionStart + insert.length }
}

// Pick the mention path for a file picked from the mention autocomplete: the
// project-relative path when known, otherwise the bare filename.
export const resolveFileMentionPath = (
  file: { name: string; path: string; relativePath?: string },
  rootDirectory: string | null | undefined,
): string =>
  file.relativePath && file.relativePath.trim().length > 0
    ? file.relativePath.trim()
    : toProjectRelativeMentionPath(file.path, rootDirectory) || file.name

const FILE_URI_PREFIX = "file://"

const encodeFilePath = (filepath: string): string => {
  let normalized = filepath.replace(/\\/g, "/")
  if (/^[A-Za-z]:/.test(normalized)) {
    normalized = `/${normalized}`
  }
  return normalized
    .split("/")
    .map((segment, index) => {
      if (index === 1 && /^[A-Za-z]:$/.test(segment)) return segment
      return encodeURIComponent(segment)
    })
    .join("/")
}

export const toServerFileUrl = (filepath: string): string => {
  const normalized = filepath.replace(/\\/g, "/").trim()
  if (normalized.toLowerCase().startsWith(FILE_URI_PREFIX)) {
    return normalized
  }
  return `file://${encodeFilePath(normalized)}`
}

// Scan message text for inline @file mentions and turn each into a
// server-backed attachment. Agent mentions and plain text are skipped;
// duplicate server paths are only attached once.
export const extractInlineFileMentions = (
  rawText: string,
  options: {
    root: string
    isKnownAgent: (lowercaseName: string) => boolean
    isConfirmedFilePath: (text: string) => boolean
  },
): { sanitizedText: string; attachments: AttachedFile[] } => {
  if (!rawText || !rawText.includes("@")) {
    return { sanitizedText: rawText, attachments: [] }
  }

  const { root, isKnownAgent, isConfirmedFilePath } = options
  const seenPaths = new Set<string>()
  const attachments: AttachedFile[] = []

  const mentionRegex = new RegExp(MENTION_TOKEN_PATTERN.source, "g")
  let match: RegExpExecArray | null
  while ((match = mentionRegex.exec(rawText)) !== null) {
    const rawMentionPath = match[1]
    const offset = match.index
    const charBefore = offset > 0 ? rawText[offset - 1] : null
    if (!isMentionBoundaryChar(charBefore)) {
      continue
    }

    const mentionPath = trimMentionToken(rawMentionPath)
    if (!mentionPath) {
      continue
    }

    if (isKnownAgent(mentionPath.toLowerCase())) {
      continue
    }

    const looksLikeFilePath = isConfirmedFilePath(mentionPath)
    if (!looksLikeFilePath) {
      continue
    }

    const normalizedMentionPath = mentionPath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "")
    if (!normalizedMentionPath) {
      continue
    }

    const serverPath = mentionPath.startsWith("/")
      ? mentionPath.replace(/\\/g, "/")
      : root
        ? `${root}/${normalizedMentionPath}`
        : null

    if (!serverPath) {
      continue
    }

    const normalizedServerPath = serverPath.replace(/\/+/g, "/")
    if (seenPaths.has(normalizedServerPath)) {
      continue
    }
    seenPaths.add(normalizedServerPath)

    const filename = normalizedMentionPath.split("/").filter(Boolean).pop() || normalizedMentionPath
    attachments.push({
      id: `inline-server-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      file: new File([], filename, { type: "text/plain" }),
      filename,
      mimeType: "text/plain",
      size: 0,
      dataUrl: toServerFileUrl(normalizedServerPath),
      source: "server",
      serverPath: normalizedServerPath,
    })
  }

  return {
    sanitizedText: rawText,
    attachments,
  }
}
