import { Log } from "../util/log"
import z from "zod"
import { lazy } from "@/util/lazy"
import { Filesystem } from "../util/filesystem"
import { Ssrf } from "../util/ssrf"
import bundledSnapshot from "./models-snapshot.json"

export namespace ModelsDev {
  const log = Log.create({ service: "models" })

  function gemini3(id: string) {
    return id.toLowerCase().includes("gemini-3")
  }

  function openai4(id: string) {
    const lower = id.toLowerCase()
    if (!lower.includes("gpt")) return true
    if (lower.includes("gpt-oss")) return true
    return lower.includes("gpt-4") || lower.includes("gpt-5")
  }

  function grok4(id: string) {
    const lower = id.toLowerCase()
    if (!lower.includes("grok")) return true
    // Grok-code is xAI's coding line, contemporaneous with Grok 4.
    if (lower.includes("grok-code")) return true
    // Allow Grok 4 and any future Grok N≥4. Parsing the version digit
    // (rather than substring matching "grok-4") so a future grok-5
    // doesn't get accidentally filtered out.
    const m = lower.match(/grok-(\d+)/)
    if (!m) return false // grok-beta, grok-vision-beta — no version, drop
    return parseInt(m[1], 10) >= 4
  }

  function glm5(id: string) {
    const lower = id.toLowerCase()
    if (!lower.includes("glm")) return true
    // Allow GLM 5 and any future GLM N≥5. Drops glm-3.x / glm-4.x.
    const m = lower.match(/glm-(\d+)/)
    if (!m) return false
    return parseInt(m[1], 10) >= 5
  }

  function supported(providerID: string, modelID: string) {
    if (providerID === "google" || providerID === "google-vertex") {
      if (!modelID.toLowerCase().includes("gemini")) return true
      return gemini3(modelID)
    }
    if (providerID === "openai") return openai4(modelID)
    if (providerID === "xai") {
      if (!modelID.toLowerCase().includes("grok")) return true
      return grok4(modelID)
    }
    if (
      providerID === "zhipuai" ||
      providerID === "zhipuai-coding-plan" ||
      providerID === "zai" ||
      providerID === "zai-coding-plan"
    )
      return glm5(modelID)
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

  export const Data = lazy(async () => {
    const read = async (file: string, source: string) => {
      try {
        return await Filesystem.readJson(file)
      } catch (error: any) {
        const level = error?.code === "ENOENT" ? "debug" : "warn"
        log[level]("failed to load model data", { source, file, error })
      }
    }

    const file = process.env["AX_CODE_MODELS_PATH"]
    if (file) {
      log.info("loading model data from file", { file })
      const data = parse(await read(file, "file"), "file")
      if (data) return data
    }

    const url = process.env["AX_CODE_MODELS_URL"]
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

  export async function get() {
    return sanitize(await Data())
  }
}
