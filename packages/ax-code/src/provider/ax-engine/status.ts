import z from "zod"
import { getPlatformEligibility } from "./platform"
import { getDependencyStatus } from "./dependency"
import { getDiskStatus, getModelStatus } from "./model-cache"
import { getServerStatus, type AxEngineServerRuntimeStatus } from "./server"
import { AX_ENGINE_API_KEY, AX_ENGINE_ERROR } from "./constants"

export const AxEngineStatus = z.object({
  eligibility: z.any(),
  dependency: z.any(),
  disk: z.any(),
  model: z.any(),
  server: z.any(),
  capability: z.object({
    toolcall: z.boolean(),
    attachment: z.boolean(),
    reason: z.string().optional(),
  }),
})
export type AxEngineStatus = z.infer<typeof AxEngineStatus>

export type AxEngineRuntimeOptions = {
  binaryPath?: unknown
  modelPath?: unknown
  quantization?: unknown
  [key: string]: unknown
}

const AxEngineModelCard = z.object({
  capabilities: z
    .object({
      toolcall: z.boolean().optional(),
      attachment: z.boolean().optional(),
    })
    .optional(),
  ax_engine: z
    .object({
      openai_tool_calling_supported: z.boolean().optional(),
      native_multimodal_input_supported: z.boolean().optional(),
      gemma4_unified_multimodal_input_supported: z.boolean().optional(),
    })
    .optional(),
})

const AxEngineModelsResponse = z.object({
  data: z.array(AxEngineModelCard).default([]),
})

export type AxEngineCapabilityStatus = {
  toolcall: boolean
  attachment: boolean
  reason?: string
}

export function evaluateAxEngineCapabilityFromModels(payload: unknown): AxEngineCapabilityStatus {
  const parsed = AxEngineModelsResponse.safeParse(payload)
  const model = parsed.success ? parsed.data.data[0] : undefined
  const toolcall = model?.ax_engine?.openai_tool_calling_supported ?? model?.capabilities?.toolcall ?? false
  const attachment =
    model?.ax_engine?.gemma4_unified_multimodal_input_supported ??
    model?.ax_engine?.native_multimodal_input_supported ??
    model?.capabilities?.attachment ??
    false

  return {
    toolcall,
    attachment,
    reason: toolcall
      ? undefined
      : `${AX_ENGINE_ERROR.ToolcallUnsupported}: ax-engine server does not advertise OpenAI structured tool calling`,
  }
}

async function getCapabilityStatus(server: AxEngineServerRuntimeStatus): Promise<AxEngineCapabilityStatus> {
  if (!server.ready || !server.state?.baseURL) {
    return {
      toolcall: false,
      attachment: false,
      reason: `${AX_ENGINE_ERROR.ToolcallUnsupported}: ax-engine server is not ready, so tool/function calling capability could not be verified`,
    }
  }

  try {
    const baseURL = server.state.baseURL.replace(/\/+$/, "")
    const response = await fetch(`${baseURL}/models`, {
      signal: AbortSignal.timeout(2000),
      headers: { authorization: `Bearer ${AX_ENGINE_API_KEY}` },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return evaluateAxEngineCapabilityFromModels(await response.json())
  } catch (error) {
    return {
      toolcall: false,
      attachment: false,
      reason: `${AX_ENGINE_ERROR.ToolcallUnsupported}: failed to inspect ax-engine /v1/models capability (${error instanceof Error ? error.message : String(error)})`,
    }
  }
}

export async function getAxEngineStatus(options: AxEngineRuntimeOptions = {}): Promise<AxEngineStatus> {
  const [eligibility, dependency, disk, model, server] = await Promise.all([
    getPlatformEligibility(),
    getDependencyStatus(options),
    getDiskStatus(options),
    getModelStatus(options),
    getServerStatus(),
  ])
  const capability = await getCapabilityStatus(server)

  return {
    eligibility,
    dependency,
    disk,
    model,
    server,
    capability,
  }
}
