import z from "zod"
import type { Provider } from "../provider"
import { resolveAxEngineApiKey } from "./constants"

const Modalities = z
  .object({
    text: z.boolean().optional(),
    audio: z.boolean().optional(),
    image: z.boolean().optional(),
    video: z.boolean().optional(),
    pdf: z.boolean().optional(),
  })
  .optional()

const AxEngineModelCard = z.object({
  id: z.string().min(1),
  capabilities: z
    .object({
      temperature: z.boolean().optional(),
      reasoning: z.boolean().optional(),
      attachment: z.boolean().optional(),
      toolcall: z.boolean().optional(),
      input: Modalities,
      output: Modalities,
      interleaved: z.boolean().optional(),
    })
    .optional(),
  limit: z
    .object({
      context: z.number().positive().optional(),
      output: z.number().positive().optional(),
    })
    .optional(),
  context_length: z.number().positive().optional(),
  max_output_tokens: z.number().positive().optional(),
  ax_engine: z
    .object({
      openai_tool_calling_supported: z.boolean().optional(),
      native_multimodal_input_supported: z.boolean().optional(),
      gemma4_unified_multimodal_input_supported: z.boolean().optional(),
      primary_use: z.string().optional(),
      chat_default: z.boolean().optional(),
      coding_supported: z.boolean().optional(),
      coding_only: z.boolean().optional(),
    })
    .optional(),
})

const AxEngineModelsResponse = z.object({
  data: z.array(AxEngineModelCard).default([]),
})

export type AxEngineLiveModelContract = {
  id: string
  context?: number
  output?: number
  toolcall: boolean
  attachment: boolean
  capabilities: Partial<Provider.Model["capabilities"]>
  primaryUse?: string
  chatDefault?: boolean
  codingSupported?: boolean
  codingOnly?: boolean
}

export function parseAxEngineModelContracts(payload: unknown): AxEngineLiveModelContract[] {
  const parsed = AxEngineModelsResponse.safeParse(payload)
  if (!parsed.success) return []
  return parsed.data.data.map((card) => {
    const context = card.limit?.context ?? card.context_length
    const advertisedOutput = card.limit?.output ?? card.max_output_tokens
    const output = context && advertisedOutput ? Math.min(context, advertisedOutput) : advertisedOutput
    const toolcall = card.ax_engine?.openai_tool_calling_supported ?? card.capabilities?.toolcall ?? false
    const attachment =
      card.ax_engine?.gemma4_unified_multimodal_input_supported ??
      card.ax_engine?.native_multimodal_input_supported ??
      card.capabilities?.attachment ??
      false
    return {
      id: card.id,
      context,
      output,
      toolcall,
      attachment,
      capabilities: {
        temperature: card.capabilities?.temperature,
        reasoning: card.capabilities?.reasoning,
        attachment,
        toolcall,
        input: card.capabilities?.input
          ? {
              text: card.capabilities.input.text ?? true,
              audio: card.capabilities.input.audio ?? false,
              image: card.capabilities.input.image ?? false,
              video: card.capabilities.input.video ?? false,
              pdf: card.capabilities.input.pdf ?? false,
            }
          : undefined,
        output: card.capabilities?.output
          ? {
              text: card.capabilities.output.text ?? true,
              audio: card.capabilities.output.audio ?? false,
              image: card.capabilities.output.image ?? false,
              video: card.capabilities.output.video ?? false,
              pdf: card.capabilities.output.pdf ?? false,
            }
          : undefined,
        interleaved: card.capabilities?.interleaved,
      },
      primaryUse: card.ax_engine?.primary_use,
      chatDefault: card.ax_engine?.chat_default,
      codingSupported: card.ax_engine?.coding_supported,
      codingOnly: card.ax_engine?.coding_only,
    }
  })
}

export async function fetchAxEngineModelContracts(input: {
  baseURL: string
  apiKey?: string
  signal?: AbortSignal
}): Promise<AxEngineLiveModelContract[]> {
  const baseURL = input.baseURL.replace(/\/+$/, "")
  const response = await fetch(`${baseURL}/models`, {
    signal: input.signal ?? AbortSignal.timeout(2_000),
    headers: { authorization: `Bearer ${input.apiKey ?? resolveAxEngineApiKey()}` },
  })
  if (!response.ok) {
    response.body?.cancel()
    throw new Error(`ax-engine /v1/models returned HTTP ${response.status}`)
  }
  const contracts = parseAxEngineModelContracts(await response.json())
  if (contracts.length === 0) throw new Error("ax-engine /v1/models returned no valid model cards")
  return contracts
}
