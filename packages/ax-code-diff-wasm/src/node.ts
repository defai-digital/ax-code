import { Worker } from "node:worker_threads"
import { createClient } from "./client.js"
export type { CompareOptions, DuplicateComparator, DiffEngine } from "./client.js"
export type { DuplicateGroup, DiffPreview, Hunk, PatchChunk } from "./protocol.js"

export function createDiffEngine() {
  return createClient((onMessage, onFailure) => {
    const worker = new Worker(new URL("./node-worker.js", import.meta.url), { execArgv: [] })
    worker.on("message", onMessage)
    worker.on("error", onFailure)
    worker.on("messageerror", () => onFailure(new Error("Wasm worker message could not be decoded")))
    worker.on("exit", (code) => onFailure(new Error(`Wasm worker exited (${code})`)))
    return {
      post: (message) => worker.postMessage(message),
      terminate: async () => {
        await worker.terminate()
      },
    }
  })
}

export const createDuplicateComparator = createDiffEngine
