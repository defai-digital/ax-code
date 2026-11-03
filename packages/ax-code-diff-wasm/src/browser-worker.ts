import { loadKernel } from "./kernel.js"
import { ABI_VERSION } from "./protocol.js"

const run = await loadKernel()
self.onmessage = (event: MessageEvent<unknown>) => self.postMessage(run(event.data))
self.postMessage({ type: "ready", version: ABI_VERSION })
