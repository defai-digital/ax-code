import { afterEach, beforeEach, expect, test, vi } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../../fixture/fixture"
import { Process } from "../../../src/util/process"
import { FileLock } from "../../../src/util/filelock"
import {
  AX_ENGINE_DEFAULT_MODEL_ID,
  resolveAxEnginePrefixCacheLaunchConfig,
} from "../../../src/provider/ax-engine/constants"
import { AxEnginePaths } from "../../../src/provider/ax-engine/paths"
import { ensureServer, getServerStatus, type AxEngineServerState } from "../../../src/provider/ax-engine/server"

const originalPaths = { ...AxEnginePaths }
const originalKill = process.kill.bind(process)

beforeEach(() => {
  // Observation fixtures borrow this worker PID only for read-only liveness.
  // A launch-contract regression must fail assertions, never kill the worker.
  vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
    if (signal === 0) return originalKill(pid, signal)
    throw new Error("Observation fixtures must not signal live processes")
  })
})

function processResult(text: string): Process.TextResult {
  return { code: 0, text, stdout: Buffer.from(text), stderr: Buffer.alloc(0) }
}

afterEach(() => {
  const signals = vi.mocked(process.kill).mock.calls.filter(([, signal]) => signal !== 0)
  Object.assign(AxEnginePaths, originalPaths)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  expect(signals).toEqual([])
})

async function isolate(dir: string) {
  Object.assign(AxEnginePaths, {
    state: dir,
    log: dir,
    serverState: path.join(dir, "server.json"),
    serverLock: path.join(dir, "server"),
    serverLog: path.join(dir, "server.log"),
    prefixCache: path.join(dir, "prefix-cache"),
  })
  for (const name of [
    "AX_MLX_PREFIX_CACHE_DIR",
    "AX_MLX_PREFIX_CACHE_MAX_BYTES",
    "AX_MLX_PREFIX_CACHE_DISK_MAX_BYTES",
    "AX_MLX_PREFIX_CACHE_DISK_MAX_ENTRY_BYTES",
  ])
    vi.stubEnv(name, undefined)
  const prefixCache = resolveAxEnginePrefixCacheLaunchConfig({ defaultDir: AxEnginePaths.prefixCache })
  const state: AxEngineServerState = {
    prefixCacheDir: prefixCache.dir,
    prefixCacheMaxBytes: prefixCache.maxBytes,
    prefixCacheDiskMaxBytes: prefixCache.diskMaxBytes,
    prefixCacheDiskMaxEntryBytes: prefixCache.diskMaxEntryBytes,
    pid: process.pid,
    port: 31418,
    baseURL: "http://127.0.0.1:31418/v1",
    modelID: AX_ENGINE_DEFAULT_MODEL_ID,
    apiModelID: AX_ENGINE_DEFAULT_MODEL_ID,
    modelPath: "/models/old",
    binaryPath: "/bin/ax-engine",
    startedAt: 1,
  }
  await fs.writeFile(AxEnginePaths.serverState, JSON.stringify(state))
  return state
}

test.each(["replacement", "stop"])("a slow health query cannot undo a concurrent %s", async (operation) => {
  await using tmp = await tmpdir()
  const state = await isolate(tmp.path)
  vi.spyOn(Process, "text").mockResolvedValue(processResult("ax-engine serve /models/old"))
  const newer = JSON.stringify({ ...state, modelPath: "/models/new", startedAt: 2 })
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (operation === "stop") await fs.rm(AxEnginePaths.serverState)
      else await fs.writeFile(AxEnginePaths.serverState, newer)
      return Response.json({ data: [] })
    }),
  )

  expect((await getServerStatus()).ready).toBe(true)
  if (operation === "stop") await expect(fs.access(AxEnginePaths.serverState)).rejects.toThrow()
  else expect(await fs.readFile(AxEnginePaths.serverState, "utf8")).toBe(newer)
})

