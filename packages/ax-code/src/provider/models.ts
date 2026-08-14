import { Log } from "../util/log"
import z from "zod"
import { lazy } from "@/util/lazy"
import { errorCode } from "@/util/error-message"
import { Filesystem } from "../util/filesystem"
import { Ssrf } from "../util/ssrf"
import { Global } from "../global"
import { Instance } from "../project/instance"
import { Flag } from "../flag/flag"
import { isModelSupportedForProvider } from "./model-support"
import { modelMemoryBlockReason } from "./model-selectability"
import bundledSnapshot from "./models-snapshot.json"
import {
  AX_ENGINE_DEFAULT_PORT,
  AX_ENGINE_DISPLAY_NAME,
  AX_ENGINE_MODEL_DEFINITIONS,
  AX_ENGINE_MODEL_IDS,
  AX_ENGINE_PROVIDER_ID,
} from "./ax-engine/constants"
import { DEDICATED_PRIVATE_GPU_VENDORS } from "./private-gpu/presets"
import type { AxEngineModelID } from "./ax-engine/constants"
import fs from "fs/promises"

export namespace ModelsDev {
  const log = Log.create({ service: "models" })

  const supported = isModelSupportedForProvider

  function sanitize(input: Record<string, Provider>) {
    return Object.fromEntries(
      Object.entries(input).map(([id, provider]) => [
        id,
        {
          ...provider,
          models: Object.fromEntries(
            Object.entries(provider.models).filter(([modelID, model]) => supported(id, modelID, model)),
          ),
        },
      ]),
    ) as Record<string, Provider>
  }

  export const Model = z.object({
    id: z.string(),
    name: z.string(),
    family: z.string().optional(),
    release_date: z.string(),
    attachment: z.boolean(),
    reasoning: z.boolean(),
    temperature: z.boolean().default(false),
    tool_call: z.boolean(),
    interleaved: z
      .union([
        z.literal(true),
        z
          .object({
            field: z.enum(["reasoning_content", "reasoning_details"]),
          })
          .strict(),
      ])
      .optional(),
    limit: z.object({
      context: z.number(),
      input: z.number().optional(),
      output: z.number(),
    }),
    modalities: z
      .object({
        input: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
        output: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
      })
      .optional(),
    experimental: z.union([z.boolean(), z.record(z.string(), z.any())]).optional(),
    status: z.enum(["alpha", "beta", "deprecated", "active"]).optional(),
    options: z.record(z.string(), z.any()).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    provider: z.object({ npm: z.string().optional(), api: z.string().optional() }).optional(),
    variants: z.record(z.string(), z.record(z.string(), z.any())).optional(),
  })
  export type Model = z.infer<typeof Model>

  export const Provider = z.object({
    api: z.string().optional(),
    name: z.string(),
    env: z.array(z.string()),
    id: z.string(),
    npm: z.string().optional(),
    options: z.record(z.string(), z.any()).optional(),
    models: z.record(z.string(), Model),
  })

  export type Provider = z.infer<typeof Provider>

  const DataSchema = z.record(z.string(), Provider)

  function builtinAxEngineModel(modelID: AxEngineModelID): Model {
    const definition = AX_ENGINE_MODEL_DEFINITIONS[modelID]
    const minMemoryBytes = definition.minMemoryBytes
    const memoryBlockReason = modelMemoryBlockReason(AX_ENGINE_PROVIDER_ID, {
      options: { minMemoryBytes },
    })
    return {
      id: modelID,
      name: definition.name,
      family: modelID,
      release_date: definition.releaseDate,
      attachment: false,
      reasoning: definition.reasoning,
      temperature: true,
      tool_call: definition.toolcall,
      modalities: { input: ["text"], output: ["text"] },
      limit: {
        context: definition.contextTokens,
        input: Math.max(1, definition.contextTokens - definition.outputTokens),
        output: definition.outputTokens,
      },
      status: "beta",
      options: {
        modelID,
        quantization: definition.defaultQuantization,
        minMemoryBytes,
        ...(memoryBlockReason ? { memoryBlockReason } : {}),
      },
      experimental: { localRuntime: AX_ENGINE_PROVIDER_ID },
    }
  }

  const BUILTIN_AX_ENGINE_PROVIDER: Provider = {
    id: AX_ENGINE_PROVIDER_ID,
    env: ["AX_ENGINE_HOST"],
    npm: "@ai-sdk/openai-compatible",
    api: `http://127.0.0.1:${AX_ENGINE_DEFAULT_PORT}/v1`,
    name: AX_ENGINE_DISPLAY_NAME,
    models: Object.fromEntries(AX_ENGINE_MODEL_IDS.map((modelID) => [modelID, builtinAxEngineModel(modelID)])),
  }

  function builtinDedicatedPrivateGpuProvider(vendor: (typeof DEDICATED_PRIVATE_GPU_VENDORS)[number]): Provider {
    return {
      id: vendor.id,
      env: [vendor.envKey],
      npm: vendor.npm,
      name: vendor.name,
      ...(vendor.defaultApi ? { api: vendor.defaultApi } : {}),
      models: {},
    }
  }

