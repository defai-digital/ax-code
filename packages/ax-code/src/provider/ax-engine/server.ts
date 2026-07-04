import fs from "fs/promises"
import { Socket } from "node:net"
import z from "zod"
import { FileLock } from "@/util/filelock"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"
import {
  AX_ENGINE_API_KEY,
  AX_ENGINE_DEFAULT_PORT,
  AX_ENGINE_ERROR,
  AX_ENGINE_MTP_MODE,
  AX_ENGINE_MODEL_IDS,
  AX_ENGINE_SPECULATION_PROFILE,
} from "./constants"
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
  contextTokens: z.number().int().positive().optional(),
  speculationProfile: z.string().optional(),
  mtpMode: z.string().optional(),
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
  /**
   * Full context window the server should allocate, in tokens. The ax-engine
   * server has no direct context-length flag — its window is the KV-cache block
   * pool (`--total-blocks` × `--block-size-tokens`). When omitted the server
   * defaults to 1024 × 16 = 16384, which silently caps every model at 16k
   * regardless of its declared contextTokens.
   */
  contextTokens?: number
  speculationProfile?: string
  mtpMode?: string
  signal?: AbortSignal
}

// The ax-engine server sizes its context window as `--total-blocks` *
// `--block-size-tokens`. We pin the block size and derive the block count from
// the model's declared contextTokens so the server window matches what the
// prompt budgeter assumes.
const AX_ENGINE_SERVER_BLOCK_SIZE_TOKENS = 16

/**
 * Build the `ax-engine serve … -- <args>` passthrough args. When contextTokens
 * is provided, size the KV-cache block pool so the server window equals it;
 * otherwise the server falls back to its 1024×16 = 16384 default.
 */
export function axEngineServerLaunchArgs(input: {
  apiModelID: string
  contextTokens?: number
  speculationProfile?: string
  mtpMode?: string
}): string[] {
  const args = ["--model-id", input.apiModelID]
  args.push("--speculation-profile", input.speculationProfile ?? AX_ENGINE_SPECULATION_PROFILE)
  if ((input.mtpMode ?? AX_ENGINE_MTP_MODE) === "pure") {
    args.push("--mlx-mtp-disable-ngram-stacking")
  }
  if (input.contextTokens && input.contextTokens > 0) {
    const totalBlocks = Math.ceil(input.contextTokens / AX_ENGINE_SERVER_BLOCK_SIZE_TOKENS)
    args.push("--block-size-tokens", String(AX_ENGINE_SERVER_BLOCK_SIZE_TOKENS), "--total-blocks", String(totalBlocks))
  }
  return args
}

function baseURLForPort(port: number) {
  return `http://127.0.0.1:${port}/v1`
}

function originFromBaseURL(baseURL: string) {
  const url = new URL(baseURL)
  return `${url.protocol}//${url.host}`
}

