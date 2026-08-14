import type { ModelMessage } from "ai"
import type { JSONSchema7 } from "@ai-sdk/provider"
import type { JSONSchema } from "zod/v4/core"
import { mergeDeep } from "remeda"
import type { Provider } from "./provider"
import type { ModelsDev } from "./models"
import { Flag } from "@/flag/flag"
import { isRecord } from "@/util/record"
import { buildSearchParameters, type LiveSearchConfig } from "./xai/server-tools"
import { isQwen37MaxOrPlusModel } from "./model-capabilities"
import { modelIdFinalSegment } from "./model-id"
import { AX_ENGINE_PROVIDER_ID } from "./ax-engine/constants"
import { cliEffortVariants } from "./cli/effort"
import { wrapThinkTagText } from "./think-tags"
import { PromptCachePolicy } from "./prompt-cache-policy"

type Modality = NonNullable<ModelsDev.Model["modalities"]>["input"][number]

function mimeToModality(mime: string): Modality | undefined {
  if (mime.startsWith("image/")) return "image"
  if (mime.startsWith("audio/")) return "audio"
  if (mime.startsWith("video/")) return "video"
  if (mime === "application/pdf") return "pdf"
  return undefined
}

export namespace ProviderTransform {
  export const OUTPUT_TOKEN_MAX = Flag.AX_CODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX || 32_000
  // Qwen 3.7 Max's documented output limit is 65 536 tokens across all
  // non-Alibaba routes (TogetherAI, Vercel). We raise the cap
  // specifically for this model so callers get the full generation budget
  // without lifting OUTPUT_TOKEN_MAX for every other model.
  const QWEN37_MAX_OUTPUT_TOKENS = 65_536
  // GLM 5.x (Z.AI / Zhipu coding + general endpoints) documents a 131 072-token
  // output limit. Raise the cap to that ceiling for the glm family so the large
  // coding generations the model is built for aren't clipped at the 32k default,
  // without lifting OUTPUT_TOKEN_MAX for every other provider. The Alibaba
  // short-window guard runs first, so GLM routed through a DashScope plan still
  // gets the conservative reservation cap.
  const GLM_OUTPUT_TOKEN_MAX = 131_072
  // DashScope and Token Plan both reserve `prompt + max_tokens` against a
  // sliding short-window quota *before* generation. Defaulting to 4k keeps
  // headroom for parallel agents and long-context requests while still letting
  // a single edit fit comfortably; users with tighter accounts can drop this
  // to 2048 / 1024 via AX_CODE_ALIBABA_OUTPUT_TOKEN_MAX.
  const ALIBABA_OUTPUT_TOKEN_MAX_DEFAULT = 4_096
  const ALIBABA_OUTPUT_TOKEN_MAX = Flag.AX_CODE_ALIBABA_OUTPUT_TOKEN_MAX || ALIBABA_OUTPUT_TOKEN_MAX_DEFAULT
  // Groq also rate-limits against the requested output reservation. The public
  // model ceiling is useful metadata, but using it as the default max_tokens
  // makes ordinary short prompts reserve 32k+ tokens and trip TPM limits.
  const GROQ_OUTPUT_TOKEN_MAX_DEFAULT = 4_096
  const GROQ_OUTPUT_TOKEN_MAX = Flag.AX_CODE_GROQ_OUTPUT_TOKEN_MAX || GROQ_OUTPUT_TOKEN_MAX_DEFAULT
  // Qwen 3.7 Max/Plus on Alibaba routes: the generic 4k cap is far too
  // conservative for models with 64k output capacity. Raise to 16k so
  // super-long runs get meaningful generation budget while still leaving
  // headroom for parallel agents on the DashScope short-window quota.
  const QWEN37_ALIBABA_OUTPUT_TOKEN_MAX = 16_384
  // Cap for `budgetTokens` (Token Plan) and `thinking_budget` (Coding Plan)
  // on Alibaba reasoning models. 8192 matches the value in the upstream
  // OpenCode example. The effective budget is clamped further by
  // maxOutputTokens (controlled by AX_CODE_ALIBABA_OUTPUT_TOKEN_MAX), so
  // there is no separate knob for this — adjusting output max already
  // covers throttling needs.
  const ALIBABA_THINKING_BUDGET_TOKENS = 8_192
  // Qwen 3.7 Max/Plus support up to 262k thinking budget per the snapshot's
  // reasoning_options. Raise the budget for these models so the reasoning
  // engine gets meaningful allocation on Alibaba routes.
  const QWEN37_ALIBABA_THINKING_BUDGET = 16_384

  // Maps npm package to the key the AI SDK expects for providerOptions.
  // The Vertex provider uses the same "google" key as the Gemini provider,
  // so variant options (thinkingConfig, reasoning effort) produced by
  // variants() land under the right namespace.
  function sdkKey(npm: string): string | undefined {
    switch (npm) {
      case "@ai-sdk/google":
      case "@ai-sdk/google-vertex":
        return "google"
      case "@ai-sdk/openai":
        return "openai"
    }
    return undefined
  }

