import { afterEach, expect, test, vi } from "vitest"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import z from "zod"
import { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionSummary } from "../../src/session/summary"
import { EventQuery } from "../../src/replay/query"
import { NativePerf } from "../../src/perf/native"
import { tmpdir } from "../fixture/fixture"

const model: Provider.Model = {
  id: ModelID.make("test-model"),
  providerID: ProviderID.make("test"),
  name: "Test",
  family: "test",
  api: { id: "test-model", url: "https://example.invalid", npm: "@ai-sdk/openai-compatible" },
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  limit: { context: 128000, output: 8192 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
}

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  NativePerf.reset()
  await Instance.disposeAll()
})

test("real prompt, SDK and adapter honor coding admission and persist request timings", async () => {
  const captured: Array<{ tools: Array<{ function: { name: string } }>; bytes: number }> = []
  const adapter = createOpenAICompatible({
    name: "performance-fixture",
    baseURL: "https://example.invalid/v1",
    fetch: async (input, init) => {
      const request = new Request(input, init)
      const body = z
        .object({ tools: z.array(z.object({ function: z.object({ name: z.string() }).passthrough() }).passthrough()) })
        .parse(await request.json())
      captured.push({ tools: body.tools, bytes: Buffer.byteLength(JSON.stringify(body.tools)) })
      const chunks = [
        { id: "test", choices: [{ delta: { role: "assistant" } }] },
        { id: "test", choices: [{ delta: { content: "Fixed response." } }] },
        {
          id: "test",
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        },
      ]
      return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", {
        headers: { "Content-Type": "text/event-stream" },
      })
    },
  })
  vi.spyOn(Provider, "getLanguage").mockResolvedValue(adapter.chatModel(model.id))
  vi.spyOn(Provider, "getModel").mockResolvedValue(model)
  vi.spyOn(Provider, "getProvider").mockResolvedValue({
    id: model.providerID,
    name: "Test",
    env: [],
    models: {},
    options: {},
    source: "custom",
  })
  vi.spyOn(SessionSummary, "summarize").mockResolvedValue()
  for (const profile of [undefined, "coding"] as const) {
    await using tmp = await tmpdir({ git: true, config: { provider: { test: { options: { toolProfile: profile } } } } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        for (const profiling of [false, true]) {
          vi.stubEnv("AX_CODE_PROFILE_NATIVE", profiling ? "1" : "0")
          const session = await Session.create({ title: "Performance fixture" })
          try {
            const result = await SessionPrompt.prompt({
              sessionID: session.id,
              agent: "build",
              model: { providerID: model.providerID, modelID: model.id },
              tools: { bash: false },
              parts: [{ type: "text", text: "Return the fixed response." }],
            })
            if (result.info.role !== "assistant") throw new Error("Expected an assistant response")
            expect(result.info.error).toBeUndefined()
            expect(result.parts.some((part) => part.type === "text" && part.text === "Fixed response.")).toBe(true)
            const responses = EventQuery.bySession(session.id).filter((event) => event.type === "llm.response")
            expect(responses).toHaveLength(1)
            const response = responses[0]
            if (response.type !== "llm.response") throw new Error("Missing response event")
            expect(response.latencyMs).toBeGreaterThanOrEqual(0)
            expect(response.timing).toMatchObject({ boundary: "provider-adapter", attempt: 1 })
            expect(response.timing!.firstContentMs).toBeGreaterThanOrEqual(0)
            expect(response.timing!.firstTextMs).toBeGreaterThanOrEqual(response.timing!.firstContentMs!)
            expect(response.timing!.streamMs).toBeGreaterThanOrEqual(response.timing!.firstTextMs!)
            expect(response.latencyMs).toBeGreaterThanOrEqual(response.timing!.setupMs)
            expect(captured.at(-1)!.tools.map((tool) => tool.function.name)).not.toContain("bash")
          } finally {
            await Session.remove(session.id)
          }
        }
      },
    })
  }
  expect(captured).toHaveLength(4)
  const [full, fullProfiled, coding, codingProfiled] = captured
  expect(coding.tools.map((tool) => tool.function.name)).toEqual(
    expect.arrayContaining(["edit", "read", "task", "verify_project", "review_complete"]),
  )
  expect(coding.tools.map((tool) => tool.function.name)).not.toContain("debug_analyze")
  expect(coding.bytes).toBeLessThan(full.bytes * 0.75)
  expect(fullProfiled.tools).toEqual(full.tools)
  expect(codingProfiled.tools).toEqual(coding.tools)
  const spans = NativePerf.snapshot().rows.map((row) => row.name)
  expect(spans).toEqual(
    expect.arrayContaining([
      "session.insertReminders",
      "session.preflight",
      "session.resolveTools",
      "session.snapshot.track",
      "session.snapshot.patch",
    ]),
  )
}, 60_000)

test("AX Engine story turns omit coding tools and project only required conversation text", async () => {
  const axEngineModel: Provider.Model = {
    ...model,
    id: ModelID.make("story-model"),
    providerID: ProviderID.make("ax-engine"),
    api: { ...model.api, id: "story-model" },
  }
  const captured: Array<Record<string, unknown>> = []
  const adapter = createOpenAICompatible({
    name: "story-fixture",
    baseURL: "https://example.invalid/v1",
    fetch: async (input, init) => {
      const request = new Request(input, init)
      captured.push(z.record(z.string(), z.unknown()).parse(await request.json()))
      const chunks = [
        { id: "test", choices: [{ delta: { role: "assistant" } }] },
        { id: "test", choices: [{ delta: { content: "Story response." } }] },
        {
          id: "test",
          choices: [{ delta: {}, finish_reason: captured.length === 3 ? "length" : "stop" }],
          usage: { prompt_tokens: 20, completion_tokens: 3, total_tokens: 23 },
        },
      ]
      return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", {
        headers: { "Content-Type": "text/event-stream" },
      })
    },
  })
  vi.spyOn(Provider, "getLanguage").mockResolvedValue(adapter.chatModel(axEngineModel.id))
  vi.spyOn(Provider, "getModel").mockResolvedValue(axEngineModel)
  vi.spyOn(Provider, "getProvider").mockResolvedValue({
    id: axEngineModel.providerID,
    name: "AX Engine",
    env: [],
    models: {},
    options: {},
    source: "custom",
  })
  vi.spyOn(SessionSummary, "summarize").mockResolvedValue()

  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({ title: "Story fixture" })
      try {
        for (const text of ["tell me a story about Japan", "another new story set in Beijing", "continue the story"]) {
          const result = await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            model: { providerID: axEngineModel.providerID, modelID: axEngineModel.id },
            parts: [{ type: "text", text }],
          })
          expect(result.info.role).toBe("assistant")
        }
      } finally {
        await Session.remove(session.id)
      }
    },
  })

  expect(captured).toHaveLength(3)
  for (const body of captured) {
    expect(body.tools ?? []).toEqual([])
    expect(JSON.stringify(body)).not.toContain("AGENTS.md")
    expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThan(12_000)
  }
  const conversationLengths = captured.map(
    (body) =>
      z
        .array(z.object({ role: z.string() }).passthrough())
        .parse(body.messages)
        .filter((message) => message.role !== "system").length,
  )
  expect(conversationLengths).toEqual([1, 1, 2])
}, 60_000)
