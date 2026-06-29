import fs from "fs/promises"
import path from "path"
import { Filesystem } from "@/util/filesystem"
import { AX_ENGINE_ERROR } from "./constants"
import type { AxEngineModelID, AxEngineQuantization } from "./constants"
import { AxEnginePaths } from "./paths"
import { HfCache } from "./hf-cache"
import { clearPreparedStateForPath, getModelStatus } from "./model-cache"
import { getServerStatus } from "./server"

export type AxEngineDeleteModelResponse = {
  deleted: boolean
  modelID: AxEngineModelID
  quantization: AxEngineQuantization
  path?: string
  freedBytes?: number
  preparedStateUpdated: boolean
}

async function directorySize(dir: string): Promise<number | undefined> {
  let total = 0
  async function walk(current: string) {
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const p = path.join(current, entry.name)
      if (entry.isDirectory()) await walk(p)
      else if (entry.isFile()) total += (await fs.stat(p)).size
    }
  }
  try {
    await walk(dir)
    return total
  } catch {
    return undefined
  }
}

function isEligibleDeleteTarget(target: string) {
  const resolved = path.resolve(target)
  if (Filesystem.contains(AxEnginePaths.models, resolved)) return true
  if (!HfCache.isInside(resolved)) return false
  return resolved.split(path.sep).includes("snapshots")
}

export async function deleteAxEngineModel(input: {
  modelID: AxEngineModelID
  quantization: AxEngineQuantization
}): Promise<AxEngineDeleteModelResponse> {
  const status = await getModelStatus({ modelID: input.modelID, quantization: input.quantization })
  if (!status.present || !status.path) {
    return {
      deleted: false,
      modelID: input.modelID,
      quantization: input.quantization,
      preparedStateUpdated: false,
    }
  }

  const target = path.resolve(status.path)
  if (!isEligibleDeleteTarget(target)) {
    throw new Error(`${AX_ENGINE_ERROR.ModelNotPrepared}: resolved model path is not managed by AX Code`)
  }

  const server = await getServerStatus()
  if (
    server.state?.modelPath &&
    (server.state.modelPath === target || Filesystem.contains(target, server.state.modelPath))
  ) {
    throw new Error(`${AX_ENGINE_ERROR.ServerStartFailed}: stop AX Engine before deleting the active model`)
  }

  const freedBytes = status.bytes ?? (await directorySize(target))
  const preparedStateUpdated = await clearPreparedStateForPath(target)
  await fs.rm(target, { recursive: true, force: true })
  await fs.rmdir(path.dirname(target)).catch(() => undefined)

  return {
    deleted: true,
    modelID: input.modelID,
    quantization: input.quantization,
    path: target,
    freedBytes,
    preparedStateUpdated,
  }
}