  function normalizeMessages(
    msgs: ModelMessage[],
    model: Provider.Model,
    _options: Record<string, unknown>,
  ): ModelMessage[] {
    const interleavedField =
      typeof model.capabilities.interleaved === "object" ? model.capabilities.interleaved.field : undefined

    // MiniMax on OpenAI-compat / private GPU emits <mm:think> in the text
    // stream. We parse those into reasoning parts for the UI, then fold them
    // back into tagged text on the next turn so vLLM does not see
    // `reasoning_content` (which MiniMax-M3 on PAI rejects).
    if (usesThinkTags(model)) return foldThinkTagReasoning(msgs)

    // DeepSeek requires a reasoning part on every assistant message, even when
    // empty. OpenCode injects one; without it some DeepSeek endpoints 400.
    if (isDeepSeekFamily(model)) msgs = padDeepSeekReasoning(msgs)

    // Whether we need to strip reasoning parts from assistant messages.
    //
    // Case 1 — interleaved.field declared (e.g. Kimi/Moonshot,
    // deepseek-reasoner, GLM on many providers): the model accepts reasoning on
    // input via a provider-specific top-level field. We strip the reasoning
    // PARTS and carry their text through providerOptions.openaiCompatible[field]
    // so the provider receives it in the expected position.
    //
    // Case 2 — the provider's API REJECTS `reasoning_content` on input assistant
    // messages. The @ai-sdk/openai-compatible serializer unconditionally emits
    // `reasoning_content` whenever a reasoning part is present, so for these
    // providers we must strip the parts before they reach the wire. Groq is the
    // known rejecter: "property 'reasoning_content' is unsupported" — even for
    // reasoning-capable models like gpt-oss and qwen3.6-27b.
    //
    // All other openai-compatible models are left untouched: many providers
    // (DeepSeek, Qwen, etc.) accept reasoning_content on input and benefit from
    // cross-turn reasoning carry-over. Stripping would silently degrade their
    // quality, so we do NOT strip by default.
    const mustStrip = Boolean(interleavedField) || rejectsReasoningContentOnInput(model)
    if (!mustStrip) return msgs

    const field = interleavedField
    return msgs.map((msg) => {
      if (msg.role !== "assistant" || !Array.isArray(msg.content)) return msg

      // Single pass: collect reasoning text and the non-reasoning content
      // simultaneously. The previous impl ran two filter() passes over the
      // same array — visible on long assistant turns with many parts.
      let reasoningText = ""
      const filteredContent: typeof msg.content = []
      for (const part of msg.content as Array<{ type: string; text?: string }>) {
        if (part.type === "reasoning") {
          if (part.text) reasoningText += part.text
        } else {
          filteredContent.push(part as (typeof msg.content)[number])
        }
      }

      // When an interleaved field is declared, carry the reasoning text
      // through providerOptions so the provider receives it in its expected
      // top-level position. Otherwise the parts are simply dropped (the
      // provider rejects reasoning_content, so there is nothing to carry).
      if (field) {
        // Always set the interleaved field, including when empty. DeepSeek
        // (and some GLM/Kimi routes) reject a missing reasoning_content on
        // follow-up assistant turns even if this turn had no thinking.
        const existing = (msg.providerOptions as { openaiCompatible?: Record<string, string> } | undefined)
          ?.openaiCompatible
        return {
          ...msg,
          content: filteredContent,
          providerOptions: {
            ...msg.providerOptions,
            openaiCompatible: {
              ...existing,
              [field]: reasoningText,
            },
          },
        }
      }

      return {
        ...msg,
        content: filteredContent,
      }
    })
  }

  // Providers whose API rejects `reasoning_content` on INPUT assistant messages.
  // The @ai-sdk/openai-compatible serializer emits this field unconditionally
  // whenever a reasoning part is present, so for these providers we strip the
  // reasoning parts in normalizeMessages before they reach the wire. This is an
  // explicit denylist rather than a broad default because hundreds of
  // openai-compatible reasoning models (DeepSeek-R1, Qwen, etc. on many
  // providers) accept and benefit from reasoning_content carry-over; stripping
  // by default would silently degrade their multi-turn reasoning quality.
  function rejectsReasoningContentOnInput(model: Provider.Model): boolean {
    if (model.api.npm !== "@ai-sdk/openai-compatible") return false
    return model.providerID === "groq"
  }

  function unsupportedParts(msgs: ModelMessage[], model: Provider.Model): ModelMessage[] {
    return msgs.map((msg) => {
      if (msg.role !== "user" || !Array.isArray(msg.content)) return msg

      const filtered = msg.content.map((part) => {
        if (part.type !== "file" && part.type !== "image") return part

        // Parse the image source once. For data: URLs the previous impl ran a
        // greedy regex `/^data:([^;]+);base64,(.*)$/` against the full string
        // and a separate `split(";")[0].replace("data:", "")` — both scan the
        // entire base64 payload (potentially megabytes). Use indexOf so we
        // never touch the payload bytes for header parsing.
        let mime: string
        if (part.type === "image") {
          const imageStr = part.image.toString()
          if (/^data:/i.test(imageStr)) {
            const semiIdx = imageStr.indexOf(";", 5)
            mime = semiIdx === -1 ? imageStr.slice(5) : imageStr.slice(5, semiIdx)
            // Empty `data:<mime>;base64,` — payload is empty.
            if (semiIdx !== -1) {
              const commaIdx = imageStr.indexOf(",", semiIdx + 1)
              if (
                commaIdx === imageStr.length - 1 &&
                imageStr.slice(semiIdx + 1, commaIdx).toLowerCase() === "base64"
              ) {
                return {
                  type: "text" as const,
                  text: "ERROR: Image file is empty or corrupted. Please provide a valid image.",
                }
              }
            }
          } else {
            // Non-data URLs (https://, etc.) are images by default — they
            // originated from image parts. Use an image mime so the modality
            // check below can verify the model supports image input instead
            // of silently passing through.
            mime = "image/unknown"
          }
        } else {
          mime = part.mediaType
        }
        const filename = part.type === "file" ? part.filename : undefined
        const modality = mimeToModality(mime)
        if (!modality) return part
        if (model.capabilities.input[modality]) return part

        const name = filename ? `"${filename}"` : modality
        return {
          type: "text" as const,
          text: `ERROR: Cannot read ${name} (this model does not support ${modality} input). Inform the user.`,
        }
      })

      return { ...msg, content: filtered }
    })
  }

  export function message(msgs: ModelMessage[], model: Provider.Model, options: Record<string, unknown>) {
    msgs = unsupportedParts(msgs, model)
    msgs = normalizeMessages(msgs, model, options)
    // Official Ornith jinja raises "System message must be at the beginning"
    // when any system turn is not messages[0]. AX Code emits several system
    // blocks (env, family prompt, craft, cache slices). Collapse them.
    if (isOrnithFamily(model)) msgs = collapseToSingleLeadingSystem(msgs)
    if (shouldApplyCaching(model, options)) {
      msgs = applyCaching(msgs, model)
    }
    return msgs
  }

  function systemText(content: ModelMessage["content"]): string {
    if (typeof content === "string") return content
    if (!Array.isArray(content)) return ""
    return content
      .map((part) => {
        if (typeof part === "string") return part
        if (part && typeof part === "object" && "text" in part && typeof (part as { text?: unknown }).text === "string") {
          return (part as { text: string }).text
        }
        return ""
      })
      .filter(Boolean)
      .join("\n")
  }

