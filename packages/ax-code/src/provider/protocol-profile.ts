import { modelIdFinalSegment } from "./model-id"
import { isDedicatedPrivateGpuProviderID } from "./private-gpu/presets"

type ProtocolModel = {
  providerID: string
  api: { id: string; url?: string; npm?: string }
  family?: string
  options?: Record<string, unknown>
}

export type ChatReasoningFamily = "qwen3.8" | "glm5.3" | "deepseek-v4" | "minimax-m3" | "minimax-m2.7"
const families: readonly string[] = ["qwen3.8", "glm5.3", "deepseek-v4", "minimax-m3", "minimax-m2.7"]

export function isKimiProtocol(model: ProtocolModel): boolean {
  if (["kimi-for-coding", "kimi-cloud-plan", "moonshotai", "moonshotai-cn"].includes(model.providerID)) return true
  if ([model.api.id, model.family].some((id) => /kimi|moonshot/i.test(id ?? ""))) return true
  try {
    const host = new URL(model.api.url ?? "").hostname
    return ["api.kimi.com", "api.moonshot.ai", "api.moonshot.cn", "api.moonshotai.cn"].includes(host)
  } catch {
    return false
  }
}

function reasoningFamily(model: ProtocolModel): ChatReasoningFamily | undefined {
  const explicit = model.options?.protocolProfile
  if (typeof explicit === "string" && families.includes(explicit)) return explicit as ChatReasoningFamily
  if (explicit === "openai-compatible" || explicit === "dashscope") return undefined
  if (model.api.npm !== "@ai-sdk/openai-compatible" || model.options?.nativeReasoning === false) return undefined
  if (isDedicatedPrivateGpuProviderID(model.providerID)) return undefined
  if (
    [
      "ax-engine",
      "groq",
      "openrouter",
      "nvidia",
      "lilac",
      "ollama",
      "lmstudio",
      "mtplx",
      "omlx",
      "ax-studio",
      "local-llm",
    ].includes(model.providerID)
  )
    return undefined
  let host = ""
  try {
    host = new URL(model.api.url ?? "").hostname
    if (["openrouter.ai", "api.groq.com", "integrate.api.nvidia.com"].includes(host)) return undefined
  } catch {}
  const id = model.api.id.toLowerCase()
  const segment = modelIdFinalSegment(id)
  if (/^qwen3\.8-(?:max|flash)$/.test(segment)) return "qwen3.8"
  if (
    model.providerID.startsWith("alibaba-coding-plan") ||
    model.providerID.startsWith("alibaba-token-plan") ||
    ["alibaba", "alibaba-cn"].includes(model.providerID) ||
    host === "dashscope.aliyuncs.com" ||
    host.endsWith(".maas.aliyuncs.com") ||
    (host.startsWith("dashscope-") && host.endsWith(".aliyuncs.com"))
  )
    return undefined
  if (/^glm-5\.3(?:-flash)?$/.test(segment)) return "glm5.3"
  if (/^deepseek-(?:v4-(?:pro|flash)|flash)$/.test(id)) return "deepseek-v4"
  if (id === "minimax-m3" || id === "minimax-m2.7") return id
  return undefined
}

export function resolveProtocolProfile(model: ProtocolModel) {
  const npm = model.api.npm ?? "@ai-sdk/openai-compatible"
  const family = reasoningFamily(model)
  const schemaDialect = isKimiProtocol(model)
    ? "moonshot"
    : model.providerID === "google" || model.api.id.includes("gemini")
      ? "gemini"
      : "json-schema"
  const providerOptionsKey =
    npm === "@ai-sdk/google" || npm === "@ai-sdk/google-vertex"
      ? "google"
      : npm === "@ai-sdk/openai"
        ? "openai"
        : model.providerID.split(".")[0]?.trim() || model.providerID
  return Object.freeze({
    id: `${npm}:${family ?? "standard"}:${schemaDialect}`,
    revision: 1,
    adapter: npm,
    reasoningFamily: family,
    schemaDialect,
    providerOptionsKey,
  })
}
