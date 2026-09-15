import z from "zod"
import { decodePromptPersistenceJsonLine } from "./persistence-json"

export type FrecencyEntry = {
  path: string
  frequency: number
  lastOpen: number
}

const FrecencyEntrySchema = z
  .object({
    path: z.string().min(1),
    frequency: z.number().finite().nonnegative(),
    lastOpen: z.number().finite().nonnegative(),
  })
  .passthrough()

export function parseFrecencyLine(line: string): FrecencyEntry | undefined {
  const parsed = decodePromptPersistenceJsonLine(line, FrecencyEntrySchema)
  if (!parsed) return undefined
  return {
    path: parsed.path,
    frequency: parsed.frequency,
    lastOpen: parsed.lastOpen,
  }
}