  function collapseToSingleLeadingSystem(msgs: ModelMessage[]): ModelMessage[] {
    const systems = msgs.filter((msg) => msg.role === "system")
    if (systems.length <= 1) return msgs
    const merged = systems
      .map((msg) => systemText(msg.content).trim())
      .filter(Boolean)
      .join("\n\n")
    const [first] = systems
    return [{ ...first, role: "system", content: merged }, ...msgs.filter((msg) => msg.role !== "system")]
  }

  // Mirrors OpenCode: stamp cache_control on the first two system messages and
  // the last two non-system messages so the stable prefix can be reused.
  function applyCaching(msgs: ModelMessage[], model: Provider.Model): ModelMessage[] {
    const system = msgs.filter((msg) => msg.role === "system").slice(0, 2)
    const final = msgs.filter((msg) => msg.role !== "system").slice(-2)

    const providerOptions = {
      anthropic: {
        cacheControl: { type: "ephemeral" },
      },
      openrouter: {
        cacheControl: { type: "ephemeral" },
      },
      bedrock: {
        cachePoint: { type: "default" },
      },
      openaiCompatible: {
        cache_control: { type: "ephemeral" },
      },
      alibaba: {
        cacheControl: { type: "ephemeral" },
      },
    }

    const seen = new Set<ModelMessage>()
    for (const msg of [...system, ...final]) {
      if (seen.has(msg)) continue
      seen.add(msg)

      const useMessageLevelOptions =
        model.providerID === "anthropic" ||
        model.providerID.includes("bedrock") ||
        model.api.npm === "@ai-sdk/amazon-bedrock"
      const shouldUseContentOptions = !useMessageLevelOptions && Array.isArray(msg.content) && msg.content.length > 0

      if (shouldUseContentOptions) {
        const lastContent = msg.content[msg.content.length - 1] as { type?: string; providerOptions?: object }
        const attachable =
          lastContent &&
          typeof lastContent === "object" &&
          lastContent.type !== "tool-approval-request" &&
          lastContent.type !== "tool-approval-response" &&
          lastContent.type !== "tool-call" &&
          lastContent.type !== "tool-result"
        if (attachable) {
          lastContent.providerOptions = mergeDeep(lastContent.providerOptions ?? {}, providerOptions)
          continue
        }
      }

      msg.providerOptions = mergeDeep(msg.providerOptions ?? {}, providerOptions)
    }

    return msgs
  }

  function shouldApplyCaching(model: Provider.Model, options: Record<string, unknown>): boolean {
    const usesAnthropicAutomaticCaching =
      options.cacheControl !== undefined &&
      (model.api.npm === "@ai-sdk/anthropic" || model.api.npm === "@ai-sdk/google-vertex/anthropic")
    if (usesAnthropicAutomaticCaching) return false
    if (model.api.npm === "@ai-sdk/gateway") return false
    if (PromptCachePolicy.honorsExplicitCache(model.providerID)) return true
    return (
      model.providerID === "anthropic" ||
      model.providerID === "google-vertex-anthropic" ||
      model.api.id.includes("anthropic") ||
      model.api.id.includes("claude") ||
      model.id.includes("anthropic") ||
      model.id.includes("claude") ||
      model.api.npm === "@ai-sdk/anthropic" ||
      model.api.npm === "@ai-sdk/alibaba"
    )
  }

  export function isKimiFamily(model: {
    id?: string
    providerID: string
    api: { id: string; url?: string }
  }): boolean {
    const ids = [model.providerID, model.api.id, model.id]
    if (
      ids.some((id) => {
        if (!id) return false
        const value = id.toLowerCase()
        return value.includes("kimi") || value.includes("moonshot")
      })
    ) {
      return true
    }
    const url = (model.api.url ?? "").toLowerCase()
    return ["api.kimi.com", "api.moonshot.ai", "api.moonshot.cn", "api.moonshotai.cn"].some((host) => url.includes(host))
  }

  export function isOrnithFamily(model: { id?: string; providerID: string; api: { id: string } }): boolean {
    return [model.providerID, model.api.id, model.id].some((id) => id?.toLowerCase().includes("ornith"))
  }

  function shouldSetPromptCacheKey(input: {
    model: Provider.Model
    providerOptions?: Record<string, any>
    longAgent?: boolean
  }): boolean {
    if (input.providerOptions?.setCacheKey === true) return true
    if (isKimiFamily(input.model)) return true
    if (input.model.providerID === "alibaba-pai") return true
    if (input.model.providerID === "venice") return true
    if (isAlibabaThinkingModel(input.model) && input.longAgent) return true
    return false
  }

  export function temperature(model: Provider.Model) {
    // Official Ornith serving recipes use 0.6 / 0.95. Check before the Qwen
    // family match so a declared qwen* family does not override it.
    if (isOrnithFamily(model)) return 0.6
    if (hasFamily(model, "qwen")) return 0.55
    if (hasFamily(model, "gemini")) return 1.0
    if (hasFamily(model, "glm")) return 1.0
    if (isMinimaxM2(model)) return 1.0
    if (isKimiFamily(model)) {
      const id = `${model.id} ${model.api.id}`.toLowerCase()
      // K2.5 / thinking / k2p follow OpenCode (1.0). Base K2 stays 0.6.
      if (["thinking", "k2.", "k2p", "k2-5"].some((token) => id.includes(token))) return 1.0
      if (id.includes("kimi-k2")) return 0.6
    }
    return undefined
  }

  export function topP(model: Provider.Model) {
    if (isOrnithFamily(model)) return 0.95
    if (hasFamily(model, "qwen")) return 1
    if (isMinimaxM2(model) || hasFamily(model, "gemini")) return 0.95
    const id = `${model.id} ${model.api.id}`.toLowerCase()
    if (["kimi-k2.5", "kimi-k2p5", "kimi-k2-5"].some((token) => id.includes(token))) return 0.95
    if (id.includes("deepseek-v4-flash")) return 0.95
    return undefined
  }

