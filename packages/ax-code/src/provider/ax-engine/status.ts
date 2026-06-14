import z from "zod"
import { getPlatformEligibility } from "./platform"
import { getDependencyStatus } from "./dependency"
import { getDiskStatus, getModelStatus } from "./model-cache"
import { getServerStatus } from "./server"
import { AX_ENGINE_ERROR } from "./constants"

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

export async function getAxEngineStatus(options: AxEngineRuntimeOptions = {}): Promise<AxEngineStatus> {
  const [eligibility, dependency, disk, model, server] = await Promise.all([
    getPlatformEligibility(),
    getDependencyStatus(options),
    getDiskStatus(options),
    getModelStatus(options),
    getServerStatus(),
  ])

  return {
    eligibility,
    dependency,
    disk,
    model,
    server,
    capability: {
      toolcall: false,
      attachment: false,
      reason: `${AX_ENGINE_ERROR.ToolcallUnsupported}: ax-engine tool/function calling is not yet promoted for AX Code agent workflows`,
    },
  }
}
