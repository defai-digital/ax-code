import fs from "fs/promises"
import path from "path"
import { Socket } from "node:net"
import semver from "semver"
import z from "zod"
import { FileLock } from "@/util/filelock"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"
import { Env } from "@/util/env"
import { Log } from "@/util/log"
import {
  AX_ENGINE_DEFAULT_MAX_CONCURRENT_REQUESTS,
  AX_ENGINE_DEFAULT_MAX_OUTPUT_TOKENS,
  AX_ENGINE_DEFAULT_PORT,
  AX_ENGINE_ERROR,
  AX_ENGINE_MAX_OUTPUT_TOKENS_FLAG_MIN_VERSION,
  AX_ENGINE_MTP_MODE,
  AX_ENGINE_MODEL_IDS,
  AX_ENGINE_SPECULATION_PROFILE,
  resolveAxEngineApiKey,
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
  maxOutputTokens: z.number().int().positive().optional(),
  maxOutputTokensFlag: z.boolean().optional(),
  maxConcurrentRequests: z.number().int().positive().optional(),
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

const log = Log.create({ service: "ax-engine.server" })

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
  /**
   * Per-request output-token budget the server enforces (`--max-batch-tokens`).
   * Must match the catalog's per-model outputTokens: a 16k-context model
   * launched at the 8192 default only leaves ~7.4k usable input tokens, which
   * the preflight fit check then (correctly) blocks as unfit for the agent.
   */
  maxOutputTokens?: number
  /**
   * Detected ax-engine binary version (from dependency status). Gates the
   * --max-output-tokens flag: binaries at or above
   * AX_ENGINE_MAX_OUTPUT_TOKENS_FLAG_MIN_VERSION accept the split knob.
   */
  binaryVersion?: string
  /**
   * In-flight requests the server may run at once. Defaults to 1 — AX Code
   * owns one foreground agent stream, and serializing engine jobs keeps a
   * cancelled stream from racing a retry against shared prefix/speculation
   * state. Higher values are an opt-in for high-memory hosts.
   */
  maxConcurrentRequests?: number
  speculationProfile?: string
  mtpMode?: string
  apiKey?: string
  signal?: AbortSignal
  /** Override for the readiness wait (default 240s); primarily a test seam. */
  readyTimeoutMs?: number
}

// The ax-engine server sizes its context window as `--total-blocks` *
// `--block-size-tokens`. We pin the block size and derive the block count from
// the model's declared contextTokens so the server window matches what the
// prompt budgeter assumes.
const AX_ENGINE_SERVER_BLOCK_SIZE_TOKENS = 16

/**
 * Whether the resolved ax-engine binary accepts --max-output-tokens (the
 * advertised per-request output budget, split from --max-batch-tokens
 * scheduler width). Unknown/unparseable versions stay on the conflated knob,
 * which every supported binary accepts.
 */
export function supportsMaxOutputTokensFlag(binaryVersion: string | undefined): boolean {
  const parsed = binaryVersion ? semver.coerce(binaryVersion) : undefined
  return parsed ? semver.gte(parsed, AX_ENGINE_MAX_OUTPUT_TOKENS_FLAG_MIN_VERSION) : false
}

/**
 * Build the `ax-engine serve … -- <args>` passthrough args. When contextTokens
 * is provided, size the KV-cache block pool so the server window equals it;
 * otherwise the server falls back to its 1024×16 = 16384 default.
 */
