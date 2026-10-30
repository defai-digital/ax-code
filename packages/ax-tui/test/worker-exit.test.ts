import { expect, test } from "vitest"
import type { Worker as NodeWorker } from "node:worker_threads"
import { Worker, type WorkerErrorEvent } from "../src/platform/worker.js"

const hasWorkerRuntime = Worker.name !== "UnsupportedWorker"

// The Node worker shim must surface a worker that exits without emitting an
// "error" (process.exit, OOM kill) as an error event; otherwise consumers wait
// on pending requests forever.
test.skipIf(!hasWorkerRuntime)("worker shim reports unexpected exit as an error event", async () => {
  const worker = new Worker(new URL("data:text/javascript,process.exit(1)"))
  try {
    const event = await new Promise<WorkerErrorEvent>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no error event within 5s")), 5_000)
      worker.onerror = (event) => {
        clearTimeout(timer)
        resolve(event)
      }
    })
    expect(event.message).toContain("exited")
    expect(event.error).toBeInstanceOf(Error)
  } finally {
    await worker.terminate().catch(() => {})
  }
})

test.skipIf(Worker.name !== "NodeWorkerShim")("worker failure reports its original error once across error and exit", async () => {
  const worker = new Worker(new URL("data:text/javascript,throw new Error('worker failure sentinel')"))
  const propertyEvents: WorkerErrorEvent[] = []
  const listenerEvents: WorkerErrorEvent[] = []
  worker.onerror = event => { propertyEvents.push(event) }
  worker.addEventListener("error", event => { listenerEvents.push(event as WorkerErrorEvent) })
  // Await the underlying exit so both native notifications have arrived; a
  // fixed sleep could miss a late duplicate and falsely pass on a busy runner.
  const native = (worker as unknown as { worker: NodeWorker }).worker
  try {
    await new Promise<void>(resolve => { native.once("exit", () => resolve()) })
    expect(propertyEvents.map(event => event.message)).toEqual(["worker failure sentinel"])
    expect(listenerEvents.map(event => event.message)).toEqual(["worker failure sentinel"])
  } finally {
    await worker.terminate()
  }
})

test.skipIf(!hasWorkerRuntime)("intentional worker termination does not report a failure", async () => {
  const worker = new Worker(new URL("data:text/javascript,postMessage('ready')"))
  const errors: WorkerErrorEvent[] = []
  worker.onerror = event => { errors.push(event) }
  await new Promise<void>(resolve => { worker.onmessage = () => resolve() })
  await worker.terminate()
  expect(errors).toEqual([])
})
