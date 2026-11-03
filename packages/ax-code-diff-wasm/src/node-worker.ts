import { readFile } from "node:fs/promises"
import { parentPort } from "node:worker_threads"
import { loadKernel } from "./kernel.js"
import { ABI_VERSION } from "./protocol.js"

if (!parentPort) throw new Error("Diff Wasm worker requires a parent")
const port = parentPort
const run = await loadKernel(await readFile(new URL("../wasm/ax_code_diff_wasm_bg.wasm", import.meta.url)))
port.on("message", (message: unknown) => port.postMessage(run(message)))
port.postMessage({ type: "ready", version: ABI_VERSION })
