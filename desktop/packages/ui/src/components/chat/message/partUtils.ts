import type { Part } from "@ax-code/sdk/v2"

export type TextContentPart = Part & { text?: string; content?: string; value?: string }
export type TimedPart = Part & { time?: { start?: number; end?: number } }
export type TimedTextContentPart = TextContentPart & TimedPart

export const isValidPart = (part: unknown): part is Part => {
  return Boolean(part && typeof part === "object" && typeof (part as { type?: unknown }).type === "string")
}

export const normalizeParts = (parts: Part[]): Part[] => {
  return parts.filter(isValidPart)
}

export const extractTextContent = (part: Part): string => {
  const partWithText = part as TextContentPart
  const rawText = partWithText.text
  if (typeof rawText === "string") {
    return rawText
  }
  return partWithText.content || partWithText.value || ""
}

export const extractTextOrContent = (part: Part): string => {
  const partWithText = part as TextContentPart
  return partWithText.text || partWithText.content || ""
}

export const extractLongestTextContent = (part: Part): string => {
  const partWithText = part as TextContentPart
  const rawText = typeof partWithText.text === "string" ? partWithText.text : ""
  const contentText = typeof partWithText.content === "string" ? partWithText.content : ""
  const valueText = typeof partWithText.value === "string" ? partWithText.value : ""
  return [rawText, contentText, valueText].reduce((best, candidate) => {
    return candidate.length > best.length ? candidate : best
  }, "")
}

export const isEmptyTextPart = (part: Part): boolean => {
  if (part.type !== "text") {
    return false
  }
  const text = extractTextContent(part)
  return !text || text.trim().length === 0
}

type PartWithSynthetic = Part & { synthetic?: boolean }

interface VisibleFilterOptions {
  includeReasoning?: boolean
}

export const filterVisibleParts = (parts: Part[], options: VisibleFilterOptions = {}): Part[] => {
  const { includeReasoning = true } = options
  const validParts = normalizeParts(parts)

  // Check if there are any non-synthetic parts
  const hasNonSynthetic = validParts.some((part) => {
    const partWithSynthetic = part as PartWithSynthetic
    return !partWithSynthetic.synthetic
  })

  return validParts.filter((part) => {
    const partWithSynthetic = part as PartWithSynthetic
    const isSynthetic = Boolean(partWithSynthetic.synthetic)

    if (isSynthetic && part.type === "text") {
      const text = extractTextContent(part)
      if (text.includes("<system-reminder>")) {
        return false
      }
    }

    // Only filter out synthetic parts if there are non-synthetic parts present
    // Otherwise, show synthetic parts so the message is displayed
    if (isSynthetic && hasNonSynthetic) {
      return false
    }
    if (!includeReasoning && part.type === "reasoning") {
      return false
    }
    const isPatchPart = part.type === "patch"

    return !isPatchPart
  })
}

export const isFinalizedTextPart = (part: Part): boolean => {
  if (part.type !== "text") {
    return false
  }
  const time = (part as TimedPart).time
  return Boolean(time && typeof time.end !== "undefined")
}
