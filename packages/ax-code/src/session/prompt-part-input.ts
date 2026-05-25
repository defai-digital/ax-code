import z from "zod"
import { MessageV2 } from "./message-v2"

export const TextPartInput = MessageV2.TextPart.omit({
  messageID: true,
  sessionID: true,
})
  .partial({
    id: true,
  })
  .meta({
    ref: "TextPartInput",
  })

export const FilePartInput = MessageV2.FilePart.omit({
  messageID: true,
  sessionID: true,
})
  .partial({
    id: true,
  })
  .meta({
    ref: "FilePartInput",
  })

export const AgentPartInput = MessageV2.AgentPart.omit({
  messageID: true,
  sessionID: true,
})
  .partial({
    id: true,
  })
  .meta({
    ref: "AgentPartInput",
  })

export const SubtaskPartInput = MessageV2.SubtaskPart.omit({
  messageID: true,
  sessionID: true,
})
  .partial({
    id: true,
  })
  .meta({
    ref: "SubtaskPartInput",
  })

export const PromptPartInput = z.discriminatedUnion("type", [
  TextPartInput,
  FilePartInput,
  AgentPartInput,
  SubtaskPartInput,
])
export type PromptPartInput = z.infer<typeof PromptPartInput>
