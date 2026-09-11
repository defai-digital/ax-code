import { describe, expect, test, vi } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../../fixture/fixture"
import { Process } from "../../../src/util/process"
import { Filesystem } from "../../../src/util/filesystem"
import {
  AX_ENGINE_PREFIX_CACHE_DISK_MAX_BYTES,
  AX_ENGINE_PREFIX_CACHE_DISK_MAX_ENTRY_BYTES,
  AX_ENGINE_PREFIX_CACHE_MAX_BYTES,
  AX_ENGINE_QWEN38_27B_AXQ_6BIT_MODEL_ID,
  AX_MLX_PREFIX_CACHE_DISK_MAX_BYTES_ENV,
  AX_MLX_PREFIX_CACHE_DISK_MAX_ENTRY_BYTES_ENV,
  AX_ENGINE_QWEN38_EXACT_MTP_PROFILE_ENV,
  AX_MLX_PREFIX_CACHE_DIR_ENV,
  AX_MLX_PREFIX_CACHE_MAX_BYTES_ENV,
} from "../../../src/provider/ax-engine/constants"
import { AxEnginePaths } from "../../../src/provider/ax-engine/paths"
import { ensureServer, isServerReady, stopServer } from "../../../src/provider/ax-engine/server"
import type { AxEngineServerOptions } from "../../../src/provider/ax-engine/server"
import { AxEngineStartupError } from "../../../src/provider/ax-engine/errors"
import { resolveAxEngineSetup } from "../../../src/provider/ax-engine/setup"

