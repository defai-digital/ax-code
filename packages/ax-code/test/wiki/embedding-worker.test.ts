import { afterEach, beforeEach, expect, test, vi } from "vitest"
import os from "node:os"
import path from "node:path"
import { Config } from "../../src/config/config"
import { getDependencyStatus } from "../../src/provider/ax-engine/dependency"
import { FileLock } from "../../src/util/filelock"
import { Process } from "../../src/util/process"
import { canUseWikiEmbeddings, openWikiEmbeddingWorker, WIKI_EMBEDDING_MODEL } from "../../src/wiki/embedding-worker"
import { tmpdir } from "../fixture/fixture"

vi.mock("../../src/provider/ax-engine/dependency", () => ({ getDependencyStatus: vi.fn() }))
const platform = Object.getOwnPropertyDescriptor(process, "platform")!
const arch = Object.getOwnPropertyDescriptor(process, "arch")!
const release = vi.fn()
beforeEach(() => {
  Object.defineProperty(process, "platform", { value: "darwin" })
  Object.defineProperty(process, "arch", { value: "arm64" })
  vi.spyOn(os, "totalmem").mockReturnValue(16 * 1024 ** 3)
  vi.spyOn(os, "freemem").mockReturnValue(4 * 1024 ** 3)
  vi.spyOn(Config, "get").mockResolvedValue({})
  vi.mocked(getDependencyStatus).mockResolvedValue({
    available: true,
    binaryPath: "/fake/ax-engine",
    version: "7.9.0",
    mode: "path",
    installable: false,
    blockers: [],
    warnings: [],
  })
  vi.spyOn(FileLock, "tryAcquire").mockResolvedValue({ [Symbol.dispose]: release })
  vi.spyOn(Process, "text").mockResolvedValue({
    code: 0,
    text: "Now drawing from 'AC Power'",
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
  })
})
afterEach(() => {
  Object.defineProperty(process, "platform", platform)
  Object.defineProperty(process, "arch", arch)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

test.each([
  ["darwin", "x64"],
  ["linux", "arm64"],
  ["win32", "arm64"],
])("%s/%s never enables Qwen ranking or probes Engine", async (host, architecture) => {
  Object.defineProperty(process, "platform", { value: host })
  Object.defineProperty(process, "arch", { value: architecture })
  expect(await canUseWikiEmbeddings()).toBe(false)
  expect(getDependencyStatus).not.toHaveBeenCalled()
  expect(Config.get).not.toHaveBeenCalled()
})

test("Qwen eligibility requires a compatible installed Engine and respects provider disablement", async () => {
  expect(await canUseWikiEmbeddings()).toBe(true)
  vi.mocked(getDependencyStatus).mockResolvedValueOnce({
    available: false,
    mode: "missing",
    installable: true,
    blockers: [],
    warnings: [],
  })
  expect(await canUseWikiEmbeddings()).toBe(false)
  vi.mocked(getDependencyStatus).mockResolvedValueOnce({
    available: true,
    binaryPath: "/fake/engine",
    version: "7.8.0",
    mode: "path",
    installable: false,
    blockers: [],
    warnings: [],
  })
  expect(await canUseWikiEmbeddings()).toBe(false)
  vi.mocked(Config.get).mockResolvedValueOnce({ disabled_providers: ["ax-engine"] })
  vi.mocked(getDependencyStatus).mockClear()
  expect(await canUseWikiEmbeddings()).toBe(false)
  expect(getDependencyStatus).not.toHaveBeenCalled()
  expect(FileLock.tryAcquire).not.toHaveBeenCalled()
  expect(Process.text).not.toHaveBeenCalled()
})

test("Engine detection errors fall back, while caller cancellation propagates", async () => {
  vi.mocked(getDependencyStatus).mockRejectedValueOnce(new Error("probe failed"))
  expect(await canUseWikiEmbeddings()).toBe(false)
  const controller = new AbortController()
  controller.abort(new DOMException("Foreground", "AbortError"))
  await expect(canUseWikiEmbeddings(controller.signal)).rejects.toMatchObject({ name: "AbortError" })
})

test("unsupported hosts, missing engines, old versions, battery and memory pressure have no download", async () => {
  const signal = new AbortController().signal
  const verify = vi.fn(async () => true)
  Object.defineProperty(process, "arch", { value: "x64" })
  expect(await openWikiEmbeddingWorker(signal, { verify })).toBeUndefined()
  expect(getDependencyStatus).not.toHaveBeenCalled()
  Object.defineProperty(process, "arch", { value: "arm64" })
  vi.mocked(getDependencyStatus).mockResolvedValueOnce({
    available: false,
    mode: "missing",
    installable: true,
    blockers: [],
    warnings: [],
  })
  expect(await openWikiEmbeddingWorker(signal, { verify })).toBeUndefined()
  vi.mocked(getDependencyStatus).mockResolvedValueOnce({
    available: true,
    binaryPath: "/fake/engine",
    version: "7.8.0",
    mode: "path",
    installable: false,
    blockers: [],
    warnings: [],
  })
  expect(await openWikiEmbeddingWorker(signal, { verify })).toBeUndefined()
  vi.mocked(Process.text).mockResolvedValueOnce({
    code: 0,
    text: "Battery Power",
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
  })
  expect(await openWikiEmbeddingWorker(signal, { verify })).toBeUndefined()
  vi.mocked(os.freemem).mockReturnValue(0)
  expect(await openWikiEmbeddingWorker(signal, { verify })).toBeUndefined()
  expect(verify).not.toHaveBeenCalled()
  expect(FileLock.tryAcquire).not.toHaveBeenCalled()
})

test("another worker owns the lease: no model IO or queue", async () => {
  vi.mocked(FileLock.tryAcquire).mockResolvedValueOnce(undefined)
  const verify = vi.fn(async () => true)
  expect(await openWikiEmbeddingWorker(new AbortController().signal, { verify })).toBeUndefined()
  expect(verify).not.toHaveBeenCalled()
})

test("verified cached model uses an authenticated separate worker and closes idempotently", async () => {
  const child = { pid: 123, exitCode: null, signalCode: null, exited: Promise.resolve(0) } as unknown as Process.Child
  const spawn = vi.spyOn(Process, "spawn").mockReturnValue(child)
  const kill = vi.spyOn(Process, "killProcessTree").mockResolvedValue()
  const request = vi.fn(async (_url: string, _init: RequestInit) =>
    Response.json({ data: [{ index: 0, embedding: [1, ...Array(1023).fill(0)] }] }),
  )
  vi.stubGlobal("fetch", request)
  const worker = await openWikiEmbeddingWorker(new AbortController().signal, { verify: async () => true })
  expect(worker).toBeDefined()
  expect(Process.text).toHaveBeenCalledTimes(1) // power only; no download
  expect(spawn.mock.calls[0][0]).toContain("--offline")
  expect(spawn.mock.calls[0][0]).toContain("127.0.0.1")
  const token = spawn.mock.calls[0][1]!.env!.AX_ENGINE_API_KEY
  expect(token).toHaveLength(64)
  expect(spawn.mock.calls[0][0].join(" ")).not.toContain(token!)
  expect((request.mock.calls[0][1].headers as Record<string, string>).Authorization).toBe(`Bearer ${token}`)
  await worker!.close()
  await worker!.close()
  expect(kill).toHaveBeenCalledTimes(1)
  expect(release).toHaveBeenCalledTimes(1)
})

test("missing artifact downloads exact pin then rejects unverified bytes without starting worker", async () => {
  const spawn = vi.spyOn(Process, "spawn")
  await expect(openWikiEmbeddingWorker(new AbortController().signal, { verify: async () => false })).rejects.toThrow(
    "verification",
  )
  expect(Process.text).toHaveBeenLastCalledWith(
    ["/fake/ax-engine", "download", `${WIKI_EMBEDDING_MODEL.repo}@${WIKI_EMBEDDING_MODEL.revision}`, "--json"],
    expect.objectContaining({ timeout: 90_000, abort: expect.any(AbortSignal) }),
  )
  expect(spawn).not.toHaveBeenCalled()
  expect(release).toHaveBeenCalledOnce()
})

test("download cancellation propagates and releases ownership", async () => {
  const controller = new AbortController()
  vi.mocked(Process.text).mockImplementation(async (cmd) => {
    if (cmd[1] === "download") controller.abort(new DOMException("Foreground", "AbortError"))
    return { code: 0, text: "AC Power", stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
  })
  await expect(openWikiEmbeddingWorker(controller.signal, { verify: async () => false })).rejects.toMatchObject({
    name: "AbortError",
  })
  expect(release).toHaveBeenCalledOnce()
})

test("concurrent closes await the same cleanup and reject further requests", async () => {
  const child = { pid: 123, exitCode: null, signalCode: null, exited: Promise.resolve(0) } as unknown as Process.Child
  vi.spyOn(Process, "spawn").mockReturnValue(child)
  const cleanup = Promise.withResolvers<void>()
  const kill = vi.spyOn(Process, "killProcessTree").mockReturnValue(cleanup.promise)
  const request = vi.fn(async () => Response.json({ data: [{ index: 0, embedding: [1, ...Array(1023).fill(0)] }] }))
  vi.stubGlobal("fetch", request)
  const worker = (await openWikiEmbeddingWorker(new AbortController().signal, { verify: async () => true }))!
  const first = worker.close()
  expect(worker.close()).toBe(first)
  expect(release).not.toHaveBeenCalled()
  await expect(worker.embed(["source"])).rejects.toMatchObject({ name: "AbortError" })
  expect(request).toHaveBeenCalledOnce()
  cleanup.resolve()
  await first
  expect(kill).toHaveBeenCalledOnce()
  expect(release).toHaveBeenCalledOnce()
})

test("requests enforce batch and response bounds and close aborts an in-flight request", async () => {
  const child = { pid: 123, exitCode: null, signalCode: null, exited: Promise.resolve(0) } as unknown as Process.Child
  vi.spyOn(Process, "spawn").mockReturnValue(child)
  vi.spyOn(Process, "killProcessTree").mockResolvedValue()
  const request = vi.fn(async (_url: string, _init: RequestInit) =>
    Response.json({ data: [{ index: 0, embedding: [1, ...Array(1023).fill(0)] }] }),
  )
  vi.stubGlobal("fetch", request)
  const worker = (await openWikiEmbeddingWorker(new AbortController().signal, { verify: async () => true }))!
  for (const input of [[], [" "], Array(5).fill("text"), ["界".repeat(1400)]])
    await expect(worker.embed(input)).rejects.toThrow("batch limits")
  expect(request).toHaveBeenCalledOnce()
  request.mockResolvedValueOnce(new Response("x".repeat(256 * 1024 + 1)))
  await expect(worker.embed(["source"])).rejects.toThrow()
  request.mockImplementationOnce(
    async (_url, init) =>
      new Promise<Response>((_, reject) => {
        init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true })
      }),
  )
  const pending = expect(worker.embed(["source"])).rejects.toMatchObject({ name: "AbortError" })
  await worker.close()
  await pending
  expect(release).toHaveBeenCalledOnce()
})

test("failed cleanup remains shared and retains the worker lease", async () => {
  const child = { pid: 123, exitCode: null, signalCode: null, exited: Promise.resolve(0) } as unknown as Process.Child
  vi.spyOn(Process, "spawn").mockReturnValue(child)
  const kill = vi.spyOn(Process, "killProcessTree").mockRejectedValue(new Error("cannot reap worker"))
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ data: [{ index: 0, embedding: [1, ...Array(1023).fill(0)] }] })),
  )
  const worker = (await openWikiEmbeddingWorker(new AbortController().signal, { verify: async () => true }))!
  const closing = worker.close()
  await expect(closing).rejects.toMatchObject({ name: "WikiEmbeddingCleanupError" })
  expect(worker.close()).toBe(closing)
  expect(kill).toHaveBeenCalledTimes(2)
  expect(release).not.toHaveBeenCalled()
})

