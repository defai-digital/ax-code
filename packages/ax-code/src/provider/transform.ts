import type { ModelMessage } from "ai"
import type { JSONSchema7 } from "@ai-sdk/provider"
import type { JSONSchema } from "zod/v4/core"
import type { Provider } from "./provider"
import type { ModelsDev } from "./models"
import { Flag } from "@/flag/flag"
import { isRecord } from "@/util/record"
import { buildSearchParameters, type LiveSearchConfig } from "./xai/server-tools"
import { isQwen37MaxModel } from "./qwen37-readiness"
import { AX_ENGINE_PROVIDER_ID } from "./ax-engine/constants"

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
  // AX Engine currently serves local 16k-context models. Reserving the generic
  // 2048-token output budget often pushes near-full prompts over the runtime's
  // prompt + max_tokens admission check before generation starts.
  const AX_ENGINE_OUTPUT_TOKEN_MAX = 512
  const AX_ENGINE_TOOL_DESCRIPTION_MAX = 180
  const AX_ENGINE_SCHEMA_DESCRIPTION_MAX = 96
  // Cap for `budgetTokens` (Token Plan) and `thinking_budget` (Coding Plan)
  // on Alibaba reasoning models. 8192 matches the value in the upstream
  // OpenCode example. The effective budget is clamped further by
  // maxOutputTokens (controlled by AX_CODE_ALIBABA_OUTPUT_TOKEN_MAX), so
  // there is no separate knob for this — adjusting output max already
  // covers throttling needs.
  const ALIBABA_THINKING_BUDGET_TOKENS = 8_192

  // Maps npm package to the key the AI SDK expects for providerOptions.
  // The Vertex provider uses the same "google" key as the Gemini provider,
  // so variant options (thinkingConfig, reasoning effort) produced by
  // variants() land under the right namespace.
  function sdkKey(npm: string): string | undefined {
    switch (npm) {
      case "@ai-sdk/google":
      case "@ai-sdk/google-vertex":
        return "google"
    }
    return undefined
  }

  function normalizeMessages(
    msgs: ModelMessage[],
    model: Provider.Model,
    options: Record<string, unknown>,
  ): ModelMessage[] {
    if (typeof model.capabilities.interleaved === "object" && model.capabilities.interleaved.field) {
      const field = model.capabilities.interleaved.field
      return msgs.map((msg) => {
        if (msg.role === "assistant" && Array.isArray(msg.content)) {
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

          // Include reasoning_content | reasoning_details directly on the message for all assistant messages
          if (reasoningText) {
            // Read the extension field through a narrow structural
            // shape instead of `as any`. Keeps the rest of the object
            // fully type-checked while acknowledging openaiCompatible
            // is an openai-compatible extension not modelled by the
            // core ModelMessage type.
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
        }

        return msg
      })
    }

    return msgs
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
          if (imageStr.startsWith("data:")) {
            const semiIdx = imageStr.indexOf(";", 5)
            mime = semiIdx === -1 ? imageStr.slice(5) : imageStr.slice(5, semiIdx)
            // Empty `data:<mime>;base64,` — payload is empty.
            if (semiIdx !== -1) {
              const commaIdx = imageStr.indexOf(",", semiIdx + 1)
              if (commaIdx === imageStr.length - 1 && imageStr.slice(semiIdx + 1, commaIdx) === "base64") {
                return {
                  type: "text" as const,
                  text: "ERROR: Image file is empty or corrupted. Please provide a valid image.",
                }
              }
            }
          } else {
            // Non-data URLs: previous impl returned the full string as the
            // mime via split(";")[0]. Preserve that behavior.
            mime = imageStr
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
    return msgs
  }

  export function temperature(model: Provider.Model) {
    if (hasFamily(model, "qwen")) return 0.55
    if (hasFamily(model, "gemini")) return 1.0
    if (hasFamily(model, "glm")) return 1.0
    if (isMinimaxM2(model)) return 1.0
    return undefined
  }

  export function topP(model: Provider.Model) {
    if (hasFamily(model, "qwen")) return 1
    if (isMinimaxM2(model) || hasFamily(model, "gemini")) return 0.95
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
    const segment = model.id?.toLowerCase().split("/").filter(Boolean).at(-1)
    const declared = model.family?.toLowerCase()
    return matches(segment) || matches(declared)
  }

  // "minimax-m2" family, including the dashless id spellings (minimax-m25 ==
  // minimax-m2.5) some providers use. hasFamily rejects those because a digit
  // immediately follows "minimax-m2", which would otherwise deny them the
  // temperature/topP/topK tuning the dotted variants receive.
  function isMinimaxM2(model: Provider.Model): boolean {
    if (hasFamily(model, "minimax-m2")) return true
    const segment = model.id.toLowerCase().split("/").filter(Boolean).at(-1) ?? ""
    return /^minimax-m2\d/.test(segment)
  }

  // Any reasoning-capable Alibaba model on an OpenAI-compat endpoint goes
  // through DashScope's documented `enable_thinking` + `thinking_budget`
  // params. Capability-driven so newly added reasoning models pick up
  // thinking automatically. The npm guard keeps a future Anthropic-SDK
  // Alibaba endpoint from accidentally matching this path — that endpoint
  // would need the Anthropic `thinking` block instead.
  function isAlibabaThinkingModel(model: Provider.Model) {
    if (!model.providerID.startsWith("alibaba")) return false
    if (model.api.npm !== "@ai-sdk/openai-compatible") return false
    return Boolean(model.capabilities.reasoning)
  }

  // Any Alibaba-backed provider (Token Plan or Coding Plan / DashScope) is
  // subject to short-window token reservation throttling. The cap applies
  // regardless of model family because reservation is computed by the
  // platform, not the model.
  function isAlibabaShortWindowProvider(model: Provider.Model) {
    return model.providerID.startsWith("alibaba-")
  }

  function compactText(input: string, max: number) {
    const text = input.replace(/\s+/g, " ").trim()
    if (text.length <= max) return text
    return `${text.slice(0, max - 3).trimEnd()}...`
  }

  function compactAxEngineSchemaNode(input: unknown, active = new WeakSet<object>()): unknown {
    if (input === null || typeof input !== "object") return input
    if (active.has(input)) return {}
    active.add(input)
    try {
      if (Array.isArray(input)) return input.map((item) => compactAxEngineSchemaNode(item, active))

      const result: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(input)) {
        switch (key) {
          case "$schema":
          case "$id":
          case "$comment":
          case "examples":
          case "default":
          case "deprecated":
          case "readOnly":
          case "writeOnly":
            continue
          case "description":
            if (typeof value === "string") {
              const compact = compactText(value, AX_ENGINE_SCHEMA_DESCRIPTION_MAX)
              if (compact) result[key] = compact
            }
            continue
          case "title":
            if (typeof value === "string" && value.length <= 32) result[key] = value
            continue
          default:
            result[key] = compactAxEngineSchemaNode(value, active)
        }
      }
      return result
    } finally {
      active.delete(input)
    }
  }

  export function shouldCompactToolSchema(model: Provider.Model) {
    return model.providerID === AX_ENGINE_PROVIDER_ID
  }

  export function toolDescription(model: Provider.Model, description: string | undefined) {
    if (!description) return description
    if (!shouldCompactToolSchema(model)) return description
    return compactText(description, AX_ENGINE_TOOL_DESCRIPTION_MAX)
  }

  function alibabaThinkingBudget(model: Provider.Model, requested?: unknown) {
    const max = maxOutputTokens(model)
    const value = typeof requested === "number" && Number.isFinite(requested) && requested > 0 ? requested : max
    return Math.min(Math.floor(value), max, ALIBABA_THINKING_BUDGET_TOKENS)
  }

  export function variants(model: Provider.Model): Record<string, Record<string, any>> {
    if (!model.capabilities.reasoning) return {}

    const id = model.id.toLowerCase()
    if (
      hasFamily(model, "deepseek") ||
      model.providerID.startsWith("alibaba-token-plan") ||
      hasFamily(model, "minimax") ||
      hasFamily(model, "glm") ||
      hasFamily(model, "mistral")
    )
      return {}

    // XAI rejects the AI SDK's top-level reasoningEffort parameter for Grok
    // chat completions (for example grok-4-1-fast). Keep Grok reasoning
    // capability metadata for output parsing and model selection, but do not
    // auto-generate client-side reasoning-effort variants. Users can still
    // provide explicit per-model variants in config if x.ai adds a supported
    // option shape later.
    if (model.api.npm === "@ai-sdk/xai") {
      return {}
    }

    switch (model.api.npm) {
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
    // parameter that was reverted through v3.1.1 and v3.1.2. The
    // lesson: don't add provider-specific options without a concrete
    // user-facing need. The v2.x behavior (no thinking, no
    // reasoningEffort) works correctly and should not be changed
    // unless z.ai publishes a documented opt-in mechanism.

    if (input.providerOptions?.setCacheKey) {
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
    if (isAlibabaThinkingModel(input.model)) {
      result["enable_thinking"] = true
      result["thinking_budget"] = alibabaThinkingBudget(input.model, ALIBABA_THINKING_BUDGET_TOKENS)
      if (input.longAgent) {
        // preserve_thinking keeps reasoning state across turns for long-agent execution.
        // Opt-out: set preserveThinking: false in provider options to disable it
        // independently (e.g. when cost is a concern but Super-Long pacing/verification
        // are still desired).
        if (input.providerOptions?.preserveThinking !== false) {
          result["preserve_thinking"] = true
        }
        // Key-based prompt cache for Super-Long sessions.
        // DashScope context caching is keyed by session ID; per-block cache_control
        // requires a live route probe before enabling (Phase 3 acceptance criterion).
        result["promptCacheKey"] = input.sessionID
      }
    }

    if (input.model.providerID === "venice") {
      result["promptCacheKey"] = input.sessionID
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

    if (model.api.npm !== "@ai-sdk/xai") return result
    const { reasoningEffort: _reasoningEffort, reasoning_effort: _reasoning_effort, ...rest } = result
    return rest
  }

  export function smallOptions(model: Provider.Model) {
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
    if (model.providerID === AX_ENGINE_PROVIDER_ID) {
      const limit = model.limit.output > 0 ? model.limit.output : AX_ENGINE_OUTPUT_TOKEN_MAX
      return Math.min(limit, AX_ENGINE_OUTPUT_TOKEN_MAX)
    }
    if (isAlibabaShortWindowProvider(model)) {
      const limit = model.limit.output > 0 ? model.limit.output : OUTPUT_TOKEN_MAX
      return Math.min(limit, OUTPUT_TOKEN_MAX, ALIBABA_OUTPUT_TOKEN_MAX)
    }
    const limit = model.limit.output
    const cap = isQwen37MaxModel(model.id ?? "")
      ? QWEN37_MAX_OUTPUT_TOKENS
      : hasFamily(model, "glm")
        ? GLM_OUTPUT_TOKEN_MAX
        : OUTPUT_TOKEN_MAX
    return limit > 0 ? Math.min(limit, cap) : cap
  }

  export function schema(model: Provider.Model, schema: JSONSchema.BaseSchema | JSONSchema7): JSONSchema7 {
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

    if (shouldCompactToolSchema(model)) {
      schema = compactAxEngineSchemaNode(schema) as JSONSchema.BaseSchema | JSONSchema7
    }

    return schema as JSONSchema7
  }
}
