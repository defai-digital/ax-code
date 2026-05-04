import { Log } from "../util/log"
import z from "zod"
import { lazy } from "@/util/lazy"
import { Filesystem } from "../util/filesystem"
import { Ssrf } from "../util/ssrf"
import { Global } from "../global"
import { Instance } from "../project/instance"
import bundledSnapshot from "./models-snapshot.json"

export namespace ModelsDev {
  const log = Log.create({ service: "models" })

  function gemini3(id: string) {
    return id.toLowerCase().includes("gemini-3")
  }

  function normalizeModelProbe(value: string) {
    return value.toLowerCase().trim().replace(/[\s_]+/g, "-")
  }

  function modelProbes(modelID: string, model?: { id?: unknown; name?: unknown; family?: unknown }) {
    return [modelID, model?.id, model?.name, model?.family]
      .filter((value): value is string => typeof value === "string")
      .flatMap((value) => {
        const lower = value.toLowerCase()
        const normalized = normalizeModelProbe(lower)
        return [lower, normalized, normalized.replaceAll("-", "")]
      })
  }

  function openai4(probes: string[]) {
    if (!probes.some((probe) => probe.includes("gpt"))) return true
    if (probes.some((probe) => probe.includes("gpt-oss"))) return true
    if (probes.some((probe) => probe.includes("gpt-5.5") || probe.includes("gpt-5-5") || probe.includes("gpt55")))
      return false
    return probes.some((probe) => probe.includes("gpt-4") || probe.includes("gpt-5"))
  }

  function grok41OrAllowedCodingModel(probes: string[]) {
    if (!probes.some((probe) => probe.includes("grok"))) return true
    if (probes.some((probe) => {
      const finalSegment = probe.split("/").pop()
      return finalSegment === "grok-4.1" || finalSegment === "grok-4-1"
    }))
      return false
    if (probes.some((probe) => probe.split("/").pop() === "grok-code-fast-1")) return true
    // Allow Grok 4.1 and any future Grok N>4. Parsing major/minor
    // avoids keeping Grok 4.0 variants like grok-4, grok-4-fast, or
    // other unversioned grok-code-* aliases.
    for (const probe of probes) {
      const m = probe.match(/grok-(\d+)(?:[.-]?(\d+))?/)
      if (!m) continue
      const major = Number(m[1])
      const minor = m[2] === undefined ? 0 : Number(m[2])
      if (major > 4 || (major === 4 && minor >= 1)) return true
    }
    return false // grok-beta, grok-vision-beta — no 4.1+ version, drop
  }

  function glm5(probes: string[]) {
    if (!probes.some((probe) => probe.includes("glm"))) return true
    if (probes.some((probe) => probe.includes("glm-5v") || probe.includes("glm5v"))) return false
    // Allow non-vision GLM 5 and any future GLM N≥5. Drops glm-5v and glm-3.x / glm-4.x.
    for (const probe of probes) {
      const m = probe.match(/glm-(\d+)/)
      if (!m) continue
      if (parseInt(m[1], 10) >= 5) return true
    }
    return false
  }

  function supported(providerID: string, modelID: string, model?: { id?: unknown; name?: unknown; family?: unknown }) {
    const probes = modelProbes(modelID, model)
    const lower = probes[0] ?? modelID.toLowerCase()
    if (probes.some((probe) => probe.includes("gpt-5.5"))) return false
    if (providerID === "google" || providerID === "google-vertex") {
      if (!lower.includes("gemini")) return true
      return gemini3(lower)
    }
    if (providerID === "openai") return openai4(probes)
    if (providerID === "xai") {
      return grok41OrAllowedCodingModel(probes)
    }
    if (
      providerID === "zhipuai" ||
      providerID === "zhipuai-coding-plan" ||
      providerID === "zai" ||
      providerID === "zai-coding-plan"
    )
      return glm5(probes)
    return true
  }

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
      allowedDirs.push(Instance.directory)
    } catch {
      // Instance context is not guaranteed to be active when this data loader
      // runs in some test/bootstrap paths.
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

    const file = process.env["AX_CODE_MODELS_PATH"]
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
