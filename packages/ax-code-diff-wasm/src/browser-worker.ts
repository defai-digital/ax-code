import { loadKernel } from "./kernel.js"
import { ABI_VERSION } from "./protocol.js"

const run = await loadKernel()
const workerOrigin = self.location.origin
self.onmessage = (event: MessageEvent<unknown>) => {
  // Dedicated workers only receive messages from their owner. Some engines
  // report that sender with an empty origin; any other origin is rejected.
  if (event.origin !== workerOrigin && event.origin !== "") return
  self.postMessage(run(event.data))
}
self.postMessage({ type: "ready", version: ABI_VERSION })
