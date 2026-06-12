import { Log } from "../util/log"
import z from "zod"
import { lazy } from "@/util/lazy"
import { Filesystem } from "../util/filesystem"
import { Ssrf } from "../util/ssrf"
import { Global } from "../global"
import { Instance } from "../project/instance"
import { Flag } from "../flag/flag"
import { isModelSupportedForProvider } from "./model-support"
import bundledSnapshot from "./models-snapshot.json"

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
    models: z.record(z.string(), Model),
  })

  export type Provider = z.infer<typeof Provider>

  const DataSchema = z.record(z.string(), Provider)

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

  function isAllowedModelPath(file: string) {
    const resolved = Filesystem.resolve(file)
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
      } catch (error: any) {
        const level = error?.code === "ENOENT" ? "debug" : "warn"
        log[level]("failed to load model data", { source, file, error })
      }
    }

    const file = Flag.AX_CODE_MODELS_PATH
    if (file) {
      if (!isAllowedModelPath(file)) {
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
    if (sanitized?.source !== data) sanitized = { source: data, result: sanitize(data) }
    return sanitized.result
  }
}