async function readServerState(): Promise<{ state?: AxEngineServerState; error?: unknown }> {
  try {
    return { state: AxEngineServerState.parse(await Filesystem.readJson(AxEnginePaths.serverState)) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return {}
    return { error }
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

type WaitForReadyResult =
  | {
      ready: true
    }
  | {
      ready: false
      reason: "aborted" | "process-exited" | "timeout"
    }

type SpawnedServerProcess = Pick<ReturnType<typeof Process.spawn>, "pid" | "exitCode" | "signalCode">

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

function processHasExited(proc: SpawnedServerProcess | undefined) {
  if (!proc) return false
  if (proc.exitCode !== null && proc.exitCode !== undefined) return true
  if (proc.signalCode !== null && proc.signalCode !== undefined) return true
  return proc.pid !== undefined && !pidLive(proc.pid)
}

async function waitForReady(
  baseURL: string,
  options: {
    signal?: AbortSignal
    process?: SpawnedServerProcess
    timeoutMs?: number
  } = {},
): Promise<WaitForReadyResult> {
  const deadline = Date.now() + (options.timeoutMs ?? 90_000)
  while (Date.now() < deadline) {
    if (options.signal?.aborted) return { ready: false, reason: "aborted" }
    if (processHasExited(options.process)) return { ready: false, reason: "process-exited" }
    if (await isServerReady(baseURL, options.signal)) return { ready: true }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return { ready: false, reason: "timeout" }
}

const SERVER_LOG_EXCERPT_BYTES = 8192
const SERVER_LOG_EXCERPT_LINES = 40

async function serverLogSize() {
  try {
    return (await fs.stat(AxEnginePaths.serverLog)).size
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return 0
    return 0
  }
}

async function readServerLogExcerpt(startOffset: number) {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined
  try {
    const stat = await fs.stat(AxEnginePaths.serverLog)
    if (stat.size <= 0) return ""
    const boundedOffset = startOffset >= 0 && startOffset <= stat.size ? startOffset : 0
    const readStart = Math.max(boundedOffset, stat.size - SERVER_LOG_EXCERPT_BYTES)
    const length = Math.min(SERVER_LOG_EXCERPT_BYTES, stat.size - readStart)
    if (length <= 0) return ""
    const buffer = Buffer.alloc(length)
    handle = await fs.open(AxEnginePaths.serverLog, "r")
    const result = await handle.read(buffer, 0, length, readStart)
    return buffer
      .subarray(0, result.bytesRead)
      .toString("utf8")
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .slice(-SERVER_LOG_EXCERPT_LINES)
      .join("\n")
      .trim()
  } catch {
    return ""
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

export function formatServerStartupFailure(input: {
  code: (typeof AX_ENGINE_ERROR)[keyof typeof AX_ENGINE_ERROR]
  origin: string
  message: string
  logExcerpt?: string
}) {
  const lines = [`${input.code}: ${input.message} at ${input.origin}`]
  if (input.logExcerpt) lines.push("Recent ax-engine server log:", input.logExcerpt)
  return lines.join("\n")
}

async function portOpen(port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = new Socket()

    socket.setTimeout(1000)
    socket.on("connect", () => {
      socket.end()
      resolve(true)
    })
    socket.on("error", () => {
      resolve(false)
    })
    socket.on("timeout", () => {
      socket.destroy()
      resolve(false)
    })
    socket.connect(port, "127.0.0.1")
  })
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
  const stateResult = await readServerState()
  if (stateResult.error) {
    return {
      running: false,
      ready: false,
      blockers: [`${AX_ENGINE_ERROR.ServerHealthFailed}: failed to read server state`],
    }
  }
  const state = stateResult.state
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

// A single user message resolves the ax-engine model more than once at the same
// time (the main completion and prompt-title generation both call getModel ->
// ensureReady -> ensureServer). FileLock is not reentrant — maybeSteal refuses
// to steal a lock held by the current pid — so without coalescing the second
// concurrent caller blocks on a lock its own process holds and times out during
// the slow first model load ("timed out waiting for file lock: server.lock").
// Collapse same-process starts that target the same server identity into one
// shared start; distinct models still serialize on the cross-process file lock.
const inflightEnsure = new Map<string, Promise<AxEngineServerState>>()

function ensureServerKey(options: AxEngineServerOptions): string {
  return [
    options.modelID,
    options.modelPath,
    options.apiModelID,
    options.contextTokens ?? "",
    options.speculationProfile ?? "",
    options.mtpMode ?? "",
    options.baseURL ?? "",
  ].join("::")
}

export async function ensureServer(options: AxEngineServerOptions): Promise<AxEngineServerState> {
  const key = ensureServerKey(options)
  const existing = inflightEnsure.get(key)
  if (existing) return existing
  const started = ensureServerLocked(options)
  inflightEnsure.set(key, started)
  try {
    return await started
  } finally {
    inflightEnsure.delete(key)
  }
}

async function ensureServerLocked(options: AxEngineServerOptions): Promise<AxEngineServerState> {
  // Held across the entire cold start: process spawn + up to 90s readiness wait,
  // or up to 120s model reload. Wait well past that worst case so a genuine
  // cross-process start (e.g. the desktop server alongside a CLI) queues instead
  // of failing at 30s; a dead holder is still reclaimed immediately via the
  // staleMs / pid-liveness checks inside FileLock.
  using _ = await FileLock.acquire(AxEnginePaths.serverLock, { timeoutMs: 180_000, staleMs: 5 * 60_000 })
  const existingResult = await readServerState()
  if (existingResult.error) {
    throw new Error(`${AX_ENGINE_ERROR.ServerStartFailed}: failed to read server state`)
  }
  const existing = existingResult.state
  // The context window is fixed at launch (KV-cache block pool), so a running
  // server whose contextTokens differ from the request — e.g. an older build
  // that started it at the default 16384 — must be relaunched, not reused.
  const contextMatches = (existing?.contextTokens ?? undefined) === (options.contextTokens ?? undefined)
  const speculationProfile = options.speculationProfile ?? AX_ENGINE_SPECULATION_PROFILE
  const mtpMode = options.mtpMode ?? AX_ENGINE_MTP_MODE
  const speculationMatches = existing?.speculationProfile === speculationProfile
  const mtpModeMatches = existing?.mtpMode === mtpMode
  if (existing && pidLive(existing.pid) && (await isServerReady(existing.baseURL, options.signal))) {
    if (contextMatches && speculationMatches && mtpModeMatches) {
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
          speculationProfile,
          mtpMode,
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
    } else {
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
  const serverLogStart = await serverLogSize()
  const logFile = await fs.open(AxEnginePaths.serverLog, "a")
  const serverArgs = axEngineServerLaunchArgs({
    apiModelID: options.apiModelID,
    contextTokens: options.contextTokens,
    speculationProfile,
    mtpMode,
  })
  let proc: ReturnType<typeof Process.spawn>
  try {
    proc = Process.spawn(
      [options.binaryPath, "serve", options.modelPath, "--port", String(port), "--", ...serverArgs],
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

  const ready = await waitForReady(resolvedBaseURL, { signal: options.signal, process: proc })
  if (!ready.ready) {
    await Process.killProcessTree(proc).catch(() => undefined)
    if (ready.reason === "aborted") options.signal?.throwIfAborted()
    const logExcerpt = await readServerLogExcerpt(serverLogStart)
    const code =
      ready.reason === "process-exited" ? AX_ENGINE_ERROR.ServerStartFailed : AX_ENGINE_ERROR.ServerHealthFailed
    const message =
      ready.reason === "process-exited"
        ? "ax-engine server exited before becoming ready"
        : "ax-engine server did not become ready"
    throw new Error(formatServerStartupFailure({ code, origin, message, logExcerpt }))
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
    contextTokens: options.contextTokens,
    speculationProfile,
    mtpMode,
    startedAt: Date.now(),
    lastHealthAt: Date.now(),
  }
  await writeServerState(state)
  return state
}

export async function stopServer() {
  using _ = await FileLock.acquire(AxEnginePaths.serverLock, { timeoutMs: 10_000, staleMs: 60_000 })
  const stateResult = await readServerState()
  if (stateResult.error) {
    throw new Error(`${AX_ENGINE_ERROR.ServerHealthFailed}: failed to read server state`)
  }
  const state = stateResult.state
  if (state && pidLive(state.pid)) {
    try {
      process.kill(state.pid, "SIGTERM")
    } catch {
      // Already gone.
    }
  }
  await removeServerState()
}
