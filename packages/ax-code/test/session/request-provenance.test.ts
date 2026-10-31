import { describe, expect, test } from "vitest"
import { createHash } from "node:crypto"
import { jsonSchema, tool } from "ai"
import z from "zod"
import { RequestProvenance } from "../../src/session/request-provenance"
import { ReplayEvent } from "../../src/replay/event"

function definition(description: string, inputSchema: z.ZodType) {
  return tool({
    description,
    inputSchema,
    execute: async () => ({ title: "", output: "", metadata: {} }),
  })
}

describe("session.request-provenance", () => {
  test("records UTF-8 component sizes without changing existing request identity or persisting content", async () => {
    const system = [{ content: "private-\u{1F642}", role: "system" }]
    const messages = [...system, { content: "private-\u00E9", role: "user" }]
    const schema = { properties: {}, type: "object" as const }
    const definitions = [{ description: "private-\u{1F642}", name: "read", schema }]
    const manifest = await RequestProvenance.build({
      providerID: "test",
      modelID: "test",
      systemMessages: system,
      messages,
      tools: { read: { description: definitions[0].description, inputSchema: jsonSchema(schema) } },
      activeToolNames: ["read"],
      options: {},
    })
    // Fixtures have sorted keys, allowing an independent canonical JSON oracle.
    const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")
    expect(manifest.systemHash).toBe(hash(system))
    // Version 2 folds the per-message canonical hashes instead of hashing the
    // concatenated array.
    expect(manifest.messagesHash).toBe(
      createHash("sha256")
        .update(messages.map((message) => hash(message)).join("\n"))
        .digest("hex"),
    )
    // The definition assembly is byte-identical to whole-array canonicalization.
    expect(manifest.toolDefinitionsHash).toBe(hash(definitions))
    expect(manifest.requestHash).toBe(
      hash({
        boundary: "ai-sdk-pre-adapter",
        messagesHash: manifest.messagesHash,
        modelID: "test",
        optionsHash: manifest.optionsHash,
        providerID: "test",
        systemHash: manifest.systemHash,
        toolDefinitionsHash: manifest.toolDefinitionsHash,
        toolNames: ["read"],
      }),
    )
    expect(manifest.requestBytes).toEqual({
      encoding: "canonical-json-utf8",
      system: Buffer.byteLength(JSON.stringify(system)),
      messages: Buffer.byteLength(JSON.stringify(messages)),
      toolDefinitions: Buffer.byteLength(JSON.stringify(definitions)),
    })
    expect(manifest.requestBytes.system).toBeGreaterThan(JSON.stringify(system).length)
    const event = ReplayEvent.parse({
      type: "llm.request",
      sessionID: "ses_sizes",
      model: "test/test",
      messageCount: 1,
      ...manifest,
    })
    expect(event).toMatchObject({ requestBytes: manifest.requestBytes, provenanceVersion: 2 })
    expect(JSON.stringify(event)).not.toContain("private-")
  })

  test("builds deterministic raw-prompt-free evidence from an assembled request", async () => {
    const input = {
      providerID: "test-provider",
      modelID: "test-model",
      systemMessages: [{ role: "system", content: "private-system-value" }],
      messages: [
        { role: "system", content: "private-system-value" },
        { role: "user", content: "private-user-value" },
        {
          role: "assistant",
          content: [{ type: "tool-call", toolName: "alpha", input: { token: "private-tool-argument" } }],
        },
      ],
      options: {
        temperature: 0.2,
        topP: 0.9,
        toolChoice: "auto" as const,
        maxOutputTokens: 1024,
        retries: 0,
        providerOptions: {
          openai: { reasoningEffort: "medium", apiKey: "private-provider-credential" },
        },
      },
      activeToolNames: ["alpha", "zebra"],
    }
    const first = await RequestProvenance.build({
      ...input,
      tools: {
        zebra: definition("private-zebra-description", z.object({ count: z.number() })),
        alpha: definition("private-alpha-description", z.object({ text: z.string() })),
      },
    })
    const second = await RequestProvenance.build({
      ...input,
      tools: {
        alpha: definition("private-alpha-description", z.object({ text: z.string() })),
        zebra: definition("private-zebra-description", z.object({ count: z.number() })),
      },
    })
    const reversed = await RequestProvenance.build({
      ...input,
      activeToolNames: ["zebra", "alpha"],
      tools: {
        alpha: definition("private-alpha-description", z.object({ text: z.string() })),
        zebra: definition("private-zebra-description", z.object({ count: z.number() })),
      },
    })

    expect(second).toEqual(first)
    expect(reversed.toolNames).toEqual(["zebra", "alpha"])
    expect(reversed.toolDefinitionsHash).not.toBe(first.toolDefinitionsHash)
    expect(reversed.requestHash).not.toBe(first.requestHash)
    expect(first).toMatchObject({
      provenanceVersion: 2,
      provenanceBoundary: "ai-sdk-pre-adapter",
      hashAlgorithm: "sha256",
      providerID: "test-provider",
      assembledMessageCount: 3,
      systemMessageCount: 1,
      toolCount: 2,
      toolNames: ["alpha", "zebra"],
    })
    for (const hash of [
      first.systemHash,
      first.messagesHash,
      first.toolDefinitionsHash,
      first.optionsHash,
      first.requestHash,
    ]) {
      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    }
    const persisted = JSON.stringify(first)
    expect(persisted).not.toContain("private-system-value")
    expect(persisted).not.toContain("private-user-value")
    expect(persisted).not.toContain("private-alpha-description")
    expect(persisted).not.toContain("private-tool-argument")
    expect(persisted).not.toContain("private-provider-credential")
  })

  test("changes request identity for material schema, content, and option changes", async () => {
    const base = {
      providerID: "test-provider",
      modelID: "test-model",
      systemMessages: [{ role: "system", content: "system" }],
      messages: [{ role: "user", content: "hello" }],
      tools: { alpha: definition("alpha", z.object({ text: z.string() })) },
      activeToolNames: ["alpha"],
      options: {
        toolChoice: "auto" as const,
        maxOutputTokens: 1024,
        providerOptions: { openai: { reasoningEffort: "medium" } },
      },
    }
    const original = await RequestProvenance.build(base)
    const schemaChanged = await RequestProvenance.build({
      ...base,
      tools: { alpha: definition("alpha", z.object({ count: z.number() })) },
    })
    const descriptionChanged = await RequestProvenance.build({
      ...base,
      tools: { alpha: definition("changed description", z.object({ text: z.string() })) },
    })
    const systemChanged = await RequestProvenance.build({
      ...base,
      systemMessages: [{ role: "system", content: "changed system" }],
    })
    const contentChanged = await RequestProvenance.build({
      ...base,
      messages: [{ role: "user", content: "changed" }],
    })
    const optionChanged = await RequestProvenance.build({
      ...base,
      options: { ...base.options, maxOutputTokens: 2048 },
    })
    const providerOptionChanged = await RequestProvenance.build({
      ...base,
      options: {
        ...base.options,
        providerOptions: { openai: { reasoningEffort: "high" } },
      },
    })
    const providerChanged = await RequestProvenance.build({ ...base, providerID: "changed-provider" })
    const modelChanged = await RequestProvenance.build({ ...base, modelID: "changed-model" })

    expect(schemaChanged.toolDefinitionsHash).not.toBe(original.toolDefinitionsHash)
    expect(descriptionChanged.toolDefinitionsHash).not.toBe(original.toolDefinitionsHash)
    expect(systemChanged.systemHash).not.toBe(original.systemHash)
    expect(contentChanged.messagesHash).not.toBe(original.messagesHash)
    expect(optionChanged.optionsHash).not.toBe(original.optionsHash)
    expect(providerOptionChanged.optionsHash).not.toBe(original.optionsHash)
    expect(JSON.stringify(original)).not.toContain("reasoningEffort")
    expect(JSON.stringify(original)).not.toContain("medium")
    expect(
      new Set([
        original.requestHash,
        schemaChanged.requestHash,
        descriptionChanged.requestHash,
        systemChanged.requestHash,
        contentChanged.requestHash,
        optionChanged.requestHash,
        providerOptionChanged.requestHash,
        providerChanged.requestHash,
        modelChanged.requestHash,
      ]),
    ).toHaveLength(9)
  })

  test("measures reused message objects exactly like freshly built ones", async () => {
    const messages = [
      { role: "system", content: "system" },
      { role: "user", content: [{ type: "text", text: "hello" }] },
      { role: "assistant", content: [{ type: "text", text: "hi" }] },
    ]
    const input = {
      providerID: "test-provider",
      modelID: "test-model",
      systemMessages: messages.slice(0, 1),
      tools: { alpha: definition("alpha", z.object({ text: z.string() })) },
      activeToolNames: ["alpha"],
      options: {},
    }
    // First build populates the per-message evidence cache.
    const warm = await RequestProvenance.build({ ...input, messages })
    // Same objects: served from the cache.
    const reused = await RequestProvenance.build({ ...input, messages })
    // Structurally identical but freshly built objects: must hash identically.
    const fresh = await RequestProvenance.build({
      ...input,
      messages: messages.map((message) => JSON.parse(JSON.stringify(message))),
    })
    expect(reused).toEqual(warm)
    expect(fresh).toEqual(warm)
  })

  test("keeps the message byte count exact as history grows", async () => {
    const base = { providerID: "p", modelID: "m", systemMessages: [], tools: {}, activeToolNames: [], options: {} }
    const history = [
      { role: "user", content: "hello" },
      { role: "assistant", content: [{ type: "text", text: "hi" }] },
    ]
    const first = await RequestProvenance.build({ ...base, messages: history })
    const grown = [...history, { role: "user", content: "next" }]
    const second = await RequestProvenance.build({ ...base, messages: grown })
    expect(first.requestBytes.messages).toBe(Buffer.byteLength(JSON.stringify(history)))
    expect(second.requestBytes.messages).toBe(Buffer.byteLength(JSON.stringify(grown)))
    expect(second.messagesHash).not.toBe(first.messagesHash)
  })

  test("keeps legacy llm.request events valid when provenance fields are absent", () => {
    expect(
      ReplayEvent.parse({
        type: "llm.request",
        sessionID: "ses_legacy",
        model: "legacy-provider/legacy-model",
        messageCount: 3,
        temperature: 0.2,
      }),
    ).toEqual({
      type: "llm.request",
      sessionID: "ses_legacy",
      model: "legacy-provider/legacy-model",
      messageCount: 3,
      temperature: 0.2,
    })
    // A version 1 recording made before the messagesHash change still parses.
    expect(
      ReplayEvent.parse({
        type: "llm.request",
        sessionID: "ses_v1",
        model: "legacy-provider/legacy-model",
        messageCount: 3,
        provenanceVersion: 1,
        messagesHash: "a".repeat(64),
      }),
    ).toMatchObject({ provenanceVersion: 1, messagesHash: "a".repeat(64) })
  })

  test("rejects cyclic request values instead of persisting ambiguous evidence", () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => RequestProvenance.fingerprint(cyclic)).toThrow("cyclic request value")
  })

  test("bounds an asynchronous schema that never resolves", async () => {
    const started = Date.now()
    const pending = RequestProvenance.build({
      providerID: "test-provider",
      modelID: "test-model",
      systemMessages: [],
      messages: [{ role: "user", content: "hello" }],
      tools: {
        hanging: {
          description: "hanging schema",
          inputSchema: jsonSchema(new Promise<never>(() => {})),
        },
      },
      activeToolNames: ["hanging"],
      options: {},
    })

    await expect(pending).rejects.toThrow("Tool schema unavailable for provenance: hanging")
    expect(Date.now() - started).toBeLessThan(1000)
  })
})
