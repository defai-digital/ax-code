import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tool, type ModelMessage } from "ai"
import z from "zod"
import { LLM } from "../../src/session/llm"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { ProviderTransform } from "../../src/provider/transform"
import { ModelsDev } from "../../src/provider/models"
import { ProviderID, ModelID } from "../../src/provider/schema"
import { Env } from "../../src/env"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"
import type { Agent } from "../../src/agent/agent"
import type { MessageV2 } from "../../src/session/message-v2"
import { SessionID, MessageID } from "../../src/session/schema"
import { createStructuredOutputTool } from "../../src/session/prompt-helpers"
import { SuperLongRuntime } from "../../src/session/super-long-runtime"

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

describe("session.llm.axEngineToolRepair", () => {
  const model = {
    id: "qwen3-coder-next",
    providerID: ProviderID.make("ax-engine"),
    limit: { context: 16_384, output: 2_048 },
  } as any

  const nonAxEngineModel = {
    id: "qwen3-coder-next",
    providerID: ProviderID.make("ollama"),
    limit: { context: 16_384, output: 2_048 },
  } as any

  const tools = {
    bash: tool({
      description: "Run shell commands",
      inputSchema: z.object({ command: z.string(), description: z.string() }),
      execute: async () => ({ output: "" }),
    }),
    edit: tool({
      description: "Edit files",
      inputSchema: z.object({
        filePath: z.string(),
        oldString: z.string(),
        newString: z.string(),
        replaceAll: z.boolean().optional(),
      }),
      execute: async () => ({ output: "" }),
    }),
    glob: tool({
      description: "Find files",
      inputSchema: z.object({ pattern: z.string(), path: z.string().optional() }),
      execute: async () => ({ output: "" }),
    }),
    read: tool({
      description: "Read files",
      inputSchema: z.object({ filePath: z.string() }),
      execute: async () => ({ output: "" }),
    }),
    write: tool({
      description: "Write files",
      inputSchema: z.object({ filePath: z.string(), content: z.string() }),
      execute: async () => ({ output: "" }),
    }),
  }

  test("maps common local Qwen tool aliases to ax-code tools", () => {
    expect(
      LLM.repairToolCallForTest({
        model,
        tools,
        toolCall: { toolName: "list_files", input: {} },
      }),
    ).toMatchObject({ toolName: "glob", input: { pattern: "**/*" } })

    expect(
      LLM.repairToolCallForTest({
        model,
        tools,
        toolCall: { toolName: "write_file", input: { path: "/tmp/index.html", content: "<html></html>" } },
      }),
    ).toMatchObject({ toolName: "write", input: { filePath: "/tmp/index.html", content: "<html></html>" } })
  })

  test("normalizes local Qwen snake_case tool arguments", () => {
    expect(
      LLM.repairToolCallForTest({
        model,
        tools,
        toolCall: { toolName: "read", input: { file_path: "/tmp/ax-code.json" } },
      }),
    ).toMatchObject({ toolName: "read", input: { filePath: "/tmp/ax-code.json" } })

    expect(
      LLM.repairToolCallForTest({
        model,
        tools,
        toolCall: {
          toolName: "edit_file",
          input: {
            file_path: "/tmp/index.html",
            old_string: "old",
            new_string: "new",
            replace_all: true,
          },
        },
      }),
    ).toMatchObject({
      toolName: "edit",
      input: { filePath: "/tmp/index.html", oldString: "old", newString: "new", replaceAll: true },
    })
  })

  test("fills bash description for ax-engine repaired calls", () => {
    expect(
      LLM.repairToolCallForTest({
        model,
        tools,
        toolCall: { toolName: "bash", input: { command: "ls -la /tmp" } },
      }),
    ).toMatchObject({ toolName: "bash", input: { command: "ls -la /tmp", description: "ls -la /tmp" } })
  })

  test("does not repair other local providers", () => {
    expect(
      LLM.repairToolCallForTest({
        model: nonAxEngineModel,
        tools,
        toolCall: { toolName: "write_file", input: { path: "/tmp/index.html", content: "<html></html>" } },
      }),
    ).toBeUndefined()
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
  const fallback = await Filesystem.readJson<Record<string, ModelsDev.Provider>>(
    path.join(import.meta.dir, "../../src/provider/models-snapshot.json"),
  )
  const provider = data[providerID]
  const fallbackProvider = fallback[providerID]
  if (!provider && !fallbackProvider) {
    throw new Error(`Missing provider in fixture: ${providerID}`)
  }
  const model = provider?.models[modelID] ?? fallbackProvider?.models[modelID]
  if (!model) {
    throw new Error(`Missing model in fixture: ${modelID}`)
  }
  return { provider: provider ?? fallbackProvider!, model }
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
  test("sends Alibaba token-plan-safe OpenAI-compatible parameters", async () => {
    const providerID = "alibaba-token-plan"
    const modelID = "qwen3.6-plus"
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
        const pluginDir = path.join(dir, ".ax-code", "plugin")
        await fs.mkdir(pluginDir, { recursive: true })
        await Bun.write(
          path.join(pluginDir, "unsafe-token-plan-params.ts"),
          [
            "export default async () => ({",
            '  "chat.params": async (_input, output) => {',
            '    output.options.thinking = { type: "enabled", budgetTokens: 8192 }',
            "    output.options.enable_thinking = true",
            '    output.options.reasoning = { effort: "high" }',
            '    output.options.reasoningEffort = "high"',
            '    output.options.reasoning_effort = "high"',
            '    output.options.thinkingConfig = { thinkingLevel: "high" }',
            "  },",
            "})",
            "",
          ].join("\n"),
        )
        await Bun.write(
          path.join(dir, "ax-code.json"),
          JSON.stringify({
            $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
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
          options: {
            thinking: { type: "enabled", budgetTokens: 8192 },
            enable_thinking: true,
            reasoning: { effort: "high" },
            reasoningEffort: "high",
            reasoning_effort: "high",
            thinkingConfig: { thinkingLevel: "high" },
          },
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

        // Token Plan runs on the OpenAI-compat endpoint and uses DashScope's
        // documented enable_thinking + thinking_budget pair (commit 54f168d5);
        // the Anthropic-shaped `thinking` block is stripped. Budget is
        // sanitized down to maxOutputTokens (4096 — the Alibaba short-window
        // cap) even though the agent config requested 8192.
        expect(body.thinking).toBeUndefined()
        expect(body.enable_thinking).toBe(true)
        expect(body.thinking_budget).toBe(4096)
        expect(body.reasoning).toBeUndefined()
        expect(body.reasoningEffort).toBeUndefined()
        expect(body.reasoning_effort).toBeUndefined()
        expect(body.thinkingConfig).toBeUndefined()
      },
    })
  })

  test("keeps tools enabled by prompt permissions", async () => {
    const providerID = "alibaba-coding-plan"
    const modelID = "qwen3.6-plus"
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
            $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
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

  test("compacts ax-engine tool payload before sending OpenAI-compatible requests", async () => {
    const modelsRequest = waitRequest(
      "/models",
      Response.json({
        object: "list",
        data: [{ id: "qwen3", object: "model", owned_by: "ax-engine" }],
      }),
    )
    const readyRequest = waitRequest(
      "/models",
      Response.json({
        object: "list",
        data: [{ id: "qwen3", object: "model", owned_by: "ax-engine" }],
      }),
    )
    const request = waitRequest(
      "/chat/completions",
      new Response(createChatStream("Hello"), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    )
    const longDescription = "Use this tool carefully with detailed operational guidance. ".repeat(40)
    const model: Provider.Model = {
      id: "qwen3-coder-next" as any,
      providerID: ProviderID.make("ax-engine"),
      name: "Qwen3-Coder-Next",
      family: "qwen",
      api: {
        id: "qwen3",
        url: `${state.server.url.origin}/v1`,
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
      limit: { context: 16_384, output: 2_048 },
      status: "active",
      options: {},
      headers: {},
      release_date: "2026-01-01",
    }

    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "ax-code.json"),
          JSON.stringify({
            $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
            enabled_providers: ["ax-engine"],
            provider: {
              "ax-engine": {
                options: {
                  apiKey: "local",
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
        const sessionID = SessionID.make("session-test-ax-engine-tools")
        const agent = {
          name: "test",
          mode: "primary",
          options: {},
          permission: [{ permission: "question", pattern: "*", action: "allow" }],
        } satisfies Agent.Info

        const user = {
          id: MessageID.make("user-ax-engine-tools"),
          sessionID,
          role: "user",
          time: { created: Date.now() },
          agent: agent.name,
          model: { providerID: model.providerID, modelID: model.id },
          tools: { question: true },
        } satisfies MessageV2.User

        const stream = await LLM.stream({
          user,
          sessionID,
          model,
          agent,
          permission: [{ permission: "question", pattern: "*", action: "allow" }],
          system: ["You are a helpful assistant."],
          abort: new AbortController().signal,
          messages: [{ role: "user", content: "Hello" }],
          tools: {
            question: tool({
              description: longDescription,
              inputSchema: z.object({
                path: z.string().describe(longDescription).default("README.md"),
                mode: z.enum(["read", "write"]).describe("Operation mode"),
              }),
              execute: async () => ({ output: "" }),
            }),
          },
        })

        for await (const _ of stream.fullStream) {
        }

        const capture = await request
        await modelsRequest
        await readyRequest
        const tools = capture.body.tools as Array<{
          function?: { description?: string; parameters?: Record<string, any> }
        }>
        const fn = tools[0]?.function
        expect(fn?.description?.length).toBeLessThanOrEqual(180)
        expect(fn?.parameters?.$schema).toBeUndefined()
        expect(fn?.parameters?.properties?.path?.default).toBeUndefined()
        expect(fn?.parameters?.properties?.path?.description.length).toBeLessThanOrEqual(96)
        expect(fn?.parameters?.properties?.mode?.enum).toEqual(["read", "write"])
      },
    })
  })

  test("omits tool schemas for models that do not support tool calling", async () => {
    const providerID = "alibaba-coding-plan"
    const modelID = "qwen3.6-plus"
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
            $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
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
        const withoutToolCalls = {
          ...resolved,
          capabilities: {
            ...resolved.capabilities,
            toolcall: false,
          },
        }
        const sessionID = SessionID.make("session-test-no-toolcall")
        const agent = {
          name: "test",
          mode: "primary",
          options: {},
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        } satisfies Agent.Info

        const user = {
          id: MessageID.make("user-no-toolcall"),
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
          model: withoutToolCalls,
          agent,
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
        expect(capture.body.tools).toBeUndefined()
        expect(capture.body.tool_choice).toBeUndefined()
      },
    })
  })

  test("sends required StructuredOutput tool schema for json_schema output", async () => {
    const providerID = "alibaba-coding-plan"
    const modelID = "qwen3.6-plus"
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
            $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
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
            StructuredOutput: createStructuredOutputTool({
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
      const providerID = "zhipuai"
      const modelID = "glm-5"
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
              $schema:
                "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
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
              { role: "user", content: [{ type: "text", text: "Use the previous result." }] },
              {
                role: "assistant",
                content: [
                  { type: "reasoning", text: "Let me think through the prior tool result." },
                  { type: "tool-call", toolCallId: "call-1", toolName: "bash", args: { command: "pwd" } },
                ],
              },
              {
                role: "tool",
                content: [
                  {
                    type: "tool-result",
                    toolCallId: "call-1",
                    toolName: "bash",
                    output: { type: "text", value: "/home/user" },
                  },
                ],
              },
              { role: "user", content: [{ type: "text", text: "Continue." }] },
            ] as any,
            tools: {},
          })

          for await (const _ of stream.fullStream) {
          }

          const capture = await request
          const text = JSON.stringify(capture.body.messages)
          expect(text).toContain("reasoning_content")
          expect(text).toContain("Let me think through the prior tool result.")
          expect(text).not.toContain('"type":"reasoning"')
        },
      })
    },
    60_000,
  )

  test.skipIf(!!process.env.CI)(
    "adds noop tool for LiteLLM-compatible histories with prior tool calls",
    async () => {
      const providerID = "alibaba-coding-plan"
      const modelID = "qwen3.6-plus"
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
              $schema:
                "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
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
              { role: "user", content: [{ type: "text", text: "Run the command." }] },
              {
                role: "assistant",
                content: [{ type: "tool-call", toolCallId: "call-1", toolName: "bash", args: { command: "pwd" } }],
              },
              {
                role: "tool",
                content: [
                  {
                    type: "tool-result",
                    toolCallId: "call-1",
                    toolName: "bash",
                    output: { type: "text", value: "/home/user" },
                  },
                ],
              },
            ] as any,
            tools: {},
          })

          for await (const _ of stream.fullStream) {
          }

          const capture = await request
          const tools = capture.body.tools as Array<{ function?: { name?: string } }> | undefined
          expect(tools?.some((item) => item.function?.name === "_noop")).toBe(true)
        },
      })
    },
    60_000,
  )

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
            $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
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
    const modelID = "gemini-3.1-pro-preview"
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
            $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
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