export function axEngineServerLaunchArgs(input: {
  apiModelID: string
  contextTokens?: number
  maxOutputTokens?: number
  binaryVersion?: string
  maxConcurrentRequests?: number
  speculationProfile?: string
  mtpMode?: string
}): string[] {
  const args = ["--model-id", input.apiModelID]
  args.push("--speculation-profile", input.speculationProfile ?? AX_ENGINE_SPECULATION_PROFILE)
  const maxOutputTokens = input.maxOutputTokens ?? AX_ENGINE_DEFAULT_MAX_OUTPUT_TOKENS
  if (supportsMaxOutputTokensFlag(input.binaryVersion)) {
    // Split-knob servers: scheduler width stays at the benchmark-tuned default
    // while the advertised per-request output budget follows the model catalog.
    args.push("--max-batch-tokens", String(AX_ENGINE_DEFAULT_MAX_OUTPUT_TOKENS))
    args.push("--max-output-tokens", String(maxOutputTokens))
  } else {
    // Older binaries only know the conflated knob: --max-batch-tokens doubles
    // as the advertised output budget, so it must carry the per-model value.
    args.push("--max-batch-tokens", String(maxOutputTokens))
  }
  // Match AX Studio's validated posture: packaged MTP remains available, while
  // the independent n-gram draft path is disabled for stable direct fallback.
  args.push("--disable-ngram-acceleration")
  // AX Code defaults to one foreground agent stream at a time. Serializing
  // engine jobs prevents a cancelled stream from racing a retry against shared
  // prefix/speculation state; higher values are an explicit opt-in.
  const maxConcurrentRequests = input.maxConcurrentRequests ?? AX_ENGINE_DEFAULT_MAX_CONCURRENT_REQUESTS
  args.push("--max-concurrent-requests", String(maxConcurrentRequests))
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

// `kill(pid, 0)` only proves *some* process owns the pid — after a reboot or
// pid recycling it can be an unrelated process. Before trusting (or, worse,
// killing) a pid recorded in server.json, require the command line to look like
// the serve invocation we spawn (`<binary> serve <modelPath> …`), not merely
// any process whose argv or cwd path mentions "ax-engine" (e.g. `tail -f
// …/ax-engine/server.log`, an editor on a path under ax-engine, grep, etc.).
function tokenLooksLikeAxEngineBinary(token: string, binaryPath?: string): boolean {
  const base = path.basename(token)
  if (binaryPath && (token === binaryPath || base === path.basename(binaryPath))) return true
  // Managed/path installs and test fixtures use names like `ax-engine` or
  // `ax-engine-exits`; require the basename, not a path *containing* ax-engine.
  return base === "ax-engine" || /^ax-engine[-_.]/.test(base)
}

export function commandLooksLikeAxEngineServer(command: string, binaryPath?: string): boolean {
  const tokens = command.trim().split(/\s+/).filter(Boolean)
  if (tokens.length < 2) return false

  // The `ax-engine serve` launcher execs the native sibling binary after it
  // resolves the model. server.json therefore records a pid whose command is
  // `ax-engine-server --port … --mlx-model-artifacts-dir …`, not necessarily
  // the original wrapper command containing the `serve` token. Require the
  // real server basename in argv0 plus the launch-defining flags so an editor,
  // grep, or log tail that merely mentions the name cannot be signalled.
  const first = path.basename(tokens[0]!)
  if (first === "ax-engine-server" || /^ax-engine-server[-_.]/.test(first)) {
    return (
      tokens.includes("--port") &&
      tokens.includes("--model-id") &&
      (tokens.includes("--mlx-model-artifacts-dir") || tokens.includes("--llama-model-path"))
    )
  }

  const serveIndex = tokens.findIndex((token) => token === "serve")
  // Real servers always pass a model path (and usually flags) after `serve`.
  if (serveIndex <= 0 || serveIndex >= tokens.length - 1) return false

  // macOS `ps` often shows shell-script servers as `/bin/sh <script> serve …`
  // rather than `<script> serve …`. Accept either argv0 or the token immediately
  // before `serve` as the engine binary — never a bare substring anywhere in argv.
  const candidates = [tokens[0]!, tokens[serveIndex - 1]!].filter(Boolean)
  return candidates.some((token) => tokenLooksLikeAxEngineBinary(token, binaryPath))
}

async function pidIsAxEngineServer(pid: number, binaryPath?: string): Promise<boolean> {
  const result = await Process.text(["ps", "-o", "command=", "-p", String(pid)], { timeout: 3000, nothrow: true })
  if (result.code !== 0) return false
  const command = result.text.trim()
  if (!command) return false
  return commandLooksLikeAxEngineServer(command, binaryPath)
}

async function serverProcessAlive(state: Pick<AxEngineServerState, "pid" | "binaryPath">): Promise<boolean> {
  return pidLive(state.pid) && (await pidIsAxEngineServer(state.pid, state.binaryPath))
}

const SERVER_EXIT_GRACE_MS = 5_000

async function waitForPidExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!pidLive(pid)) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return !pidLive(pid)
}

