import { afterEach, describe, expect, test, vi } from "vitest"
import z from "zod"
import { SessionCompaction } from "../../src/session/compaction"
import {
  maybeSchedulePreflightCompaction,
  maybeScheduleUsageCompaction,
} from "../../src/session/prompt-loop-compaction"
import { ToolRegistry } from "../../src/tool/registry"
import type { Agent } from "../../src/agent/agent"
import type { Provider } from "../../src/provider/provider"

const imagePart = { type: "file", mime: "image/png", url: "data:image/png;base64,AAAA" } as any
const userModel = { providerID: "test" as any, modelID: "test-model" as any }
const finishedTokens = { input: 100, output: 100, reasoning: 0, cache: { read: 0, write: 0 } } as any

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
let overflowSpy: ReturnType<typeof spyOn> | undefined

afterEach(() => {
  budgetSpy?.mockRestore()
  budgetSpy = undefined
  createSpy?.mockRestore()
  createSpy = undefined
  toolsSpy?.mockRestore()
  toolsSpy = undefined
  overflowSpy?.mockRestore()
  overflowSpy = undefined
})

describe("session.prompt preflight compaction", () => {
  test("counts registry tool schemas before sending a provider request", async () => {
    budgetSpy = vi.spyOn(SessionCompaction, "budget").mockResolvedValue({ cap: 2_000, reserved: 0, usable: 2_000 })
    createSpy = vi.spyOn(SessionCompaction, "create").mockResolvedValue({} as any)
    toolsSpy = vi.spyOn(ToolRegistry, "tools").mockResolvedValue([
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

  test("does not compact before an unanswered media turn even when over budget (#259)", async () => {
    budgetSpy = vi.spyOn(SessionCompaction, "budget").mockResolvedValue({ cap: 2_000, reserved: 0, usable: 2_000 })
    createSpy = vi.spyOn(SessionCompaction, "create").mockResolvedValue({} as any)
    toolsSpy = vi.spyOn(ToolRegistry, "tools").mockResolvedValue([
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
      userModel,
      model,
      // Same over-budget setup as the test above, but the user turn carries an image.
      userParts: [{ type: "text", text: "explain this image" } as any, imagePart],
      system: ["small system"],
      requestMessages: [{ role: "user", content: "explain this image" }],
    })

    expect(scheduled).toBe(false)
    expect(createSpy).not.toHaveBeenCalled()
  })
})

describe("session.prompt usage compaction", () => {
  test("schedules when the last turn overflows and the latest turn has no media", async () => {
    overflowSpy = vi.spyOn(SessionCompaction, "isOverflow").mockResolvedValue(true)
    createSpy = vi.spyOn(SessionCompaction, "create").mockResolvedValue({} as any)

    const scheduled = await maybeScheduleUsageCompaction({
      sessionID: "ses_test" as any,
      agent: "build",
      userModel,
      model,
      lastFinished: { summary: false, tokens: finishedTokens } as any,
      latestUserParts: [{ type: "text", text: "keep going" } as any],
    })

    expect(scheduled).toBe(true)
    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ triggerReason: "provider_usage" }))
  })

  test("skips usage compaction while the latest user turn carries unresolved media (#259)", async () => {
    overflowSpy = vi.spyOn(SessionCompaction, "isOverflow").mockResolvedValue(true)
    createSpy = vi.spyOn(SessionCompaction, "create").mockResolvedValue({} as any)

    const scheduled = await maybeScheduleUsageCompaction({
      sessionID: "ses_test" as any,
      agent: "build",
      userModel,
      model,
      // Would overflow and schedule, but the latest turn has an unanswered image.
      lastFinished: { summary: false, tokens: finishedTokens } as any,
      latestUserParts: [{ type: "text", text: "explain this image" } as any, imagePart],
    })

    expect(scheduled).toBe(false)
    expect(createSpy).not.toHaveBeenCalled()
  })
})
