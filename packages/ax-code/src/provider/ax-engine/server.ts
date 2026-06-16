import fs from "fs/promises"
import z from "zod"
import { FileLock } from "@/util/filelock"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"
import { AX_ENGINE_API_KEY, AX_ENGINE_DEFAULT_PORT, AX_ENGINE_ERROR, AX_ENGINE_MODEL_IDS } from "./constants"
import type { AxEngineModelID } from "./constants"
import { AxEnginePaths } from "./paths"

export const AxEngineServerState = z.object({
  pid: z.number().int().positive(),
  port: z.number().int().positive(),
  baseURL: z.string(),
  modelID: z.enum(AX_ENGINE_MODEL_IDS),
  apiModelID: z.string().optional(),
  modelPath: z.string(),
  modelRevision: z.string().optional(),
  binaryPath: z.string(),
  startedAt: z.number(),
  lastHealthAt: z.number().optional(),
})
export type AxEngineServerState = z.infer<typeof AxEngineServerState>

export const AxEngineServerRuntimeStatus = z.object({
  running: z.boolean(),
  ready: z.boolean(),
  state: AxEngineServerState.optional(),
  blockers: z.array(z.string()).default([]),
})
export type AxEngineServerRuntimeStatus = z.infer<typeof AxEngineServerRuntimeStatus>

export type AxEngineServerOptions = {
  binaryPath: string
  modelID: AxEngineModelID
  apiModelID: string
  modelPath: string
  modelRevision?: string
  preferredPort?: number
  baseURL?: string
  signal?: AbortSignal
}

function baseURLForPort(port: number) {
  return `http://127.0.0.1:${port}/v1`
}

function originFromBaseURL(baseURL: string) {
  const url = new URL(baseURL)
  return `${url.protocol}//${url.host}`
}

async function readServerState(): Promise<AxEngineServerState | undefined> {
  try {
    return AxEngineServerState.parse(await Filesystem.readJson(AxEnginePaths.serverState))
  } catch {
    return undefined
  }
}

async function writeServerState(state: AxEngineServerState) {
  await Filesystem.writeJson(AxEnginePaths.serverState, state)
}

async function removeServerState() {
  await fs.rm(AxEnginePaths.serverState, { force: true }).catch(() => undefined)
}

function pidLive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export async function isServerReady(baseURL: string, signal?: AbortSignal) {
  return fetch(`${baseURL.replace(/\/+$/, "")}/models`, {
    signal: signal ?? AbortSignal.timeout(2000),
    headers: { authorization: `Bearer ${AX_ENGINE_API_KEY}` },
  })
    .then((res) => {
      const ok = res.ok
      if (!ok) res.body?.cancel()
      return ok
    })
    .catch(() => false)
}

async function waitForReady(baseURL: string, signal?: AbortSignal) {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    if (signal?.aborted) return false
    if (await isServerReady(baseURL, signal)) return true
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return false
}

async function portOpen(port: number) {
  return Bun.connect({
    hostname: "127.0.0.1",
    port,
    socket: { open() {}, data() {}, close() {}, error() {} },
  })
    .then((socket) => {
      socket.end()
      return true
    })
    .catch(() => false)
}

async function selectPort(preferredPort?: number) {
  const start = preferredPort ?? AX_ENGINE_DEFAULT_PORT
  for (let port = start; port < start + 20; port++) {
    if (!(await portOpen(port))) return port
  }
  throw new Error(`${AX_ENGINE_ERROR.ServerStartFailed}: no local port available near ${start}`)
}

