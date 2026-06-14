import path from "path"
import { Global } from "@/global"
import { AX_ENGINE_MODEL_ID } from "./constants"

export namespace AxEnginePaths {
  export const root = path.join(Global.Path.cache, "ax-engine")
  export const models = path.join(root, "models")
  export const downloads = path.join(root, "downloads")
  export const venv = path.join(root, "venv")
  export const state = path.join(Global.Path.state, "ax-engine")
  export const log = path.join(Global.Path.log, "ax-engine")
  export const serverState = path.join(state, "server.json")
  export const prepareState = path.join(state, "prepare.json")
  export const serverLock = path.join(state, "server")
  export const prepareLock = path.join(state, "prepare")
  export const serverLog = path.join(log, "server.log")

  export function managedModelDir(quantization: string) {
    return path.join(models, AX_ENGINE_MODEL_ID, quantization)
  }

  export function completionMarker(modelDir: string) {
    return path.join(modelDir, ".ax-code-complete.json")
  }
}