test("a stale process query cannot delete a replacement server record", async () => {
  await using tmp = await tmpdir()
  const state = await isolate(tmp.path)
  const newer = JSON.stringify({ ...state, modelPath: "/models/new", startedAt: 2 })
  vi.spyOn(Process, "text").mockImplementation(async () => {
    await fs.writeFile(AxEnginePaths.serverState, newer)
    return processResult("unrelated-process")
  })
  expect((await getServerStatus()).running).toBe(false)
  expect(await fs.readFile(AxEnginePaths.serverState, "utf8")).toBe(newer)
})

test("a pre-cancelled start performs no lifecycle work", async () => {
  await using tmp = await tmpdir()
  const state = await isolate(tmp.path)
  const readProcess = vi.spyOn(Process, "text").mockRejectedValue(new Error("Unexpected process inspection"))
  const reason = new Error("User cancelled startup")
  await expect(
    ensureServer({
      binaryPath: state.binaryPath,
      modelID: state.modelID,
      apiModelID: state.modelID,
      modelPath: state.modelPath,
      signal: AbortSignal.abort(reason),
    }),
  ).rejects.toBe(reason)
  expect(readProcess).not.toHaveBeenCalled()
  expect(await fs.readFile(AxEnginePaths.serverState, "utf8")).toBe(JSON.stringify(state))
})

test("cancelling one startup does not cancel another caller waiting for the same server", async () => {
  await using tmp = await tmpdir()
  const state = {
    ...(await isolate(tmp.path)),
    maxOutputTokens: 8_192,
    speculationProfile: "agentic",
    mtpMode: "pure",
  }
  await fs.writeFile(AxEnginePaths.serverState, JSON.stringify(state))
  vi.spyOn(Process, "text").mockResolvedValue(processResult("ax-engine serve /models/old"))
  const entered = Promise.withResolvers<void>()
  let calls = 0
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (++calls !== 1) return Response.json({ data: [] })
      entered.resolve()
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })
      })
    }),
  )
  const input = {
    binaryPath: state.binaryPath,
    modelID: state.modelID,
    apiModelID: state.modelID,
    modelPath: state.modelPath,
  }
  const controller = new AbortController()
  const first = ensureServer({ ...input, signal: controller.signal }).catch((error: unknown) => error)
  await entered.promise
  const second = ensureServer(input)
  const reason = new Error("First caller cancelled")
  controller.abort(reason)
  expect(await first).toBe(reason)
  await expect(second).resolves.toMatchObject({ pid: state.pid })
})

test("a cancelled startup stops waiting for a lifecycle lock without touching its owner", async () => {
  await using tmp = await tmpdir()
  const state = await isolate(tmp.path)
  using holder = await FileLock.acquire(AxEnginePaths.serverLock)
  const controller = new AbortController()
  const reason = new Error("Stop waiting for the engine")
  const waiting = ensureServer({
    binaryPath: state.binaryPath,
    modelID: state.modelID,
    apiModelID: state.modelID,
    modelPath: state.modelPath,
    signal: controller.signal,
  }).catch((error: unknown) => error)
  controller.abort(reason)
  const outcome = await Promise.race([waiting, new Promise<undefined>((resolve) => setTimeout(resolve, 250))])
  // Let the pre-fix waiter exit before disposing the fixture.
  holder[Symbol.dispose]()
  await waiting
  expect(outcome).toBe(reason)
})

test("transient health failures do not restart an already running engine", async () => {
  await using tmp = await tmpdir()
  const state = {
    ...(await isolate(tmp.path)),
    maxOutputTokens: 8_192,
    speculationProfile: "agentic",
    mtpMode: "pure",
    lastHealthAt: Date.now(),
  }
  const saved = JSON.stringify(state)
  await fs.writeFile(AxEnginePaths.serverState, saved)
  // The second process inspection belongs to termination in the old path.
  // Never allow a regression to signal the test runner's own PID.
  vi.spyOn(Process, "text")
    .mockResolvedValueOnce(processResult("ax-engine serve /models/old"))
    .mockResolvedValue(processResult("unrelated-process"))
  const spawn = vi.spyOn(Process, "spawn").mockImplementation(() => {
    throw new Error("The running engine must not be restarted")
  })
  const probe = vi
    .fn()
    .mockRejectedValueOnce(new DOMException("Health probe timed out", "TimeoutError"))
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValue(Response.json({ data: [] }))
  vi.stubGlobal("fetch", probe)

  await expect(
    ensureServer({
      binaryPath: state.binaryPath,
      modelID: state.modelID,
      apiModelID: state.modelID,
      modelPath: state.modelPath,
    }),
  ).resolves.toMatchObject({ pid: state.pid })
  expect(probe).toHaveBeenCalledTimes(3)
  expect(spawn).not.toHaveBeenCalled()
  expect(await fs.readFile(AxEnginePaths.serverState, "utf8")).toBe(saved)
})

