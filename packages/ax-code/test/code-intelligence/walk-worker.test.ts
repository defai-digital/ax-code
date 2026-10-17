import { afterEach, expect, test, vi } from "vitest"
import { NativeAddon } from "../../src/native/addon"
import { NativePerf } from "../../src/perf/native"
import { ProjectID } from "../../src/project/schema"
import { CodeNodeID } from "../../src/code-intelligence/id"

const project = ProjectID.make("walk-worker")
const options = { seeds: [CodeNodeID.make("root")], callers: true, depth: 6, budget: 100 }
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  delete process.env.AX_CODE_PROFILE_NATIVE
  NativePerf.reset()
})

async function fixture(name: string) {
  const jobs: Array<{ cancel: ReturnType<typeof vi.fn>; fail: (error: Error) => void }> = []
  const close = vi.fn()
  const sync = vi.fn(() => {
    throw new Error("sync walk must not run")
  })
  class FakeStore {
    close = close
    walkCallGraph = sync
  }
  class Cancellation {
    cancel = vi.fn()
  }
  const call = vi.fn(
    (_path: string, _project: string, _options: string, token: Cancellation) =>
      new Promise<string>((_resolve, reject) => jobs.push({ cancel: token.cancel, fail: reject })),
  )
  const addon = { IndexStore: FakeStore, IndexCancellation: Cancellation, walkCallGraphAsync: call }
  vi.spyOn(NativeAddon, "index").mockReturnValue(addon as unknown as ReturnType<typeof NativeAddon.index>)
  const module = "../../src/code-intelligence/native-store.ts?walk-worker-" + name
  const { NativeStore } = (await import(module)) as typeof import("../../src/code-intelligence/native-store")
  return { NativeStore, jobs, call, close, sync, addon }
}

test("walk queue bounds admission, removes cancelled waiters and drains active work before closing", async () => {
  const { NativeStore, jobs, call, close, sync } = await fixture("capacity")
  const controllers = Array.from({ length: 34 }, () => new AbortController())
  const pending = controllers.map((c) => NativeStore.walkCallGraphAsync(project, options, c.signal))
  const settled = Promise.allSettled(pending)
  expect(call).toHaveBeenCalledTimes(2)
  await expect(NativeStore.walkCallGraphAsync(project, options)).rejects.toMatchObject({ name: "WorkQueueFullError" })
  const reason = new Error("queued cancellation")
  controllers[2].abort(reason)
  await expect(pending[2]).rejects.toBe(reason)
  const closing = NativeStore.close()
  for (const job of jobs) expect(job.cancel).toHaveBeenCalledTimes(1)
  expect(close).not.toHaveBeenCalled()
  for (const job of jobs) job.fail(new Error("native cancelled"))
  await closing
  const result = await settled
  expect(result.every((r) => r.status === "rejected")).toBe(true)
  expect(call).toHaveBeenCalledTimes(2)
  expect(close).toHaveBeenCalledTimes(1)
  expect(sync).not.toHaveBeenCalled()
  await expect(NativeStore.walkCallGraphAsync(project, options)).rejects.toThrow("closed")
})

test("walk pre-abort and missing async capability never run the synchronous walk", async () => {
  const { NativeStore, call, sync, addon } = await fixture("missing")
  const controller = new AbortController()
  controller.abort(new Error("pre-abort"))
  await expect(NativeStore.walkCallGraphAsync(project, options, controller.signal)).rejects.toBe(
    controller.signal.reason,
  )
  vi.spyOn(NativeAddon, "index").mockReturnValue({ ...addon, walkCallGraphAsync: undefined } as unknown as ReturnType<
    typeof NativeAddon.index
  >)
  expect(await NativeStore.walkCallGraphAsync(project, options)).toBeUndefined()
  expect(call).not.toHaveBeenCalled()
  expect(sync).not.toHaveBeenCalled()
  await NativeStore.close()
  await expect(NativeStore.walkCallGraphAsync(project, options)).rejects.toThrow("closed")
})

test("walk timeout cancels native work but retains the slot until it settles", async () => {
  const { NativeStore, jobs, close } = await fixture("deadline")
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] })
  process.env.AX_CODE_PROFILE_NATIVE = "1"
  let finished = false
  const pending = NativeStore.walkCallGraphAsync(project, options)
  const rejection = expect(pending).rejects.toMatchObject({ name: "TimeoutError" })
  void pending.then(
    () => {
      finished = true
    },
    () => {
      finished = true
    },
  )
  await vi.advanceTimersByTimeAsync(30_001)
  expect(jobs[0].cancel).toHaveBeenCalledTimes(1)
  expect(finished).toBe(false)
  expect(close).not.toHaveBeenCalled()
  jobs[0].fail(new Error("native cancelled"))
  await rejection
  expect(NativePerf.snapshot().operations[0].phases).toMatchObject({ native: { fails: 1 }, total: { fails: 1 } })
  await NativeStore.close()
})

test("real walk failures propagate without a sync retry and profile a failed native phase", async () => {
  const { NativeStore, jobs, sync } = await fixture("failure")
  process.env.AX_CODE_PROFILE_NATIVE = "1"
  const pending = NativeStore.walkCallGraphAsync(project, options)
  const error = new Error("Graph walk work limit exceeded")
  const rejection = expect(pending).rejects.toBe(error)
  jobs[0].fail(error)
  await rejection
  expect(sync).not.toHaveBeenCalled()
  expect(NativePerf.snapshot().operations[0].phases).toMatchObject({ native: { fails: 1 }, total: { fails: 1 } })
  await NativeStore.close()
})

test("walk admission rejects oversized projections before serialization or native dispatch", async () => {
  const { NativeStore, call } = await fixture("bounds")
  await expect(
    NativeStore.walkCallGraphAsync(project, { ...options, seeds: Array(10001).fill(options.seeds[0]) }),
  ).rejects.toThrow("input limit")
  await expect(NativeStore.walkCallGraphAsync(project, { ...options, roots: ["x".repeat(16385)] })).rejects.toThrow(
    "input limit",
  )
  expect(call).not.toHaveBeenCalled()
  await NativeStore.close()
})
