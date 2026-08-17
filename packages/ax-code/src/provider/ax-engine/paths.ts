import path from "path"
import { Global } from "@/global"
import { AX_ENGINE_MANAGED_BINARY_NAME } from "./constants"
import type { AxEngineModelID } from "./constants"

function containedPath(base: string, ...segments: string[]) {
  const resolvedBase = path.resolve(base)
  const candidate = path.resolve(resolvedBase, ...segments)
  const relative = path.relative(resolvedBase, candidate)
  const escapesBase = relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
  if (escapesBase) throw new TypeError(`AX Engine path escapes its managed directory: ${segments.join("/")}`)
  return candidate
}

export namespace AxEnginePaths {
  export const root = containedPath(Global.Path.cache, "ax-engine")
  export const models = containedPath(root, "models")
  export const downloads = containedPath(root, "downloads")
  // Durable L2 prefix-cache directory for managed servers (AX_MLX_PREFIX_CACHE_DIR).
  // Cache keys fold in the model artifact fingerprint, so one shared directory is
  // safe across models and survives hot-swaps/restarts — switching back to a model
  // no longer re-prefills the whole conversation. Disposable: delete to reclaim.
  export const prefixCache = containedPath(root, "prefix-cache")
  // Managed ax-engine binary installs, one versioned subdir each.
  export const bin = containedPath(root, "bin")
  export const state = containedPath(Global.Path.state, "ax-engine")
  export const log = containedPath(Global.Path.log, "ax-engine")
  export const serverState = containedPath(state, "server.json")
  export const prepareState = containedPath(state, "prepare.json")
  export const installState = containedPath(state, "install.json")
  export const serverLock = containedPath(state, "server")
  export const prepareLock = containedPath(state, "prepare")
  export const installLock = containedPath(state, "install")
  export const serverLog = containedPath(log, "server.log")

  export function managedModelDir(modelID: AxEngineModelID, quantization: string) {
    return containedPath(models, modelID, quantization)
  }

  export function managedBinaryDir(version: string) {
    return containedPath(bin, version)
  }

  export function managedBinary(version: string) {
    return containedPath(managedBinaryDir(version), AX_ENGINE_MANAGED_BINARY_NAME)
  }

  export function completionMarker(modelDir: string) {
    return containedPath(modelDir, ".ax-code-complete.json")
  }
}
