import path from "path"
import { Global } from "@/global"
import { AX_ENGINE_MANAGED_BINARY_NAME } from "./constants"
import type { AxEngineModelID } from "./constants"

export namespace AxEnginePaths {
  export const root = path.join(Global.Path.cache, "ax-engine")
  export const models = path.join(root, "models")
  export const downloads = path.join(root, "downloads")
  // Durable L2 prefix-cache directory for managed servers (AX_MLX_PREFIX_CACHE_DIR).
  // Cache keys fold in the model artifact fingerprint, so one shared directory is
  // safe across models and survives hot-swaps/restarts — switching back to a model
  // no longer re-prefills the whole conversation. Disposable: delete to reclaim.
  export const prefixCache = path.join(root, "prefix-cache")
  // Managed ax-engine binary installs, one versioned subdir each.
  export const bin = path.join(root, "bin")
  export const state = path.join(Global.Path.state, "ax-engine")
  export const log = path.join(Global.Path.log, "ax-engine")
  export const serverState = path.join(state, "server.json")
  export const prepareState = path.join(state, "prepare.json")
  export const installState = path.join(state, "install.json")
  export const serverLock = path.join(state, "server")
  export const prepareLock = path.join(state, "prepare")
  export const installLock = path.join(state, "install")
  export const serverLog = path.join(log, "server.log")

  export function managedModelDir(modelID: AxEngineModelID, quantization: string) {
    return path.join(models, modelID, quantization)
  }

  export function managedBinaryDir(version: string) {
    return path.join(bin, version)
  }

  export function managedBinary(version: string) {
    return path.join(managedBinaryDir(version), AX_ENGINE_MANAGED_BINARY_NAME)
  }

  export function completionMarker(modelDir: string) {
    return path.join(modelDir, ".ax-code-complete.json")
  }
}
