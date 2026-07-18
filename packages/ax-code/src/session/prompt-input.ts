import z from "zod"
import { JsonBoolean } from "@/util/schema"
import { ModelID, ProviderID } from "../provider/schema"
import { MessageV2 } from "./message-v2"
import { FilePartInput, PromptPartInput } from "./prompt-part-input"
import { PromptIsolationPolicy } from "./prompt-runtime-policy"
import { MessageID, SessionID } from "./schema"

export const PromptInput = z.object({
  sessionID: SessionID.zod,
  messageID: MessageID.zod.optional(),
  model: z
    .object({
      providerID: ProviderID.zod,
      modelID: ModelID.zod,
    })
    .optional(),
  agent: z.string().optional(),
  userSelectedAgent: JsonBoolean.optional().describe(
    "@deprecated Use agentRouting to control automatic specialist routing.",
  ),
  agentRouting: z
    .enum(["auto", "preserve"])
    .optional()
    .describe("Controls specialist agent auto-routing. Use preserve for synthetic continuation prompts."),
  noReply: JsonBoolean.optional(),
  tools: z
    .record(z.string(), JsonBoolean)
    .optional()
    .describe("@deprecated tools and permissions have been merged, you can set permissions on the session itself now"),
  toolsScope: z.enum(["session", "turn"]).optional(),
  isolation: PromptIsolationPolicy.optional(),
  format: MessageV2.Format.optional(),
  system: z.string().optional(),
  variant: z.string().optional(),
  requestedDepth: z.enum(["fast", "standard", "deep", "xdeep"]).optional(),
  parts: z.array(PromptPartInput),
})
export type PromptInput = z.infer<typeof PromptInput>

export const LoopInput = z.object({
  sessionID: SessionID.zod,
  resume_existing: JsonBoolean.optional(),
})
export type LoopInput = z.infer<typeof LoopInput>

export const ShellInput = z.object({
  sessionID: SessionID.zod,
  agent: z.string(),
  model: z
    .object({
      providerID: ProviderID.zod,
      modelID: ModelID.zod,
    })
    .optional(),
  command: z.string(),
})
export type ShellInput = z.infer<typeof ShellInput>

export const CommandInput = z.object({
  messageID: MessageID.zod.optional(),
  sessionID: SessionID.zod,
  agent: z.string().optional(),
  model: z.string().optional(),
  arguments: z.string(),
  command: z.string(),
  variant: z.string().optional(),
  parts: z.array(FilePartInput).optional(),
})
export type CommandInput = z.infer<typeof CommandInput>
