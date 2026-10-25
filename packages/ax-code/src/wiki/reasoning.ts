import type { Provider } from "../provider/provider"
import { ProviderTransform } from "../provider/transform"
import { LOCAL_RUNTIME_PROVIDER_IDS } from "../mode/provider-category"
import { isDedicatedPrivateGpuProviderID } from "../provider/private-gpu/presets"
import { isLocalProviderHost } from "../provider/local-dispatcher"

type Options = Record<string, any>
export type WikiReasoningMode = "off" | "low" | "not-required" | "uncontrolled"
export type WikiReasoningPolicy = {
  mode: WikiReasoningMode
  providerOptions?: Record<string, Options>
}

// Restrict this preference to Wiki calls. Never merge the foreground session's
// high-effort variant into an auxiliary page request.
export function resolveWikiReasoning(model: Provider.Model, small: Options): WikiReasoningPolicy {
  const npm = model.api.npm
  const id = model.api.id.toLowerCase()
  const segment = id.split("/").at(-1) ?? id
  const nativeAnthropic = npm === "@ai-sdk/anthropic" || npm === "@ai-sdk/google-vertex/anthropic"
  if (!model.capabilities.reasoning && npm !== "cli") return { mode: "not-required" }

  if (npm === "@ai-sdk/google" || npm === "@ai-sdk/google-vertex") {
    // GenerateContent uses token budgets on 2.5 and levels on 3.x. Pro and
    // newer Flash models reject "minimal"; low is their common safe level.
    if (/^gemini-2\.5-flash(?:-lite)?(?:$|-)/.test(segment))
      return options(model, { thinkingConfig: { thinkingBudget: 0 } })
    if (/^gemini-2\.5-pro(?:$|-)/.test(segment)) return options(model, { thinkingConfig: { thinkingBudget: 128 } })
    if (/^gemini-(?:3(?:\.\d+)?|4-argon)(?:-|$)/.test(segment)) {
      const minimal = /^gemini-(?:3-flash|3\.[1356]-flash-lite|3\.[356]-flash)(?:-|$)/.test(segment)
      return options(model, { thinkingConfig: { thinkingLevel: minimal ? "minimal" : "low" } })
    }
    return { mode: "uncontrolled" }
  }

  if (model.options?.nativeReasoning === false) {
    // An explicit dialect opt-out must not re-enable generic effort fields.
    return localTemplate(model, small) ? options(model, small) : { mode: "uncontrolled" }
  }

  if (nativeAnthropic && segment === "minimax-m3.1-flash") return options(model, { effort: "low" })
  if (nativeAnthropic && model.providerID === "anthropic" && segment.startsWith("claude-")) {
    // Newer Claude models may default to thinking, and some cannot disable it.
    // Low effort survives this SDK even when disabled thinking is omitted.
    if (/^claude-(?:fable|mythos|(?:opus|sonnet|haiku)-(?:4-7|5))(?:-|$)/.test(segment))
      return options(model, { effort: "low" })
    // This SDK omits disabled thinking. Only older models default to off.
    if (/^claude-(?:(?:opus|sonnet|haiku)-4(?:-[0-6])?|3-[57]-sonnet)(?:-20\d{6}|-latest)?$/.test(segment))
      return options(model, { thinking: { type: "disabled" } })
  }

  // Prefer existing, explicit thinking-off controls (DeepSeek, Qwen, local
  // templates, Venice) and the scoped GLM/MiniMax low-effort page policies.
  if (mode(small) === "off" && (!small.chat_template_kwargs || localTemplate(model, small)))
    return options(model, small)
  // The older generic MiniMax helper assumes a local template. Hosted models
  // may ignore it, and M3.1 Flash rejects the generic M3 "none" variant.
  if (segment === "minimax-m3.1-flash" && mode(small) === "low") return options(model, small)
  if (segment.startsWith("minimax-") && small.chat_template_kwargs && !localTemplate(model, small))
    return { mode: "uncontrolled" }

  // Groq's GPT-OSS API accepts low/medium/high, not none. Qwen accepts none.
  if (
    npm === "@ai-sdk/groq" ||
    (npm === "@ai-sdk/openai-compatible" && /^gpt-oss-(?:20b|120b)$/.test(segment)) ||
    model.providerID === "groq"
  ) {
    if (/^gpt-oss-(?:20b|120b)$/.test(segment)) return options(model, { reasoningEffort: "low" })
    if (/^qwen3\.[68]-27b$/.test(segment)) return options(model, { reasoningEffort: "none" })
  }

  // Use the model's effective variants, including configured overrides and
  // disabled-variant filtering. An explicitly empty map is authoritative.
  const variants = model.variants ?? ProviderTransform.variants(model)
  for (const name of ["none", "off", "minimal", "low"]) {
    if (name === "low" && mode(small) === "low") return options(model, small)
    const variant = variants[name]
    if (variant && variant.disabled !== true && mode(variant)) return options(model, variant)
  }
  if (mode(small)) return options(model, small)
  return { mode: "uncontrolled" }
}

