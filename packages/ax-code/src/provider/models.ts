import { Log } from "../util/log"
import z from "zod"
import { lazy } from "@/util/lazy"
import { Filesystem } from "../util/filesystem"
import { Ssrf } from "../util/ssrf"
import bundledSnapshot from "./models-snapshot.json"

export namespace ModelsDev {
  const log = Log.create({ service: "models" })

  const Cost = z.object({
    input: z.number(),
    output: z.number(),
    cache_read: z.number().optional(),
    cache_write: z.number().optional(),
    reasoning: z.number().optional(),
  })

  function gemini3(id: string) {
    return id.toLowerCase().includes("gemini-3")
  }

  function openai4(id: string) {
    const lower = id.toLowerCase()
    if (!lower.includes("gpt")) return true
    if (lower.includes("gpt-oss")) return true
    return lower.includes("gpt-4") || lower.includes("gpt-5")
  }

  function supported(providerID: string, modelID: string) {
    if (providerID === "google" || providerID === "google-vertex") {
      if (!modelID.toLowerCase().includes("gemini")) return true
      return gemini3(modelID)
    }
    if (providerID === "openai") return openai4(modelID)
    return true
  }

  function sanitize(input: Record<string, Provider>) {
    return Object.fromEntries(
      Object.entries(input).map(([id, provider]) => [
        id,
        {
          ...provider,
          models: Object.fromEntries(Object.entries(provider.models).filter(([modelID]) => supported(id, modelID))),
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
    temperature: z.boolean(),
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
    cost: Cost,
    modalities: z
      .object({
        input: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
        output: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
      })
      .optional(),
    experimental: z.boolean().optional(),
    status: z.enum(["alpha", "beta", "deprecated"]).optional(),
    options: z.record(z.string(), z.any()),
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

  export const Data = lazy(async () => {
    const read = async (file: string, source: string) => {
      try {
        return (await Filesystem.readJson(file)) as Record<string, unknown>
      } catch (error: any) {
        const level = error?.code === "ENOENT" ? "debug" : "warn"
        log[level]("failed to load model data", { source, file, error })
      }
    }

    const file = process.env["AX_CODE_MODELS_PATH"]
    if (file) {
      log.info("loading model data from file", { file })
      const data = await read(file, "file")
      if (data) return data
    }

    const url = process.env["AX_CODE_MODELS_URL"]
    if (url) {
      log.info("loading model data from url", { url })
      try {
        await Ssrf.assertPublicUrl(url, "AX_CODE_MODELS_URL")
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return (await res.json()) as Record<string, unknown>
      } catch (error) {
        log.warn("failed to load model data", { source: "url", url, error })
      }
    }

    log.info("loading bundled model snapshot")
    return (bundledSnapshot ?? {}) as Record<string, unknown>
  })

  export async function get() {
    return sanitize((await Data()) as Record<string, Provider>)
  }
}
