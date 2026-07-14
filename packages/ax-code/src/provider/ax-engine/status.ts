import z from "zod"
import { AxEnginePlatformEligibility, getPlatformEligibility } from "./platform"
import { AxEngineDependencyStatus, getDependencyStatus } from "./dependency"
import { AxEngineDiskStatus, AxEngineModelStatus, getDiskStatus, getModelStatus } from "./model-cache"
import { AxEngineServerRuntimeStatus, getServerStatus } from "./server"
import { AX_ENGINE_ERROR, resolveAxEngineApiKey } from "./constants"
import { toErrorMessage } from "../../util/error-message"
import { parseAxEngineModelContracts } from "./model-card"
import {
  AX_CODE_LOCAL_ENGINE_BACKEND,
  mapAxEngineStatusToLifecycle,
  type LocalEngineBackendKind,
  type LocalEngineLifecycle,
  type LocalEnginePhase,
} from "./lifecycle"

export const AxEngineCapabilityStatus = z.object({
  toolcall: z.boolean(),
  attachment: z.boolean(),
  reason: z.string().optional(),
})
export type AxEngineCapabilityStatus = z.infer<typeof AxEngineCapabilityStatus>

export const LocalEngineLifecycleStatus = z.object({
  phase: z.enum([
    "unavailable",
    "missing_dependency",
    "missing_model",
    "starting",
    "ready",
    "degraded",
    "error",
  ]),
  backend: z.enum(["in_process", "sidecar_http"]),
  blockers: z.array(z.string()).default([]),
})
export type LocalEngineLifecycleStatus = z.infer<typeof LocalEngineLifecycleStatus>

export const AxEngineStatus = z.object({
  eligibility: AxEnginePlatformEligibility,
  dependency: AxEngineDependencyStatus,
  disk: AxEngineDiskStatus,
  model: AxEngineModelStatus,
  server: AxEngineServerRuntimeStatus,
  capability: AxEngineCapabilityStatus,
  /** Shared cross-product lifecycle (ax-engine LOCAL-ENGINE-CLIENTS contract). */
  lifecycle: LocalEngineLifecycleStatus,
})
export type AxEngineStatus = z.infer<typeof AxEngineStatus>

/** Status fields used to derive lifecycle (before lifecycle is attached). */
export type AxEngineStatusCore = Omit<AxEngineStatus, "lifecycle">

export type AxEngineRuntimeOptions = {
  binaryPath?: unknown
  modelPath?: unknown
  quantization?: unknown
  [key: string]: unknown
}

export function evaluateAxEngineCapabilityFromModels(
  payload: unknown,
  preferredModelIDs: string[] = [],
): AxEngineCapabilityStatus {
  const contracts = parseAxEngineModelContracts(payload)
  const preferred = preferredModelIDs.map((id) => id.trim()).filter(Boolean)
  const model =
    preferred.length > 0
      ? (contracts.find((contract) => preferred.includes(contract.id)) ??
        // Prefer any card that advertises tool calling when the active id is
        // missing from the list — better than treating the first non-toolcall
        // card as authoritative after a multi-model / model-switch response.
        contracts.find((contract) => contract.toolcall) ??
        contracts[0])
      : (contracts.find((contract) => contract.toolcall) ?? contracts[0])
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
    const preferred = [server.state.apiModelID, server.state.modelID].filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    )
    return evaluateAxEngineCapabilityFromModels(await response.json(), preferred)
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

  const core: AxEngineStatusCore = {
    eligibility,
    dependency,
    disk,
    model,
    server,
    capability,
  }
  const lifecycle = mapAxEngineStatusToLifecycle(core)

  return {
    ...core,
    lifecycle,
  }
}

export async function getAxEngineLifecycle(
  options: AxEngineRuntimeOptions = {},
): Promise<LocalEngineLifecycle> {
  return (await getAxEngineStatus(options)).lifecycle
}

/** Re-export phase types for API consumers. */
export type { LocalEngineBackendKind, LocalEngineLifecycle, LocalEnginePhase }
export { AX_CODE_LOCAL_ENGINE_BACKEND }
