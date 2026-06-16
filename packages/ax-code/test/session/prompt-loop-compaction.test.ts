import { afterEach, describe, expect, spyOn, test } from "bun:test"
import z from "zod"
import { SessionCompaction } from "../../src/session/compaction"
import { maybeSchedulePreflightCompaction } from "../../src/session/prompt-loop-compaction"
import { ToolRegistry } from "../../src/tool/registry"
import type { Agent } from "../../src/agent/agent"
import type { Provider } from "../../src/provider/provider"

const model: Provider.Model = {
  id: "test-model" as any,
  providerID: "test" as any,
  name: "Test",
  family: "test",
  api: {
    id: "test-model",
    url: "https://example.com",
    npm: "@ai-sdk/openai-compatible",
  },
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  limit: {
    context: 16_384,
    output: 2_048,
  },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
}

const agent: Agent.Info = {
  name: "build",
  mode: "primary",
  permission: [],
  options: {},
}

let budgetSpy: ReturnType<typeof spyOn> | undefined
let createSpy: ReturnType<typeof spyOn> | undefined
let toolsSpy: ReturnType<typeof spyOn> | undefined

afterEach(() => {
  budgetSpy?.mockRestore()
  budgetSpy = undefined
  createSpy?.mockRestore()
  createSpy = undefined
  toolsSpy?.mockRestore()
  toolsSpy = undefined
})

describe("session.prompt preflight compaction", () => {
  test("counts registry tool schemas before sending a provider request", async () => {
    budgetSpy = spyOn(SessionCompaction, "budget").mockResolvedValue({ cap: 2_000, reserved: 0, usable: 2_000 })
    createSpy = spyOn(SessionCompaction, "create").mockResolvedValue({} as any)
    toolsSpy = spyOn(ToolRegistry, "tools").mockResolvedValue([
      {
        id: "large_tool",
        description: "Tool with a large provider schema",
        parameters: z.object({
          payload: z.string().describe("x".repeat(12_000)),
        }),
        execute: async () => ({ title: "", metadata: {}, output: "" }),
      },
    ] as any)

    const scheduled = await maybeSchedulePreflightCompaction({
      sessionID: "ses_test" as any,
      agent: "build",
      agentInfo: agent,
      userModel: { providerID: "test" as any, modelID: "test-model" as any },
      model,
      userParts: [{ type: "text", text: "small request" } as any],
      system: ["small system"],
      requestMessages: [{ role: "user", content: "small request" }],
    })

    expect(scheduled).toBe(true)
    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerReason: "prompt_preflight",
      }),
    )
  })
})
