import type { PromptInfo } from "./history"

export type StashEntry = {
  id: string
  input: string
  parts: PromptInfo["parts"]
  timestamp: number
}

function isPromptPartList(input: unknown): input is PromptInfo["parts"] {
  return (
    Array.isArray(input) &&
    input.every((part) => part && typeof part === "object" && typeof (part as { type?: unknown }).type === "string")
  )
}

export function parseStashLine(line: string, makeID: () => string): StashEntry | undefined {
  try {
    const parsed = JSON.parse(line)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined
    const candidate = parsed as { id?: unknown; input?: unknown; parts?: unknown; timestamp?: unknown }
    if (typeof candidate.input !== "string") return undefined
    if (!isPromptPartList(candidate.parts)) return undefined
    if (typeof candidate.timestamp !== "number" || !Number.isFinite(candidate.timestamp) || candidate.timestamp < 0) {
      return undefined
    }
    return {
      id: typeof candidate.id === "string" && candidate.id.length > 0 ? candidate.id : makeID(),
      input: candidate.input,
      parts: candidate.parts,
      timestamp: candidate.timestamp,
    }
  } catch {
    return undefined
  }
}
