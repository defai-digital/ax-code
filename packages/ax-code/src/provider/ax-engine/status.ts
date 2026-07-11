import z from "zod"
import { AxEnginePlatformEligibility, getPlatformEligibility } from "./platform"
import { AxEngineDependencyStatus, getDependencyStatus } from "./dependency"
import { AxEngineDiskStatus, AxEngineModelStatus, getDiskStatus, getModelStatus } from "./model-cache"
import { AxEngineServerRuntimeStatus, getServerStatus } from "./server"
import { AX_ENGINE_ERROR, resolveAxEngineApiKey } from "./constants"
import { toErrorMessage } from "../../util/error-message"
import { parseAxEngineModelContracts } from "./model-card"

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

export function evaluateAxEngineCapabilityFromModels(payload: unknown): AxEngineCapabilityStatus {
  const model = parseAxEngineModelContracts(payload)[0]
  const toolcall = model?.toolcall ?? false
  const attachment = model?.attachment ?? false

  return {
    toolcall,
    attachment,
    reason: toolcall
      ? undefined
      : `${AX_ENGINE_ERROR.ToolcallUnsupported}: ax-engine server does not advertise OpenAI structured tool calling`,
  }
}

export function formatAxEngineCapabilityInspectionFailureReason(error: unknown): string {
  return `${AX_ENGINE_ERROR.ToolcallUnsupported}: failed to inspect ax-engine /v1/models capability (${toErrorMessage(error)})`
}

async function getCapabilityStatus(
  server: AxEngineServerRuntimeStatus,
  options: AxEngineRuntimeOptions,
): Promise<AxEngineCapabilityStatus> {
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
      headers: { authorization: `Bearer ${resolveAxEngineApiKey(options)}` },
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
      reason: formatAxEngineCapabilityInspectionFailureReason(error),
    }
  }
}

export async function getAxEngineStatus(options: AxEngineRuntimeOptions = {}): Promise<AxEngineStatus> {
  const [eligibility, dependency, disk, model, server] = await Promise.all([
    getPlatformEligibility(),
    getDependencyStatus(options),
    getDiskStatus(options),
    getModelStatus(options),
    getServerStatus(resolveAxEngineApiKey(options)),
  ])
  const capability = await getCapabilityStatus(server, options)

  return {
    eligibility,
    dependency,
    disk,
    model,
    server,
    capability,
  }
}