test("persistent health failures exhaust a bounded retry before restarting", async () => {
  await using tmp = await tmpdir()
  const state = await isolate(tmp.path)
  vi.spyOn(Process, "text")
    .mockResolvedValueOnce(processResult("ax-engine serve /models/old"))
    .mockResolvedValue(processResult("unrelated-process"))
  const restart = new Error("Replacement startup reached")
  const spawn = vi.spyOn(Process, "spawn").mockImplementation(() => {
    throw restart
  })
  const probe = vi.fn(async () => new Response(null, { status: 503 }))
  vi.stubGlobal("fetch", probe)

  await expect(
    ensureServer({
      binaryPath: state.binaryPath,
      modelID: state.modelID,
      apiModelID: state.modelID,
      modelPath: state.modelPath,
    }),
  ).rejects.toBe(restart)
  expect(probe).toHaveBeenCalledTimes(3)
  expect(spawn).toHaveBeenCalledOnce()
})

test("cancelling the health retry delay preserves the running engine", async () => {
  await using tmp = await tmpdir()
  const state = await isolate(tmp.path)
  const saved = await fs.readFile(AxEnginePaths.serverState, "utf8")
  vi.spyOn(Process, "text")
    .mockResolvedValueOnce(processResult("ax-engine serve /models/old"))
    .mockResolvedValue(processResult("unrelated-process"))
  const spawn = vi.spyOn(Process, "spawn").mockImplementation(() => {
    throw new Error("Cancellation must not restart the engine")
  })
  const controller = new AbortController()
  const reason = new Error("User cancelled health retry")
  const probe = vi.fn(async () => {
    setTimeout(() => controller.abort(reason), 10)
    return new Response(null, { status: 503 })
  })
  vi.stubGlobal("fetch", probe)

  await expect(
    ensureServer({
      binaryPath: state.binaryPath,
      modelID: state.modelID,
      apiModelID: state.modelID,
      modelPath: state.modelPath,
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ name: "AbortError", cause: reason })
  expect(probe).toHaveBeenCalledOnce()
  expect(spawn).not.toHaveBeenCalled()
  expect(await fs.readFile(AxEnginePaths.serverState, "utf8")).toBe(saved)
})

test.each(["revision", "api model"])("reloads a changed %s even when the catalog id and path match", async (change) => {
  await using tmp = await tmpdir()
  const state = {
    ...(await isolate(tmp.path)),
    modelRevision: "old-revision",
    maxOutputTokens: 8_192,
    speculationProfile: "agentic",
    mtpMode: "pure",
  }
  await fs.writeFile(AxEnginePaths.serverState, JSON.stringify(state))
  vi.spyOn(Process, "text").mockResolvedValue(processResult("ax-engine serve /models/old"))
  const cancel = vi.fn()
  const loads: RequestInit[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        loads.push(init)
        return new Response(new ReadableStream({ cancel }))
      }
      return Response.json({ data: [] })
    }),
  )
  const next = await ensureServer({
    binaryPath: state.binaryPath,
    modelID: state.modelID,
    apiModelID: change === "api model" ? "new-api-model" : state.modelID,
    modelPath: state.modelPath,
    modelRevision: change === "revision" ? "new-revision" : state.modelRevision,
  })
  expect(loads).toHaveLength(1)
  expect(loads[0].redirect).toBe("error")
  expect(cancel).toHaveBeenCalledOnce()
  expect(next.apiModelID).toBe(change === "api model" ? "new-api-model" : state.modelID)
  expect(next.modelRevision).toBe(change === "revision" ? "new-revision" : state.modelRevision)
})
