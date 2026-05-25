import path from "path"
import z from "zod"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { Filesystem } from "@/util/filesystem"
import { FileLock } from "@/util/filelock"
import { Lock } from "@/util/lock"
import { Log } from "@/util/log"
import { FeatureFlag } from "@/util/feature-flags"

const log = Log.create({ service: "project-config" })

const PROJECT_CONFIG_PERSIST_ERROR = "Failed to persist configuration"

export const BooleanFeatureState = z.object({
  enabled: z.boolean(),
})

function coerceErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function createPersistErrorLogger(log: ReturnType<typeof Log.create>, context: string) {
  return (error: unknown) => {
    log.warn(`failed to persist ${context}`, { error: coerceErrorMessage(error) })
  }
}

type PersistProjectConfigResponseOptions = {
  log: ReturnType<typeof Log.create>
  context: string
  update: (config: Config.Info) => void | Promise<void>
}

export async function persistProjectConfigResponse(
  options: PersistProjectConfigResponseOptions,
): Promise<{ error: string } | undefined> {
  const persisted = await persistProjectConfig(options.update, {
    onError: createPersistErrorLogger(options.log, options.context),
  })
  if (!persisted) return { error: PROJECT_CONFIG_PERSIST_ERROR }
  return undefined
}

type PersistProjectConfigFeatureResponseOptions<FeatureValue extends string | boolean, ResponseState> = {
  featureFlag: string
  featureValue: FeatureValue
  responseState: ResponseState
} & PersistProjectConfigResponseOptions

export async function persistProjectConfigFeatureResponse<FeatureValue extends string | boolean, ResponseState>(
  options: PersistProjectConfigFeatureResponseOptions<FeatureValue, ResponseState>,
): Promise<{ error: string } | ResponseState> {
  const persisted = await persistProjectConfigResponse(options)
  if (persisted) return persisted
  FeatureFlag.set(options.featureFlag, options.featureValue)
  return options.responseState
}

export function persistProjectConfigBooleanFeatureResponse(
  options: Omit<
    PersistProjectConfigFeatureResponseOptions<boolean, { enabled: boolean }>,
    "featureValue" | "responseState"
  > & {
    enabled: boolean
  },
) {
  return persistProjectConfigFeatureResponse({
    ...options,
    featureFlag: options.featureFlag,
    featureValue: options.enabled,
    responseState: { enabled: options.enabled },
  })
}

export async function readProjectConfigFeatureState(options: {
  featureFlag: string
  read: (config: Config.Info | undefined) => boolean
}) {
  const config = await readProjectConfig()
  const enabled = options.read(config)
  FeatureFlag.set(options.featureFlag, enabled)
  return { enabled }
}

function filepath() {
  return path.join(Instance.directory, "ax-code.json")
}

export function parseProjectConfigText(text: string): Config.Info {
  try {
    const value = JSON.parse(text)
    const next = Config.Info.safeParse(value)
    if (next.success) return next.data
    // Strip unknown keys but keep valid ones instead of resetting to {}
    const stripped = Config.Info.strip().safeParse(value)
    if (stripped.success) {
      log.warn("project config had unknown keys, stripped to valid subset", { issueCount: next.error.issues.length })
      return stripped.data
    }
    log.warn("project config validation failed, preserving raw object", { issueCount: next.error.issues.length })
    return value as Config.Info
  } catch (error) {
    log.warn("failed to parse project config JSON", { error })
    return {}
  }
}

export async function readProjectConfig() {
  const file = filepath()
  const text = await Filesystem.readText(file).catch(() => "{}")
  return parseProjectConfigText(text)
}

export async function updateProjectConfig<T>(fn: (config: Config.Info) => T | Promise<T>) {
  const file = filepath()
  using _inProcess = await Lock.write(file)
  using _crossProcess = await FileLock.acquire(file)
  const text = await Filesystem.readText(file).catch(() => "{}")
  const config = parseProjectConfigText(text)
  const result = await fn(config)
  await Filesystem.writeJson(file, config)
  return result
}

type PersistProjectConfigOptions = {
  onError?: (error: unknown) => void
}

export async function persistProjectConfig(
  fn: (config: Config.Info) => void | Promise<void>,
  options: PersistProjectConfigOptions = {},
) {
  try {
    await updateProjectConfig(fn)
    return true
  } catch (error) {
    options.onError?.(error)
    return false
  }
}