  export function topK(model: Provider.Model) {
    const id = model.id.toLowerCase()
    if (isMinimaxM2(model)) {
      // Versioned m2 models (m2.1/m2.5/m2.7 and their dashed/dashless
      // spellings) use a wider top-k than the base m2.
      return /m2[.-]?\d/.test(id) ? 40 : 20
    }
    if (hasFamily(model, "gemini")) return 64
    return undefined
  }

  const WIDELY_SUPPORTED_EFFORTS = ["low", "medium", "high"]
  const ANTHROPIC_EFFORTS = ["low", "medium", "high", "max"]

  // Anthropic thinking budget per effort tier. budgetTokens must stay below
  // the request's max_tokens, which maxOutputTokens caps at OUTPUT_TOKEN_MAX
  // (32k), so 16k always leaves room for actual output.
  const ANTHROPIC_THINKING_BUDGETS: Record<string, number> = {
    low: 2_048,
    medium: 8_192,
    high: 16_384,
  }

  // Match against the declared family when available, otherwise only the
  // final model-id segment. This avoids substring matches from provider or
  // account prefixes such as `accounts/qwen-tools/...` while still matching
  // ids like `google/gemini-3-flash` and family aliases such as
  // `gemini-flash`.
  function hasFamily(model: Provider.Model, family: string): boolean {
    const matches = (value?: string) => {
      if (!value) return false
      if (!value.startsWith(family)) return false
      const next = value[family.length]
      return next === undefined || /[^a-z0-9]/.test(next)
    }
    const segment = model.id ? modelIdFinalSegment(model.id).toLowerCase() : undefined
    const declared = model.family?.toLowerCase()
    return matches(segment) || matches(declared)
  }

  // "minimax-m2" family, including the dashless id spellings (minimax-m25 ==
  // minimax-m2.5) some providers use. hasFamily rejects those because a digit
  // immediately follows "minimax-m2", which would otherwise deny them the
  // temperature/topP/topK tuning the dotted variants receive.
  function isMinimaxM2(model: Provider.Model): boolean {
    if (hasFamily(model, "minimax-m2")) return true
    const segment = modelIdFinalSegment(model.id).toLowerCase()
    return /^minimax-m2\d/.test(segment)
  }

  function isMinimax(model: Provider.Model): boolean {
    if (hasFamily(model, "minimax")) return true
    const segment = modelIdFinalSegment(model.id).toLowerCase()
    const api = model.api.id.toLowerCase()
    return segment.includes("minimax") || api.includes("minimax")
  }

  function isMinimaxM3(model: Provider.Model): boolean {
    const id = `${model.id} ${model.api.id}`.toLowerCase()
    return id.includes("minimax-m3")
  }

  function isGlm52(model: Provider.Model): boolean {
    const id = `${model.id} ${model.api.id}`.toLowerCase()
    return ["glm-5.2", "glm-5-2", "glm-5p2"].some((token) => id.includes(token))
  }

  function isZaiProvider(providerID: string): boolean {
    return providerID.startsWith("zai") || providerID.startsWith("zhipuai")
  }

  function isPrivateGpuProvider(providerID: string): boolean {
    return (
      providerID === "alibaba-pai" ||
      providerID === "runpod" ||
      providerID === "huggingface-endpoints" ||
      providerID === "sagemaker" ||
      providerID === "volcengine-ark" ||
      providerID === "modelarts" ||
      providerID === "tencent-ti"
    )
  }

  function isDeepSeekFamily(model: Provider.Model): boolean {
    if (hasFamily(model, "deepseek")) return true
    const id = `${model.id} ${model.api.id}`.toLowerCase()
    return id.includes("deepseek")
  }

  function padDeepSeekReasoning(msgs: ModelMessage[]): ModelMessage[] {
    return msgs.map((msg) => {
      if (msg.role !== "assistant") return msg
      if (Array.isArray(msg.content)) {
        if (msg.content.some((part) => part.type === "reasoning")) return msg
        return { ...msg, content: [...msg.content, { type: "reasoning", text: "" }] }
      }
      return {
        ...msg,
        content: [
          ...(msg.content ? [{ type: "text" as const, text: msg.content }] : []),
          { type: "reasoning" as const, text: "" },
        ],
      }
    })
  }

  // Tag-style thinking: MiniMax-M3 on dedicated GPU (PAI/vLLM) writes
  // `<mm:think>` into the text stream. DashScope MiniMax uses enable_thinking
  // instead and must keep the existing Alibaba path.
  function usesThinkTags(model: Provider.Model): boolean {
    if (isAlibabaPlanProvider(model.providerID)) return false
    return isMinimax(model)
  }

  function foldThinkTagReasoning(msgs: ModelMessage[]): ModelMessage[] {
    return msgs.map((msg) => {
      if (msg.role !== "assistant" || !Array.isArray(msg.content)) return msg
      let reasoningText = ""
      const rest: typeof msg.content = []
      for (const part of msg.content as Array<{ type: string; text?: string }>) {
        if (part.type === "reasoning") {
          if (part.text) reasoningText += part.text
        } else {
          rest.push(part as (typeof msg.content)[number])
        }
      }
      if (!reasoningText) return msg
      const tagged = wrapThinkTagText(reasoningText)
      const firstText = rest.findIndex((part) => part.type === "text")
      if (firstText >= 0) {
        const part = rest[firstText] as { type: "text"; text: string }
        rest[firstText] = { ...part, text: `${tagged}\n${part.text}` }
      } else {
        rest.unshift({ type: "text", text: tagged } as (typeof msg.content)[number])
      }
      return { ...msg, content: rest }
    })
  }

  // DashScope Coding Plan / Token Plan only. Dedicated PAI-EAS GPU services
  // use the same `alibaba-` prefix but are not subject to Model Studio
  // short-window reservation or DashScope thinking params.
  function isAlibabaPlanProvider(providerID: string) {
    return providerID.startsWith("alibaba-coding-plan") || providerID.startsWith("alibaba-token-plan")
  }

  // Any reasoning-capable Alibaba model on an OpenAI-compat endpoint goes
  // through DashScope's documented `enable_thinking` + `thinking_budget`
  // params. Capability-driven so newly added reasoning models pick up
  // thinking automatically. The npm guard keeps a future Anthropic-SDK
  // Alibaba endpoint from accidentally matching this path — that endpoint
  // would need the Anthropic `thinking` block instead.
  function isAlibabaThinkingModel(model: Provider.Model) {
    if (!isAlibabaPlanProvider(model.providerID)) return false
    if (model.api.npm !== "@ai-sdk/openai-compatible") return false
    return Boolean(model.capabilities.reasoning)
  }

