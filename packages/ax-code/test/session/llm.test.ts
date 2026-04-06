import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import path from "path"
import { tool, type ModelMessage } from "ai"
import z from "zod"
import { LLM } from "../../src/session/llm"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { ProviderTransform } from "../../src/provider/transform"
import { ModelsDev } from "../../src/provider/models"
import { ProviderID, ModelID } from "../../src/provider/schema"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"
import type { Agent } from "../../src/agent/agent"
import type { MessageV2 } from "../../src/session/message-v2"
import { SessionID, MessageID } from "../../src/session/schema"
import { SessionPrompt } from "../../src/session/prompt"

describe("session.llm.hasToolCalls", () => {
  test("returns false for empty messages array", () => {
    expect(LLM.hasToolCalls([])).toBe(false)
  })

  test("returns false for messages with only text content", () => {
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "Hello" }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Hi there" }],
      },
    ]
    expect(LLM.hasToolCalls(messages)).toBe(false)
  })

  test("returns true when messages contain tool-call", () => {
    const messages = [
      {
        role: "user",
        content: [{ type: "text", text: "Run a command" }],
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-123",
            toolName: "bash",
          },
        ],
      },
    ] as ModelMessage[]
    expect(LLM.hasToolCalls(messages)).toBe(true)
  })

  test("returns true when messages contain tool-result", () => {
    const messages = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-123",
            toolName: "bash",
          },
        ],
      },
    ] as ModelMessage[]
    expect(LLM.hasToolCalls(messages)).toBe(true)
  })

  test("returns false for messages with string content", () => {
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: "Hello world",
      },
      {
        role: "assistant",
        content: "Hi there",
      },
    ]
    expect(LLM.hasToolCalls(messages)).toBe(false)
  })

  test("returns true when tool-call is mixed with text content", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me run that command" },
          {
            type: "tool-call",
            toolCallId: "call-456",
            toolName: "read",
          },
        ],
      },
    ] as ModelMessage[]
    expect(LLM.hasToolCalls(messages)).toBe(true)
  })
})

type Capture = {
  url: URL
  headers: Headers
  body: Record<string, unknown>
}

const state = {
  server: {
    url: new URL("http://127.0.0.1"),
  },
  queue: [] as Array<{ path: string; response: Response; resolve: (value: Capture) => void }>,
}
const originalFetch = globalThis.fetch

function deferred<T>() {
  const result = {} as { promise: Promise<T>; resolve: (value: T) => void }
  result.promise = new Promise((resolve) => {
    result.resolve = resolve
  })
  return result
}

function waitRequest(pathname: string, response: Response) {
  const pending = deferred<Capture>()
  state.queue.push({ path: pathname, response, resolve: pending.resolve })
  return pending.promise
}

beforeAll(() => {
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init)
      const url = new URL(req.url)
      const idx = state.queue.findIndex((item) => url.pathname.endsWith(item.path))
      if (idx === -1) {
        return new Response("not found", { status: 404 })
      }

      const [next] = state.queue.splice(idx, 1)
      const text = await req.text()
      const body = text ? (JSON.parse(text) as Record<string, unknown>) : {}
      next.resolve({ url, headers: req.headers, body })
      return next.response
    },
    { preconnect: originalFetch.preconnect },
  ) as typeof fetch
})

beforeEach(() => {
  state.queue.length = 0
})

afterAll(() => {
  globalThis.fetch = originalFetch
})

function createChatStream(text: string) {
  const payload =
    [
      `data: ${JSON.stringify({
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        choices: [{ delta: { role: "assistant" } }],
      })}`,
      `data: ${JSON.stringify({
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        choices: [{ delta: { content: text } }],
      })}`,
      `data: ${JSON.stringify({
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        choices: [{ delta: {}, finish_reason: "stop" }],
      })}`,
      "data: [DONE]",
    ].join("\n\n") + "\n\n"

  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(payload))
      controller.close()
    },
  })
}

