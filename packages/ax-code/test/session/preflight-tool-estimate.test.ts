import { afterEach, describe, expect, test, vi, type MockInstance } from "vitest"
import { jsonSchema } from "ai"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { MCP } from "../../src/mcp"
import type { Provider } from "../../src/provider/provider"
import { estimateRegistryToolSchemaTokens } from "../../src/session/prompt/prompt-tools"
import { tmpdir } from "../fixture/fixture"

const model: Provider.Model = {
  id: "test-model" as any,
  providerID: "test" as any,
  name: "Test",
  family: "test",
  api: { id: "test-model", url: "https://example.com", npm: "@ai-sdk/openai-compatible" },
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  limit: { context: 65_536, output: 2_048 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
}

let mcpSpy: MockInstance | undefined
afterEach(() => {
  mcpSpy?.mockRestore()
  mcpSpy = undefined
})

function mcpTool(description: string, webmcp?: object) {
  return {
    description,
    inputSchema: jsonSchema({ type: "object", properties: { query: { type: "string" } } }),
    execute: async () => ({}),
    ...(webmcp ? { webmcp } : {}),
  } as any
}

async function estimate(tools: Record<string, unknown>, options: { tools?: Record<string, boolean> } = {}) {
  mcpSpy?.mockRestore()
  mcpSpy = vi.spyOn(MCP, "tools").mockResolvedValue(tools as any)
  await using tmp = await tmpdir({ git: true })
  return Instance.provide({
    directory: tmp.path,
    fn: async () => estimateRegistryToolSchemaTokens({ agent: (await Agent.get("build"))!, model, ...options }),
  })
}

describe("preflight tool schema estimate", () => {
  test("counts connected MCP tools that the registry does not know about", async () => {
    const base = await estimate({})
    const withMcp = await estimate({ lookup: mcpTool("x".repeat(4000)) })
    expect(withMcp - base).toBeGreaterThanOrEqual(1000)
  })

  test("adds browser_workflow only when a WebMCP bridge tool is connected", async () => {
    const plain = await estimate({ lookup: mcpTool("short") })
    const bridged = await estimate({ lookup: mcpTool("short", { server: "bridge" }) })
    // browser_workflow carries a ~16 KB schema (about 4k tokens).
    expect(bridged - plain).toBeGreaterThan(3000)
  })

  test("honors per-tool disables for MCP tools and browser_workflow", async () => {
    const tools = { lookup: mcpTool("y".repeat(4000), { server: "bridge" }) }
    const full = await estimate(tools)
    const withoutTool = await estimate(tools, { tools: { lookup: false } })
    const withoutWorkflow = await estimate(tools, { tools: { browser_workflow: false } })
    const neither = await estimate(tools, { tools: { lookup: false, browser_workflow: false } })
    expect(withoutTool).toBeLessThan(full)
    expect(withoutWorkflow).toBeLessThan(full)
    expect(neither).toBe(await estimate({}))
  })

  test("falls back to the registry count when MCP tools cannot be listed", async () => {
    const base = await estimate({})
    mcpSpy?.mockRestore()
    mcpSpy = vi.spyOn(MCP, "tools").mockRejectedValue(new Error("mcp unavailable"))
    await using tmp = await tmpdir({ git: true })
    const fallback = await Instance.provide({
      directory: tmp.path,
      fn: async () => estimateRegistryToolSchemaTokens({ agent: (await Agent.get("build"))!, model }),
    })
    expect(fallback).toBe(base)
  })
})
