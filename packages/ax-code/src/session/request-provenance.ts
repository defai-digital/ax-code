import { asSchema } from "ai"
import { withTimeout } from "@/util/timeout"
import { Hash } from "@/util/hash"

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
  return Hash.fast(typeof value === "string" ? value : Buffer.from(value))
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
    provenanceVersion: 2
    provenanceBoundary: "ai-sdk-pre-adapter"
    hashAlgorithm: "sha256"
    providerID: string
    modelID: string
    assembledMessageCount: number
    systemMessageCount: number
    toolCount: number
    toolNames: string[]
    requestBytes: {
      encoding: "canonical-json-utf8"
      system: number
      messages: number
      toolDefinitions: number
    }
    systemHash: string
    /**
     * Version 2: sha256 over the ordered per-message canonical hashes rather
     * than one hash of the concatenated canonical array, so unchanged history
     * is measured once and reused across steps. Not comparable with a version 1
     * `messagesHash` for the same request.
     */
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
    return sha256(canonicalJson(value))
  }

  function canonicalJson(value: unknown) {
    return JSON.stringify(canonicalize(value))
  }

  function measureSerialized(serialized: string) {
    // Never retain request bodies in the manifest. This is not a provider
    // tokenizer or wire-size measure.
    return { hash: sha256(serialized), bytes: Buffer.byteLength(serialized, "utf8") }
  }

  function measure(value: unknown) {
    return measureSerialized(canonicalJson(value))
  }

  // Per-message evidence cache. Canonicalizing a 1-1.6 MB history dominates the
  // manifest cost and the history is re-measured on every step, while the
  // converted ModelMessages are reused across steps (toModelMessages caches
  // conversions per message, the request path only replaces the messages it
  // rewrites, and the evidence projection returns the same objects when it
  // changes nothing). Cache the hash and byte count only — never the canonical
  // text — so the cache cannot accumulate copies of history. A message that is
  // rebuilt is a new object and simply misses.
  const messageEvidence = new WeakMap<object, { hash: string; bytes: number }>()

  function messageMeasurement(message: unknown) {
    if (typeof message !== "object" || message === null) return measure(message)
    const cached = messageEvidence.get(message)
    if (cached !== undefined) return cached
    const measured = measure(message)
    messageEvidence.set(message, measured)
    return measured
  }

  /**
   * Fold the per-message hashes into `messagesHash`. Hashes are fixed-width hex
   * joined by a newline, so the encoding is unambiguous. The byte count stays
   * the exact canonical JSON length of the array: `[` + items joined by `,` +
   * `]`, which is what `JSON.stringify` produces for an array of canonical
   * values.
   */
  function measureMessages(messages: unknown[]) {
    const parts = messages.map(messageMeasurement)
    return {
      hash: sha256(parts.map((part) => part.hash).join("\n")),
      bytes: parts.reduce((total, part) => total + part.bytes, 0) + (messages.length === 0 ? 2 : messages.length + 1),
    }
  }

  // Tool definitions carry a large schema each and are remeasured per step. The
  // converted schema object is stable across steps (the prompt tool cache keeps
  // one conversion per tool and model), so cache the exact per-definition
  // canonical JSON and assemble the array string from it. Assembly reproduces
  // the bytes a whole-array canonicalization would produce, so
  // `toolDefinitionsHash` and its byte count are unchanged from version 1.
  const definitionEvidence = new WeakMap<object, Map<string, string>>()
  const DEFINITION_CACHE_MAX = 16

  function definitionSerialization(definition: { name: string; description: string; schema: unknown }) {
    const { name, description, schema } = definition
    if (typeof schema !== "object" || schema === null) return canonicalJson(definition)
    let byKey = definitionEvidence.get(schema)
    if (!byKey) {
      byKey = new Map()
      definitionEvidence.set(schema, byKey)
    }
    const key = `${name}\u0000${description}`
    const cached = byKey.get(key)
    if (cached !== undefined) return cached
    const serialized = canonicalJson(definition)
    if (byKey.size >= DEFINITION_CACHE_MAX) byKey.clear()
    byKey.set(key, serialized)
    return serialized
  }

  function measureDefinitions(definitions: Array<{ name: string; description: string; schema: unknown }>) {
    return measureSerialized(`[${definitions.map(definitionSerialization).join(",")}]`)
  }

  const TOOL_SCHEMA_TIMEOUT_MS = 250

  export async function build(input: Input): Promise<Manifest> {
    const toolNames = [...input.activeToolNames]
    // One timer for the whole surface instead of one per tool: the budget is
    // the same order of magnitude, a hanging or rejecting schema still fails
    // the whole manifest (which becomes a manifest-unavailable marker at the
    // caller), and the failing tool is still named in the error.
    const settled = new Set<string>()
    const failed: string[] = []
    const resolved = toolNames.map(async (name) => {
      const current = input.tools[name]!
      let schema: unknown = null
      if (current.inputSchema) {
        try {
          schema = await Promise.resolve(asSchema(current.inputSchema as Parameters<typeof asSchema>[0]).jsonSchema)
        } catch (error) {
          failed.push(name)
          throw error
        }
      }
      settled.add(name)
      return { name, description: current.description ?? "", schema }
    })
    let toolDefinitions: Array<{ name: string; description: string; schema: unknown }>
    try {
      toolDefinitions = await withTimeout(
        Promise.all(resolved),
        TOOL_SCHEMA_TIMEOUT_MS,
        "Tool schema provenance timed out",
      )
    } catch (error) {
      // The caller records a manifest-unavailable marker and still dispatches
      // the model request. Never publish a complete-looking partial hash.
      const stuck = toolNames.filter((name) => !settled.has(name))
      throw new Error(`Tool schema unavailable for provenance: ${failed[0] ?? stuck[0] ?? toolNames[0]}`, {
        cause: error,
      })
    }
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
    const system = measure(input.systemMessages)
    const messages = measureMessages(input.messages)
    const definitions = measureDefinitions(toolDefinitions)
    const systemHash = system.hash
    const messagesHash = messages.hash
    const toolDefinitionsHash = definitions.hash
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
      provenanceVersion: 2,
      provenanceBoundary: "ai-sdk-pre-adapter",
      hashAlgorithm: "sha256",
      providerID: input.providerID,
      modelID: input.modelID,
      assembledMessageCount: input.messages.length,
      systemMessageCount: input.systemMessages.length,
      toolCount: toolNames.length,
      toolNames,
      requestBytes: {
        encoding: "canonical-json-utf8",
        system: system.bytes,
        messages: messages.bytes,
        toolDefinitions: definitions.bytes,
      },
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