test("a failed spawn releases admission and preserves the spawn error instead of claiming a live worker", async () => {
  const failure = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })
  const exited = Promise.reject(failure)
  void exited.catch(() => {})
  const child = { pid: undefined, exitCode: -2, signalCode: null, exited } as unknown as Process.Child
  vi.spyOn(Process, "spawn").mockReturnValue(child)
  const kill = vi.spyOn(Process, "killProcessTree").mockResolvedValue()
  const request = vi.fn()
  vi.stubGlobal("fetch", request)
  await expect(openWikiEmbeddingWorker(new AbortController().signal, { verify: async () => true })).rejects.toBe(
    failure,
  )
  expect(kill).not.toHaveBeenCalled()
  expect(request).not.toHaveBeenCalled()
  expect(release).toHaveBeenCalledOnce()
})

test("an Engine binary removed after detection releases admission through the real spawn error path", async () => {
  await using tmp = await tmpdir({})
  vi.mocked(getDependencyStatus).mockResolvedValueOnce({
    available: true,
    binaryPath: path.join(tmp.path, "removed-engine"),
    version: "7.9.0",
    mode: "path",
    installable: false,
    blockers: [],
    warnings: [],
  })
  const kill = vi.spyOn(Process, "killProcessTree").mockResolvedValue()
  await expect(
    openWikiEmbeddingWorker(new AbortController().signal, { verify: async () => true }),
  ).rejects.toMatchObject({ code: "ENOENT" })
  expect(kill).not.toHaveBeenCalled()
  expect(release).toHaveBeenCalledOnce()
})

test("HTTP error responses cancel their unread bodies before a readiness retry can reuse the connection", async () => {
  const child = { pid: 123, exitCode: null, signalCode: null, exited: Promise.resolve(0) } as unknown as Process.Child
  vi.spyOn(Process, "spawn").mockReturnValue(child)
  vi.spyOn(Process, "killProcessTree").mockResolvedValue()
  const request = vi.fn(async () => Response.json({ data: [{ index: 0, embedding: [1, ...Array(1023).fill(0)] }] }))
  vi.stubGlobal("fetch", request)
  const worker = (await openWikiEmbeddingWorker(new AbortController().signal, { verify: async () => true }))!
  const cancel = vi.fn()
  request.mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { status: 503 }))
  try {
    await expect(worker.embed(["source"])).rejects.toThrow("request failed")
    expect(cancel).toHaveBeenCalledOnce()
  } finally {
    await worker.close()
  }
})
