import z from "zod"

export const PromptHistoryPart = z.record(z.string(), z.unknown()).and(
  z.object({
    type: z.string(),
  }),
)

export const PromptHistoryEntry = z
  .object({
    input: z.string(),
    mode: z.enum(["normal", "shell"]).optional(),
    parts: z.array(PromptHistoryPart).default([]),
  })
  .passthrough()

export type PromptHistoryEntry = z.infer<typeof PromptHistoryEntry>