  function withBuiltIns(input: Record<string, Provider>) {
    const next = { ...input }
    if (!next[AX_ENGINE_PROVIDER_ID]) next[AX_ENGINE_PROVIDER_ID] = BUILTIN_AX_ENGINE_PROVIDER
    for (const vendor of DEDICATED_PRIVATE_GPU_VENDORS) {
      if (!next[vendor.id]) next[vendor.id] = builtinDedicatedPrivateGpuProvider(vendor)
    }
    return next
  }

  /**
   * Cloud-provider env/API normals that models.dev may lag Meta/DeepSeek docs.
   * Meta documents MODEL_API_KEY; models.dev ships META_MODEL_API_KEY. Accept both
   * so login/env discovery matches OpenCode + Meta Muse Spark setup guides.
   */
  function withCloudApiKeyAliases(input: Record<string, Provider>): Record<string, Provider> {
    const out = { ...input }
    const meta = out["meta"]
    if (meta) {
      const env = new Set(meta.env ?? [])
      env.add("META_MODEL_API_KEY")
      env.add("MODEL_API_KEY")
      out["meta"] = {
        ...meta,
        name: meta.name || "Meta Model API",
        npm: meta.npm || "@ai-sdk/openai",
        api: meta.api || "https://api.meta.ai/v1",
        env: Array.from(env),
      }
    }
    const deepseek = out["deepseek"]
    if (deepseek) {
      const env = new Set(deepseek.env ?? [])
      env.add("DEEPSEEK_API_KEY")
      out["deepseek"] = {
        ...deepseek,
        name: deepseek.name || "DeepSeek",
        npm: deepseek.npm || "@ai-sdk/openai-compatible",
        // OpenAI-compatible hosts accept base without trailing /v1; DeepSeek docs
        // use https://api.deepseek.com and OpenCode often pins /v1.
        api: deepseek.api || "https://api.deepseek.com",
        env: Array.from(env),
      }
    }
    return out
  }

  function parse(input: unknown, source: string) {
    const result = DataSchema.safeParse(input)
    if (!result.success) {
      log.warn("invalid model data", {
        source,
        error: result.error.flatten(),
      })
      return
    }
    return result.data
  }

  async function isAllowedModelPath(file: string) {
    const resolved = await fs.realpath(Filesystem.resolve(file)).catch(() => undefined)
    if (!resolved) return false
    const allowedDirs: string[] = [Global.Path.config, Global.Path.data, Global.Path.home]
    try {
      if (Instance.worktree && Instance.worktree !== "/") allowedDirs.push(Instance.worktree)
    } catch {
      // Instance context is optional for this loader in bootstrap paths.
    }
    try {
      allowedDirs.push(Instance.directory)
    } catch {
      // Instance directory may be unavailable if called outside a provisioned context.
    }

    return allowedDirs.some((root) => Filesystem.contains(root, resolved))
  }

  export const Data = lazy(async () => {
    const read = async (file: string, source: string) => {
      try {
        return await Filesystem.readJson(file)
      } catch (error: unknown) {
        const level = errorCode(error) === "ENOENT" ? "debug" : "warn"
        log[level]("failed to load model data", { source, file, error })
      }
    }

    const file = Flag.AX_CODE_MODELS_PATH
    if (file) {
      if (!(await isAllowedModelPath(file))) {
        log.warn("AX_CODE_MODELS_PATH outside allowed directories; ignoring", {
          file,
        })
      } else {
        const resolved = Filesystem.resolve(file)
        log.info("loading model data from file", { file: resolved })
        const data = parse(await read(resolved, "file"), "file")
        if (data) return data
      }
    }

    const url = Flag.AX_CODE_MODELS_URL
    if (url) {
      log.info("loading model data from url", { url })
      try {
        await Ssrf.assertPublicUrl(url, "AX_CODE_MODELS_URL")
        const res = await Ssrf.pinnedFetch(url, { signal: AbortSignal.timeout(10_000) })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = parse(await res.json(), "url")
        if (data) return data
      } catch (error) {
        log.warn("failed to load model data", { source: "url", url, error })
      }
    }

    log.info("loading bundled model snapshot")
    const bundled = parse(bundledSnapshot ?? {}, "bundled")
    if (bundled) return bundled
    throw new Error("bundled model snapshot is invalid")
  })

  // Memoize the sanitized view keyed on the Data() result reference:
  // Data() is lazy (stable object), but get() is called from several init
  // paths and sanitize() rebuilds the whole provider/model tree each time.
  // Callers treat the result as read-only (provider state converts entries
  // into fresh Info objects; the rest are display/serialization reads).
  let sanitized: { source: Record<string, Provider>; result: Record<string, Provider> } | undefined

  export async function get() {
    const data = await Data()
    if (sanitized?.source !== data) {
      sanitized = { source: data, result: sanitize(withCloudApiKeyAliases(withBuiltIns(data))) }
    }
    return sanitized.result
  }
}
