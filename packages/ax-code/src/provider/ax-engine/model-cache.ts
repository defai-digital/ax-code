import fs from "fs/promises"
import path from "path"
import z from "zod"
import { FileLock } from "@/util/filelock"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"
import { parseJsonResult } from "@/util/json-value"
import { toErrorMessage } from "@/util/error-message"
import {
  AX_ENGINE_DEFAULT_MODEL_ID,
  AX_ENGINE_ERROR,
  AX_ENGINE_MODEL_DEFINITIONS,
  AX_ENGINE_MODEL_IDS,
  AX_ENGINE_QUANTIZATION_IDS,
  AX_ENGINE_DEFAULT_QUANTIZATION,
  isAxEngineModelID,
} from "./constants"
import type { AxEngineModelID, AxEngineQuantization } from "./constants"
import { AxEnginePaths } from "./paths"
import { axEngineDownloadEnv } from "./python"
import {
  applyProgressEvent,
  parseGiBTotalFromMessage,
  parseProgressJsonLine,
  progressFromCacheBytes,
  type AxEngineDownloadProgress,
} from "./download-progress"
import { HfCache } from "./hf-cache"
import { Log } from "@/util/log"
import type { Readable } from "node:stream"
import fsSync from "fs"

const log = Log.create({ service: "ax-engine-model-cache" })

// Longest a model download is allowed to run.
const DOWNLOAD_TIMEOUT_MS = 6 * 60 * 60 * 1000

// FileLock steals by lockfile age using the *acquirer's* staleMs — a live
// holder's lock is taken once it is older than whatever the next caller
// passes. Every prepareLock acquirer must therefore tolerate the longest
// legitimate hold (a full model download), or a quick caller (markPrepared,
// reclaim) would steal the lock from a download in progress and break the
// serialization it exists for. Dead holders are still reclaimed immediately
// via FileLock's pid-liveness check regardless of this value.
const PREPARE_LOCK_STALE_MS = DOWNLOAD_TIMEOUT_MS + 30 * 60 * 1000

// The Hugging Face repo that backs a model+quantization, used to locate the
// shared snapshot the engine downloaded.
export function hfRepoFor(modelID: AxEngineModelID, quantization: AxEngineQuantization): string | undefined {
  const model = AX_ENGINE_MODEL_DEFINITIONS[modelID]
  return model.quantizations[quantization as keyof typeof model.quantizations]?.hfRepo
}

export const AxEngineModelStatus = z.object({
  present: z.boolean(),
  modelID: z.enum(AX_ENGINE_MODEL_IDS),
  quantization: z.enum(AX_ENGINE_QUANTIZATION_IDS),
  path: z.string().optional(),
  revision: z.string().optional(),
  bytes: z.number().optional(),
  complete: z.boolean().default(false),
  blockers: z.array(z.string()).default([]),
})
export type AxEngineModelStatus = z.infer<typeof AxEngineModelStatus>

export const AxEnginePrepareState = z.object({
  modelID: z.enum(AX_ENGINE_MODEL_IDS),
  quantization: z.enum(AX_ENGINE_QUANTIZATION_IDS),
  path: z.string(),
  revision: z.string().optional(),
  preparedAt: z.number(),
})
export type AxEnginePrepareState = z.infer<typeof AxEnginePrepareState>

export const AxEngineDiskStatus = z.object({
  path: z.string(),
  modelID: z.enum(AX_ENGINE_MODEL_IDS),
  quantization: z.enum(AX_ENGINE_QUANTIZATION_IDS),
  freeBytes: z.number().optional(),
  requiredBytes: z.number(),
  ok: z.boolean(),
  blockers: z.array(z.string()).default([]),
})
export type AxEngineDiskStatus = z.infer<typeof AxEngineDiskStatus>

export type AxEngineModelOptions = {
  modelID?: unknown
  modelPath?: unknown
  quantization?: unknown
  downloadDir?: unknown
  [key: string]: unknown
}

export function normalizeModelID(value: unknown): AxEngineModelID {
  return isAxEngineModelID(value) ? value : AX_ENGINE_DEFAULT_MODEL_ID
}