async function loadServerModel(input: {
  baseURL: string
  apiModelID: string
  modelPath: string
  signal?: AbortSignal
}) {
  const response = await fetch(`${input.baseURL.replace(/\/+$/, "")}/model/load`, {
    method: "POST",
    signal: input.signal ?? AbortSignal.timeout(120_000),
    headers: {
      authorization: `Bearer ${AX_ENGINE_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model_id: input.apiModelID,
      model_path: input.modelPath,
    }),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    response.body?.cancel()
    throw new Error(
      `${AX_ENGINE_ERROR.ServerStartFailed}: ax-engine model load failed with HTTP ${response.status}${text ? `: ${text}` : ""}`,
    )
  }
}

export async function getServerStatus(): Promise<AxEngineServerRuntimeStatus> {
  const state = await readServerState()
  if (!state) return { running: false, ready: false, blockers: [] }
  const running = pidLive(state.pid)
  if (!running) {
    await removeServerState()
    return { running: false, ready: false, blockers: [] }
  }
  const ready = running && (await isServerReady(state.baseURL))
  const nextState = ready ? { ...state, lastHealthAt: Date.now() } : state
  if (ready) await writeServerState(nextState).catch(() => undefined)
  return {
    running,
    ready,
    state: nextState,
    blockers: ready ? [] : [`${AX_ENGINE_ERROR.ServerHealthFailed}: ax-engine server is not ready`],
  }
}

export async function ensureServer(options: AxEngineServerOptions): Promise<AxEngineServerState> {
  using _ = await FileLock.acquire(AxEnginePaths.serverLock, { timeoutMs: 30_000, staleMs: 5 * 60_000 })
  const existing = await readServerState()
  if (existing && pidLive(existing.pid) && (await isServerReady(existing.baseURL, options.signal))) {
    if (existing.modelID === options.modelID && existing.modelPath === options.modelPath) return existing
    try {
      await loadServerModel({
        baseURL: existing.baseURL,
        apiModelID: options.apiModelID,
        modelPath: options.modelPath,
        signal: options.signal,
      })
      const nextState: AxEngineServerState = {
        ...existing,
        modelID: options.modelID,
        apiModelID: options.apiModelID,
        modelPath: options.modelPath,
        modelRevision: options.modelRevision,
        lastHealthAt: Date.now(),
      }
      await writeServerState(nextState)
      return nextState
    } catch {
      try {
        process.kill(existing.pid, "SIGTERM")
      } catch {
        // Already gone.
      }
      await removeServerState()
    }
  }

  await fs.mkdir(AxEnginePaths.state, { recursive: true })
  await fs.mkdir(AxEnginePaths.log, { recursive: true })

  const baseURL = options.baseURL?.replace(/\/+$/, "")
  const port = baseURL
    ? Number.parseInt(new URL(baseURL).port || String(AX_ENGINE_DEFAULT_PORT), 10)
    : await selectPort(options.preferredPort)
  const resolvedBaseURL = baseURL ?? baseURLForPort(port)
  const origin = originFromBaseURL(resolvedBaseURL)
  const logFile = await fs.open(AxEnginePaths.serverLog, "a")
  let proc: ReturnType<typeof Process.spawn>
  try {
    proc = Process.spawn(
      [options.binaryPath, "serve", options.modelPath, "--port", String(port), "--", "--model-id", options.apiModelID],
      {
        stdout: logFile.fd,
        stderr: logFile.fd,
        detached: true,
        abort: options.signal,
      },
    )
  } finally {
    await logFile.close().catch(() => undefined)
  }
  proc.unref?.()

  const ready = await waitForReady(resolvedBaseURL, options.signal)
  if (!ready) {
    await Process.killProcessTree(proc).catch(() => undefined)
    throw new Error(`${AX_ENGINE_ERROR.ServerHealthFailed}: ax-engine server did not become ready at ${origin}`)
  }

  const state: AxEngineServerState = {
    pid: proc.pid!,
    port,
    baseURL: resolvedBaseURL,
    modelID: options.modelID,
    apiModelID: options.apiModelID,
    modelPath: options.modelPath,
    modelRevision: options.modelRevision,
    binaryPath: options.binaryPath,
    startedAt: Date.now(),
    lastHealthAt: Date.now(),
  }
  await writeServerState(state)
  return state
}

export async function stopServer() {
  using _ = await FileLock.acquire(AxEnginePaths.serverLock, { timeoutMs: 10_000, staleMs: 60_000 })
  const state = await readServerState()
  if (state && pidLive(state.pid)) {
    try {
      process.kill(state.pid, "SIGTERM")
    } catch {
      // Already gone.
    }
  }
  await removeServerState()
}
