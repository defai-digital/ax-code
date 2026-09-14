import { describe, expect, test } from "vitest"
import { createToolContext, decodeToolParamsValue, parseToolParams } from "../../src/cli/cmd/debug/agent"

describe("debug agent", () => {
  test("decodeToolParamsValue decodes already-parsed params", () => {
    expect(decodeToolParamsValue({ path: "src/index.ts", limit: 2 })).toEqual({
      path: "src/index.ts",
      limit: 2,
    })
    expect(() => decodeToolParamsValue(["not", "object"])).toThrow("Tool params must be a JSON object")
    expect(() => decodeToolParamsValue(null)).toThrow("Tool params must be a JSON object")
  })

  test("parseToolParams decodes JSON object params", () => {
    expect(parseToolParams()).toEqual({})
    expect(parseToolParams("  ")).toEqual({})
    expect(parseToolParams(JSON.stringify({ path: "src/index.ts", limit: 2 }))).toEqual({
      path: "src/index.ts",
      limit: 2,
    })
  })

  test("parseToolParams rejects invalid JSON and non-object JSON", () => {
    expect(() => parseToolParams("{not json")).toThrow("Failed to parse --params as JSON")
    expect(() => parseToolParams(JSON.stringify(["not", "object"]))).toThrow("Tool params must be a JSON object")
    expect(() => parseToolParams("null")).toThrow("Tool params must be a JSON object")
  })
})

test("debug task contexts have a distinct persisted user parent", async () => {
  const { Agent } = await import("../../src/agent/agent")
  const { Instance } = await import("../../src/project/instance")
  const { MessageV2 } = await import("../../src/session/message-v2")
  const { taskParentConstraints } = await import("../../src/tool/task-constraints")
  const { tmpdir } = await import("../fixture/fixture")
  await using tmp = await tmpdir({ git: true, config: { provider: { openai: { options: { apiKey: "test-key" } } } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await Agent.get("build")
      if (!agent) throw new Error("Missing build agent")
      const { ModelID, ProviderID } = await import("../../src/provider/schema")
      const ctx = await createToolContext({
        ...agent,
        model: { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-5.4") },
      })
      const assistant = await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
      if (assistant.info.role !== "assistant") throw new Error("Expected assistant context")
      expect(assistant.info.parentID).not.toBe(assistant.info.id)
      const parent = await MessageV2.get({ sessionID: ctx.sessionID, messageID: assistant.info.parentID })
      expect(parent.info).toMatchObject({ role: "user", agent: "build" })
      await expect(taskParentConstraints(assistant.info)).resolves.toMatchObject({ tools: {}, permissionDenials: [] })
    },
  })
})
