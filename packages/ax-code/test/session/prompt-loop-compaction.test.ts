import { afterEach, describe, expect, test, vi, type MockInstance } from "vitest"
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

let budgetSpy: MockInstance | undefined
let createSpy: MockInstance | undefined
let toolsSpy: MockInstance | undefined
let overflowSpy: MockInstance | undefined

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
  test.each([
    { input: undefined, reserved: 1_000 },
    { input: 4_000, reserved: 1_000 },
    { input: undefined, reserved: 0 },
    { input: 4_000, reserved: 0 },
  ])("preserves AX Engine output capacity with %j", async ({ input, reserved }) => {
    budgetSpy = vi
      .spyOn(SessionCompaction, "budget")
      .mockResolvedValue({ cap: 4_000, reserved, usable: 4_000 - reserved })
    createSpy = vi.spyOn(SessionCompaction, "create").mockResolvedValue({} as any)
    const result = await maybeSchedulePreflightCompaction({
      sessionID: "ses_test" as any,
      agent: "build",
      agentInfo: agent,
      userModel,
      model: { ...model, providerID: "ax-engine" as any, limit: { context: 4_000, output: 1_000, input } },
      userParts: [{ type: "text", text: "Hello" } as any],
      system: ["x".repeat(14_000)],
      requestMessages: [{ role: "user", content: "Hello" }],
      omitToolSchemas: true,
    })
    expect(result).toMatchObject({ action: "block", usableTokens: 3_000 })
    expect(createSpy).not.toHaveBeenCalled()
  })

  test("counts registry tool schemas toward the budget when history is large enough for compaction to help", async () => {
    // A moderate tool schema (~120 tokens) plus a large message history: tool
    // schemas alone fit comfortably under budget, so compacting the history
    // can genuinely bring the total back under budget — this is the case
    // preflight compaction is meant for.
    budgetSpy = vi.spyOn(SessionCompaction, "budget").mockResolvedValue({ cap: 2_000, reserved: 0, usable: 2_000 })
    createSpy = vi.spyOn(SessionCompaction, "create").mockResolvedValue({} as any)
    toolsSpy = vi.spyOn(ToolRegistry, "tools").mockResolvedValue([
      {
        id: "small_tool",
        description: "Tool with a modest provider schema",
        parameters: z.object({
          payload: z.string().describe("x".repeat(200)),
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
      requestMessages: [
        { role: "user", content: "x".repeat(5_000) },
        { role: "assistant", content: "y".repeat(5_000) },
        { role: "user", content: "small request" },
      ],
    })

    expect(scheduled).toEqual({ action: "compact" })
    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerReason: "prompt_preflight",
      }),
    )
  })

  test("blocks a tiny first turn when fixed prompt/tool overhead cannot fit (#344, #345)", async () => {
    // Compaction only summarizes `messages` — it can never shrink the fixed
    // tool-schema overhead. If that overhead alone already meets/exceeds the
    // usable budget (as here: a lone huge tool schema vs. a tiny first
    // message), scheduling compaction is guaranteed to be futile — the very
    // next preflight check would trip the identical condition again with an
    // unchanged, still-oversized tool-schema total. This was the root cause
    // of local (small-context) models auto-compacting on literally the first
    // prompt of a session, before there was anything to compact.
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

    expect(scheduled.action).toBe("block")
    if (scheduled.action === "block") {
      expect(scheduled.message).toContain("Automatic compaction cannot help this new or tiny session")
      expect(scheduled.message).toContain("fewer tools enabled")
      expect(scheduled.fixedTokens).toBeGreaterThanOrEqual(scheduled.usableTokens)
      expect(scheduled.compactableHistoryTokens).toBeLessThan(512)
    }
    expect(createSpy).not.toHaveBeenCalled()
  })

  test("sends a tiny request that exceeds the compaction trigger but still fits the input cap", async () => {
    // Compaction `usable` is a 90% trigger, not the provider input window.
    // Ornith 9B in a large project reproduced ~23066 fixed tokens vs ~22118
    // usable vs ~24576 cap; blocking at usable aborted a request the model
    // could still accept.
    budgetSpy = vi
      .spyOn(SessionCompaction, "budget")
      .mockResolvedValue({ cap: 24_576, reserved: 2_458, usable: 22_118 })
    createSpy = vi.spyOn(SessionCompaction, "create").mockResolvedValue({} as any)
    toolsSpy = vi.spyOn(ToolRegistry, "tools").mockResolvedValue([
      {
        id: "core_tool",
        description: "Tool with a schema that lands between usable and cap",
        parameters: z.object({
          payload: z.string().describe("x".repeat(88_000)),
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
      userParts: [{ type: "text", text: "i want a vietnam love story" } as any],
      system: ["x".repeat(4_000)],
      requestMessages: [{ role: "user", content: "i want a vietnam love story" }],
    })

    expect(scheduled).toEqual({ action: "continue" })
    expect(createSpy).not.toHaveBeenCalled()
  })

  test("omits tool schemas when the model cannot call tools", async () => {
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

    const noTools = {
      ...model,
      capabilities: { ...model.capabilities, toolcall: false },
    }
    const scheduled = await maybeSchedulePreflightCompaction({
      sessionID: "ses_test" as any,
      agent: "build",
      agentInfo: agent,
      userModel,
      model: noTools,
      userParts: [{ type: "text", text: "small request" } as any],
      system: ["small system"],
      requestMessages: [{ role: "user", content: "small request" }],
    })

    expect(scheduled).toEqual({ action: "continue" })
    expect(toolsSpy).not.toHaveBeenCalled()
    expect(createSpy).not.toHaveBeenCalled()
  })

  test("omits tool schemas for text-only / response-only turns (not tools: {})", async () => {
    // Regression: callers used `tools: {}` intending "no tools", but estimation
    // treats empty maps as "no overrides" and still budgets the full registry.
    // Forced text-only recovery and response-only rewrites would then be
    // blocked/compacted even though the wire request has no tool schemas.
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

    const emptyMapStillCounts = await maybeSchedulePreflightCompaction({
      sessionID: "ses_test" as any,
      agent: "build",
      agentInfo: agent,
      userModel,
      model,
      userParts: [{ type: "text", text: "small request" } as any],
      system: ["small system"],
      requestMessages: [{ role: "user", content: "small request" }],
      tools: {},
    })
    expect(emptyMapStillCounts.action).toBe("block")
    expect(toolsSpy).toHaveBeenCalled()

    toolsSpy.mockClear()
    const textOnly = await maybeSchedulePreflightCompaction({
      sessionID: "ses_test" as any,
      agent: "build",
      agentInfo: agent,
      userModel,
      model,
      userParts: [{ type: "text", text: "small request" } as any],
      system: ["small system"],
      requestMessages: [{ role: "user", content: "small request" }],
      tools: {},
      omitToolSchemas: true,
    })
    expect(textOnly).toEqual({ action: "continue" })
    expect(toolsSpy).not.toHaveBeenCalled()
    expect(createSpy).not.toHaveBeenCalled()
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

    expect(scheduled).toEqual({ action: "continue" })
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

  test("checks overflow against the latest step's tokens, not the turn-cumulative message totals", async () => {
    // A three-step turn at ~30k context per step accumulates to 93k on the
    // message totals; checking THAT against the budget would schedule a
    // compaction the session does not need. The latest step-finish tokens
    // are the real current context size.
    overflowSpy = vi.spyOn(SessionCompaction, "isOverflow").mockResolvedValue(false)
    createSpy = vi.spyOn(SessionCompaction, "create").mockResolvedValue({} as any)
    const stepTokens = { input: 30_000, output: 1_000, reasoning: 0, cache: { read: 0, write: 0 } }

    const scheduled = await maybeScheduleUsageCompaction({
      sessionID: "ses_test" as any,
      agent: "build",
      userModel,
      model,
      lastFinished: {
        summary: false,
        tokens: { input: 90_000, output: 3_000, reasoning: 0, cache: { read: 0, write: 0 } },
      } as any,
      lastFinishedStepTokens: stepTokens as any,
      latestUserParts: [{ type: "text", text: "keep going" } as any],
    })

    expect(overflowSpy).toHaveBeenCalledWith(expect.objectContaining({ tokens: stepTokens }))
    expect(scheduled).toBe(false)
    expect(createSpy).not.toHaveBeenCalled()
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
