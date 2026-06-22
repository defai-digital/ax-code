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
import { HfCache } from "./hf-cache"
import { Log } from "@/util/log"

const log = Log.create({ service: "ax-engine-model-cache" })

// The Hugging Face repo that backs a model+quantization, used to locate the
// shared snapshot the engine downloaded.
function hfRepoFor(modelID: AxEngineModelID, quantization: AxEngineQuantization): string | undefined {
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
  let total = 0
  async function walk(current: string) {
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const p = path.join(current, entry.name)
      if (entry.isDirectory()) await walk(p)
      else if (entry.isFile()) total += (await fs.stat(p)).size
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
    typeof options.downloadDir === "string" && options.downloadDir.trim()
      ? options.downloadDir.trim()
      : HfCache.root()
  await fs.mkdir(target, { recursive: true })
  const result = await Process.text(["df", "-Pk", target], { nothrow: true })
  const freeBytes = result.code === 0 ? parseDfPkAvailableBytes(result.text) : undefined
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

async function readPrepareState(): Promise<{ state?: AxEnginePrepareState; error?: unknown }> {
  try {
    return { state: AxEnginePrepareState.parse(await Filesystem.readJson(AxEnginePaths.prepareState)) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return {}
    return { error }
  }
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

  for (const candidate of candidates) {
    try {
      if (!(await exists(candidate))) continue
      const marker = await readCompletionMarker(candidate)
      const matchingMarker = marker?.modelID === modelID && marker.quantization === quantization ? marker : undefined
      const complete = HfCache.isInside(candidate)
        ? await HfCache.isCompleteSnapshot(candidate)
        : !!matchingMarker || (await hasManifest(candidate))
      if (!complete) continue
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
      return {
        present: false,
        modelID,
        quantization,
        complete: false,
        blockers: [`${AX_ENGINE_ERROR.ModelMissing}: failed to inspect model path (${toErrorMessage(error)})`],
      }
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
  const parsed = parseJsonResult(text)
  if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") return {}
  const record = parsed.value as Record<string, unknown>
  return {
    dest: typeof record.dest === "string" ? record.dest : typeof record.path === "string" ? record.path : undefined,
    revision: typeof record.revision === "string" ? record.revision : undefined,
  }
}

export async function markPrepared(input: {
  modelID?: AxEngineModelID
  modelPath: string
  quantization?: AxEngineQuantization
  revision?: string
}): Promise<AxEnginePrepareState> {
  using _ = await FileLock.acquire(AxEnginePaths.prepareLock, { timeoutMs: 30_000, staleMs: 10 * 60_000 })
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
  const modelID = input.modelID ?? AX_ENGINE_DEFAULT_MODEL_ID
  const state: AxEnginePrepareState = {
    modelID,
    quantization: input.quantization ?? AX_ENGINE_MODEL_DEFINITIONS[modelID].defaultQuantization,
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
}): Promise<AxEnginePrepareState> {
  const modelID = input.modelID ?? AX_ENGINE_DEFAULT_MODEL_ID
  const quantization = input.quantization ?? AX_ENGINE_MODEL_DEFINITIONS[modelID].defaultQuantization
  const repo =
    AX_ENGINE_MODEL_DEFINITIONS[modelID].quantizations[
      quantization as keyof (typeof AX_ENGINE_MODEL_DEFINITIONS)[typeof modelID]["quantizations"]
    ]?.hfRepo
  if (!repo) {
    throw new Error(
      `${AX_ENGINE_ERROR.DownloadFailed}: ${AX_ENGINE_MODEL_DEFINITIONS[modelID].name} does not support ${quantization}`,
    )
  }
  // Only pass --dest when an explicit destination is requested. Without it the
  // engine downloads into the shared Hugging Face Hub cache (its documented
  // default) and returns that snapshot path, so the weights live in one
  // standard location instead of being copied into ax-code's own cache.
  const dest = input.dest ? resolveDownloadDestination(modelID, quantization, input.dest) : undefined
  const cmd = [input.binaryPath, "download", repo, "--json"]
  if (dest) cmd.push("--dest", dest)

  using _ = await FileLock.acquire(AxEnginePaths.prepareLock, { timeoutMs: 30_000, staleMs: 60 * 60_000 })
  await assertDiskSpace({ quantization, downloadDir: dest ?? HfCache.root() })
  const result = await Process.text(cmd, {
    timeout: 6 * 60 * 60 * 1000,
    abort: input.signal,
    nothrow: true,
  })
  if (result.code !== 0) {
    throw new Error(`${AX_ENGINE_ERROR.DownloadFailed}: ${result.stderr.toString().trim() || result.text.trim()}`)
  }
  const parsed = parseDownloadJson(result.text.trim())
  if (!parsed.dest) {
    throw new Error(`${AX_ENGINE_ERROR.DownloadFailed}: ax-engine download did not return a destination`)
  }
  const complete = HfCache.isInside(parsed.dest)
    ? await HfCache.isCompleteSnapshot(parsed.dest)
    : await hasManifest(parsed.dest)
  if (!complete) {
    throw new Error(`${AX_ENGINE_ERROR.DownloadFailed}: downloaded model path is incomplete`)
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
  // exists in the HF cache — otherwise we would destroy the only copy.
  if (!snapshotPath || !(await HfCache.isCompleteSnapshot(snapshotPath))) return undefined

  using _ = await FileLock.acquire(AxEnginePaths.prepareLock, { timeoutMs: 30_000, staleMs: 10 * 60_000 })

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
  const rel = path.relative(dir, target)
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
}