  // Token Plan / Coding Plan (DashScope) short-window token reservation.
  // The cap applies regardless of model family because reservation is
  // computed by the platform, not the model. PAI-EAS is excluded.
  function isAlibabaShortWindowProvider(model: Provider.Model) {
    return isAlibabaPlanProvider(model.providerID)
  }

  function supportsAnthropicEffort(model: Provider.Model) {
    const id = `${model.id} ${model.api.id}`.toLowerCase().replaceAll(".", "-")
    return (
      /claude-opus-?4-[5-8](?:$|[^0-9])/.test(id) ||
      /claude-sonnet-?4-6(?:$|[^0-9])/.test(id) ||
      /claude-(?:fable|mythos|sonnet)-?5(?:$|[^0-9])/.test(id) ||
      id.includes("claude-mythos-preview")
    )
  }

  function isAnthropicOpus45(model: Provider.Model) {
    const id = `${model.id} ${model.api.id}`.toLowerCase().replaceAll(".", "-")
    return /claude-opus-?4-5(?:$|[^0-9])/.test(id)
  }

  function usesAnthropicAdaptiveThinking(model: Provider.Model) {
    const id = `${model.id} ${model.api.id}`.toLowerCase().replaceAll(".", "-")
    return /claude-(?:opus-?4-[6-8]|sonnet-?4-6)(?:$|[^0-9])/.test(id)
  }

  function supportsXaiEffort(model: Provider.Model) {
    const id = model.api.id.toLowerCase()
    return /^grok-4\.5(?:$|-)/.test(id) || /^grok-4\.20-multi-agent(?:$|-)/.test(id)
  }

  function alibabaThinkingBudget(model: Provider.Model, requested?: unknown) {
    const max = maxOutputTokens(model)
    const value = typeof requested === "number" && Number.isFinite(requested) && requested > 0 ? requested : max
    const budgetCap = isQwen37MaxOrPlusModel(model.id ?? "")
      ? QWEN37_ALIBABA_THINKING_BUDGET
      : ALIBABA_THINKING_BUDGET_TOKENS
    return Math.min(Math.floor(value), max, budgetCap)
  }

  function glm52ReasoningVariants(model: Provider.Model): Record<string, Record<string, any>> | undefined {
    if (!isGlm52(model)) return undefined
    // z.ai wire shape is locked empty until ADR-040 M2. Private GPU / vLLM
    // rejects OpenAI reasoningEffort (think-tags or native reasoning_content).
    if (isZaiProvider(model.providerID) || isPrivateGpuProvider(model.providerID)) return undefined
    if (model.api.npm === "@openrouter/ai-sdk-provider") {
      return {
        high: { reasoning: { effort: "high" } },
        xhigh: { reasoning: { effort: "xhigh" } },
      }
    }
    if (model.api.npm === "@ai-sdk/openai-compatible") {
      return {
        high: { reasoningEffort: "high" },
        max: { reasoningEffort: "max" },
      }
    }
    if (model.api.npm === "@ai-sdk/anthropic") {
      return {
        high: { effort: "high" },
        max: { effort: "max" },
      }
    }
    return undefined
  }

  function minimaxM3ReasoningVariants(model: Provider.Model): Record<string, Record<string, any>> | undefined {
    if (!isMinimaxM3(model)) return undefined
    if (!["@ai-sdk/anthropic", "@ai-sdk/openai-compatible"].includes(model.api.npm)) return undefined
    // PAI / vLLM MiniMax uses <mm:think> tags, not Anthropic thinking blocks.
    if (isPrivateGpuProvider(model.providerID)) return undefined
    if (["nvidia", "lilac"].includes(model.providerID)) {
      return {
        none: { chat_template_kwargs: { thinking_mode: "disabled" } },
        thinking: { chat_template_kwargs: { thinking_mode: "enabled" } },
      }
    }
    return {
      none: { thinking: { type: "disabled" } },
      thinking: { thinking: { type: "adaptive" } },
    }
  }

  function kimiAnthropicReasoningVariants(model: Provider.Model): Record<string, Record<string, any>> | undefined {
    if (!isKimiFamily(model)) return undefined
    if (!["@ai-sdk/anthropic", "@ai-sdk/google-vertex/anthropic"].includes(model.api.npm)) return undefined
    return Object.fromEntries(
      ["low", "medium", "high", "xhigh", "max"].map((effort) => [
        effort,
        { thinking: { type: "adaptive", display: "summarized" }, effort },
      ]),
    )
  }