export function normalizeQuantization(
  value: unknown,
  modelID: AxEngineModelID = AX_ENGINE_DEFAULT_MODEL_ID,
): AxEngineQuantization {
  const model = AX_ENGINE_MODEL_DEFINITIONS[modelID]
  // `in` walks the prototype chain, so "toString"/"constructor" would pass —
  // restrict to own keys of the quantization map.
  if (typeof value === "string" && Object.hasOwn(model.quantizations, value)) return value as AxEngineQuantization
  return model.defaultQuantization
}

async function exists(file: string) {
  return fs
    .stat(file)
    .then(() => true)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false
      throw error
    })
}

async function directorySize(dir: string): Promise<number | undefined> {
  // HF snapshots are symlink farms into blobs/ — following links (deduped by
  // real path so a blob is only counted once) is what makes the reported model
  // size real instead of the few KB of link entries.
  let total = 0
  const seen = new Set<string>()
  async function walk(current: string) {
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const p = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(p)
        continue
      }
      const real = await fs.realpath(p).catch(() => undefined)
      if (!real || seen.has(real)) continue
      seen.add(real)
      const stat = await fs.stat(real).catch(() => undefined)
      if (stat?.isFile()) total += stat.size
    }
  }
  try {
    await walk(dir)
    return total
  } catch {
    return undefined
  }
}

export function requiredDiskBytes(modelID: AxEngineModelID, quantization: AxEngineQuantization): number {
  const model = AX_ENGINE_MODEL_DEFINITIONS[modelID]
  return model.quantizations[quantization as keyof typeof model.quantizations]?.minDiskBytes ?? 64 * 1024 ** 3
}

export function resolveDownloadDestination(
  modelID: AxEngineModelID,
  quantization: AxEngineQuantization,
  dest?: string,
) {
  return dest ?? AxEnginePaths.managedModelDir(modelID, quantization)
}

export function parseDfPkAvailableBytes(text: string): number | undefined {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const dataLine = lines.at(-1)
  if (!dataLine || lines.length < 2) return undefined
  const columns = dataLine.split(/\s+/)
  const available = columns[3]
  if (available === undefined || !/^\d+$/.test(available)) return undefined
  const availableBlocks = Number(available)
  if (!Number.isSafeInteger(availableBlocks)) return undefined
  return availableBlocks * 1024
}

export function evaluateDiskStatus(input: {
  path: string
  modelID?: AxEngineModelID
  quantization?: AxEngineQuantization
  freeBytes?: number
  requiredBytes?: number
}): AxEngineDiskStatus {
  const modelID = input.modelID ?? AX_ENGINE_DEFAULT_MODEL_ID
  const quantization = input.quantization ?? AX_ENGINE_DEFAULT_QUANTIZATION
  const requiredBytes = input.requiredBytes ?? requiredDiskBytes(modelID, quantization)
  const blockers: string[] = []

  if (input.freeBytes === undefined) {
    blockers.push(`${AX_ENGINE_ERROR.InsufficientDisk}: could not determine free disk space at ${input.path}`)
  } else if (input.freeBytes < requiredBytes) {
    blockers.push(
      `${AX_ENGINE_ERROR.InsufficientDisk}: ${Math.ceil(requiredBytes / 1024 ** 3)} GiB free is required for ${quantization}`,
    )
  }

  return {
    path: input.path,
    modelID,
    quantization,
    freeBytes: input.freeBytes,
    requiredBytes,
    ok: blockers.length === 0,
    blockers,
  }
}

export async function getDiskStatus(options: AxEngineModelOptions = {}): Promise<AxEngineDiskStatus> {
  const modelID = normalizeModelID(options.modelID)
  const quantization = normalizeQuantization(options.quantization, modelID)
  const target =
    typeof options.downloadDir === "string" && options.downloadDir.trim() ? options.downloadDir.trim() : HfCache.root()
  let freeBytes: number | undefined
  try {
    await fs.mkdir(target, { recursive: true })
    const result = await Process.text(["df", "-Pk", target], { nothrow: true })
    freeBytes = result.code === 0 ? parseDfPkAvailableBytes(result.text) : undefined
  } catch (error) {
    log.warn("failed to inspect ax-engine model cache disk", {
      path: target,
      error: toErrorMessage(error),
    })
  }
  return evaluateDiskStatus({
    path: target,
    modelID,
    quantization,
    freeBytes,
  })
}