async function fixture(mode: "ready" | "unready" | "exit" = "ready") {
  const tmp = await tmpdir()
  const originalPaths = { ...AxEnginePaths }
  Object.assign(AxEnginePaths, {
    state: tmp.path,
    log: tmp.path,
    serverState: path.join(tmp.path, "server.json"),
    serverLock: path.join(tmp.path, "server"),
    serverLog: path.join(tmp.path, "server.log"),
    prefixCache: path.join(tmp.path, "prefix-cache"),
  })
  const script = path.join(tmp.path, "ax-engine-fixture.cjs")
  await fs.writeFile(
    script,
    `if (${mode === "exit"}) process.exit(7)
const http = require("node:http")
const port = Number(process.argv[process.argv.indexOf("--port") + 1])
http.createServer((req, res) => {
  res.writeHead(${mode === "ready" ? 200 : 503}, { "content-type": "application/json" })
  res.end('{"data":[]}')
}).listen(port, "127.0.0.1")
`,
  )
  const binary = path.join(tmp.path, "ax-engine")
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
  await fs.writeFile(binary, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)} "$@"\n`, { mode: 0o755 })
  const children: ReturnType<typeof Process.spawn>[] = []
  const spawned: Array<{ cmd: string[]; env?: NodeJS.ProcessEnv | null }> = []
  const spawn = Process.spawn
  vi.spyOn(Process, "spawn").mockImplementation((cmd, options) => {
    const child = spawn(cmd, options)
    if (cmd[0] === binary) {
      children.push(child)
      spawned.push({ cmd, env: options?.env })
    }
    return child
  })
  return {
    input: {
      binaryPath: binary,
      modelID: AX_ENGINE_QWEN38_27B_AXQ_6BIT_MODEL_ID,
      apiModelID: AX_ENGINE_QWEN38_27B_AXQ_6BIT_MODEL_ID,
      modelPath: path.join(tmp.path, "model"),
      preferredPort: 39141,
      readyTimeoutMs: 5_000,
    } satisfies AxEngineServerOptions,
    children,
    spawned,
    async [Symbol.asyncDispose]() {
      vi.restoreAllMocks()
      for (const child of children) await Process.killProcessTree(child)
      Object.assign(AxEnginePaths, originalPaths)
      await tmp[Symbol.asyncDispose]()
    },
  }
}

// Managed process identity currently uses Unix ps; these fixtures exercise
// real subprocesses and HTTP without loading weights or touching host state.
describe.skipIf(process.platform === "win32")("managed engine residency", () => {
  test("the outer setup timeout cleans up a still-starting engine", async () => {
    await using f = await fixture("unready")
    const caller = new AbortController()
    await expect(
      resolveAxEngineSetup({ modelID: f.input.modelID, signal: caller.signal, timeoutMs: 500 }, (signal) =>
        ensureServer({ ...f.input, signal }),
      ),
    ).rejects.toMatchObject({ name: "AxEngineStartupError", data: { reason: "setup-timeout" } })
    expect(f.children).toHaveLength(1)
    await vi.waitFor(async () => {
      expect(f.children[0].exitCode !== null || f.children[0].signalCode !== null).toBe(true)
      await expect(fs.access(AxEnginePaths.serverState)).rejects.toThrow()
    })
    expect(caller.signal.aborted).toBe(false)
  })

  test("cancelling capability discovery preserves an engine that already became ready", async () => {
    await using f = await fixture()
    const caller = new AbortController()
    const ready = Promise.withResolvers<Awaited<ReturnType<typeof ensureServer>>>()
    const discovery = Promise.withResolvers<void>()
    const pending = resolveAxEngineSetup({ modelID: f.input.modelID, signal: caller.signal }, async (signal) => {
      const state = await ensureServer({ ...f.input, signal })
      ready.resolve(state)
      await discovery.promise
      return state
    }).catch((error: unknown) => error)
    const state = await ready.promise
    const reason = new DOMException("Cancelled capability discovery", "AbortError")
    caller.abort(reason)
    expect(await pending).toBe(reason)
    discovery.resolve()
    expect(await isServerReady(state.baseURL)).toBe(true)
    expect((await Filesystem.readJson(AxEnginePaths.serverState)).pid).toBe(state.pid)
  })

  test("the readiness deadline interrupts an in-flight health probe", async () => {
    await using f = await fixture()
    let aborted = false
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener(
          "abort",
          () => {
            aborted = true
            reject(init!.signal!.reason)
          },
          { once: true },
        )
      })
    })
    const started = performance.now()
    await expect(ensureServer({ ...f.input, readyTimeoutMs: 50 })).rejects.toMatchObject({
      name: "AxEngineStartupError",
      data: { reason: "timeout" },
    })
    expect(aborted).toBe(true)
    expect(performance.now() - started).toBeLessThan(1_500)
    await expect(fs.access(AxEnginePaths.serverState)).rejects.toThrow()
  })

  test("a health response after the readiness deadline is not accepted", async () => {
    await using f = await fixture()
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150))
      return Response.json({ data: [] })
    })
    const result = await ensureServer({ ...f.input, readyTimeoutMs: 50 }).catch((error: unknown) => error)
    expect(result).toMatchObject({ name: "AxEngineStartupError", data: { reason: "timeout" } })
    await expect(f.children[0].exited).resolves.toBeTypeOf("number")
    await expect(fs.access(AxEnginePaths.serverState)).rejects.toThrow()
  })

  test.each(["health response", "ready-state write"])(
    "an engine exiting during %s is not handed off",
    async (phase) => {
      await using f = await fixture()
      if (phase === "health response") {
        const fetch = globalThis.fetch
        vi.spyOn(globalThis, "fetch").mockImplementation(async (...args) => {
          const response = await fetch(...args)
          if (response.ok) await Process.killProcessTree(f.children[0])
          return response
        })
      } else {
        const write = Filesystem.writeJson
        let writes = 0
        vi.spyOn(Filesystem, "writeJson").mockImplementation(async (file, content) => {
          await write(file, content)
          if (file === AxEnginePaths.serverState && ++writes === 2) await Process.killProcessTree(f.children[0])
        })
      }
      const result = await ensureServer(f.input).catch((error: unknown) => error)
      expect(result).toMatchObject({ name: "AxEngineStartupError", data: { reason: "process-exited" } })
      await expect(fs.access(AxEnginePaths.serverState)).rejects.toThrow()
    },
  )

  test("cancellation while preparing the log does not launch a process", async () => {
    await using f = await fixture()
    const controller = new AbortController()
    const reason = new DOMException("Cancelled before spawn", "AbortError")
    const open = fs.open
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await open(...args)
      if (args[0] === AxEnginePaths.serverLog && args[1] === "a") controller.abort(reason)
      return handle
    })
    await expect(ensureServer({ ...f.input, signal: controller.signal })).rejects.toBe(reason)
    expect(f.children).toHaveLength(0)
    await expect(fs.access(AxEnginePaths.serverState)).rejects.toThrow()
  })

  test("a completed caller leaves a healthy engine for the next turn and explicit stop", async () => {
    await using f = await fixture()
    const firstCaller = new AbortController()
    const first = await ensureServer({ ...f.input, signal: firstCaller.signal })
    // Normal prompt-loop cleanup aborts the generation's signal.
    firstCaller.abort()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(await isServerReady(first.baseURL)).toBe(true)
    const secondCaller = new AbortController()
    const second = await ensureServer({ ...f.input, signal: secondCaller.signal })
    expect(second.pid).toBe(first.pid)
    expect(f.children).toHaveLength(1)
    secondCaller.abort()
    expect(await isServerReady(second.baseURL)).toBe(true)
    await stopServer()
    await expect(f.children[0].exited).resolves.toBeTypeOf("number")
    await expect(fs.access(AxEnginePaths.serverState)).rejects.toThrow()
    expect(await isServerReady(first.baseURL)).toBe(false)
  })

  test("managed spawn injects 8 GiB prefix-cache budgets", async () => {
    await using f = await fixture()
    const state = await ensureServer(f.input)
    expect(f.spawned[0]?.env?.[AX_MLX_PREFIX_CACHE_DIR_ENV]).toBe(AxEnginePaths.prefixCache)
    expect(f.spawned[0]?.env?.[AX_MLX_PREFIX_CACHE_MAX_BYTES_ENV]).toBe(String(AX_ENGINE_PREFIX_CACHE_MAX_BYTES))
    expect(f.spawned[0]?.env?.[AX_MLX_PREFIX_CACHE_DISK_MAX_BYTES_ENV]).toBe(
      String(AX_ENGINE_PREFIX_CACHE_DISK_MAX_BYTES),
    )
    expect(f.spawned[0]?.env?.[AX_MLX_PREFIX_CACHE_DISK_MAX_ENTRY_BYTES_ENV]).toBe(
      String(AX_ENGINE_PREFIX_CACHE_DISK_MAX_ENTRY_BYTES),
    )
    expect(state.prefixCacheDir).toBe(AxEnginePaths.prefixCache)
    expect(state.prefixCacheMaxBytes).toBe(AX_ENGINE_PREFIX_CACHE_MAX_BYTES)
    expect((await Filesystem.readJson(AxEnginePaths.serverState)).prefixCacheMaxBytes).toBe(
      AX_ENGINE_PREFIX_CACHE_MAX_BYTES,
    )
    for (const [key, value] of Object.entries(AX_ENGINE_QWEN38_EXACT_MTP_PROFILE_ENV)) {
      expect(f.spawned[0]?.env?.[key]).toBe(value)
    }
    expect(state.qwen38ExactMtpProfile).toContain("AX_MLX_QWEN_LINEAR_MTP_EXACT=1")
    await stopServer()
  })

  test.each([
    AX_ENGINE_QWEN38_27B_AXQ_6BIT_MODEL_ID,
    `AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-6bit-MTP@${"a".repeat(40)}` as const,
  ] as const)("Qwen3.8 managed spawn injects the exact MTP profile for %s", async (modelID) => {
    await using f = await fixture()
    const input = { ...f.input, modelID }
    const state = await ensureServer(input)
    expect(f.spawned[0]?.env?.AX_MLX_QWEN_LINEAR_MTP_EXACT).toBe("1")
    expect(f.spawned[0]?.env?.AX_MLX_QWEN_LINEAR_MTP_CERTIFICATION_CANDIDATE).toBe("1")
    expect(f.spawned[0]?.env?.AX_MLX_MTP_ASYNC_DRAFT).toBe("1")
    expect(f.spawned[0]?.env?.AX_MLX_MTP_VERIFY_SUBMIT_LAYERS).toBe("8")
    expect(f.spawned[0]?.env?.AX_MLX_PIPELINE_GRANULARITY).toBe("layer")
    expect(f.spawned[0]?.env?.AX_MLX_MTP_MIN_REMAINING_TOKENS).toBe("0")
    expect(state.qwen38ExactMtpProfile).toContain("AX_MLX_MTP_ASYNC_DRAFT=1")
    expect((await ensureServer(input)).pid).toBe(state.pid)
    const previous = process.env.AX_MLX_MTP_ASYNC_DRAFT
    process.env.AX_MLX_MTP_ASYNC_DRAFT = "0"
    try {
      const restarted = await ensureServer(input)
      expect(restarted.pid).not.toBe(state.pid)
      expect(f.spawned[1]?.env?.AX_MLX_MTP_ASYNC_DRAFT).toBe("0")
      expect(restarted.qwen38ExactMtpProfile).toContain("AX_MLX_MTP_ASYNC_DRAFT=0")
      await expect(f.children[0].exited).resolves.toBeTypeOf("number")
    } finally {
      if (previous === undefined) delete process.env.AX_MLX_MTP_ASYNC_DRAFT
      else process.env.AX_MLX_MTP_ASYNC_DRAFT = previous
      await stopServer()
    }
  })

  test("changing the prefix-cache budget relaunches the managed server", async () => {
    await using f = await fixture()
    const first = await ensureServer(f.input)
    const previous = process.env[AX_MLX_PREFIX_CACHE_MAX_BYTES_ENV]
    process.env[AX_MLX_PREFIX_CACHE_MAX_BYTES_ENV] = "0"
    try {
      const second = await ensureServer(f.input)
      expect(second.pid).not.toBe(first.pid)
      expect(f.children).toHaveLength(2)
      await expect(f.children[0].exited).resolves.toBeTypeOf("number")
      expect(f.spawned[1]?.env?.[AX_MLX_PREFIX_CACHE_MAX_BYTES_ENV]).toBe("0")
      expect(second.prefixCacheMaxBytes).toBe(0)
    } finally {
      if (previous === undefined) delete process.env[AX_MLX_PREFIX_CACHE_MAX_BYTES_ENV]
      else process.env[AX_MLX_PREFIX_CACHE_MAX_BYTES_ENV] = previous
      await stopServer()
    }
  })

  test("cancelling cold startup reaps the owned process and removes its provisional record", async () => {
    await using f = await fixture("unready")
    const controller = new AbortController()
    const pending = ensureServer({ ...f.input, signal: controller.signal }).catch((error: unknown) => error)
    await vi.waitFor(async () => expect((await Filesystem.readJson(AxEnginePaths.serverState)).pid).toBeGreaterThan(0))
    const reason = new DOMException("Startup cancelled", "AbortError")
    controller.abort(reason)
    expect(await pending).toBe(reason)
    expect(f.children).toHaveLength(1)
    await expect(f.children[0].exited).resolves.toBeTypeOf("number")
    await expect(fs.access(AxEnginePaths.serverState)).rejects.toThrow()
  })

  test.each(["unready", "exit"] as const)(
    "a %s startup reports a typed failure and reaps its process",
    async (mode) => {
      await using f = await fixture(mode)
      const failure = await ensureServer({ ...f.input, readyTimeoutMs: 1_000 }).catch((error: unknown) => error)
      expect(AxEngineStartupError.isInstance(failure)).toBe(true)
      if (!AxEngineStartupError.isInstance(failure)) throw failure
      expect(failure.data.reason).toBe(mode === "exit" ? "process-exited" : "timeout")
      expect(failure.message).toContain("Startup was not retried automatically")
      expect(failure.message).toContain(f.input.modelPath)
      expect(failure.message).toContain("read access to the configured model path")
      expect(f.children).toHaveLength(1)
      await expect(f.children[0].exited).resolves.toBeTypeOf("number")
      await expect(fs.access(AxEnginePaths.serverState)).rejects.toThrow()
    },
  )

  test.each([1, 2])("cancellation during state write %s cannot hand off a cancelled start", async (abortAt) => {
    await using f = await fixture()
    const controller = new AbortController()
    const reason = new DOMException("Startup cancelled during persistence", "AbortError")
    const write = Filesystem.writeJson
    let writes = 0
    vi.spyOn(Filesystem, "writeJson").mockImplementation(async (file, content) => {
      await write(file, content)
      if (file === AxEnginePaths.serverState && ++writes === abortAt) controller.abort(reason)
    })
    await expect(ensureServer({ ...f.input, signal: controller.signal })).rejects.toBe(reason)
    expect(f.children).toHaveLength(1)
    await expect(f.children[0].exited).resolves.toBeTypeOf("number")
    await expect(fs.access(AxEnginePaths.serverState)).rejects.toThrow()
  })

  test.each([1, 2])("a failure writing server state at write %s does not orphan the child", async (failAt) => {
    await using f = await fixture()
    const write = Filesystem.writeJson
    const failure = new Error("State storage unavailable")
    let writes = 0
    vi.spyOn(Filesystem, "writeJson").mockImplementation(async (file, content) => {
      if (file === AxEnginePaths.serverState && ++writes === failAt) throw failure
      return write(file, content)
    })
    await expect(ensureServer(f.input)).rejects.toBe(failure)
    expect(f.children).toHaveLength(1)
    await vi.waitFor(() => expect(f.children[0].exitCode !== null || f.children[0].signalCode !== null).toBe(true))
    await expect(fs.access(AxEnginePaths.serverState)).rejects.toThrow()
  })
})
