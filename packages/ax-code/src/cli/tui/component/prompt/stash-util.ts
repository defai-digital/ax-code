import type { PromptInfo } from "./history"
import z from "zod"
import { decodePromptPersistenceJsonLine } from "./persistence-json"

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

const StashEntrySchema = z
  .object({
    id: z.unknown().optional(),
    input: z.string(),
    parts: z.custom<PromptInfo["parts"]>(isPromptPartList),
    timestamp: z.number().finite().nonnegative(),
  })
  .passthrough()

export function parseStashLine(line: string, makeID: () => string): StashEntry | undefined {
  const parsed = decodePromptPersistenceJsonLine(line, StashEntrySchema)
  if (!parsed) return undefined
  return {
    id: typeof parsed.id === "string" && parsed.id.length > 0 ? parsed.id : makeID(),
    input: parsed.input,
    parts: parsed.parts,
    timestamp: parsed.timestamp,
  }
}
