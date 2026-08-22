import { createHash } from "node:crypto"
import { asSchema } from "ai"
import { withTimeout } from "@/util/timeout"

type ModelVisibleTool = {
  description?: string
  inputSchema?: unknown
}

type Canonical = null | boolean | number | string | Canonical[] | { [key: string]: Canonical }

function canonicalize(value: unknown, stack = new WeakSet<object>()): Canonical {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : `[Number:${String(value)}]`
  if (typeof value === "bigint") return `[BigInt:${value.toString()}]`
  if (typeof value === "undefined") return "[Undefined]"
  if (typeof value === "function") return "[Function]"
  if (typeof value === "symbol") return `[Symbol:${value.description ?? ""}]`

  if (value instanceof Date) return `[Date:${value.toISOString()}]`
  if (value instanceof URL) return `[URL:${value.toString()}]`
  if (value instanceof ArrayBuffer) {
    const bytes = new Uint8Array(value)
    return { type: "ArrayBuffer", bytes: bytes.byteLength, sha256: sha256(bytes) }
  }
  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    return { type: value.constructor.name, bytes: bytes.byteLength, sha256: sha256(bytes) }
  }

  if (typeof value !== "object") return `[Unsupported:${typeof value}]`
  if (stack.has(value)) throw new Error("Cannot fingerprint a cyclic request value")
  stack.add(value)
  try {
    if (Array.isArray(value)) return value.map((item) => canonicalize(item, stack))
    const record = value as Record<string, unknown>
    const result: Record<string, Canonical> = {}
    for (const key of Object.keys(record).sort()) result[key] = canonicalize(record[key], stack)
    return result
  } finally {
    stack.delete(value)
  }
}

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex")
}

export namespace RequestProvenance {
  export type Input = {
    providerID: string
    modelID: string
    systemMessages: unknown[]
    messages: unknown[]
    tools: Record<string, ModelVisibleTool>
    activeToolNames: string[]
    options: {
      temperature?: number
      topP?: number
      topK?: number
      toolChoice?: "auto" | "required" | "none"
      maxOutputTokens?: number
      retries?: number
      reasoningDepth?: string
      variant?: string
      providerOptions?: unknown
    }
  }

  export type Manifest = {
    provenanceVersion: 1
    provenanceBoundary: "ai-sdk-pre-adapter"
    hashAlgorithm: "sha256"
    providerID: string
    modelID: string
    assembledMessageCount: number
    systemMessageCount: number
    toolCount: number
    toolNames: string[]
    systemHash: string
    messagesHash: string
    toolDefinitionsHash: string
    optionsHash: string
    requestHash: string
    toolChoice?: "auto" | "required" | "none"
    maxOutputTokens?: number
    topP?: number
    topK?: number
    reasoningDepth?: string
    variant?: string
  }

  export function fingerprint(value: unknown): string {
    return sha256(JSON.stringify(canonicalize(value)))
  }

  export async function build(input: Input): Promise<Manifest> {
    const toolNames = [...input.activeToolNames]
    const toolDefinitions = await Promise.all(
      toolNames.map(async (name) => {
        const current = input.tools[name]!
        let schema: unknown
        try {
          schema = current.inputSchema
            ? await withTimeout(
                Promise.resolve(asSchema(current.inputSchema as Parameters<typeof asSchema>[0]).jsonSchema),
                250,
                `Tool schema provenance timed out for ${name}`,
              )
            : null
        } catch (error) {
          // The caller records a manifest-unavailable marker and still dispatches
          // the model request. Never publish a complete-looking partial hash.
          throw new Error(`Tool schema unavailable for provenance: ${name}`, { cause: error })
        }
        return { name, description: current.description ?? "", schema }
      }),
    )
    const options = {
      temperature: input.options.temperature,
      topP: input.options.topP,
      topK: input.options.topK,
      toolChoice: input.options.toolChoice,
      maxOutputTokens: input.options.maxOutputTokens,
      retries: input.options.retries,
      reasoningDepth: input.options.reasoningDepth,
      variant: input.options.variant,
      providerOptions: input.options.providerOptions,
    }
    const systemHash = fingerprint(input.systemMessages)
    const messagesHash = fingerprint(input.messages)
    const toolDefinitionsHash = fingerprint(toolDefinitions)
    const optionsHash = fingerprint(options)
    const requestHash = fingerprint({
      boundary: "ai-sdk-pre-adapter",
      providerID: input.providerID,
      modelID: input.modelID,
      systemHash,
      messagesHash,
      toolDefinitionsHash,
      optionsHash,
      toolNames,
    })

    return {
      provenanceVersion: 1,
      provenanceBoundary: "ai-sdk-pre-adapter",
      hashAlgorithm: "sha256",
      providerID: input.providerID,
      modelID: input.modelID,
      assembledMessageCount: input.messages.length,
      systemMessageCount: input.systemMessages.length,
      toolCount: toolNames.length,
      toolNames,
      systemHash,
      messagesHash,
      toolDefinitionsHash,
      optionsHash,
      requestHash,
      toolChoice: input.options.toolChoice,
      maxOutputTokens: input.options.maxOutputTokens,
      topP: input.options.topP,
      topK: input.options.topK,
      reasoningDepth: input.options.reasoningDepth,
      variant: input.options.variant,
    }
  }
}