// SIGTERM the recorded server and wait for it to actually exit, escalating to
// SIGKILL after a grace period. Waiting matters: respawning while the old
// process is still dying leaves two multi-GB model servers transiently
// resident (an OOM risk on exactly the machines local inference targets) and
// lets the dying process keep holding the preferred port. Never signals a pid
// whose command line no longer looks like ax-engine, so a recycled pid is
// never killed.
async function terminateServerProcess(state: Pick<AxEngineServerState, "pid" | "binaryPath">): Promise<void> {
  if (!(await serverProcessAlive(state))) return
  try {
    process.kill(state.pid, "SIGTERM")
  } catch {
    return
  }
  if (await waitForPidExit(state.pid, SERVER_EXIT_GRACE_MS)) return
  try {
    process.kill(state.pid, "SIGKILL")
  } catch {
    return
  }
  await waitForPidExit(state.pid, 2_000)
}

type WaitForReadyResult =
  | {
      ready: true
    }
  | {
      ready: false
      reason: "aborted" | "process-exited" | "timeout"
    }

type SpawnedServerProcess = Pick<ReturnType<typeof Process.spawn>, "pid" | "exitCode" | "signalCode" | "exited">

export async function isServerReady(baseURL: string, signal?: AbortSignal, apiKey = resolveAxEngineApiKey()) {
  // Every probe gets its own 2s timeout even when a caller signal is provided;
  // otherwise a wedged accept loop can hang a single fetch indefinitely —
  // waitForReady's deadline is only checked between polls.
  const probeSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(2000)]) : AbortSignal.timeout(2000)
  return fetch(`${baseURL.replace(/\/+$/, "")}/models`, {
    signal: probeSignal,
    headers: { authorization: `Bearer ${apiKey}` },
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
    apiKey?: string
  } = {},
): Promise<WaitForReadyResult> {
  // Cold-loading a local model (mmap + weight load + first-token warmup for a
  // 12B-35B param model) can legitimately take minutes, not seconds.
  // session/llm-impl.ts gives the ax-engine provider a 300s outer setup
  // envelope specifically to cover this — keep this default comfortably under
  // that so a slow-but-successful start isn't cut off here first, before the
  // outer envelope ever gets a chance to matter.
  const deadline = Date.now() + (options.timeoutMs ?? 240_000)
  // Detached/unref'd children do not update exitCode reliably on every
  // supported Node release. Process.spawn's exited promise is driven by the
  // child "exit" event, so track it as an authoritative second signal.
  let observedProcessExit = processHasExited(options.process)
  void options.process?.exited.then(
    () => {
      observedProcessExit = true
    },
    () => {
      observedProcessExit = true
    },
  )
  const processExited = () => observedProcessExit || processHasExited(options.process)
  while (Date.now() < deadline) {
    if (options.signal?.aborted) return { ready: false, reason: "aborted" }
    if (processExited()) return { ready: false, reason: "process-exited" }
    if (await isServerReady(baseURL, options.signal, options.apiKey)) return { ready: true }
    // A child can exit while the final health probe is waiting on its own
    // timeout. Re-check before classifying the overall wait as a health
    // timeout; otherwise fast startup failures race with the deadline and are
    // intermittently reported as AX_ENGINE_SERVER_HEALTH_FAILED.
    if (processExited()) return { ready: false, reason: "process-exited" }
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    await new Promise((resolve) => setTimeout(resolve, Math.min(500, remaining)))
  }
  if (options.signal?.aborted) return { ready: false, reason: "aborted" }
  if (processExited()) return { ready: false, reason: "process-exited" }
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
    handle = await fs.open(AxEnginePaths.serverLog, "r")
    const stat = await handle.stat()
    if (stat.size <= 0) return ""
    const boundedOffset = startOffset >= 0 && startOffset <= stat.size ? startOffset : 0
    const readStart = Math.max(boundedOffset, stat.size - SERVER_LOG_EXCERPT_BYTES)
    const length = Math.min(SERVER_LOG_EXCERPT_BYTES, stat.size - readStart)
    if (length <= 0) return ""
    const buffer = Buffer.alloc(length)
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
  apiKey?: string
  signal?: AbortSignal
}) {
  const response = await fetch(`${input.baseURL.replace(/\/+$/, "")}/model/load`, {
    method: "POST",
    signal: input.signal ?? AbortSignal.timeout(120_000),
    headers: {
      authorization: `Bearer ${input.apiKey ?? resolveAxEngineApiKey()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model_id: input.apiModelID,
      model_path: input.modelPath,
      // Managed mode runs a single resident model per host. Without this the
      // server defaults to availability-first replacement, which builds the
      // incoming model BESIDE the outgoing one — transient dual residency of
      // two 27B-class weight sets (plus KV/compile state) on a unified-memory
      // Mac. memory_constrained drains first and rolls back on failure.
      load_policy: "memory_constrained",
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

export async function getServerStatus(apiKey = resolveAxEngineApiKey()): Promise<AxEngineServerRuntimeStatus> {
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
  const running = await serverProcessAlive(state)
  if (!running) {
    await removeServerState()
    return { running: false, ready: false, blockers: [] }
  }
  const ready = running && (await isServerReady(state.baseURL, undefined, apiKey))
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
    options.maxOutputTokens ?? "",
    options.maxConcurrentRequests ?? AX_ENGINE_DEFAULT_MAX_CONCURRENT_REQUESTS,
    options.binaryVersion ?? "",
    options.speculationProfile ?? "",
    options.mtpMode ?? "",
    options.baseURL ?? "",
    options.apiKey ?? "",
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
  // Held across the entire cold start: process spawn + up to 240s readiness wait
  // (see waitForReady), or up to 120s model reload. Wait well past that worst
  // case so a genuine cross-process start (e.g. the desktop server alongside a
  // CLI) queues instead of failing while the first holder is still legitimately
  // loading the model; a dead holder is still reclaimed immediately via the
  // staleMs / pid-liveness checks inside FileLock. Previously this was 180_000,
  // shorter than waitForReady's 240_000 — any second caller queued behind a
  // slow cold load would hit "timed out waiting for file lock" well before the
  // first start ever finished, surfacing as "start never works".
  using _ = await FileLock.acquire(AxEnginePaths.serverLock, { timeoutMs: 260_000, staleMs: 5 * 60_000 })
  const existingResult = await readServerState()
  if (existingResult.error) {
    throw new Error(`${AX_ENGINE_ERROR.ServerStartFailed}: failed to read server state`)
  }
  const existing = existingResult.state
  // The context window is fixed at launch (KV-cache block pool), so a running
  // server whose contextTokens differ from the request — e.g. an older build
  // that started it at the default 16384 — must be relaunched, not reused.
  const contextMatches = (existing?.contextTokens ?? undefined) === (options.contextTokens ?? undefined)
  const maxOutputTokens = options.maxOutputTokens ?? AX_ENGINE_DEFAULT_MAX_OUTPUT_TOKENS
  // State files written before maxOutputTokens was recorded predate per-model
  // output budgets; treat them as mismatched so the server is relaunched once
  // with the correct --max-batch-tokens instead of silently reusing a server
  // whose output budget belongs to a different model.
  const maxOutputTokensMatches = existing?.maxOutputTokens === maxOutputTokens
  // The launch shape also depends on whether the binary takes the split
  // --max-output-tokens flag; a binary upgrade must relaunch the server even
  // when the model budget itself is unchanged. Pre-flag state files default
  // to the conflated mode they were launched with.
  const maxOutputTokensFlag = supportsMaxOutputTokensFlag(options.binaryVersion)
  const maxOutputTokensFlagMatches = (existing?.maxOutputTokensFlag ?? false) === maxOutputTokensFlag
  // The concurrency cap is fixed at launch (--max-concurrent-requests), so a
  // running server started with a different value must be relaunched, not
  // reused. State files predating this field were launched at the default.
  const maxConcurrentRequests = options.maxConcurrentRequests ?? AX_ENGINE_DEFAULT_MAX_CONCURRENT_REQUESTS
  const maxConcurrentRequestsMatches =
    (existing?.maxConcurrentRequests ?? AX_ENGINE_DEFAULT_MAX_CONCURRENT_REQUESTS) === maxConcurrentRequests
  const speculationProfile = options.speculationProfile ?? AX_ENGINE_SPECULATION_PROFILE
  const mtpMode = options.mtpMode ?? AX_ENGINE_MTP_MODE
  const speculationMatches = existing?.speculationProfile === speculationProfile
  const mtpModeMatches = existing?.mtpMode === mtpMode
  if (existing) {
    const alive = await serverProcessAlive(existing)
    if (alive && (await isServerReady(existing.baseURL, options.signal, options.apiKey))) {
      if (
        contextMatches &&
        maxOutputTokensMatches &&
        maxOutputTokensFlagMatches &&
        maxConcurrentRequestsMatches &&
        speculationMatches &&
        mtpModeMatches
      ) {
        if (existing.modelID === options.modelID && existing.modelPath === options.modelPath) return existing
        try {
          await loadServerModel({
            baseURL: existing.baseURL,
            apiModelID: options.apiModelID,
            modelPath: options.modelPath,
            apiKey: options.apiKey,
            signal: options.signal,
          })
          const nextState: AxEngineServerState = {
            ...existing,
            modelID: options.modelID,
            apiModelID: options.apiModelID,
            modelPath: options.modelPath,
            modelRevision: options.modelRevision,
            maxOutputTokens,
            maxOutputTokensFlag,
            maxConcurrentRequests,
            speculationProfile,
            mtpMode,
            lastHealthAt: Date.now(),
          }
          await writeServerState(nextState)
          return nextState
        } catch {
          await terminateServerProcess(existing)
          await removeServerState()
        }
      } else {
        // The concurrency cap is fixed at launch, so changing
        // maxConcurrentRequests (or any other launch param) only takes effect
        // through this relaunch. Name the mismatched fields — without this,
        // "the server is still running with the old value" is undebuggable.
        log.info("relaunching ax-engine server: launch parameters changed", {
          pid: existing.pid,
          mismatches: [
            !contextMatches ? `contextTokens: ${existing.contextTokens} -> ${options.contextTokens}` : undefined,
            !maxOutputTokensMatches ? `maxOutputTokens: ${existing.maxOutputTokens} -> ${maxOutputTokens}` : undefined,
            !maxOutputTokensFlagMatches ? "maxOutputTokensFlag changed" : undefined,
            !maxConcurrentRequestsMatches
              ? `maxConcurrentRequests: ${existing.maxConcurrentRequests ?? AX_ENGINE_DEFAULT_MAX_CONCURRENT_REQUESTS} -> ${maxConcurrentRequests}`
              : undefined,
            !speculationMatches
              ? `speculationProfile: ${existing.speculationProfile} -> ${speculationProfile}`
              : undefined,
            !mtpModeMatches ? `mtpMode: ${existing.mtpMode} -> ${mtpMode}` : undefined,
          ].filter(Boolean),
        })
        await terminateServerProcess(existing)
        await removeServerState()
      }
    } else {
      // Live-but-not-ready: the server lock is ours, so no live caller is
      // waiting on this server — it is wedged, orphaned mid-startup by a
      // caller that died, or a recycled pid. Clear it out before starting
      // fresh so two model servers never run at once (previously this path
      // spawned a duplicate over the old process). terminateServerProcess
      // no-ops for dead or foreign pids.
      await terminateServerProcess(existing)
      await removeServerState()
    }
  }

  await fs.mkdir(AxEnginePaths.state, { recursive: true })
  await fs.mkdir(AxEnginePaths.log, { recursive: true })
  await fs.mkdir(AxEnginePaths.prefixCache, { recursive: true })

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
    maxOutputTokens,
    binaryVersion: options.binaryVersion,
    maxConcurrentRequests,
    speculationProfile,
    mtpMode,
  })
  log.info("starting ax-engine server", {
    port,
    modelID: options.modelID,
    contextTokens: options.contextTokens,
    maxOutputTokens,
    maxConcurrentRequests,
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
        // The native server reads AX_ENGINE_API_KEY when --api-key is omitted.
        // Inject the resolved provider value so configured credentials and
        // client probes always agree without exposing the secret in `ps`.
        env: {
          ...Env.sanitize(process.env),
          AX_ENGINE_API_KEY: options.apiKey ?? resolveAxEngineApiKey(),
          // Durable L2 prefix cache: hot-swaps and restarts discard the
          // in-memory store; without this, switching back to a 27B model
          // re-prefills the full conversation (~40k tokens at ~170 tok/s).
          AX_MLX_PREFIX_CACHE_DIR: AxEnginePaths.prefixCache,
        },
      },
    )
  } finally {
    await logFile.close().catch(() => undefined)
  }
  proc.unref?.()

  // Record the spawned (detached, unref'd) server before the readiness wait —
  // a cold model load can take minutes, and if this process dies during it the
  // engine would otherwise become an invisible multi-GB orphan that nothing
  // can discover or stop. With the record in place, the next ensureServer or
  // stopServer finds it via server.json and reclaims it.
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
    maxOutputTokens,
    maxOutputTokensFlag,
    maxConcurrentRequests,
    speculationProfile,
    mtpMode,
    startedAt: Date.now(),
  }
  await writeServerState(state)

  const ready = await waitForReady(resolvedBaseURL, {
    signal: options.signal,
    process: proc,
    timeoutMs: options.readyTimeoutMs,
    apiKey: options.apiKey,
  })
  if (!ready.ready) {
    await Process.killProcessTree(proc).catch(() => undefined)
    await removeServerState()
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

  const readyState: AxEngineServerState = { ...state, lastHealthAt: Date.now() }
  await writeServerState(readyState)
  return readyState
}

export async function stopServer() {
  // staleMs must tolerate the longest legitimate serverLock hold: FileLock
  // steals by lockfile age using the *acquirer's* staleMs, and a cold start
  // legitimately holds this lock for up to ~240s of readiness waiting. The
  // previous 60s here let a concurrent stop steal the lock and delete
  // server.json out from under a still-loading start. Dead holders are
  // reclaimed immediately via FileLock's pid-liveness check regardless.
  using _ = await FileLock.acquire(AxEnginePaths.serverLock, { timeoutMs: 10_000, staleMs: 5 * 60_000 })
  const stateResult = await readServerState()
  if (stateResult.error) {
    throw new Error(`${AX_ENGINE_ERROR.ServerHealthFailed}: failed to read server state`)
  }
  const state = stateResult.state
  if (state) await terminateServerProcess(state)
  await removeServerState()
}