async function loadFixture(providerID: string, modelID: string) {
  const fixturePath = path.join(import.meta.dir, "../tool/fixtures/models-api.json")
  const data = await Filesystem.readJson<Record<string, ModelsDev.Provider>>(fixturePath)
  const provider = data[providerID]
  if (!provider) {
    throw new Error(`Missing provider in fixture: ${providerID}`)
  }
  const model = provider.models[modelID]
  if (!model) {
    throw new Error(`Missing model in fixture: ${modelID}`)
  }
  return { provider, model }
}

function createEventStream(chunks: unknown[], includeDone = false) {
  const lines = chunks.map((chunk) => `data: ${typeof chunk === "string" ? chunk : JSON.stringify(chunk)}`)
  if (includeDone) {
    lines.push("data: [DONE]")
  }
  const payload = lines.join("\n\n") + "\n\n"
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(payload))
      controller.close()
    },
  })
}

function createEventResponse(chunks: unknown[], includeDone = false) {
  return new Response(createEventStream(chunks, includeDone), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  })
}

describe("session.llm.stream", () => {
  test("sends temperature, tokens, and reasoning options for openai-compatible models", async () => {
    const providerID = "alibaba"
    const modelID = "qwen-plus"
    const fixture = await loadFixture(providerID, modelID)
    const provider = fixture.provider
    const model = fixture.model

    const request = waitRequest(
      "/chat/completions",
      new Response(createChatStream("Hello"), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    )

    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "ax-code.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            enabled_providers: [providerID],
            provider: {
              [providerID]: {
                options: {
                  apiKey: "test-key",
                  baseURL: `${state.server.url.origin}/v1`,
                },
              },
            },
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const resolved = await Provider.getModel(ProviderID.make(providerID), ModelID.make(model.id))
        const sessionID = SessionID.make("session-test-1")
        const agent = {
          name: "test",
          mode: "primary",
          options: {},
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
          temperature: 0.4,
          topP: 0.8,
        } satisfies Agent.Info

        const user = {
          id: MessageID.make("user-1"),
          sessionID,
          role: "user",
          time: { created: Date.now() },
          agent: agent.name,
          model: { providerID: ProviderID.make(providerID), modelID: resolved.id },
          variant: "high",
        } satisfies MessageV2.User

        const stream = await LLM.stream({
          user,
          sessionID,
          model: resolved,
          agent,
          system: ["You are a helpful assistant."],
          abort: new AbortController().signal,
          messages: [{ role: "user", content: "Hello" }],
          tools: {},
        })

        for await (const _ of stream.fullStream) {
        }

        const capture = await request
        const body = capture.body
        const headers = capture.headers
        const url = capture.url

        expect(url.pathname.startsWith("/v1/")).toBe(true)
        expect(url.pathname.endsWith("/chat/completions")).toBe(true)
        expect(headers.get("Authorization")).toBe("Bearer test-key")

        expect(body.model).toBe(resolved.api.id)
        expect(body.temperature).toBe(0.4)
        expect(body.top_p).toBe(0.8)
        expect(body.stream).toBe(true)

        const maxTokens = (body.max_tokens as number | undefined) ?? (body.max_output_tokens as number | undefined)
        const expectedMaxTokens = ProviderTransform.maxOutputTokens(resolved)
        expect(maxTokens).toBe(expectedMaxTokens)

        const reasoning = (body.reasoningEffort as string | undefined) ?? (body.reasoning_effort as string | undefined)
        expect(reasoning).toBe("high")
      },
    })
  })

  test("keeps tools enabled by prompt permissions", async () => {
    const providerID = "alibaba"
    const modelID = "qwen-plus"
    const fixture = await loadFixture(providerID, modelID)
    const model = fixture.model

    const request = waitRequest(
      "/chat/completions",
      new Response(createChatStream("Hello"), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    )

    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "ax-code.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            enabled_providers: [providerID],
            provider: {
              [providerID]: {
                options: {
                  apiKey: "test-key",
                  baseURL: `${state.server.url.origin}/v1`,
                },
              },
            },
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const resolved = await Provider.getModel(ProviderID.make(providerID), ModelID.make(model.id))
        const sessionID = SessionID.make("session-test-tools")
        const agent = {
          name: "test",
          mode: "primary",
          options: {},
          permission: [{ permission: "question", pattern: "*", action: "deny" }],
        } satisfies Agent.Info

        const user = {
          id: MessageID.make("user-tools"),
          sessionID,
          role: "user",
          time: { created: Date.now() },
          agent: agent.name,
          model: { providerID: ProviderID.make(providerID), modelID: resolved.id },
          tools: { question: true },
        } satisfies MessageV2.User

        const stream = await LLM.stream({
          user,
          sessionID,
          model: resolved,
          agent,
          permission: [{ permission: "question", pattern: "*", action: "allow" }],
          system: ["You are a helpful assistant."],
          abort: new AbortController().signal,
          messages: [{ role: "user", content: "Hello" }],
          tools: {
            question: tool({
              description: "Ask a question",
              inputSchema: z.object({}),
              execute: async () => ({ output: "" }),
            }),
          },
        })

        for await (const _ of stream.fullStream) {
        }

        const capture = await request
        const tools = capture.body.tools as Array<{ function?: { name?: string } }> | undefined
        expect(tools?.some((item) => item.function?.name === "question")).toBe(true)
      },
    })
  })

  test("sends required StructuredOutput tool schema for json_schema output", async () => {
    const providerID = "alibaba"
    const modelID = "qwen-plus"
    const fixture = await loadFixture(providerID, modelID)
    const provider = fixture.provider
    const model = fixture.model

    const request = waitRequest(
      "/chat/completions",
      new Response(createChatStream("Hello"), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    )

    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "ax-code.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            enabled_providers: [providerID],
            provider: {
              [providerID]: {
                options: {
                  apiKey: "test-key",
                  baseURL: `${state.server.url.origin}/v1`,
                },
              },
            },
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const resolved = await Provider.getModel(ProviderID.make(providerID), ModelID.make(model.id))
        const sessionID = SessionID.make("session-test-structured")
        const agent = {
          name: "test",
          mode: "primary",
          options: {},
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        } satisfies Agent.Info

        const user = {
          id: MessageID.make("user-structured"),
          sessionID,
          role: "user",
          time: { created: Date.now() },
          agent: agent.name,
          model: { providerID: ProviderID.make(providerID), modelID: resolved.id },
        } satisfies MessageV2.User

        const stream = await LLM.stream({
          user,
          sessionID,
          model: resolved,
          agent,
          system: ["Return valid structured output."],
          abort: new AbortController().signal,
          messages: [{ role: "user", content: "Share a structured answer" }],
          toolChoice: "required",
          tools: {
            StructuredOutput: SessionPrompt.createStructuredOutputTool({
              schema: {
                $schema: "http://json-schema.org/draft-07/schema#",
                type: "object",
                properties: {
                  answer: { type: "string" },
                  score: { type: "number" },
                },
                required: ["answer"],
              },
              onSuccess() {},
            }),
          },
        })

        for await (const _ of stream.fullStream) {
        }

        const capture = await request
        const body = capture.body
        const tools = body.tools as Array<{ function?: { name?: string; parameters?: Record<string, unknown> } }>
        const item = tools.find((tool) => tool.function?.name === "StructuredOutput")
        expect(body.tool_choice).toBe("required")
        expect(item).toBeDefined()
        expect(item?.function?.parameters?.["$schema"]).toBeUndefined()
        expect((item?.function?.parameters?.properties as Record<string, unknown>)?.["answer"]).toBeDefined()
        expect((item?.function?.parameters?.properties as Record<string, unknown>)?.["score"]).toBeDefined()
      },
    })
  })

  test.skipIf(!!process.env.CI)(
    "normalizes interleaved reasoning into provider request payload",
    async () => {
    const providerID = "moonshotai-cn"
    const modelID = "kimi-k2-thinking"
    const fixture = await loadFixture(providerID, modelID)
    const model = fixture.model

    const request = waitRequest(
      "/chat/completions",
      new Response(createChatStream("Hello"), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    )

    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "ax-code.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            enabled_providers: [providerID],
            provider: {
              [providerID]: {
                options: {
                  apiKey: "test-key",
                  baseURL: `${state.server.url.origin}/v1`,
                },
              },
            },
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const resolved = await Provider.getModel(ProviderID.make(providerID), ModelID.make(model.id))
        const sessionID = SessionID.make("session-test-reasoning")
        const agent = {
          name: "test",
          mode: "primary",
          options: {},
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        } satisfies Agent.Info

        const user = {
          id: MessageID.make("user-reasoning"),
          sessionID,
          role: "user",
          time: { created: Date.now() },
          agent: agent.name,
          model: { providerID: ProviderID.make(providerID), modelID: resolved.id },
        } satisfies MessageV2.User

        const stream = await LLM.stream({
          user,
          sessionID,
          model: resolved,
          agent,
          system: ["Continue from the prior step."],
          abort: new AbortController().signal,
          messages: [
            { role: "user", content: "Use the previous result." },
            {
              role: "assistant",
              content: [
                { type: "reasoning", text: "Let me think through the prior tool result." },
                { type: "tool-call", toolCallId: "call-1", toolName: "bash", input: { command: "pwd" } },
              ],
            } as any,
            { role: "user", content: "Continue." },
          ],
          tools: {},
        })

        for await (const _ of stream.fullStream) {
        }

        const capture = await request
        const text = JSON.stringify(capture.body.messages)
        expect(text).toContain("reasoning_content")
        expect(text).toContain("Let me think through the prior tool result.")
        expect(text).not.toContain("\"type\":\"reasoning\"")
      },
    })
  }, 60_000)

  test.skipIf(!!process.env.CI)(
    "adds noop tool for LiteLLM-compatible histories with prior tool calls",
    async () => {
    const providerID = "alibaba"
    const modelID = "qwen-plus"
    const fixture = await loadFixture(providerID, modelID)
    const model = fixture.model

    const request = waitRequest(
      "/chat/completions",
      new Response(createChatStream("Hello"), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    )

    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "ax-code.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            enabled_providers: [providerID],
            provider: {
              [providerID]: {
                options: {
                  apiKey: "test-key",
                  baseURL: `${state.server.url.origin}/v1`,
                  litellmProxy: true,
                },
              },
            },
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const resolved = await Provider.getModel(ProviderID.make(providerID), ModelID.make(model.id))
        const sessionID = SessionID.make("session-test-image")
        const agent = {
          name: "test",
          mode: "primary",
          options: {},
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        } satisfies Agent.Info

        const user = {
          id: MessageID.make("user-image"),
          sessionID,
          role: "user",
          time: { created: Date.now() },
          agent: agent.name,
          model: { providerID: ProviderID.make(providerID), modelID: resolved.id },
        } satisfies MessageV2.User

        const stream = await LLM.stream({
          user,
          sessionID,
          model: resolved,
          agent,
          system: ["Continue the tool-assisted exchange."],
          abort: new AbortController().signal,
          messages: [
            { role: "user", content: "Run the command." },
            {
              role: "assistant",
              content: [
                { type: "tool-call", toolCallId: "call-1", toolName: "bash", input: { command: "pwd" } },
              ],
            } as any,
          ],
          tools: {},
        })

        for await (const _ of stream.fullStream) {
        }

        const capture = await request
        const tools = capture.body.tools as Array<{ function?: { name?: string } }> | undefined
        expect(tools?.some((item) => item.function?.name === "_noop")).toBe(true)
      },
    })
  }, 60_000)

  test("sends Google API payload for Gemini models", async () => {
    const providerID = "google"
    const modelID = "gemini-3-flash-preview"
    const fixture = await loadFixture(providerID, modelID)
    const provider = fixture.provider
    const model = fixture.model
    const pathSuffix = `/v1beta/models/${model.id}:streamGenerateContent`

    const chunks = [
      {
        candidates: [
          {
            content: {
              parts: [{ text: "Hello" }],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {
          promptTokenCount: 1,
          candidatesTokenCount: 1,
          totalTokenCount: 2,
        },
      },
    ]
    const request = waitRequest(pathSuffix, createEventResponse(chunks))

    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "ax-code.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            enabled_providers: [providerID],
            provider: {
              [providerID]: {
                options: {
                  apiKey: "test-google-key",
                  baseURL: `${state.server.url.origin}/v1beta`,
                },
              },
            },
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const resolved = await Provider.getModel(ProviderID.make(providerID), ModelID.make(model.id))
        const sessionID = SessionID.make("session-test-4")
        const agent = {
          name: "test",
          mode: "primary",
          options: {},
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
          temperature: 0.3,
          topP: 0.8,
        } satisfies Agent.Info

        const user = {
          id: MessageID.make("user-4"),
          sessionID,
          role: "user",
          time: { created: Date.now() },
          agent: agent.name,
          model: { providerID: ProviderID.make(providerID), modelID: resolved.id },
        } satisfies MessageV2.User

        const stream = await LLM.stream({
          user,
          sessionID,
          model: resolved,
          agent,
          system: ["You are a helpful assistant."],
          abort: new AbortController().signal,
          messages: [{ role: "user", content: "Hello" }],
          tools: {},
        })

        for await (const _ of stream.fullStream) {
        }

        const capture = await request
        const body = capture.body
        const config = body.generationConfig as
          | { temperature?: number; topP?: number; maxOutputTokens?: number }
          | undefined

        expect(capture.url.pathname).toBe(pathSuffix)
        expect(config?.temperature).toBe(0.3)
        expect(config?.topP).toBe(0.8)
        expect(config?.maxOutputTokens).toBe(ProviderTransform.maxOutputTokens(resolved))
        expect((config as any)?.thinkingConfig?.includeThoughts).toBe(true)
        expect((config as any)?.thinkingConfig?.thinkingLevel).toBe("high")
      },
    })
  })

  test("uses minimal Gemini thinking config for small-model requests", async () => {
    const providerID = "google"
    const modelID = "gemini-3-pro-preview"
    const fixture = await loadFixture(providerID, modelID)
    const model = fixture.model
    const pathSuffix = `/v1beta/models/${model.id}:streamGenerateContent`

    const chunks = [
      {
        candidates: [
          {
            content: {
              parts: [{ text: "Short title" }],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {
          promptTokenCount: 1,
          candidatesTokenCount: 1,
          totalTokenCount: 2,
        },
      },
    ]
    const request = waitRequest(pathSuffix, createEventResponse(chunks))

    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "ax-code.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            enabled_providers: [providerID],
            provider: {
              [providerID]: {
                options: {
                  apiKey: "test-google-key",
                  baseURL: `${state.server.url.origin}/v1beta`,
                },
              },
            },
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const resolved = await Provider.getModel(ProviderID.make(providerID), ModelID.make(model.id))
        const sessionID = SessionID.make("session-test-google-small")
        const agent = {
          name: "test",
          mode: "primary",
          options: {},
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        } satisfies Agent.Info

        const user = {
          id: MessageID.make("user-google-small"),
          sessionID,
          role: "user",
          time: { created: Date.now() },
          agent: agent.name,
          model: { providerID: ProviderID.make(providerID), modelID: resolved.id },
        } satisfies MessageV2.User

        const stream = await LLM.stream({
          user,
          sessionID,
          model: resolved,
          agent,
          small: true,
          system: ["Generate a short title."],
          abort: new AbortController().signal,
          messages: [{ role: "user", content: "Summarize this conversation." }],
          tools: {},
        })

        for await (const _ of stream.fullStream) {
        }

        const capture = await request
        const config = (capture.body.generationConfig as { thinkingConfig?: Record<string, unknown> } | undefined)
          ?.thinkingConfig

        expect(capture.url.pathname).toBe(pathSuffix)
        expect(config?.["thinkingLevel"]).toBe("minimal")
      },
    })
  })

})