  export function variants(model: Provider.Model): Record<string, Record<string, any>> {
    // CLI providers report reasoning=false because their output is opaque to
    // the AI SDK, but several CLIs expose a documented effort flag. Publish
    // those variants before the capability gate and translate them when the
    // subprocess command is built.
    if (model.api.npm === "cli") return cliEffortVariants(model.providerID)

    if (!model.capabilities.reasoning) return {}

    const id = model.id.toLowerCase()

    // GLM 5.2 / MiniMax M3 / Kimi-on-Anthropic have documented effort knobs.
    // Keep the older family-wide empty return below for everything else.
    const glm52Variants = glm52ReasoningVariants(model)
    if (glm52Variants) return glm52Variants
    const minimaxM3Variants = minimaxM3ReasoningVariants(model)
    if (minimaxM3Variants) return minimaxM3Variants
    const kimiAnthropicVariants = kimiAnthropicReasoningVariants(model)
    if (kimiAnthropicVariants) return kimiAnthropicVariants

    if (
      hasFamily(model, "deepseek") ||
      isAlibabaThinkingModel(model) ||
      hasFamily(model, "minimax") ||
      hasFamily(model, "glm") ||
      hasFamily(model, "mistral")
    )
      return {}

    // Groq's API only accepts `reasoning_effort` values `none` or `default`
    // for reasoning-capable models (Qwen3.6-27B, GPT-OSS-120B). The generic
    // `low`/`medium`/`high` values cause a 400 error: "reasoning_effort must
    // be one of none or default". Do not auto-generate reasoning-effort
    // variants; the model still reasons by default without the parameter.
    if (model.providerID === "groq") {
      return {}
    }

    // OpenRouter's public model metadata exposes `reasoning` /
    // `include_reasoning` broadly, but most current OpenRouter models do not
    // advertise the OpenAI-style `reasoning_effort` knob. Do not synthesize
    // generic reasoningEffort variants for this gateway; users can still pass
    // explicit OpenRouter request options in provider config when needed.
    if (model.providerID === "openrouter") {
      return {}
    }

    switch (model.api.npm) {
      case "@ai-sdk/xai":
        // The xAI loader uses the Responses API, where Grok reasoning models
        // accept low/medium/high reasoningEffort through the AI SDK.
        if (model.providerID !== "xai" || !supportsXaiEffort(model)) return {}
        return Object.fromEntries(WIDELY_SUPPORTED_EFFORTS.map((effort) => [effort, { reasoningEffort: effort }]))

      case "venice-ai-sdk-provider":
      // https://docs.venice.ai/overview/guides/reasoning-models#reasoning-effort
      case "@ai-sdk/openai-compatible":
        return Object.fromEntries(WIDELY_SUPPORTED_EFFORTS.map((effort) => [effort, { reasoningEffort: effort }]))

      case "@ai-sdk/google-vertex":
      case "@ai-sdk/google": {
        // https://v5.ai-sdk.dev/providers/ai-sdk-providers/google-generative-ai
        let levels = ["low", "high"]
        if (id.includes("3.1")) levels = ["low", "medium", "high"]
        return Object.fromEntries(
          levels.map((effort) => [
            effort,
            {
              thinkingConfig: {
                includeThoughts: true,
                thinkingLevel: effort,
              },
            },
          ]),
        )
      }

      case "@ai-sdk/anthropic": {
        // First-party Anthropic only. Third-party Anthropic-compatible
        // endpoints (minimax, freemodel, ...) are not verified to accept
        // `thinking` blocks; they can opt in via config variants.
        if (model.providerID !== "anthropic") return {}
        if (supportsAnthropicEffort(model)) {
          const levels = isAnthropicOpus45(model) ? WIDELY_SUPPORTED_EFFORTS : ANTHROPIC_EFFORTS
          return Object.fromEntries(
            levels.map((effort) => [
              effort,
              {
                effort,
                ...(isAnthropicOpus45(model)
                  ? { thinking: { type: "enabled", budgetTokens: ANTHROPIC_THINKING_BUDGETS[effort] } }
                  : usesAnthropicAdaptiveThinking(model)
                    ? { thinking: { type: "adaptive" } }
                    : {}),
              },
            ]),
          )
        }
        return Object.fromEntries(
          WIDELY_SUPPORTED_EFFORTS.map((effort) => [
            effort,
            { thinking: { type: "enabled", budgetTokens: ANTHROPIC_THINKING_BUDGETS[effort] } },
          ]),
        )
      }

      case "@ai-sdk/openai": {
        // First-party OpenAI and Meta Model API (Muse Spark). Meta's Responses
        // surface accepts the same reasoningEffort levels as OpenAI; OpenCode
        // configures Muse with reasoningEffort high/xhigh for agentic coding.
        if (model.providerID === "openai") {
          return Object.fromEntries(WIDELY_SUPPORTED_EFFORTS.map((effort) => [effort, { reasoningEffort: effort }]))
        }
        if (model.providerID === "meta" || hasFamily(model, "muse")) {
          const efforts = ["minimal", "low", "medium", "high", "xhigh"] as const
          return Object.fromEntries(
            efforts.map((effort) => [
              effort,
              {
                reasoningEffort: effort,
                // Encrypted reasoning must be requested so multi-turn tool
                // loops retain Muse Spark's prior chain-of-thought (Meta docs /
                // OpenCode Muse setup). Without include, each turn restarts
                // reasoning from scratch.
                reasoningSummary: "auto",
                include: ["reasoning.encrypted_content"],
              },
            ]),
          )
        }
        return {}
      }
    }
    return {}
  }

