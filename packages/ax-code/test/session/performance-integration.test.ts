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

test("real prompt, SDK and adapter honor coding admission and persist opt-in timings", async () => {
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
            if (profiling) {
              expect(response.timing).toMatchObject({ boundary: "provider-adapter", attempt: 1 })
              expect(response.timing!.firstContentMs).toBeGreaterThanOrEqual(0)
              expect(response.timing!.firstTextMs).toBeGreaterThanOrEqual(response.timing!.firstContentMs!)
              expect(response.timing!.streamMs).toBeGreaterThanOrEqual(response.timing!.firstTextMs!)
            } else expect(response).not.toHaveProperty("timing")
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