async function assertDiskSpace(options: AxEngineModelOptions = {}): Promise<AxEngineDiskStatus> {
  const status = await getDiskStatus(options)
  if (!status.ok) {
    throw new Error(status.blockers.join("; "))
  }
  return status
}

async function hasManifest(dir: string) {
  return exists(path.join(dir, "model-manifest.json"))
}

function packageMarkerFor(modelID: AxEngineModelID, quantization: AxEngineQuantization) {
  return AX_ENGINE_MODEL_DEFINITIONS[modelID].quantizations[quantization]?.packageMarker
}

function allowsDirectFallback(modelID: AxEngineModelID, quantization: AxEngineQuantization) {
  return AX_ENGINE_MODEL_DEFINITIONS[modelID].quantizations[quantization]?.directFallback ?? false
}

async function hasPackageMarker(dir: string, modelID: AxEngineModelID, quantization: AxEngineQuantization) {
  const marker = packageMarkerFor(modelID, quantization)
  return !marker || (await exists(path.join(dir, marker)))
}

async function hasRunnablePackageContract(dir: string, modelID: AxEngineModelID, quantization: AxEngineQuantization) {
  return allowsDirectFallback(modelID, quantization) || (await hasPackageMarker(dir, modelID, quantization))
}

async function readPrepareState(): Promise<{ state?: AxEnginePrepareState; error?: unknown }> {
  try {
    return { state: AxEnginePrepareState.parse(await Filesystem.readJson(AxEnginePaths.prepareState)) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return {}
    return { error }
  }
}

export async function clearPreparedStateForPath(target: string): Promise<boolean> {
  using _ = await FileLock.acquire(AxEnginePaths.prepareLock, { timeoutMs: 30_000, staleMs: PREPARE_LOCK_STALE_MS })
  const current = await readPrepareState()
  if (!current.state || current.error) return false
  if (current.state.path !== target && !Filesystem.contains(target, current.state.path)) return false
  await fs.rm(AxEnginePaths.prepareState, { force: true })
  return true
}

async function writePrepareState(state: AxEnginePrepareState) {
  await Filesystem.writeJson(AxEnginePaths.prepareState, state)
}

async function readCompletionMarker(dir: string): Promise<AxEnginePrepareState | undefined> {
  try {
    return AxEnginePrepareState.parse(await Filesystem.readJson(AxEnginePaths.completionMarker(dir)))
  } catch {
    return undefined
  }
}

async function writeCompletionMarker(state: AxEnginePrepareState) {
  await Filesystem.writeJson(AxEnginePaths.completionMarker(state.path), state)
}

export async function getModelStatus(options: AxEngineModelOptions = {}): Promise<AxEngineModelStatus> {
  const modelID = normalizeModelID(options.modelID)
  const quantization = normalizeQuantization(options.quantization, modelID)
  const configured =
    typeof options.modelPath === "string" && options.modelPath.trim() ? options.modelPath.trim() : undefined
  const preparedResult = await readPrepareState()
  if (preparedResult.error) {
    return {
      present: false,
      modelID,
      quantization,
      complete: false,
      blockers: [
        `${AX_ENGINE_ERROR.ModelMissing}: failed to read prepared model state (${toErrorMessage(preparedResult.error)})`,
      ],
    }
  }
  const prepared = preparedResult.state
  const preparedPath =
    prepared?.modelID === modelID && prepared.quantization === quantization ? prepared.path : undefined

  // Resolve the shared Hugging Face Hub snapshot so a model the engine (or
  // `huggingface-cli`) already downloaded is found without a redundant copy.
  // Ordered after the explicit/prepared paths but before the legacy managed
  // dir, so the standard cache wins for fresh setups while old layouts still
  // resolve.
  const repo = hfRepoFor(modelID, quantization)
  const hfSnapshot = repo ? await HfCache.completeSnapshotDir(repo) : undefined

  const candidates = [
    configured,
    preparedPath,
    hfSnapshot,
    AxEnginePaths.managedModelDir(modelID, quantization),
  ].filter((item): item is string => !!item)

  const inspectErrors: string[] = []
  for (const candidate of candidates) {
    try {
      if (!(await exists(candidate))) continue
      const marker = await readCompletionMarker(candidate)
      const matchingMarker = marker?.modelID === modelID && marker.quantization === quantization ? marker : undefined
      const complete = HfCache.isInside(candidate)
        ? await HfCache.isCompleteSnapshot(candidate)
        : !!matchingMarker || (await hasManifest(candidate))
      if (!complete || !(await hasRunnablePackageContract(candidate, modelID, quantization))) continue
      return {
        present: true,
        modelID,
        quantization,
        path: candidate,
        revision: matchingMarker?.revision,
        bytes: await directorySize(candidate),
        complete: true,
        blockers: [],
      }
    } catch (error) {
      // One unreadable candidate (EACCES on a configured path, flaky FS, etc.)
      // must not hide a later healthy HF snapshot or managed copy.
      inspectErrors.push(`${candidate}: ${toErrorMessage(error)}`)
      continue
    }
  }

  // Prefer inspect failures over a generic "not prepared" message so permission
  // problems stay actionable. Healthy later candidates already returned above.
  if (inspectErrors.length > 0) {
    return {
      present: false,
      modelID,
      quantization,
      complete: false,
      blockers: [`${AX_ENGINE_ERROR.ModelMissing}: failed to inspect model path (${inspectErrors.join("; ")})`],
    }
  }

  return {
    present: false,
    modelID,
    quantization,
    complete: false,
    blockers: [
      `${AX_ENGINE_ERROR.ModelMissing}: prepare ${AX_ENGINE_MODEL_DEFINITIONS[modelID].name} before using ax-engine`,
    ],
  }
}

function parseDownloadJson(text: string): { dest?: string; revision?: string } {
  const parse = (candidate: string) => {
    const parsed = parseJsonResult(candidate)
    if (!parsed.ok || !parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) return undefined
    return parseDownloadSummary(parsed.value as Record<string, unknown>)
  }

  const direct = parse(text)
  if (direct?.dest) return direct

  // ax-engine 6.11 keeps progress events as NDJSON but its binary wrapper
  // pretty-prints the final helper summary across multiple lines. Parse the
  // trailing JSON object as a suffix when the whole mixed transcript is not a
  // single JSON value.
  const lines = text.split(/\r?\n/)
  for (let index = lines.length - 1; index >= 0; index--) {
    if (!lines[index]?.trimStart().startsWith("{")) continue
    const trailing = parse(lines.slice(index).join("\n").trim())
    if (trailing?.dest) return trailing
  }
  return direct ?? {}
}

function parseDownloadSummary(record: Record<string, unknown>): { dest?: string; revision?: string } {
  const nestedDownload =
    record.download && typeof record.download === "object" ? (record.download as Record<string, unknown>) : undefined
  return {
    dest:
      typeof record.output_dir === "string"
        ? record.output_dir
        : typeof record.dest === "string"
          ? record.dest
          : typeof record.path === "string"
            ? record.path
            : undefined,
    revision:
      typeof record.revision === "string"
        ? record.revision
        : typeof nestedDownload?.revision === "string"
          ? nestedDownload.revision
          : undefined,
  }
}

async function readLines(stream: Readable, onLine: (line: string) => void): Promise<void> {
  let buffer = ""
  for await (const chunk of stream) {
    buffer += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8")
    let newline = buffer.indexOf("\n")
    while (newline !== -1) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (line.trim()) onLine(line)
      newline = buffer.indexOf("\n")
    }
  }
  if (buffer.trim()) onLine(buffer)
}