  export function options(input: {
    model: Provider.Model
    sessionID: string
    providerOptions?: Record<string, any>
    longAgent?: boolean
  }): Record<string, any> {
    const result: Record<string, any> = {}

    // z.ai: no special provider options. v3.1.0 added a `thinking`
    // parameter that was reverted through v3.1.1 and v3.1.2. OpenCode
    // currently sends `thinking: { type: "enabled", clear_thinking: false }`
    // on zai/zhipuai OpenAI-compat; we keep the empty shape until a live
    // wire probe (ADR-040 M2) confirms it. Do not copy that block back.

    // Session-scoped cache key. OpenCode defaults this on for OpenAI-family
    // SDKs; we keep the generic default off (unknown OpenAI-compat servers
    // 400 on extra fields) but turn it on for routes that document the
    // hint: Kimi/Moonshot (replica affinity), alibaba-pai, venice, explicit
    // setCacheKey, and Super-Long Alibaba thinking models below.
    if (input.providerOptions?.setCacheKey !== false && shouldSetPromptCacheKey(input)) {
      result["promptCacheKey"] = input.sessionID
    }

    if (input.model.api.npm === "@ai-sdk/google") {
      if (input.model.capabilities.reasoning) {
        result["thinkingConfig"] = {
          includeThoughts: true,
          thinkingLevel: "high",
        }
      }
    }

    // Alibaba reasoning models — both Token Plan and Coding Plan run on
    // DashScope's OpenAI-compat endpoint, so both take the documented
    // `enable_thinking` + `thinking_budget` params. The Anthropic-shaped
    // `thinking` block belongs to the separate `/apps/anthropic/v1`
    // endpoint, which this provider does not target.
    // MiniMax's Anthropic interface defaults thinking off, unlike Chat Completions.
    if (isMinimaxM3(input.model) && input.model.api.npm === "@ai-sdk/anthropic") {
      result["thinking"] = { type: "adaptive" }
    }

    // Moonshot's Anthropic-compatible API uses adaptive effort, not token budgets.
    if (
      ["@ai-sdk/anthropic", "@ai-sdk/google-vertex/anthropic"].includes(input.model.api.npm) &&
      isKimiFamily(input.model) &&
      input.model.capabilities.reasoning
    ) {
      result["thinking"] = { type: "adaptive", display: "summarized" }
      result["effort"] = "high"
    }

    if (isAlibabaThinkingModel(input.model)) {
      result["enable_thinking"] = true
      // No explicit `requested` — alibabaThinkingBudget picks the model-aware
      // default (QWEN37_ALIBABA_THINKING_BUDGET for Max/Plus, generic 8k
      // otherwise) when requested is undefined.
      result["thinking_budget"] = alibabaThinkingBudget(input.model)
      if (input.longAgent) {
        // preserve_thinking keeps reasoning state across turns for long-agent execution.
        // Opt-out: set preserveThinking: false in provider options to disable it
        // independently (e.g. when cost is a concern but Super-Long pacing/verification
        // are still desired).
        if (input.providerOptions?.preserveThinking !== false) {
          result["preserve_thinking"] = true
        }
      }
    }

    // Ornith hub jinja (35B local and 397B-FP8 on PAI/vLLM) defaults thinking
    // on via chat_template_kwargs. Send the switch explicitly so a generic
    // Qwen server default cannot close the think channel.
    if (isOrnithFamily(input.model) && input.model.api.npm === "@ai-sdk/openai-compatible") {
      result["chat_template_kwargs"] = {
        enable_thinking: true,
        ...(input.longAgent && input.providerOptions?.preserveThinking !== false
          ? { preserve_thinking: true }
          : {}),
      }
    }

    // xAI Live Search: opt grok-4+ chat models into automatic real-world
    // search so current-events queries (weather, news, X chatter) work out of
    // the box. The model decides per-turn whether to actually search (mode:
    // "auto"). User overrides at `provider.xai.options.searchParameters` or
    // per-model `models.<id>.options.searchParameters` win via mergeDeep
    // later; passing { mode: "off" } disables this entirely.
    if (input.model.api.npm === "@ai-sdk/xai") {
      const userOverride = input.providerOptions?.searchParameters as Partial<LiveSearchConfig> | undefined
      const params = buildSearchParameters(input.model.api.id, userOverride)
      if (params) result["searchParameters"] = params
    }

    // Alibaba DashScope internet search: Qwen models served through the
    // Alibaba coding-plan / token-plan endpoints accept `enable_search` plus
    // `search_options` as request body extras (DashScope's OpenAI-compat path
    // spreads providerOptions[<providerID>] into the body). DeepSeek / GLM /
    // MiniMax / Kimi served on the same plans don't honor this knob, so we
    // gate on the api.id family. Users can opt out by setting
    // `provider.<alibaba-id>.options.enable_search = false` in ax-code.json.
    if (isAlibabaQwenPlanModel(input.model)) {
      const userExplicit = input.providerOptions?.enable_search
      if (userExplicit !== false) {
        result["enable_search"] = true
        const userSearchOptions = input.providerOptions?.search_options as Record<string, unknown> | undefined
        result["search_options"] = {
          enable_source: true,
          enable_citation: true,
          ...(userSearchOptions ?? {}),
        }
      }
    }

    return result
  }

  function isAlibabaQwenPlanModel(model: Provider.Model): boolean {
    if (model.api.npm !== "@ai-sdk/openai-compatible") return false
    const pid = model.providerID
    if (!pid.startsWith("alibaba-coding-plan") && !pid.startsWith("alibaba-token-plan")) return false
    if (model.capabilities.output?.text === false) return false
    return model.api.id.toLowerCase().startsWith("qwen")
  }

  export function sanitizeOptions(model: Provider.Model, options: Record<string, any>): Record<string, any> {
    let result = options
    if (isAlibabaThinkingModel(model)) {
      // Strip incompatible thinking shapes (Anthropic block, reasoning-effort
      // variants) that user config or other transforms may have layered in,
      // then re-establish the documented DashScope pair with a clamped
      // budget — covers the case where user config bumps `thinking_budget`
      // above the per-account ceiling.
      const {
        thinking: _thinking,
        reasoning: _reasoning,
        reasoningEffort: _reasoningEffort,
        reasoning_effort: _reasoning_effort,
        thinkingConfig: _thinkingConfig,
        thinking_budget: requestedBudget,
        enable_thinking: requestedEnable,
        preserve_thinking: requestedPreserve,
        ...rest
      } = result
      // Respect an explicit `enable_thinking: false` from smallOptions or
      // user config — auxiliary calls (summarization, titling) should not
      // pay for thinking. When thinking is off, preserve_thinking is also
      // stripped (no reasoning state to preserve).
      result =
        requestedEnable === false
          ? { ...rest, enable_thinking: false }
          : {
              ...rest,
              enable_thinking: true,
              thinking_budget: alibabaThinkingBudget(model, requestedBudget),
              // Carry through preserve_thinking only when it was explicitly requested
              ...(requestedPreserve ? { preserve_thinking: true } : {}),
            }
    }

    if (model.providerID === AX_ENGINE_PROVIDER_ID) {
      const {
        baseURL: _baseURL,
        binaryPath: _binaryPath,
        modelID: _modelID,
        modelPath: _modelPath,
        port: _port,
        quantization: _quantization,
        ...rest
      } = result
      return rest
    }

    if (model.providerID === "groq" || model.providerID === "openrouter") {
      const { reasoningEffort: _reasoningEffort, reasoning_effort: _reasoning_effort, ...rest } = result
      return rest
    }
    return result
  }

  export function smallOptions(model: Provider.Model) {
    if (isOrnithFamily(model) || model.providerID === AX_ENGINE_PROVIDER_ID) {
      // AX Engine and Ornith (local 35B or PAI 397B) expose Qwen's
      // chat-template switch. Auxiliary and response-only turns do not
      // benefit from a long hidden reasoning pass, so prefill the closed
      // thinking block and generate the answer directly.
      return { chat_template_kwargs: { enable_thinking: false } }
    }
    if (model.providerID === "google") {
      return { thinkingConfig: { thinkingLevel: "minimal" } }
    }
    if (model.providerID === "venice") {
      return { veniceParameters: { disableThinking: true } }
    }
    // Auxiliary calls (titles, summaries) don't need reasoning. Turn
    // thinking off explicitly so DashScope doesn't bill for thinking
    // tokens on these short requests. sanitizeOptions respects the
    // explicit `false` and skips re-establishing thinking_budget.
    if (isAlibabaThinkingModel(model)) {
      return { enable_thinking: false }
    }
    // MiniMax on vLLM / PAI still thinks for title/summary calls unless the
    // chat template is told not to. Harmless if the backend ignores it.
    if (isMinimax(model) && model.api.npm === "@ai-sdk/openai-compatible") {
      return { chat_template_kwargs: { enable_thinking: false } }
    }

    return {}
  }

