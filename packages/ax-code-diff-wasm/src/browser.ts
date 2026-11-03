import { createClient } from "./client.js"
export type { CompareOptions, DuplicateComparator, DiffEngine } from "./client.js"
export type { DuplicateGroup, DiffPreview, Hunk, PatchChunk } from "./protocol.js"

export function createDiffEngine() {
  return createClient((onMessage, onFailure) => {
    const worker = new Worker(new URL("./browser-worker.js", import.meta.url), { type: "module" })
    worker.onmessage = (event) => onMessage(event.data)
    worker.onerror = () => onFailure(new Error("Wasm worker failed to load or execute"))
    worker.onmessageerror = () => onFailure(new Error("Wasm worker message could not be decoded"))
    return {
      post: (message) => worker.postMessage(message),
      terminate: async () => {
        worker.terminate()
      },
    }
  })
}

export const createDuplicateComparator = createDiffEngine
