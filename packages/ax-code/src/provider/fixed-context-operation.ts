import z from "zod"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { Permission } from "@/permission"
import { Provider } from "@/provider/provider"
import { ProviderID, ModelID } from "@/provider/schema"
import { isAxTrustProviderID } from "@/mode/provider-category"
import {
  buildFixedContextRequest,
  FixedContextError,
  generateFixedContext,
  readFixedContextFiles,
  validateFixedContextQuestion,
} from "./fixed-context"

export const FixedContextInput = z
  .object({
    files: z.array(z.string().min(1).max(4096)).min(1).max(14),
    question: z.string().min(1).max(1024),
    providerID: ProviderID.zod,
    modelID: ModelID.zod,
    maxTokens: z.number().int().min(1).max(4096).optional(),
  })
  .strict()
  .meta({ ref: "FixedContextInput" })

export const FixedContextOutput = z
  .object({
    answer: z.string(),
    cache: z.object({
      status: z.enum(["HIT", "EXACT_HIT", "MISS", "BYPASS", "UNREPORTED"]),
      score: z.number().optional(),
    }),
    contextDigest: z.string(),
    providerID: z.string(),
    modelID: z.string(),
    requestID: z.string().optional(),
    usage: z.unknown().optional(),
  })
  .meta({ ref: "FixedContextOutput" })

export async function askFixedContext(
  input: z.infer<typeof FixedContextInput>,
  directory: string,
  signal?: AbortSignal,
) {
  const selected = FixedContextInput.parse(input)
  validateFixedContextQuestion(selected.question)
  signal?.throwIfAborted()
  const config = await Config.get()
  const configured = config.provider?.[selected.providerID]
  if (configured?.management !== "ax-trust" && !isAxTrustProviderID(selected.providerID))
    throw new FixedContextError({ message: "Select a connected AX Trust provider for fixed-context questions." })
  const model = await Provider.getModel(selected.providerID, selected.modelID)
  if (model.api.npm !== "@ai-sdk/openai-compatible")
    throw new FixedContextError({ message: "This command requires an AX Trust OpenAI-compatible chat connection." })
  const agent = await Agent.get(await Agent.defaultAgent())
  const context = await readFixedContextFiles({
    directory,
    files: selected.files,
    signal,
    allowRead: (file) => Permission.evaluate("read", file, agent.permission).action === "allow",
  })
  const request = buildFixedContextRequest({
    ...context,
    model: model.api.id,
    question: selected.question,
    maxTokens: selected.maxTokens,
  })
  signal?.throwIfAborted()
  const language = await Provider.getLanguage(model)
  if (language.specificationVersion !== "v3")
    throw new FixedContextError({ message: "This command requires the bundled version 3 chat adapter." })
  const result = await generateFixedContext(language, request, signal)
  return { ...result, providerID: selected.providerID, modelID: selected.modelID }
}
