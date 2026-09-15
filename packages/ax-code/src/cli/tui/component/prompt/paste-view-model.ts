import type { PromptInfo } from "./history"

type PromptPart = PromptInfo["parts"][number]

const SUMMARY_PATTERN = /^\[Pasted ~(\d+) lines\]$/

export type SummarizedPasteView = {
  partIndex: number
  label: string
  text: string
  lineCount: number
  previewLines: string[]
  hiddenLineCount: number
}

export function isSummarizedPastePart(part: PromptPart): part is Extract<PromptPart, { type: "text" }> {
  const value = part.type === "text" ? part.source?.text?.value : undefined
  return !!value && SUMMARY_PATTERN.test(value)
}

export function summarizedPasteViews(parts: PromptInfo["parts"], previewLineLimit = 2): SummarizedPasteView[] {
  return parts.flatMap((part, partIndex) => {
    if (!isSummarizedPastePart(part)) return []
    const label = part.source?.text?.value
    if (!label) return []
    const normalized = part.text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    const lines = normalized.split("\n")
    const previewLines = lines.slice(0, previewLineLimit)
    return [
      {
        partIndex,
        label,
        text: part.text,
        lineCount: lines.length,
        previewLines,
        hiddenLineCount: Math.max(0, lines.length - previewLines.length),
      },
    ]
  })
}
