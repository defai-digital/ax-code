import { afterEach, describe, expect, spyOn, test } from "bun:test"
import z from "zod"
import { Agent } from "../../src/agent/agent"
import { ProviderTransform } from "../../src/provider/transform"
import { Instance } from "../../src/project/instance"
import {
  collectMcpToolContent,
  resolveTools,
  shouldBypassAgentCheck,
  transformMcpInputSchema,
} from "../../src/session/prompt-tools"
import { tmpdir } from "../fixture/fixture"

describe("session.prompt-tools", () => {
  let schemaSpy: ReturnType<typeof spyOn> | undefined

  afterEach(() => {
    schemaSpy?.mockRestore()
    schemaSpy = undefined
  })

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

  test("image content block produces a valid data URL FilePart for TUI screenshot rendering", () => {
    const b64 = Buffer.from("fake-png-bytes").toString("base64")
    const result = collectMcpToolContent([{ type: "image", mimeType: "image/png", data: b64 }])

    expect(result.textParts).toEqual(["[Image content: image/png]"])
    expect(result.attachments).toHaveLength(1)

    const attachment = result.attachments[0]!
    expect(attachment.type).toBe("file")
    expect(attachment.mime).toBe("image/png")
    expect(attachment.url).toBe(`data:image/png;base64,${b64}`)
    // Images have no filename — they render inline via the data URL
    expect(attachment.filename).toBeUndefined()
  })

  test("browser_screenshot image block (no explicit mimeType) defaults to image/png", () => {
    // @playwright/mcp browser_screenshot returns type:"image" without mimeType
    const b64 = Buffer.from("screenshot-bytes").toString("base64")
    const result = collectMcpToolContent([{ type: "image", data: b64 } as any])

    expect(result.attachments).toHaveLength(1)
    const attachment = result.attachments[0]!
    expect(attachment.mime).toBe("image/png")
    expect(attachment.url).toMatch(/^data:image\/png;base64,/)
  })

  test("deduplicates concurrent MCP schema transforms for the same cache key", async () => {
    const model = {
      id: "test-model",
      providerID: "test-provider",
      api: { id: "test-model", npm: "@ai-sdk/openai-compatible" },
    } as any
    const inputSchema = z.object({ query: z.string() })
    const cacheKey = `mcp:test-tool:${Date.now()}:${Math.random()}`
    const originalSchema = ProviderTransform.schema
    schemaSpy = spyOn(ProviderTransform, "schema").mockImplementation((modelArg, schemaArg) =>
      originalSchema(modelArg, schemaArg),
    )

    const [first, second] = await Promise.all([
      transformMcpInputSchema({ cacheKey, model, inputSchema }),
      transformMcpInputSchema({ cacheKey, model, inputSchema }),
    ])

    expect(first).toBe(second)
    expect(schemaSpy).toHaveBeenCalledTimes(1)
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
