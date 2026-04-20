import type { PromptInfo } from "./history"

export type PromptExtmark = {
  id: number
  start: number
  end: number
}

export type PromptSubmissionView = {
  text: string
  parts: PromptInfo["parts"]
}

export function isPromptExitCommand(input: string) {
  const trimmed = input.trim()
  return trimmed === "exit" || trimmed === "quit" || trimmed === ":q"
}

export function promptSubmissionView(input: {
  text: string
  parts: PromptInfo["parts"]
  extmarks: PromptExtmark[]
  extmarkToPartIndex: ReadonlyMap<number, number>
}): PromptSubmissionView {
  let text = ""
  let cursor = 0
  const sorted = [...input.extmarks].sort((a, b) => a.start - b.start || a.end - b.end)

  for (const extmark of sorted) {
    const partIndex = input.extmarkToPartIndex.get(extmark.id)
    if (partIndex === undefined) continue
    const part = input.parts[partIndex]
    if (part?.type !== "text" || !part.text) continue
    const start = Math.max(0, Math.min(extmark.start, input.text.length))
    const end = Math.max(start, Math.min(extmark.end, input.text.length))

    // extmarks are expected to be non-overlapping. If they do overlap, keep
    // the first span and skip later conflicting replacements instead of
    // corrupting the reconstructed prompt text.
    if (start < cursor) continue

    text += input.text.slice(cursor, start)
    text += part.text
    cursor = end
  }

  text += input.text.slice(cursor)

  return {
    text,
    parts: input.parts.filter((part) => part.type !== "text"),
  }
}
