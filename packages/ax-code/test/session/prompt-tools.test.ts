import { describe, expect, test } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { collectMcpToolContent, resolveTools, shouldBypassAgentCheck } from "../../src/session/prompt-tools"
import { tmpdir } from "../fixture/fixture"

describe("session.prompt-tools", () => {
  test("bypasses agent checks only when the turn explicitly includes an agent part", () => {
    expect(shouldBypassAgentCheck(undefined)).toBe(false)
    expect(shouldBypassAgentCheck([{ type: "text", text: "hello" } as any])).toBe(false)
    expect(
      shouldBypassAgentCheck([{ type: "text", text: "hello" } as any, { type: "agent", name: "build" } as any]),
    ).toBe(true)
  })

  test("collects MCP tool text with binary placeholders instead of raw model-facing blobs", () => {
    const result = collectMcpToolContent([
      { type: "text", text: "visible text" },
      { type: "image", mimeType: "image/png", data: "abc123" },
      {
        type: "resource",
        resource: {
          uri: "secret://large",
          mimeType: "application/octet-stream",
          blob: "rawblob",
        },
      },
    ])

    expect(result.textParts).toEqual([
      "visible text",
      "[Image content: image/png]",
      "[Binary MCP resource: secret://large (application/octet-stream)]",
    ])
    expect(result.attachments).toHaveLength(2)
    expect(result.attachments[1]).toMatchObject({
      filename: "secret://large",
      mime: "application/octet-stream",
    })
  })

  test("filters tools denied by the active agent ruleset", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const agent = await Agent.get("compaction")
        expect(agent).toBeDefined()

        const tools = await resolveTools({
          agent: agent!,
          session: { id: "ses_test", permission: [] } as any,
          model: {
            providerID: "test-provider",
            api: { id: "test-model", npm: "@ai-sdk/openai-compatible" },
          } as any,
          tools: {},
          bypassAgentCheck: false,
          messages: [],
          processor: {
            message: { id: "msg_test" },
            partFromToolCall: () => undefined,
          } as any,
        })

        expect(Object.keys(tools)).toEqual([])
      },
    })
  })
})