function localTemplate(model: Provider.Model, value: Options): boolean {
  if (value.chat_template_kwargs?.enable_thinking !== false && value.chat_template_kwargs?.thinking_mode !== "disabled")
    return false
  if (
    LOCAL_RUNTIME_PROVIDER_IDS.some((id) => id === model.providerID) ||
    isDedicatedPrivateGpuProviderID(model.providerID)
  )
    return true
  try {
    return isLocalProviderHost(new URL(model.api.url).hostname)
  } catch {
    return false
  }
}

function mode(value: Options): "off" | "low" | undefined {
  // A variant named low is not enough: inspect its actual controls. Never
  // mistake hiding reasoning (includeThoughts/exclude) for reducing effort.
  const efforts = [
    value.reasoningEffort,
    value.reasoning_effort,
    value.effort,
    value.thinkingConfig?.thinkingLevel,
    value.reasoning?.effort,
  ].filter((v) => v !== undefined)
  if (efforts.some((v) => !["none", "minimal", "low"].includes(v))) return undefined
  if (
    value.thinking?.type === "disabled" ||
    value.enable_thinking === false ||
    value.chat_template_kwargs?.enable_thinking === false ||
    value.chat_template_kwargs?.thinking_mode === "disabled" ||
    value.veniceParameters?.disableThinking === true ||
    value.thinkingConfig?.thinkingBudget === 0 ||
    value.reasoning?.enabled === false ||
    efforts.includes("none")
  )
    return "off"
  if (efforts.some((v) => v === "low" || v === "minimal")) return "low"
  if (value.thinkingConfig?.thinkingBudget === 128) return "low"
  return undefined
}

function options(model: Provider.Model, value: Options): WikiReasoningPolicy {
  const npm = model.api.npm
  // A recognized control in the wrong SDK namespace is silently discarded by
  // several adapters. Classify only fields this adapter actually consumes.
  const controls =
    npm === "@ai-sdk/anthropic" || npm === "@ai-sdk/google-vertex/anthropic"
      ? { thinking: value.thinking, effort: value.effort }
      : npm === "@ai-sdk/google" || npm === "@ai-sdk/google-vertex"
        ? { thinkingConfig: value.thinkingConfig }
        : npm === "@openrouter/ai-sdk-provider"
          ? { reasoning: value.reasoning }
          : ["@ai-sdk/openai", "@ai-sdk/groq", "@ai-sdk/xai", "@ai-sdk/deepseek"].includes(npm)
            ? { reasoningEffort: value.reasoningEffort }
            : npm === "cli"
              ? { effort: value.effort }
              : npm === "venice-ai-sdk-provider"
                ? { veniceParameters: value.veniceParameters }
                : npm === "@ai-sdk/openai-compatible"
                  ? value
                  : {}
  const selectedMode = mode(controls)
  if (!selectedMode) return { mode: "uncontrolled" }
  const key =
    npm === "@ai-sdk/anthropic" || npm === "@ai-sdk/google-vertex/anthropic"
      ? "anthropic"
      : npm === "@ai-sdk/groq"
        ? "groq"
        : npm === "@openrouter/ai-sdk-provider"
          ? "openrouter"
          : npm === "@ai-sdk/xai"
            ? "xai"
            : npm === "@ai-sdk/deepseek"
              ? "deepseek"
              : ProviderTransform.providerOptionsKey(model)
  if (npm !== "@ai-sdk/openai-compatible") return { mode: selectedMode, providerOptions: { [key]: value } }
  const { reasoning_effort, ...body } = value
  const effort = body.reasoningEffort ?? reasoning_effort
  if (effort !== undefined) body.reasoningEffort = effort
  return {
    mode: selectedMode,
    providerOptions: {
      ...(effort !== undefined && key !== "openaiCompatible" ? { openaiCompatible: { reasoningEffort: effort } } : {}),
      [key]: body,
    },
  }
}