/** Best-effort recursive size for progress only (does not throw). */
function measureDirBytes(target: string): number {
  try {
    const stat = fsSync.statSync(target)
    if (stat.isFile()) return stat.size
    if (!stat.isDirectory()) return 0
  } catch {
    return 0
  }
  let total = 0
  const stack = [target]
  while (stack.length > 0) {
    const current = stack.pop()!
    let entries: fsSync.Dirent[]
    try {
      entries = fsSync.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      // Stay under the progress root — readdir entries should already, but
      // refuse any escape (security_scan path_traversal).
      if (!Filesystem.contains(target, full)) continue
      try {
        if (entry.isDirectory()) stack.push(full)
        else if (entry.isFile() || entry.isSymbolicLink()) {
          total += fsSync.statSync(full).size
        }
      } catch {
        // ignore unreadable entries mid-download
      }
    }
  }
  return total
}

/**
 * Run `ax-engine download|download-mtp --json --progress-json`, stream-parse
 * NDJSON progress events, and return the final summary text + exit code.
 *
 * Mid-download: also poll the HF hub cache for the target repo so the UI does
 * not freeze at the engine's sparse start event (~5%) for multi-GB transfers.
 */
async function runAxEngineDownload(input: {
  cmd: string[]
  env: NodeJS.ProcessEnv
  signal?: AbortSignal
  onProgress?: (progress: AxEngineDownloadProgress) => void
  /** Hugging Face repo id used to locate the hub cache for byte polling. */
  watchRepo?: string
  /** Optional known total size (bytes); also learned from engine messages. */
  expectedBytes?: number
}): Promise<{ code: number; stdout: string; stderr: string; lastSummary?: Record<string, unknown> }> {
  // Prefer live progress. Older engines that reject the flag are retried once
  // without it and stay indeterminate.
  const withProgress = [...input.cmd, "--progress-json"]
  const attempt = async (cmd: string[]) => {
    const startedAt = Date.now()
    const proc = Process.spawn(cmd, {
      stdout: "pipe",
      stderr: "pipe",
      env: input.env,
      abort: input.signal,
      timeout: DOWNLOAD_TIMEOUT_MS,
    })
    if (!proc.stdout || !proc.stderr) throw new Error("Process output not available")

    let progress: AxEngineDownloadProgress | undefined
    let lastSummary: Record<string, unknown> | undefined
    let expectedBytes = input.expectedBytes
    const stdoutChunks: string[] = []
    const stderrChunks: Buffer[] = []
    // Pretty-printed final summaries from the engine wrapper span multiple
    // lines. Accumulate from the first "{" until JSON.parse succeeds.
    let multiLineJson: string | undefined

    const publish = (event: { done: number; total: number; message?: string }) => {
      progress = applyProgressEvent(progress, event)
      input.onProgress?.(progress)
    }

    const tryConsumeJsonObject = (text: string): boolean => {
      const parsed = parseProgressJsonLine(text)
      if (parsed.kind === "progress") {
        const fromMessage = parseGiBTotalFromMessage(parsed.event.file)
        if (fromMessage) expectedBytes = expectedBytes ?? fromMessage
        publish({
          done: parsed.event.done,
          total: parsed.event.total,
          message: parsed.event.file,
        })
        return true
      }
      if (parsed.kind === "summary") {
        lastSummary = parsed.value
        return true
      }
      return false
    }

    const onStdoutLine = (line: string) => {
      stdoutChunks.push(line)
      if (multiLineJson !== undefined) {
        multiLineJson += `\n${line}`
        if (tryConsumeJsonObject(multiLineJson)) multiLineJson = undefined
        return
      }
      if (tryConsumeJsonObject(line)) return
      // Start of a pretty-printed object (engine final summary).
      if (line.trimStart().startsWith("{")) multiLineJson = line
    }

    // Poll HF cache while snapshot_download is blocked inside the engine —
    // progress-json is otherwise silent for most of a multi-GB download.
    const CACHE_POLL_MS = 2000
    let pollTimer: ReturnType<typeof setInterval> | undefined
    if (input.watchRepo && input.onProgress) {
      const repoPath = HfCache.repoDir(input.watchRepo, input.env)
      const tick = () => {
        // Prefer engine events once we leave the weight phase (>= 85).
        if (progress && progress.percent >= 85) return
        const downloaded = measureDirBytes(repoPath)
        if (downloaded <= 0 && !progress) return
        const event = progressFromCacheBytes({
          downloadedBytes: downloaded,
          totalBytes: expectedBytes,
          startedAt,
        })
        publish(event)
      }
      pollTimer = setInterval(tick, CACHE_POLL_MS)
      // First sample quickly so the bar moves off a frozen 5%/0.0 GiB.
      setTimeout(tick, 250)
    }

    const stdoutDone = readLines(proc.stdout, onStdoutLine)
    const stderrDone = (async () => {
      for await (const chunk of proc.stderr!) {
        stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
    })()

    try {
      const code = await proc.exited
      await Promise.all([stdoutDone, stderrDone])
      return {
        code,
        stdout: stdoutChunks.join("\n"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        lastSummary,
      }
    } finally {
      if (pollTimer) clearInterval(pollTimer)
    }
  }

  const first = await attempt(withProgress)
  const unknownOption =
    first.code !== 0 &&
    /unknown (download )?option: --progress-json|unrecognized option.*progress-json/i.test(
      `${first.stderr}\n${first.stdout}`,
    )
  if (!unknownOption) return first
  log.warn("ax-engine rejected --progress-json; retrying without live progress")
  return attempt(input.cmd)
}

export async function markPrepared(input: {
  modelID?: AxEngineModelID
  modelPath: string
  quantization?: AxEngineQuantization
  revision?: string
}): Promise<AxEnginePrepareState> {
  using _ = await FileLock.acquire(AxEnginePaths.prepareLock, { timeoutMs: 30_000, staleMs: PREPARE_LOCK_STALE_MS })
  const modelID = input.modelID ?? AX_ENGINE_DEFAULT_MODEL_ID
  const quantization = input.quantization ?? AX_ENGINE_MODEL_DEFINITIONS[modelID].defaultQuantization
  if (!(await exists(input.modelPath))) {
    throw new Error(`${AX_ENGINE_ERROR.ModelMissing}: model path does not exist`)
  }
  if (HfCache.isInside(input.modelPath)) {
    if (!(await HfCache.isCompleteSnapshot(input.modelPath))) {
      throw new Error(`${AX_ENGINE_ERROR.ModelMissing}: model path is incomplete`)
    }
  } else if (!(await hasManifest(input.modelPath))) {
    throw new Error(`${AX_ENGINE_ERROR.ModelMissing}: model path is missing model-manifest.json`)
  }
  if (!(await hasRunnablePackageContract(input.modelPath, modelID, quantization))) {
    throw new Error(
      `${AX_ENGINE_ERROR.ModelMissing}: model path is missing required ${packageMarkerFor(modelID, quantization)} package contract`,
    )
  }
  const state: AxEnginePrepareState = {
    modelID,
    quantization,
    path: input.modelPath,
    revision: input.revision,
    preparedAt: Date.now(),
  }
  await writePrepareState(state)
  await writeCompletionMarker(state).catch(() => undefined)
  return state
}

async function markPreparedWithLockHeld(input: {
  modelID: AxEngineModelID
  modelPath: string
  quantization: AxEngineQuantization
  revision?: string
}): Promise<AxEnginePrepareState> {
  const state: AxEnginePrepareState = {
    modelID: input.modelID,
    quantization: input.quantization,
    path: input.modelPath,
    revision: input.revision,
    preparedAt: Date.now(),
  }
  await writePrepareState(state)
  await writeCompletionMarker(state).catch(() => undefined)
  return state
}

export async function downloadModel(input: {
  binaryPath: string
  modelID?: AxEngineModelID
  quantization?: AxEngineQuantization
  dest?: string
  signal?: AbortSignal
  onProgress?: (progress: AxEngineDownloadProgress) => void
}): Promise<AxEnginePrepareState> {
  const modelID = input.modelID ?? AX_ENGINE_DEFAULT_MODEL_ID
  const quantization = input.quantization ?? AX_ENGINE_MODEL_DEFINITIONS[modelID].defaultQuantization
  const quantizationDefinition = AX_ENGINE_MODEL_DEFINITIONS[modelID].quantizations[quantization]
  const repo = quantizationDefinition?.hfRepo
  if (!quantizationDefinition || !repo) {
    throw new Error(
      `${AX_ENGINE_ERROR.DownloadFailed}: ${AX_ENGINE_MODEL_DEFINITIONS[modelID].name} does not support ${quantization}`,
    )
  }
  // Only pass --dest when an explicit destination is requested. Without it the
  // engine downloads into the shared Hugging Face Hub cache (its documented
  // default) and returns that snapshot path, so the weights live in one
  // standard location instead of being copied into ax-code's own cache.
  const dest = input.dest ? resolveDownloadDestination(modelID, quantization, input.dest) : undefined
  const downloadMode = quantizationDefinition.downloadMode
  const useMtpPackage = downloadMode === "mtp"
  const cmd = useMtpPackage
    ? [input.binaryPath, "download-mtp", modelID, "--json"]
    : [input.binaryPath, "download", repo, "--json"]
  if (dest) cmd.push(useMtpPackage ? "--output" : "--dest", dest)

  using _ = await FileLock.acquire(AxEnginePaths.prepareLock, { timeoutMs: 30_000, staleMs: PREPARE_LOCK_STALE_MS })
  await assertDiskSpace({ modelID, quantization, downloadDir: dest ?? HfCache.root() })
  // Always inject AX_ENGINE_PYTHON when a managed/explicit Python with
  // huggingface_hub is available. Relying on parent env alone fails for CLI
  // launches and some Desktop paths that never set the variable.
  const downloadEnv = axEngineDownloadEnv()
  if (downloadEnv.AX_ENGINE_PYTHON) {
    log.info("ax-engine download using AX_ENGINE_PYTHON", { python: downloadEnv.AX_ENGINE_PYTHON })
  } else {
    log.warn("ax-engine download has no AX_ENGINE_PYTHON; ax-engine will use system python3", {
      hint: "python3 -m pip install huggingface_hub  (or install into ~/.ax-engine/venv)",
    })
  }
  const result = await runAxEngineDownload({
    cmd,
    env: downloadEnv,
    signal: input.signal,
    onProgress: input.onProgress,
    watchRepo: repo,
    // minDiskBytes includes headroom; use it only as a soft upper bound until
    // the engine (or hub) reports a real total in a progress message.
    expectedBytes: undefined,
  })
  if (result.code !== 0) {
    throw new Error(`${AX_ENGINE_ERROR.DownloadFailed}: ${result.stderr.trim() || result.stdout.trim()}`)
  }
  const streamed = result.lastSummary ? parseDownloadSummary(result.lastSummary) : undefined
  const parsed = streamed?.dest ? streamed : parseDownloadJson(result.stdout.trim())
  if (!parsed.dest) {
    throw new Error(`${AX_ENGINE_ERROR.DownloadFailed}: ax-engine download did not return a destination`)
  }
  const complete = HfCache.isInside(parsed.dest)
    ? await HfCache.isCompleteSnapshot(parsed.dest)
    : await hasManifest(parsed.dest)
  if (!complete) {
    throw new Error(`${AX_ENGINE_ERROR.DownloadFailed}: downloaded model path is incomplete`)
  }
  // `download-mtp` promises a packaged assistant/sidecar. Direct fallback is
  // valid for existing base weights, but must not hide a broken MTP download.
  if (!(await hasPackageMarker(parsed.dest, modelID, quantization))) {
    throw new Error(
      `${AX_ENGINE_ERROR.DownloadFailed}: downloaded model is missing required ${packageMarkerFor(modelID, quantization)} package contract`,
    )
  }
  return markPreparedWithLockHeld({
    modelID,
    modelPath: parsed.dest,
    quantization,
    revision: parsed.revision,
  }).catch((error: unknown) => {
    throw new Error(`${AX_ENGINE_ERROR.DownloadFailed}: ${toErrorMessage(error)}`)
  })
}

export type AxEngineReclaimResult = {
  modelID: AxEngineModelID
  quantization: AxEngineQuantization
  managedPath: string
  snapshotPath: string
  freedBytes?: number
}

// Migrate one legacy managed copy (ax-code's own cache) to the shared Hugging
// Face Hub snapshot. Only deletes the managed copy once the HF snapshot is
// verified complete (weights + AX manifest) — never the sole copy. Repoints
// prepare.json if it still pointed into the managed dir. Returns undefined when
// there is nothing to reclaim or the HF copy is not a safe replacement.
export async function reclaimManagedCopy(
  modelID: AxEngineModelID,
  quantization: AxEngineQuantization,
): Promise<AxEngineReclaimResult | undefined> {
  const managedPath = AxEnginePaths.managedModelDir(modelID, quantization)
  if (!(await exists(managedPath))) return undefined

  const repo = hfRepoFor(modelID, quantization)
  const snapshotPath = repo ? await HfCache.completeSnapshotDir(repo) : undefined
  // Refuse to delete the managed copy unless an equivalent, complete snapshot
  // exists in the HF cache — otherwise we would destroy the only copy. MTP
  // models additionally require the family-specific sidecar package contract;
  // base weights alone cannot replace a model prepared by download-mtp.
  if (
    !snapshotPath ||
    !(await HfCache.isCompleteSnapshot(snapshotPath)) ||
    // Do not trade an MTP-ready legacy copy for direct-only base weights. The
    // latter are runnable, but deleting the only sidecar would silently remove
    // acceleration. Direct-only models have no marker and pass this check.
    !(await hasPackageMarker(snapshotPath, modelID, quantization))
  )
    return undefined

  using _ = await FileLock.acquire(AxEnginePaths.prepareLock, { timeoutMs: 30_000, staleMs: PREPARE_LOCK_STALE_MS })

  // Repoint prepare.json off the managed dir before deleting it.
  const current = await readPrepareState()
  if (current.error) return undefined
  if (
    current.state &&
    current.state.modelID === modelID &&
    current.state.quantization === quantization &&
    isInsideDir(current.state.path, managedPath)
  ) {
    await writePrepareState({ ...current.state, path: snapshotPath, preparedAt: Date.now() })
  }

  const freedBytes = await directorySize(managedPath)
  await fs.rm(managedPath, { recursive: true, force: true })
  // Drop now-empty parent (models/<modelID>) when it has no other quantizations.
  await fs.rmdir(path.dirname(managedPath)).catch(() => undefined)
  log.info("reclaimed redundant ax-engine model copy", {
    status: "success",
    durationMs: 0,
    modelID,
    quantization,
    managedPath,
    snapshotPath,
    freedBytes: freedBytes ?? 0,
  })
  return { modelID, quantization, managedPath, snapshotPath, freedBytes }
}

// Scan the legacy managed models directory and reclaim every copy that the HF
// cache can now serve. Safe to call repeatedly; a no-op once nothing redundant
// remains. Best-effort: failures are logged, never thrown.
export async function reclaimManagedModelCopies(): Promise<AxEngineReclaimResult[]> {
  const reclaimed: AxEngineReclaimResult[] = []
  let modelDirs: string[]
  try {
    const entries = await fs.readdir(AxEnginePaths.models, { withFileTypes: true })
    modelDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return reclaimed
  }
  for (const modelName of modelDirs) {
    if (!isAxEngineModelID(modelName)) continue
    let quantDirs: string[]
    try {
      const entries = await fs.readdir(path.join(AxEnginePaths.models, modelName), { withFileTypes: true })
      quantDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    } catch {
      continue
    }
    for (const quant of quantDirs) {
      if (!AX_ENGINE_QUANTIZATION_IDS.includes(quant as AxEngineQuantization)) continue
      try {
        const result = await reclaimManagedCopy(modelName, quant as AxEngineQuantization)
        if (result) reclaimed.push(result)
      } catch (error) {
        log.warn("failed to reclaim managed ax-engine copy", {
          status: "error",
          durationMs: 0,
          errorCode: "AX_ENGINE_RECLAIM_FAILED",
          modelID: modelName,
          quantization: quant,
          error: toErrorMessage(error),
        })
      }
    }
  }
  return reclaimed
}

function isInsideDir(target: string, dir: string): boolean {
  return Filesystem.contains(dir, target)
}