describe("session.llm.stream - Phase 1 long-agent profile wiring", () => {
  const origSuperLong = process.env.AX_CODE_SUPER_LONG
  const origSuperLongOverride = process.env.AX_CODE_SUPER_LONG_SESSION_OVERRIDE
  const origAutonomous = process.env.AX_CODE_AUTONOMOUS
  const origDurablePacing = process.env.AX_CODE_SUPER_LONG_DURABLE_PACING

  beforeEach(() => {
    process.env.AX_CODE_SUPER_LONG_DURABLE_PACING = "0"
    // Super-Long requires autonomous. Pin the flag explicitly: config loads
    // with an `autonomous` key sync the env, so earlier tests in the process
    // could otherwise leak it off.
    process.env.AX_CODE_AUTONOMOUS = "1"
  })

  afterEach(() => {
    if (origSuperLong === undefined) {
      delete process.env.AX_CODE_SUPER_LONG
    } else {
      process.env.AX_CODE_SUPER_LONG = origSuperLong
    }
    if (origSuperLongOverride === undefined) {
      delete process.env.AX_CODE_SUPER_LONG_SESSION_OVERRIDE
    } else {
      process.env.AX_CODE_SUPER_LONG_SESSION_OVERRIDE = origSuperLongOverride
    }
    if (origAutonomous === undefined) {
      delete process.env.AX_CODE_AUTONOMOUS
    } else {
      process.env.AX_CODE_AUTONOMOUS = origAutonomous
    }
    if (origDurablePacing === undefined) {
      delete process.env.AX_CODE_SUPER_LONG_DURABLE_PACING
    } else {
      process.env.AX_CODE_SUPER_LONG_DURABLE_PACING = origDurablePacing
    }
    LLM.clearPacingState()
  })

  test("Qwen3.7-Max with Super-Long enabled emits preserve_thinking in request body", async () => {
    process.env.AX_CODE_SUPER_LONG = "1"
    const providerID = "alibaba-coding-plan"
    const modelID = "qwen3.7-max"
    const fixture = await loadFixture(providerID, modelID)
    const model = fixture.model

    const request = waitRequest(
      "/chat/completions",
      new Response(createChatStream("ok"), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    )

    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "ax-code.json"),
          JSON.stringify({
            $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
            enabled_providers: [providerID],
            provider: {
              [providerID]: {
                options: { apiKey: "test-key", baseURL: `${state.server.url.origin}/v1` },
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
        const sessionID = SessionID.make("session-phase1-qwen-preserve")
        const agent = {
          name: "primary",
          mode: "primary",
          options: {},
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        } satisfies Agent.Info
        const user = {
          id: MessageID.make("user-phase1-preserve"),
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
          system: ["You are a coding agent."],
          abort: new AbortController().signal,
          messages: [{ role: "user", content: "Fix the bug." }],
          tools: {},
        })
        for await (const _ of stream.fullStream) {
        }

        const capture = await request
        expect(capture.body.preserve_thinking).toBe(true)
        expect(capture.body.enable_thinking).toBe(true)
      },
    })
  })

  test("Qwen3.7-Max defaults Super-Long on without env bootstrap", async () => {
    delete process.env.AX_CODE_SUPER_LONG
    delete process.env.AX_CODE_SUPER_LONG_SESSION_OVERRIDE
    const providerID = "alibaba-coding-plan"
    const modelID = "qwen3.7-max"
    const fixture = await loadFixture(providerID, modelID)
    const model = fixture.model

    const request = waitRequest(
      "/chat/completions",
      new Response(createChatStream("ok"), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    )

    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "ax-code.json"),
          JSON.stringify({
            $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
            enabled_providers: [providerID],
            provider: {
              [providerID]: {
                options: { apiKey: "test-key", baseURL: `${state.server.url.origin}/v1` },
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
        const sessionID = SessionID.make("session-phase1-qwen-default-on")
        const agent = {
          name: "primary",
          mode: "primary",
          options: {},
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        } satisfies Agent.Info
        const user = {
          id: MessageID.make("user-phase1-default-on"),
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
          system: ["You are a coding agent."],
          abort: new AbortController().signal,
          messages: [{ role: "user", content: "Review the PR." }],
          tools: {},
        })
        for await (const _ of stream.fullStream) {
        }

        const capture = await request
        expect(capture.body.preserve_thinking).toBe(true)
        expect(capture.body.promptCacheKey).toBe(sessionID)
        const systemText = (capture.body.messages as Array<{ role: string; content: string }>)
          .filter((m) => m.role === "system")
          .map((m) => m.content)
          .join("\n")
        expect(systemText).toContain("Super-Long mode")
      },
    })
  })

  test("Qwen3.7-Max does not enter Super-Long request shaping when autonomous mode is off", async () => {
    delete process.env.AX_CODE_SUPER_LONG
    delete process.env.AX_CODE_SUPER_LONG_SESSION_OVERRIDE
    process.env.AX_CODE_AUTONOMOUS = "false"
    const providerID = "alibaba-coding-plan"
    const modelID = "qwen3.7-max"
    const fixture = await loadFixture(providerID, modelID)
    const model = fixture.model

    const request = waitRequest(
      "/chat/completions",
      new Response(createChatStream("ok"), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    )

    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "ax-code.json"),
          JSON.stringify({
            $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
            enabled_providers: [providerID],
            provider: {
              [providerID]: {
                options: { apiKey: "test-key", baseURL: `${state.server.url.origin}/v1` },
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
        const sessionID = SessionID.make("session-phase1-qwen-autonomous-off")
        const agent = {
          name: "primary",
          mode: "primary",
          options: {},
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        } satisfies Agent.Info
        const user = {
          id: MessageID.make("user-phase1-autonomous-off"),
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
          system: ["You are a coding agent."],
          abort: new AbortController().signal,
          messages: [{ role: "user", content: "Review the PR." }],
          tools: {},
        })
        for await (const _ of stream.fullStream) {
        }

        const capture = await request
        expect(capture.body.preserve_thinking).toBeUndefined()
        expect(capture.body.promptCacheKey).toBeUndefined()
        const systemText = (capture.body.messages as Array<{ role: string; content: string }>)
          .filter((m) => m.role === "system")
          .map((m) => m.content)
          .join("\n")
        expect(systemText).not.toContain("Super-Long mode")
      },
    })
  })

  test("non-Qwen model with Super-Long enabled does not emit preserve_thinking", async () => {
    process.env.AX_CODE_SUPER_LONG = "1"
    const providerID = "alibaba-coding-plan"
    const modelID = "qwen3.6-plus"
    const fixture = await loadFixture(providerID, modelID)
    const model = fixture.model

    const request = waitRequest(
      "/chat/completions",
      new Response(createChatStream("ok"), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    )

    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "ax-code.json"),
          JSON.stringify({
            $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
            enabled_providers: [providerID],
            provider: {
              [providerID]: {
                options: { apiKey: "test-key", baseURL: `${state.server.url.origin}/v1` },
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
        const sessionID = SessionID.make("session-phase1-non-qwen")
        const agent = {
          name: "primary",
          mode: "primary",
          options: {},
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        } satisfies Agent.Info
        const user = {
          id: MessageID.make("user-phase1-non-qwen"),
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
          system: ["You are a coding agent."],
          abort: new AbortController().signal,
          messages: [{ role: "user", content: "Fix the bug." }],
          tools: {},
        })
        for await (const _ of stream.fullStream) {
        }

        const capture = await request
        // qwen3.6-plus has preserveThinkingEligible=false via defaultLongAgentProfile
        expect(capture.body.preserve_thinking).toBeUndefined()
        expect(capture.body.enable_thinking).toBe(true)
      },
    })
  })

  test("Qwen3.7-Max with Super-Long enabled injects verification reminder in system messages", async () => {
    process.env.AX_CODE_SUPER_LONG = "1"
    const providerID = "alibaba-coding-plan"
    const modelID = "qwen3.7-max"
    const fixture = await loadFixture(providerID, modelID)
    const model = fixture.model

    const request = waitRequest(
      "/chat/completions",
      new Response(createChatStream("ok"), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    )

    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "ax-code.json"),
          JSON.stringify({
            $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
            enabled_providers: [providerID],
            provider: {
              [providerID]: {
                options: { apiKey: "test-key", baseURL: `${state.server.url.origin}/v1` },
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
        const sessionID = SessionID.make("session-phase1-verification")
        const agent = {
          name: "primary",
          mode: "primary",
          options: {},
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        } satisfies Agent.Info
        const user = {
          id: MessageID.make("user-phase1-verification"),
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
          system: ["You are a coding agent."],
          abort: new AbortController().signal,
          messages: [{ role: "user", content: "Refactor the module." }],
          tools: {},
        })
        for await (const _ of stream.fullStream) {
        }

        const capture = await request
        const systemMessages = (capture.body.messages as Array<{ role: string; content: string }>).filter(
          (m) => m.role === "system",
        )
        const allSystemText = systemMessages.map((m) => m.content).join("\n")
        expect(allSystemText).toContain("Super-Long mode")
        expect(allSystemText).toContain("verification")
      },
    })
  })

  test("non-Qwen model with Super-Long enabled still injects verification reminder and context pack", async () => {
    process.env.AX_CODE_SUPER_LONG = "1"
    const providerID = "alibaba-coding-plan"
    const modelID = "qwen3.6-plus"
    const fixture = await loadFixture(providerID, modelID)
    const model = fixture.model

    const request = waitRequest(
      "/chat/completions",
      new Response(createChatStream("ok"), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    )

    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "ax-code.json"),
          JSON.stringify({
            $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
            enabled_providers: [providerID],
            provider: {
              [providerID]: {
                options: { apiKey: "test-key", baseURL: `${state.server.url.origin}/v1` },
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
        const sessionID = SessionID.make("session-phase1-non-qwen-verification")
        const agent = {
          name: "primary",
          mode: "primary",
          options: {},
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        } satisfies Agent.Info
        const user = {
          id: MessageID.make("user-phase1-non-qwen-verify"),
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
          system: ["You are a coding agent."],
          abort: new AbortController().signal,
          messages: [{ role: "user", content: "Refactor the module." }],
          tools: {},
        })
        for await (const _ of stream.fullStream) {
        }

        const capture = await request
        const allSystemText = (capture.body.messages as Array<{ role: string; content: string }>)
          .filter((m) => m.role === "system")
          .map((m) => m.content)
          .join("\n")
        // Supervision text is provider-agnostic and must fire for every
        // Super-Long run; only request shaping (preserve_thinking,
        // promptCacheKey) stays model-gated.
        expect(allSystemText).toContain("Super-Long mode")
        expect(allSystemText).toContain("## Long-Agent Context Pack")
        expect(capture.body.preserve_thinking).toBeUndefined()
        expect(capture.body.promptCacheKey).toBeUndefined()
      },
    })
  })

  test("Qwen3.7-Max with Super-Long enabled sends promptCacheKey in request body (Phase 3)", async () => {
    process.env.AX_CODE_SUPER_LONG = "1"
    const providerID = "alibaba-coding-plan"
    const modelID = "qwen3.7-max"
    const fixture = await loadFixture(providerID, modelID)
    const model = fixture.model

    const request = waitRequest(
      "/chat/completions",
      new Response(createChatStream("ok"), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    )

    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "ax-code.json"),
          JSON.stringify({
            $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
            enabled_providers: [providerID],
            provider: {
              [providerID]: {
                options: { apiKey: "test-key", baseURL: `${state.server.url.origin}/v1` },
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
        const sessionID = SessionID.make("session-phase3-cache")
        const agent = {
          name: "primary",
          mode: "primary",
          options: {},
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        } satisfies Agent.Info
        const user = {
          id: MessageID.make("user-phase3-cache"),
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
          system: ["You are a coding agent."],
          abort: new AbortController().signal,
          messages: [{ role: "user", content: "Review the PR." }],
          tools: {},
        })
        for await (const _ of stream.fullStream) {
        }

        const capture = await request
        // promptCacheKey enables key-based session caching on DashScope for Super-Long runs
        expect(capture.body.promptCacheKey).toBe(sessionID)
        expect(capture.body.preserve_thinking).toBe(true)
        const systemMessages = (
          capture.body.messages as Array<{ role: string; cache_control?: { type?: string } }>
        ).filter((m) => m.role === "system")
        expect(systemMessages.some((m) => m.cache_control?.type === "ephemeral")).toBe(true)
      },
    })
  })

  test("Qwen3.7-Max with Super-Long enabled injects long-agent context pack into system messages", async () => {
    process.env.AX_CODE_SUPER_LONG = "1"
    const providerID = "alibaba-coding-plan"
    const modelID = "qwen3.7-max"
    const fixture = await loadFixture(providerID, modelID)
    const model = fixture.model

    const request = waitRequest(
      "/chat/completions",
      new Response(createChatStream("ok"), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    )

    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "ax-code.json"),
          JSON.stringify({
            $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
            enabled_providers: [providerID],
            provider: {
              [providerID]: {
                options: { apiKey: "test-key", baseURL: `${state.server.url.origin}/v1` },
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
        const sessionID = SessionID.make("session-phase4-context-pack")
        const agent = {
          name: "primary",
          mode: "primary",
          options: {},
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        } satisfies Agent.Info
        const user = {
          id: MessageID.make("user-phase4-context-pack"),
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
          system: ["You are a coding agent."],
          abort: new AbortController().signal,
          messages: [{ role: "user", content: "Fix the regression in src/session/llm.ts." }],
          tools: {},
        })
        for await (const _ of stream.fullStream) {
        }

        const capture = await request
        const systemMessages = (capture.body.messages as Array<{ role: string; content: string }>).filter(
          (m) => m.role === "system",
        )
        const allSystemText = systemMessages.map((m) => m.content).join("\n")
        expect(allSystemText).toContain("## Long-Agent Context Pack")
        expect(allSystemText).toContain("Fix the regression in src/session/llm.ts.")
        expect(allSystemText).toContain("src/session/llm.ts")
      },
    })
  })

  test("super-long pacing keys are shared across sessions for the same provider and model", () => {
    const base = { providerID: "alibaba-coding-plan", modelID: "qwen3.7-max" }
    expect(LLM.pacingKeyForTest({ ...base, sessionID: "session-a" })).toBe(
      LLM.pacingKeyForTest({ ...base, sessionID: "session-b" }),
    )
  })

  test("super-long pacing state is shared across sessions for the same provider and model", async () => {
    const sessionA = {
      sessionID: "session-pacing-a",
      providerID: "alibaba-coding-plan",
      modelID: "qwen3.7-max",
    }
    const sessionB = {
      ...sessionA,
      sessionID: "session-pacing-b",
    }
    LLM.setPacingStateForTest(sessionA, { timestamps: [1_000] })

    await LLM.applySuperLongPacingForTest({
      ...sessionB,
      enabled: true,
      abort: new AbortController().signal,
      policy: {
        windowMs: 1_000,
        maxRequests: 10,
        minDelayMs: 100,
      },
      now: () => 1_175,
    })

    expect(LLM.getPacingStateForTest(sessionA)?.timestamps).toEqual([1_000, 1_175])
  })

  test("super-long pacing treats whitespace-padded durable disable env as process-local", async () => {
    process.env.AX_CODE_SUPER_LONG_DURABLE_PACING = " 0 "
    const reserveSpy = spyOn(SuperLongRuntime, "reservePacing").mockImplementation(async () => {
      throw new Error("durable pacing should not be used")
    })
    try {
      const target = {
        sessionID: "session-pacing-env-disabled",
        providerID: "alibaba-coding-plan",
        modelID: "qwen3.7-max",
      }

      await LLM.applySuperLongPacingForTest({
        ...target,
        enabled: true,
        abort: new AbortController().signal,
      })

      expect(reserveSpy).not.toHaveBeenCalled()
      expect(LLM.getPacingStateForTest(target)?.timestamps).toHaveLength(1)
    } finally {
      reserveSpy.mockRestore()
    }
  })

  test("super-long process-local pacing normalizes state before waiting", async () => {
    const target = {
      sessionID: "session-pacing-local-normalize",
      providerID: "alibaba-coding-plan",
      modelID: "qwen3.7-max",
    }
    LLM.setPacingStateForTest(target, { timestamps: [1_500, 1_000, 500] })

    const times = [1_550, 1_600]
    await LLM.applySuperLongPacingForTest({
      ...target,
      enabled: true,
      abort: new AbortController().signal,
      policy: {
        windowMs: 1_000,
        maxRequests: 10,
        minDelayMs: 100,
      },
      now: () => times.shift() ?? 1_600,
      sleep: async (ms) => {
        expect(ms).toBe(50)
        expect(LLM.getPacingStateForTest(target)?.timestamps).toEqual([1_000, 1_500])
      },
    })

    expect(LLM.getPacingStateForTest(target)?.timestamps).toEqual([1_000, 1_500, 1_600])
  })

  test("super-long pacing rechecks state after waiting before recording", async () => {
    const target = {
      sessionID: "session-pacing-reread",
      providerID: "alibaba-coding-plan",
      modelID: "qwen3.7-max",
    }
    LLM.setPacingStateForTest(target, { timestamps: [1_000] })

    const times = [1_050, 1_175]
    await LLM.applySuperLongPacingForTest({
      ...target,
      enabled: true,
      abort: new AbortController().signal,
      policy: {
        windowMs: 1_000,
        maxRequests: 10,
        minDelayMs: 100,
      },
      now: () => times.shift() ?? 1_175,
      sleep: async (ms) => {
        expect(ms).toBe(50)
        LLM.setPacingStateForTest(target, { timestamps: [1_000, 1_075] })
      },
    })

    expect(LLM.getPacingStateForTest(target)?.timestamps).toEqual([1_000, 1_075, 1_175])
  })

  test("super-long pacing releases reservation when stream fails before first chunk", async () => {
    const target = {
      sessionID: "session-pacing-release",
      providerID: "alibaba-coding-plan",
      modelID: "qwen3.7-max",
    }
    const reservation = await LLM.applySuperLongPacingForTest({
      ...target,
      enabled: true,
      abort: new AbortController().signal,
      policy: {
        windowMs: 1_000,
        maxRequests: 10,
        minDelayMs: 100,
      },
      now: () => 1_000,
    })
    expect(LLM.getPacingStateForTest(target)?.timestamps).toEqual([1_000])

    const wrapped = LLM.attachSuperLongPacingReservationForTest(
      {
        fullStream: (async function* () {
          throw new Error("network failed")
        })(),
      },
      reservation,
      new AbortController().signal,
    )

    await expect(async () => {
      for await (const _ of wrapped.fullStream) {
      }
    }).toThrow("network failed")
    expect(LLM.getPacingStateForTest(target)).toBeUndefined()
  })

  test("super-long pacing releases reservation when stream iterator is abandoned before first chunk", async () => {
    const target = {
      sessionID: "session-pacing-return-release",
      providerID: "alibaba-coding-plan",
      modelID: "qwen3.7-max",
    }
    const reservation = await LLM.applySuperLongPacingForTest({
      ...target,
      enabled: true,
      abort: new AbortController().signal,
      policy: {
        windowMs: 1_000,
        maxRequests: 10,
        minDelayMs: 100,
      },
      now: () => 1_000,
    })
    expect(LLM.getPacingStateForTest(target)?.timestamps).toEqual([1_000])

    const wrapped = LLM.attachSuperLongPacingReservationForTest(
      {
        fullStream: (async function* () {
          yield "started"
        })(),
      },
      reservation,
      new AbortController().signal,
    )

    const iterator = wrapped.fullStream[Symbol.asyncIterator]()
    await iterator.return?.()

    expect(LLM.getPacingStateForTest(target)).toBeUndefined()
  })

  test("super-long pacing skips durable release for process-local reservations", async () => {
    const releaseSpy = spyOn(SuperLongRuntime, "releasePacingReservation").mockImplementation(async () => {})
    try {
      const target = {
        sessionID: "session-pacing-local-release",
        providerID: "alibaba-coding-plan",
        modelID: "qwen3.7-max",
      }
      const reservation = await LLM.applySuperLongPacingForTest({
        ...target,
        enabled: true,
        abort: new AbortController().signal,
        policy: {
          windowMs: 1_000,
          maxRequests: 10,
          minDelayMs: 100,
        },
        now: () => 1_000,
      })

      const wrapped = LLM.attachSuperLongPacingReservationForTest(
        {
          fullStream: (async function* () {})(),
        },
        reservation,
        new AbortController().signal,
      )
      for await (const _ of wrapped.fullStream) {
      }

      expect(releaseSpy).not.toHaveBeenCalled()
      expect(LLM.getPacingStateForTest(target)).toBeUndefined()
    } finally {
      releaseSpy.mockRestore()
    }
  })

  test("super-long process-local pacing releases the normalized reservation timestamp", async () => {
    const target = {
      sessionID: "session-pacing-normalized-release",
      providerID: "alibaba-coding-plan",
      modelID: "qwen3.7-max",
    }
    const reservation = await LLM.applySuperLongPacingForTest({
      ...target,
      enabled: true,
      abort: new AbortController().signal,
      policy: {
        windowMs: 1_000,
        maxRequests: 10,
        minDelayMs: 100,
      },
      now: () => Number.NaN,
    })

    expect(reservation?.timestamp).toBe(0)
    const wrapped = LLM.attachSuperLongPacingReservationForTest(
      {
        fullStream: (async function* () {})(),
      },
      reservation,
      new AbortController().signal,
    )
    for await (const _ of wrapped.fullStream) {
    }

    expect(LLM.getPacingStateForTest(target)).toBeUndefined()
  })

  test("super-long pacing waits for durable release when stream ends before first chunk", async () => {
    const releaseGate = deferred<void>()
    const releaseSpy = spyOn(SuperLongRuntime, "releasePacingReservation").mockImplementation(async () => {
      await releaseGate.promise
    })
    try {
      const wrapped = LLM.attachSuperLongPacingReservationForTest(
        {
          fullStream: (async function* () {})(),
        },
        { key: "alibaba-coding-plan/qwen3.7-max", timestamp: 1_000, durable: true },
        new AbortController().signal,
      )

      let settled = false
      const consume = (async () => {
        for await (const _ of wrapped.fullStream) {
        }
        settled = true
      })()
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(releaseSpy).toHaveBeenCalledWith({
        key: "alibaba-coding-plan/qwen3.7-max",
        timestamp: 1_000,
        now: expect.any(Number),
      })
      expect(settled).toBe(false)

      releaseGate.resolve()
      await consume
      expect(settled).toBe(true)
    } finally {
      releaseSpy.mockRestore()
    }
  })
})

