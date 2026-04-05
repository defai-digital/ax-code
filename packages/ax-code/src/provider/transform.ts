import type { ModelMessage } from "ai"
import type { JSONSchema7 } from "@ai-sdk/provider"
import type { JSONSchema } from "zod/v4/core"
import type { Provider } from "./provider"
import type { ModelsDev } from "./models"
import { Flag } from "@/flag/flag"

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
          const reasoningParts = msg.content.filter((part: { type: string }) => part.type === "reasoning")
          const reasoningText = reasoningParts.map((part: { type: string; text?: string }) => part.text ?? "").join("")

          // Filter out reasoning parts from content
          const filteredContent = msg.content.filter((part: { type: string }) => part.type !== "reasoning")

          // Include reasoning_content | reasoning_details directly on the message for all assistant messages
          if (reasoningText) {
            return {
              ...msg,
              content: filteredContent,
              providerOptions: {
                ...msg.providerOptions,
                openaiCompatible: {
                  ...(msg.providerOptions as any)?.openaiCompatible,
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

        // Check for empty base64 image data
        if (part.type === "image") {
          const imageStr = part.image.toString()
          if (imageStr.startsWith("data:")) {
            const match = imageStr.match(/^data:([^;]+);base64,(.*)$/)
            if (match && (!match[2] || match[2].length === 0)) {
              return {
                type: "text" as const,
                text: "ERROR: Image file is empty or corrupted. Please provide a valid image.",
              }
            }
          }
        }

        const mime = part.type === "image" ? part.image.toString().split(";")[0].replace("data:", "") : part.mediaType
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
    const id = model.id.toLowerCase()
    if (id.includes("qwen")) return 0.55
    if (id.includes("gemini")) return 1.0
    if (id.includes("glm")) return 1.0
    if (id.includes("minimax-m2")) return 1.0
    if (id.includes("kimi-k2")) {
      // kimi-k2-thinking & kimi-k2.5 && kimi-k2p5 && kimi-k2-5
      if (["thinking", "k2.", "k2p", "k2-5"].some((s) => id.includes(s))) {
        return 1.0
      }
      return 0.6
    }
    return undefined
  }

  export function topP(model: Provider.Model) {
    const id = model.id.toLowerCase()
    if (id.includes("qwen")) return 1
    if (["minimax-m2", "gemini", "kimi-k2.5", "kimi-k2p5", "kimi-k2-5"].some((s) => id.includes(s))) {
      return 0.95
    }
    return undefined
  }

  export function topK(model: Provider.Model) {
    const id = model.id.toLowerCase()
    if (id.includes("minimax-m2")) {
      if (["m2.", "m25", "m21"].some((s) => id.includes(s))) return 40
      return 20
    }
    if (id.includes("gemini")) return 64
    return undefined
  }

  const WIDELY_SUPPORTED_EFFORTS = ["low", "medium", "high"]

  // Match a model family name against a model id with a word-boundary on
  // both sides, so ids like "zai-glm-4" do not match the "glm" family and
  // hypothetical providers named "kimi-tools" do not match "kimi". A
  // family matches when it appears at the start, end, or surrounded by
  // non-alphanumeric characters (typically "-", "/", "."). This keeps the
  // existing substring-based dispatch without false positives from future
  // provider names that embed a family token as a substring of a larger
  // word.
  function hasFamily(id: string, family: string): boolean {
    const idx = id.indexOf(family)
    if (idx === -1) return false
    const before = idx === 0 ? "" : id[idx - 1]
    const after = idx + family.length >= id.length ? "" : id[idx + family.length]
    const isWord = (c: string) => /[a-z0-9]/.test(c)
    return !isWord(before) && !isWord(after)
  }

  export function variants(model: Provider.Model): Record<string, Record<string, any>> {
    if (!model.capabilities.reasoning) return {}

    const id = model.id.toLowerCase()
    if (
      hasFamily(id, "deepseek") ||
      hasFamily(id, "minimax") ||
      hasFamily(id, "glm") ||
      hasFamily(id, "mistral") ||
      hasFamily(id, "kimi") ||
      // TODO: Remove this after models.dev data is fixed to use "kimi-k2.5" instead of "k2p5"
      hasFamily(id, "k2p5")
    )
      return {}

    // XAI supports different effort sets across grok reasoning families.
    if (model.api.npm === "@ai-sdk/xai") {
      if (id.includes("grok-4") || id.includes("grok-code")) {
        return {
          medium: { reasoningEffort: "medium" },
          high: { reasoningEffort: "high" },
          max: { reasoningEffort: "max" },
        }
      }
      return {}
    }

    switch (model.api.npm) {
      case "venice-ai-sdk-provider":
      // https://docs.venice.ai/overview/guides/reasoning-models#reasoning-effort
      case "@ai-sdk/openai-compatible":
        return Object.fromEntries(WIDELY_SUPPORTED_EFFORTS.map((effort) => [effort, { reasoningEffort: effort }]))

      case "@ai-sdk/groq":
        // https://console.groq.com/docs/reasoning
        return Object.fromEntries(
          ["none", ...WIDELY_SUPPORTED_EFFORTS].map((effort) => [effort, { reasoningEffort: effort }]),
        )

      case "@ai-sdk/google-vertex":
      case "@ai-sdk/google":
        // https://v5.ai-sdk.dev/providers/ai-sdk-providers/google-generative-ai
        {
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
  }): Record<string, any> {
    const result: Record<string, any> = {}

    if (
      input.model.providerID.startsWith("zai") &&
      input.model.api.npm === "@ai-sdk/openai-compatible"
    ) {
      result["thinking"] = {
        type: "enabled",
        clear_thinking: false,
      }
    }

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

    // Enable thinking for reasoning models on Alibaba Cloud (DashScope).
    // DashScope's OpenAI-compatible API requires `enable_thinking: true` in the request body
    // to return reasoning_content. Without it, reasoning models never output thinking tokens.
    if (
      input.model.providerID.startsWith("alibaba") &&
      input.model.capabilities.reasoning &&
      input.model.api.npm === "@ai-sdk/openai-compatible"
    ) {
      result["enable_thinking"] = true
    }

    if (input.model.providerID === "venice") {
      result["promptCacheKey"] = input.sessionID
    }

    return result
  }

  export function smallOptions(model: Provider.Model) {
    if (model.providerID === "google") {
      return { thinkingConfig: { thinkingLevel: "minimal" } }
    }
    if (model.providerID === "venice") {
      return { veniceParameters: { disableThinking: true } }
    }

    return {}
  }

  export function providerOptions(model: Provider.Model, options: { [x: string]: any }) {
    const key = sdkKey(model.api.npm) ?? model.providerID
    return { [key]: options }
  }

  export function maxOutputTokens(model: Provider.Model): number {
    // Use nullish coalescing so an explicit output: 0 (no output capability)
    // is not coerced to OUTPUT_TOKEN_MAX by the falsy-zero short-circuit.
    return Math.min(model.limit.output, OUTPUT_TOKEN_MAX) ?? OUTPUT_TOKEN_MAX
  }

  export function schema(model: Provider.Model, schema: JSONSchema.BaseSchema | JSONSchema7): JSONSchema7 {
    /*
    if (providerID === "openai") {
      if (schema.type === "object" && schema.properties) {
        for (const [key, value] of Object.entries(schema.properties)) {
          if (schema.required?.includes(key)) continue
          schema.properties[key] = {
            anyOf: [
              value as JSONSchema.JSONSchema,
              {
                type: "null",
              },
            ],
          }
        }
      }
    }
    */

    // Convert integer enums to string enums for Google/Gemini
    if (model.providerID === "google" || model.api.id.includes("gemini")) {
      const isPlainObject = (node: unknown): node is Record<string, any> =>
        typeof node === "object" && node !== null && !Array.isArray(node)
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

      const sanitizeGemini = (obj: any): any => {
        if (obj === null || typeof obj !== "object") {
          return obj
        }

        if (Array.isArray(obj)) {
          return obj.map(sanitizeGemini)
        }

        const result: any = {}
        for (const [key, value] of Object.entries(obj)) {
          if (key === "enum" && Array.isArray(value)) {
            // Convert all enum values to strings
            result[key] = value.map((v) => String(v))
          } else if (typeof value === "object" && value !== null) {
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
      }

      schema = sanitizeGemini(schema)
    }

    return schema as JSONSchema7
  }
}