  export function providerOptions(model: Provider.Model, options: { [x: string]: any }) {
    const key = sdkKey(model.api.npm) ?? model.providerID
    return { [key]: options }
  }

  export function maxOutputTokens(model: Provider.Model): number {
    // If the model declares no output capability (0) or a missing limit,
    // fall back to OUTPUT_TOKEN_MAX. Math.min never returns nullish, so
    // the old `?? OUTPUT_TOKEN_MAX` was dead code.
    if (isAlibabaShortWindowProvider(model)) {
      const limit = model.limit.output > 0 ? model.limit.output : OUTPUT_TOKEN_MAX
      // Qwen 3.7 Max/Plus on Alibaba: lift from the generic 4k cap to 16k
      // so these models' 64k output capacity is not crushed to 6%.
      const alibabaCap = isQwen37MaxOrPlusModel(model.id ?? "")
        ? QWEN37_ALIBABA_OUTPUT_TOKEN_MAX
        : ALIBABA_OUTPUT_TOKEN_MAX
      return Math.min(limit, OUTPUT_TOKEN_MAX, alibabaCap)
    }
    if (model.providerID === "groq") {
      const limit = model.limit.output > 0 ? model.limit.output : OUTPUT_TOKEN_MAX
      return Math.min(limit, OUTPUT_TOKEN_MAX, GROQ_OUTPUT_TOKEN_MAX)
    }
    const limit = model.limit.output
    const cap = isQwen37MaxOrPlusModel(model.id ?? "")
      ? QWEN37_MAX_OUTPUT_TOKENS
      : hasFamily(model, "glm")
        ? GLM_OUTPUT_TOKEN_MAX
        : OUTPUT_TOKEN_MAX
    return limit > 0 ? Math.min(limit, cap) : cap
  }

  export function schema(model: Provider.Model, schema: JSONSchema.BaseSchema | JSONSchema7): JSONSchema7 {
    // Moonshot expands $ref before validation and rejects sibling keywords
    // (description on the same node) plus tuple-style `items` arrays.
    if (isKimiFamily(model)) {
      const sanitizeMoonshot = (obj: unknown): unknown => {
        if (obj === null || typeof obj !== "object") return obj
        if (Array.isArray(obj)) return obj.map(sanitizeMoonshot)
        const record = obj as Record<string, unknown>
        if ("$ref" in record && typeof record.$ref === "string") return { $ref: record.$ref }
        const result = Object.fromEntries(
          Object.entries(record).map(([key, value]) => [key, sanitizeMoonshot(value)]),
        ) as Record<string, unknown>
        if (Array.isArray(result.items)) result.items = result.items[0] ?? {}
        return result
      }
      const sanitized = sanitizeMoonshot(schema)
      if (typeof sanitized === "object" && sanitized !== null && !Array.isArray(sanitized)) {
        schema = sanitized as JSONSchema.BaseSchema | JSONSchema7
      }
    }

    // Convert integer enums to string enums for Google/Gemini
    if (model.providerID === "google" || model.api.id.includes("gemini")) {
      const isPlainObject = (node: unknown): node is Record<string, any> => isRecord(node)
      const hasCombiner = (node: unknown) =>
        isPlainObject(node) && (Array.isArray(node.anyOf) || Array.isArray(node.oneOf) || Array.isArray(node.allOf))
      const hasSchemaIntent = (node: unknown) => {
        if (!isPlainObject(node)) return false
        if (hasCombiner(node)) return true
        return [
          "type",
          "properties",
          "items",
          "prefixItems",
          "enum",
          "const",
          "$ref",
          "additionalProperties",
          "patternProperties",
          "required",
          "not",
          "if",
          "then",
          "else",
        ].some((key) => key in node)
      }

      const active = new WeakSet<object>()
      const sanitizeGemini = (obj: any): any => {
        if (obj === null || typeof obj !== "object") {
          return obj
        }

        if (active.has(obj)) return {}
        active.add(obj)

        if (Array.isArray(obj)) {
          try {
            return obj.map(sanitizeGemini)
          } finally {
            active.delete(obj)
          }
        }

        try {
          const result: any = {}
          for (const [key, value] of Object.entries(obj)) {
            if (key === "enum" && Array.isArray(value)) {
              // Convert all enum values to strings
              result[key] = value.map((v) => String(v))
            } else if (isRecord(value) || Array.isArray(value)) {
              result[key] = sanitizeGemini(value)
            } else {
              result[key] = value
            }
          }
          // Post-process: if the schema has an enum and its type is integer or
          // number, promote the type to string. Done after the copy loop so the
          // conversion is independent of JSON key order — previously this lived
          // inside the loop and silently missed schemas where enum appeared
          // before type.
          if (Array.isArray(result.enum) && (result.type === "integer" || result.type === "number")) {
            result.type = "string"
          }

          // Filter required array to only include fields that exist in properties
          if (result.type === "object" && result.properties && Array.isArray(result.required)) {
            result.required = result.required.filter((field: any) => field in result.properties)
          }

          if (result.type === "array" && !hasCombiner(result)) {
            if (result.items == null) {
              result.items = {}
            }
            // Ensure items has a type only when it's still schema-empty.
            if (isPlainObject(result.items) && !hasSchemaIntent(result.items)) {
              result.items.type = "string"
            }
          }

          // Remove properties/required from non-object types (Gemini rejects these)
          if (result.type && result.type !== "object" && !hasCombiner(result)) {
            delete result.properties
            delete result.required
          }

          return result
        } finally {
          active.delete(obj)
        }
      }

      schema = sanitizeGemini(schema)
    }

    return schema as JSONSchema7
  }
}
