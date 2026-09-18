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

async function withCancellation<T>(load: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const cancelled = () => new FixedContextError({ message: "The fixed-context question was cancelled or timed out." })
  if (signal?.aborted) throw cancelled()
  if (!signal) return load()
  const aborted = Promise.withResolvers<never>()
  const onAbort = () => aborted.reject(cancelled())
  signal.addEventListener("abort", onAbort, { once: true })
  try {
    // Provider and agent setup may be shared with other callers. Stop waiting
    // without cancelling that shared work or starting the next request stage.
    const result = await Promise.race([
      aborted.promise,
      Promise.resolve().then(() => {
        if (signal.aborted) throw cancelled()
        return load()
      }),
    ])
    if (signal.aborted) throw cancelled()
    return result
  } catch (error) {
    if (signal.aborted) throw cancelled()
    throw error
  } finally {
    signal.removeEventListener("abort", onAbort)
  }
}

export async function askFixedContext(
  input: z.infer<typeof FixedContextInput>,
  directory: string,
  signal?: AbortSignal,
) {
  const selected = FixedContextInput.parse(input)
  validateFixedContextQuestion(selected.question)
  const config = await withCancellation(() => Config.get(), signal)
  const configured = config.provider?.[selected.providerID]
  if (configured?.management !== "ax-trust" && !isAxTrustProviderID(selected.providerID))
    throw new FixedContextError({ message: "Select a connected AX Trust provider for fixed-context questions." })
  const model = await withCancellation(() => Provider.getModel(selected.providerID, selected.modelID), signal)
  if (model.api.npm !== "@ai-sdk/openai-compatible")
    throw new FixedContextError({ message: "This command requires an AX Trust OpenAI-compatible chat connection." })
  const agentName = await withCancellation(() => Agent.defaultAgent(), signal)
  const agent = await withCancellation(() => Agent.get(agentName), signal)
  const context = await withCancellation(
    () =>
      readFixedContextFiles({
        directory,
        files: selected.files,
        signal,
        allowRead: (file) => Permission.evaluate("read", file, agent.permission).action === "allow",
      }),
    signal,
  )
  const request = buildFixedContextRequest({
    ...context,
    model: model.api.id,
    question: selected.question,
    maxTokens: selected.maxTokens,
  })
  const language = await withCancellation(() => Provider.getLanguage(model), signal)
  if (language.specificationVersion !== "v3")
    throw new FixedContextError({ message: "This command requires the bundled version 3 chat adapter." })
  const result = await generateFixedContext(language, request, signal)
  return { ...result, providerID: selected.providerID, modelID: selected.modelID }
}
