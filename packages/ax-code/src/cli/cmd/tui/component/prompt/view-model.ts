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
  let text = input.text
  const sorted = [...input.extmarks].sort((a, b) => b.start - a.start)

  for (const extmark of sorted) {
    const partIndex = input.extmarkToPartIndex.get(extmark.id)
    if (partIndex === undefined) continue
    const part = input.parts[partIndex]
    if (part?.type !== "text" || !part.text) continue
    const before = text.slice(0, extmark.start)
    const after = text.slice(extmark.end)
    text = before + part.text + after
  }

  return {
    text,
    parts: input.parts.filter((part) => part.type !== "text"),
  }
}
