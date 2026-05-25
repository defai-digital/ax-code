import type { AgentPart, FilePart, TextPart } from "@ax-code/sdk/v2"
import z from "zod"

export type PromptInfo = {
  input: string
  mode?: "normal" | "shell"
  parts: (
    | Omit<FilePart, "id" | "messageID" | "sessionID">
    | Omit<AgentPart, "id" | "messageID" | "sessionID">
    | (Omit<TextPart, "id" | "messageID" | "sessionID"> & {
        source?: {
          text: {
            start: number
            end: number
            value: string
          }
        }
      })
  )[]
}

const PromptInfoSchema = z
  .object({
    input: z.string(),
    mode: z.enum(["normal", "shell"]).optional(),
    parts: z.array(z.record(z.string(), z.unknown())).default([]),
  })
  .passthrough()

export function isPromptInfo(value: unknown): value is PromptInfo {
  if (!value || typeof value !== "object") return false
  const candidate = value as { input?: unknown; mode?: unknown; parts?: unknown }
  if (typeof candidate.input !== "string") return false
  if (candidate.mode !== undefined && candidate.mode !== "normal" && candidate.mode !== "shell") return false
  if (!Array.isArray(candidate.parts)) return false
  for (const part of candidate.parts) {
    if (!part || typeof part !== "object") return false
    if (typeof (part as { type?: unknown }).type !== "string") return false
  }
  return true
}

export function parsePromptInfo(value: unknown): PromptInfo | undefined {
  const parsed = PromptInfoSchema.safeParse(value)
  if (!parsed.success) return undefined
  return isPromptInfo(parsed.data) ? parsed.data : undefined
}

export function parsePromptInfoList(value: unknown): PromptInfo[] {
  const parsed = z.array(PromptInfoSchema).safeParse(value)
  if (!parsed.success) return []
  return parsed.data.filter(isPromptInfo)
}