describe("session.llm.extractLastUserTask", () => {
  test("returns undefined for empty messages", () => {
    expect(LLM.extractLastUserTask([])).toBeUndefined()
  })

  test("returns string content from last user message", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "first message" },
      { role: "assistant", content: "reply" },
      { role: "user", content: "second message" },
    ]
    expect(LLM.extractLastUserTask(messages)).toBe("second message")
  })

  test("extracts text part from array content", () => {
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "Fix the failing tests" }],
      },
    ]
    expect(LLM.extractLastUserTask(messages)).toBe("Fix the failing tests")
  })

  test("truncates content at 500 characters", () => {
    const long = "x".repeat(600)
    const messages: ModelMessage[] = [{ role: "user", content: long }]
    const result = LLM.extractLastUserTask(messages)
    expect(result?.length).toBe(500)
  })

  test("skips non-user messages to find last user", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "task one" },
      { role: "assistant", content: "done" },
    ]
    expect(LLM.extractLastUserTask(messages)).toBe("task one")
  })

  test("returns undefined when no user messages exist", () => {
    const messages: ModelMessage[] = [{ role: "assistant", content: "I will help" }]
    expect(LLM.extractLastUserTask(messages)).toBeUndefined()
  })
})

describe("session.llm.extractTouchedFiles", () => {
  test("returns empty array for empty messages", () => {
    expect(LLM.extractTouchedFiles([])).toEqual([])
  })

  test("extracts file_path from read tool calls", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "c1",
            toolName: "read",
            input: { file_path: "/src/index.ts" },
          },
        ],
      },
    ] as any as ModelMessage[]
    const result = LLM.extractTouchedFiles(messages)
    expect(result).toHaveLength(1)
    expect(result[0]?.path).toBe("/src/index.ts")
    expect(result[0]?.summary).toBe("accessed by read")
  })

  test("extracts file_path from edit and write tool calls", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "c1",
            toolName: "edit",
            input: { file_path: "/src/a.ts" },
          },
          {
            type: "tool-call",
            toolCallId: "c2",
            toolName: "write",
            input: { file_path: "/src/b.ts" },
          },
        ],
      },
    ] as any as ModelMessage[]
    const result = LLM.extractTouchedFiles(messages)
    expect(result).toHaveLength(2)
    expect(result.map((r) => r.path)).toContain("/src/a.ts")
    expect(result.map((r) => r.path)).toContain("/src/b.ts")
  })

  test("deduplicates repeated file accesses", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "c1", toolName: "read", input: { file_path: "/src/dup.ts" } },
          { type: "tool-call", toolCallId: "c2", toolName: "edit", input: { file_path: "/src/dup.ts" } },
        ],
      },
    ] as any as ModelMessage[]
    const result = LLM.extractTouchedFiles(messages)
    expect(result).toHaveLength(1)
    expect(result[0]?.path).toBe("/src/dup.ts")
  })

  test("ignores non-file-touching tools", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "c1", toolName: "bash", input: { command: "ls" } },
          { type: "tool-call", toolCallId: "c2", toolName: "webfetch", input: { url: "https://example.com" } },
        ],
      },
    ] as any as ModelMessage[]
    expect(LLM.extractTouchedFiles(messages)).toHaveLength(0)
  })

  test("ignores user messages", () => {
    const messages = [
      {
        role: "user",
        content: [{ type: "tool-call", toolCallId: "c1", toolName: "read", input: { file_path: "/src/user.ts" } }],
      },
    ] as any as ModelMessage[]
    expect(LLM.extractTouchedFiles(messages)).toHaveLength(0)
  })

  test("caps result at 20 files", () => {
    const parts = Array.from({ length: 25 }, (_, i) => ({
      type: "tool-call",
      toolCallId: `c${i}`,
      toolName: "read",
      input: { file_path: `/src/file${i}.ts` },
    }))
    const messages = [{ role: "assistant", content: parts }] as any as ModelMessage[]
    const result = LLM.extractTouchedFiles(messages)
    expect(result).toHaveLength(20)
  })
})
