import z from "zod"
import { AxEnginePlatformEligibility, getPlatformEligibility } from "./platform"
import { AxEngineDependencyStatus, getDependencyStatus } from "./dependency"
import { AxEngineDiskStatus, AxEngineModelStatus, getDiskStatus, getModelStatus } from "./model-cache"
import { AxEngineServerRuntimeStatus, getServerStatus } from "./server"
import { AX_ENGINE_API_KEY, AX_ENGINE_ERROR } from "./constants"

export const AxEngineCapabilityStatus = z.object({
  toolcall: z.boolean(),
  attachment: z.boolean(),
  reason: z.string().optional(),
})
export type AxEngineCapabilityStatus = z.infer<typeof AxEngineCapabilityStatus>

export const AxEngineStatus = z.object({
  eligibility: AxEnginePlatformEligibility,
  dependency: AxEngineDependencyStatus,
  disk: AxEngineDiskStatus,
  model: AxEngineModelStatus,
  server: AxEngineServerRuntimeStatus,
  capability: AxEngineCapabilityStatus,
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
    if (!response.ok) {
      response.body?.cancel()
      throw new Error(`HTTP ${response.status}`)
    }
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
