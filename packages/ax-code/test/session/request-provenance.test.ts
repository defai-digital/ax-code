import { describe, expect, test } from "vitest"
import { jsonSchema, tool } from "ai"
import z from "zod"
import { RequestProvenance } from "../../src/session/request-provenance"

function definition(description: string, inputSchema: z.ZodType) {
  return tool({
    description,
    inputSchema,
    execute: async () => ({ title: "", output: "", metadata: {} }),
  })
}

describe("session.request-provenance", () => {
  test("builds deterministic raw-prompt-free evidence from an assembled request", async () => {
    const input = {
      providerID: "test-provider",
      modelID: "test-model",
      systemMessages: [{ role: "system", content: "private-system-value" }],
      messages: [
        { role: "system", content: "private-system-value" },
        { role: "user", content: "private-user-value" },
      ],
      options: {
        temperature: 0.2,
        topP: 0.9,
        toolChoice: "auto" as const,
        maxOutputTokens: 1024,
        retries: 0,
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
      provenanceVersion: 1,
      provenanceBoundary: "ai-sdk-pre-adapter",
      hashAlgorithm: "sha256",
      providerID: "test-provider",
      assembledMessageCount: 2,
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

    expect(schemaChanged.toolDefinitionsHash).not.toBe(original.toolDefinitionsHash)
    expect(contentChanged.messagesHash).not.toBe(original.messagesHash)
    expect(optionChanged.optionsHash).not.toBe(original.optionsHash)
    expect(providerOptionChanged.optionsHash).not.toBe(original.optionsHash)
    expect(
      new Set([
        original.requestHash,
        schemaChanged.requestHash,
        contentChanged.requestHash,
        optionChanged.requestHash,
        providerOptionChanged.requestHash,
      ]),
    ).toHaveLength(5)
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
