import fs from "fs/promises"
import path from "path"
import z from "zod"
import { FileLock } from "@/util/filelock"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"
import { parseJsonResult } from "@/util/json-value"
import { toErrorMessage } from "@/util/error-message"
import { AX_ENGINE_ERROR, AX_ENGINE_HF_REPOS, AX_ENGINE_MODEL_ID, AX_ENGINE_DEFAULT_QUANTIZATION } from "./constants"
import type { AxEngineQuantization } from "./constants"
import { AxEnginePaths } from "./paths"

export const AxEngineModelStatus = z.object({
  present: z.boolean(),
  modelID: z.literal(AX_ENGINE_MODEL_ID),
  quantization: z.enum(["mlx4bit", "mlx6bit"]),
  path: z.string().optional(),
  revision: z.string().optional(),
  bytes: z.number().optional(),
  complete: z.boolean().default(false),
  blockers: z.array(z.string()).default([]),
})
export type AxEngineModelStatus = z.infer<typeof AxEngineModelStatus>

export const AxEnginePrepareState = z.object({
  modelID: z.literal(AX_ENGINE_MODEL_ID),
  quantization: z.enum(["mlx4bit", "mlx6bit"]),
  path: z.string(),
  revision: z.string().optional(),
  preparedAt: z.number(),
})
export type AxEnginePrepareState = z.infer<typeof AxEnginePrepareState>

export type AxEngineModelOptions = {
  modelPath?: unknown
  quantization?: unknown
  [key: string]: unknown
}

export function normalizeQuantization(value: unknown): AxEngineQuantization {
  return value === "mlx6bit" ? "mlx6bit" : AX_ENGINE_DEFAULT_QUANTIZATION
}

async function exists(file: string) {
  return fs
    .stat(file)
    .then(() => true)
    .catch(() => false)
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

async function hasManifest(dir: string) {
  return exists(path.join(dir, "model-manifest.json"))
}

async function readPrepareState(): Promise<AxEnginePrepareState | undefined> {
  try {
    return AxEnginePrepareState.parse(await Filesystem.readJson(AxEnginePaths.prepareState))
  } catch {
    return undefined
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
  const quantization = normalizeQuantization(options.quantization)
  const configured =
    typeof options.modelPath === "string" && options.modelPath.trim() ? options.modelPath.trim() : undefined

  const candidates = [configured, (await readPrepareState())?.path, AxEnginePaths.managedModelDir(quantization)].filter(
    (item): item is string => !!item,
  )

  for (const candidate of candidates) {
    if (!(await exists(candidate))) continue
    const marker = await readCompletionMarker(candidate)
    const complete = !!marker || (await hasManifest(candidate))
    if (!complete) continue
    return {
      present: true,
      modelID: AX_ENGINE_MODEL_ID,
      quantization,
      path: candidate,
      revision: marker?.revision,
      bytes: await directorySize(candidate),
      complete: true,
      blockers: [],
    }
  }

  return {
    present: false,
    modelID: AX_ENGINE_MODEL_ID,
    quantization,
    complete: false,
    blockers: [`${AX_ENGINE_ERROR.ModelMissing}: prepare Qwen3-Coder-Next MLX before using ax-engine`],
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
  modelPath: string
  quantization?: AxEngineQuantization
  revision?: string
}): Promise<AxEnginePrepareState> {
  using _ = await FileLock.acquire(AxEnginePaths.prepareLock, { timeoutMs: 30_000, staleMs: 10 * 60_000 })
  if (!(await exists(input.modelPath))) {
    throw new Error(`${AX_ENGINE_ERROR.ModelMissing}: model path does not exist`)
  }
  if (!(await hasManifest(input.modelPath))) {
    throw new Error(`${AX_ENGINE_ERROR.ModelMissing}: model path is missing model-manifest.json`)
  }
  const state: AxEnginePrepareState = {
    modelID: AX_ENGINE_MODEL_ID,
    quantization: input.quantization ?? AX_ENGINE_DEFAULT_QUANTIZATION,
    path: input.modelPath,
    revision: input.revision,
    preparedAt: Date.now(),
  }
  await writePrepareState(state)
  await writeCompletionMarker(state).catch(() => undefined)
  return state
}

async function markPreparedWithLockHeld(input: {
  modelPath: string
  quantization: AxEngineQuantization
  revision?: string
}): Promise<AxEnginePrepareState> {
  const state: AxEnginePrepareState = {
    modelID: AX_ENGINE_MODEL_ID,
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
  quantization?: AxEngineQuantization
  dest?: string
  signal?: AbortSignal
}): Promise<AxEnginePrepareState> {
  const quantization = input.quantization ?? AX_ENGINE_DEFAULT_QUANTIZATION
  const repo = AX_ENGINE_HF_REPOS[quantization]
  const cmd = [input.binaryPath, "download", repo, "--json"]
  if (input.dest) cmd.push("--dest", input.dest)

  using _ = await FileLock.acquire(AxEnginePaths.prepareLock, { timeoutMs: 30_000, staleMs: 60 * 60_000 })
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
  if (!(await hasManifest(parsed.dest))) {
    throw new Error(`${AX_ENGINE_ERROR.DownloadFailed}: downloaded model path is incomplete`)
  }
  return markPreparedWithLockHeld({
    modelPath: parsed.dest,
    quantization,
    revision: parsed.revision,
  }).catch((error: unknown) => {
    throw new Error(`${AX_ENGINE_ERROR.DownloadFailed}: ${toErrorMessage(error)}`)
  })
}
