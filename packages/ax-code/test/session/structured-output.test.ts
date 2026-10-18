import { describe, expect, test, vi } from "vitest"
import { MessageV2 } from "../../src/session/message-v2"
import { createStructuredOutputTool, createStructuredOutputTurn } from "../../src/session/prompt/prompt-helpers"
import { SessionID, MessageID } from "../../src/session/schema"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { LLM } from "../../src/session/llm"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { tmpdir } from "../fixture/fixture"

describe("structured-output.OutputFormat", () => {
  test("parses text format", () => {
    const result = MessageV2.Format.safeParse({ type: "text" })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe("text")
    }
  })

  test("parses json_schema format with defaults", () => {
    const result = MessageV2.Format.safeParse({
      type: "json_schema",
      schema: { type: "object", properties: { name: { type: "string" } } },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe("json_schema")
      if (result.data.type === "json_schema") {
        expect(result.data.retryCount).toBe(2) // default value
      }
    }
  })

  test("parses json_schema format with custom retryCount", () => {
    const result = MessageV2.Format.safeParse({
      type: "json_schema",
      schema: { type: "object" },
      retryCount: 5,
    })
    expect(result.success).toBe(true)
    if (result.success && result.data.type === "json_schema") {
      expect(result.data.retryCount).toBe(5)
    }
  })

  test("rejects invalid type", () => {
    const result = MessageV2.Format.safeParse({ type: "invalid" })
    expect(result.success).toBe(false)
  })

  test("rejects json_schema without schema", () => {
    const result = MessageV2.Format.safeParse({ type: "json_schema" })
    expect(result.success).toBe(false)
  })

  test("rejects negative retryCount", () => {
    const result = MessageV2.Format.safeParse({
      type: "json_schema",
      schema: { type: "object" },
      retryCount: -1,
    })
    expect(result.success).toBe(false)
  })
})

describe("structured-output.StructuredOutputError", () => {
  test("creates error with message and retries", () => {
    const error = new MessageV2.StructuredOutputError({
      message: "Failed to validate",
      retries: 3,
    })

    expect(error.name).toBe("StructuredOutputError")
    expect(error.data.message).toBe("Failed to validate")
    expect(error.data.retries).toBe(3)
  })

  test("converts to object correctly", () => {
    const error = new MessageV2.StructuredOutputError({
      message: "Test error",
      retries: 2,
    })

    const obj = error.toObject()
    expect(obj.name).toBe("StructuredOutputError")
    expect(obj.data.message).toBe("Test error")
    expect(obj.data.retries).toBe(2)
  })

  test("isInstance correctly identifies error", () => {
    const error = new MessageV2.StructuredOutputError({
      message: "Test",
      retries: 1,
    })

    expect(MessageV2.StructuredOutputError.isInstance(error)).toBe(true)
    expect(MessageV2.StructuredOutputError.isInstance({ name: "other" })).toBe(false)
  })
})

describe("structured-output.UserMessage", () => {
  test("user message accepts outputFormat", () => {
    const result = MessageV2.User.safeParse({
      id: MessageID.ascending(),
      sessionID: SessionID.descending(),
      role: "user",
      time: { created: Date.now() },
      agent: "default",
      model: { providerID: "anthropic", modelID: "claude-3" },
      outputFormat: {
        type: "json_schema",
        schema: { type: "object" },
      },
    })
    expect(result.success).toBe(true)
  })

  test("user message works without outputFormat (optional)", () => {
    const result = MessageV2.User.safeParse({
      id: MessageID.ascending(),
      sessionID: SessionID.descending(),
      role: "user",
      time: { created: Date.now() },
      agent: "default",
      model: { providerID: "anthropic", modelID: "claude-3" },
    })
    expect(result.success).toBe(true)
  })
})

describe("structured-output.AssistantMessage", () => {
  const baseAssistantMessage = {
    id: MessageID.ascending(),
    sessionID: SessionID.descending(),
    role: "assistant" as const,
    parentID: MessageID.ascending(),
    modelID: "claude-3",
    providerID: "anthropic",
    mode: "default",
    agent: "default",
    path: { cwd: "/test", root: "/test" },
    tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: Date.now() },
  }

  test("assistant message accepts structured", () => {
    const result = MessageV2.Assistant.safeParse({
      ...baseAssistantMessage,
      structured: { company: "Anthropic", founded: 2021 },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.structured).toEqual({ company: "Anthropic", founded: 2021 })
    }
  })

  test("assistant message works without structured_output (optional)", () => {
    const result = MessageV2.Assistant.safeParse(baseAssistantMessage)
    expect(result.success).toBe(true)
  })
})

describe("structured-output.createStructuredOutputTool", () => {
  test("creates tool with correct id", () => {
    const tool = createStructuredOutputTool({
      schema: { type: "object", properties: { name: { type: "string" } } },
      onSuccess: () => {},
    })

    // AI SDK tool type doesn't expose id, but we set it internally
    expect((tool as any).id).toBe("StructuredOutput")
  })

  test("creates tool with description", () => {
    const tool = createStructuredOutputTool({
      schema: { type: "object" },
      onSuccess: () => {},
    })

    expect(tool.description).toContain("structured format")
  })

  test("creates tool with schema as inputSchema", () => {
    const schema = {
      type: "object",
      properties: {
        company: { type: "string" },
        founded: { type: "number" },
      },
      required: ["company"],
    }

    const tool = createStructuredOutputTool({
      schema,
      onSuccess: () => {},
    })

    // AI SDK wraps schema in { jsonSchema: {...} }
    expect(tool.inputSchema).toBeDefined()
    const inputSchema = tool.inputSchema as any
    expect(inputSchema.jsonSchema?.properties?.company).toBeDefined()
    expect(inputSchema.jsonSchema?.properties?.founded).toBeDefined()
  })

  test("strips $schema property from inputSchema", () => {
    const schema = {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: { name: { type: "string" } },
    }

    const tool = createStructuredOutputTool({
      schema,
      onSuccess: () => {},
    })

    // AI SDK wraps schema in { jsonSchema: {...} }
    const inputSchema = tool.inputSchema as any
    expect(inputSchema.jsonSchema?.$schema).toBeUndefined()
  })

  test("execute calls onSuccess with valid args", async () => {
    let capturedOutput: unknown

    const tool = createStructuredOutputTool({
      schema: { type: "object", properties: { name: { type: "string" } } },
      onSuccess: (output) => {
        capturedOutput = output
      },
    })

    expect(tool.execute).toBeDefined()
    const testArgs = { name: "Test Company" }
    const result = await tool.execute!(testArgs, {
      toolCallId: "test-call-id",
      messages: [],
      abortSignal: undefined as any,
    })

    expect(capturedOutput).toEqual(testArgs)
    expect(result.output).toBe("Structured output captured successfully.")
    expect(result.metadata.valid).toBe(true)
  })

  test("AI SDK validates schema before execute - missing required field", async () => {
    // Note: The AI SDK validates the input against the schema BEFORE calling execute()
    // So invalid inputs never reach the tool's execute function
    // This test documents the expected schema behavior
    const tool = createStructuredOutputTool({
      schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
        required: ["name", "age"],
      },
      onSuccess: () => {},
    })

    // The schema requires both 'name' and 'age'
    expect(tool.inputSchema).toBeDefined()
    const inputSchema = tool.inputSchema as any
    expect(inputSchema.jsonSchema?.required).toContain("name")
    expect(inputSchema.jsonSchema?.required).toContain("age")
  })

  test("AI SDK validates schema types before execute - wrong type", async () => {
    // Note: The AI SDK validates the input against the schema BEFORE calling execute()
    // So invalid inputs never reach the tool's execute function
    // This test documents the expected schema behavior
    const tool = createStructuredOutputTool({
      schema: {
        type: "object",
        properties: {
          count: { type: "number" },
        },
        required: ["count"],
      },
      onSuccess: () => {},
    })

    // The schema defines 'count' as a number
    expect(tool.inputSchema).toBeDefined()
    const inputSchema = tool.inputSchema as any
    expect(inputSchema.jsonSchema?.properties?.count?.type).toBe("number")
  })

  test("execute handles nested objects", async () => {
    let capturedOutput: unknown

    const tool = createStructuredOutputTool({
      schema: {
        type: "object",
        properties: {
          user: {
            type: "object",
            properties: {
              name: { type: "string" },
              email: { type: "string" },
            },
            required: ["name"],
          },
        },
        required: ["user"],
      },
      onSuccess: (output) => {
        capturedOutput = output
      },
    })

    // Valid nested object - AI SDK validates before calling execute()
    const validResult = await tool.execute!(
      { user: { name: "John", email: "john@test.com" } },
      {
        toolCallId: "test-call-id",
        messages: [],
        abortSignal: undefined as any,
      },
    )

    expect(capturedOutput).toEqual({ user: { name: "John", email: "john@test.com" } })
    expect(validResult.metadata.valid).toBe(true)

    // Verify schema has correct nested structure
    const inputSchema = tool.inputSchema as any
    expect(inputSchema.jsonSchema?.properties?.user?.type).toBe("object")
    expect(inputSchema.jsonSchema?.properties?.user?.properties?.name?.type).toBe("string")
    expect(inputSchema.jsonSchema?.properties?.user?.required).toContain("name")
  })

  test("execute handles arrays", async () => {
    let capturedOutput: unknown

    const tool = createStructuredOutputTool({
      schema: {
        type: "object",
        properties: {
          tags: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["tags"],
      },
      onSuccess: (output) => {
        capturedOutput = output
      },
    })

    // Valid array - AI SDK validates before calling execute()
    const validResult = await tool.execute!(
      { tags: ["a", "b", "c"] },
      {
        toolCallId: "test-call-id",
        messages: [],
        abortSignal: undefined as any,
      },
    )

    expect(capturedOutput).toEqual({ tags: ["a", "b", "c"] })
    expect(validResult.metadata.valid).toBe(true)

    // Verify schema has correct array structure
    const inputSchema = tool.inputSchema as any
    expect(inputSchema.jsonSchema?.properties?.tags?.type).toBe("array")
    expect(inputSchema.jsonSchema?.properties?.tags?.items?.type).toBe("string")
  })

  test("toModelOutput returns text value", async () => {
    const tool = createStructuredOutputTool({
      schema: { type: "object" },
      onSuccess: () => {},
    })

    expect(tool.toModelOutput).toBeDefined()
    const modelOutput = await Promise.resolve(
      tool.toModelOutput!({
        toolCallId: "test-call-id",
        input: {},
        output: "Test output",
      }),
    )

    expect(modelOutput.type).toBe("text")
    expect((modelOutput as any).value).toBe("Test output")
  })

  // Note: Retry behavior is handled by the AI SDK and the prompt loop, not the tool itself
  // The tool simply calls onSuccess when execute() is called with valid args
  // See prompt.ts loop() for actual retry logic
})

describe("structured-output.createStructuredOutputTurn", () => {
  function assistantMessage(): MessageV2.Assistant {
    return {
      id: MessageID.ascending(),
      sessionID: SessionID.descending(),
      role: "assistant",
      parentID: MessageID.ascending(),
      modelID: "claude-3" as any,
      providerID: "anthropic" as any,
      mode: "default",
      agent: "default",
      path: { cwd: "/test", root: "/test" },
      tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: Date.now() },
    }
  }

  test("does not attach a tool for text output", async () => {
    const turn = createStructuredOutputTurn({ type: "text" })
    const tools = {}
    turn.attachTool(tools)

    expect(turn.toolChoice).toBeUndefined()
    expect(tools).toEqual({})
    expect(await turn.saveCaptured(assistantMessage())).toBe(false)
    expect(await turn.failIfMissing(assistantMessage())).toBe(false)
  })

  test("attaches required tool and saves captured structured output", async () => {
    const update = vi.spyOn(Session, "updateMessage").mockResolvedValue(undefined as any)
    try {
      const turn = createStructuredOutputTurn({
        type: "json_schema",
        schema: { type: "object", properties: { name: { type: "string" } } },
        retryCount: 2,
      })
      const tools: Record<string, any> = {}
      turn.attachTool(tools)

      expect(turn.toolChoice).toBe("required")
      expect(tools.StructuredOutput).toBeDefined()
      await tools.StructuredOutput.execute({ name: "Acme" }, { toolCallId: "call_1", messages: [] })

      const assistant = assistantMessage()
      await expect(turn.saveCaptured(assistant)).resolves.toBe(true)
      expect(assistant.structured).toEqual({ name: "Acme" })
      expect(assistant.finish).toBe("stop")
      expect(update).toHaveBeenCalledWith(assistant)
    } finally {
      update.mockRestore()
    }
  })

  test("marks missing required structured output as an assistant error", async () => {
    const update = vi.spyOn(Session, "updateMessage").mockResolvedValue(undefined as any)
    try {
      const turn = createStructuredOutputTurn({
        type: "json_schema",
        schema: { type: "object" },
        retryCount: 2,
      })
      const assistant = assistantMessage()

      await expect(turn.failIfMissing(assistant)).resolves.toBe(true)
      expect(assistant.error?.name).toBe("StructuredOutputError")
      expect(update).toHaveBeenCalledWith(assistant)
    } finally {
      update.mockRestore()
    }
  })
})

describe("structured-output.loop retry", () => {
  function fixtureModel(): Provider.Model {
    return {
      id: ModelID.make("structured-fixture"),
      providerID: ProviderID.make("structured-gateway"),
      name: "Structured fixture",
      family: "structured-fixture",
      api: { id: "structured-fixture", url: "http://127.0.0.1:1/v1", npm: "@ai-sdk/openai-compatible" },
      capabilities: {
        temperature: true,
        reasoning: false,
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      limit: { context: 65536, output: 8192 },
      status: "active",
      options: {},
      headers: {},
      release_date: "2026-09-19",
    }
  }

  test("retries a turn that ends without calling StructuredOutput", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = fixtureModel()
        vi.spyOn(Provider, "getModel").mockResolvedValue(model)
        const requests: LLM.StreamInput[] = []
        vi.spyOn(LLM, "stream").mockImplementation(async (input) => {
          requests.push(input)
          const first = requests.length === 1
          return {
            fullStream: (async function* () {
              yield { type: "start" }
              yield { type: "start-step" }
              if (first) {
                yield { type: "text-start", id: "text_1" }
                yield { type: "text-delta", id: "text_1", text: "plain answer" }
                yield { type: "text-end", id: "text_1" }
                yield {
                  type: "finish-step",
                  finishReason: "stop",
                  usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
                }
              } else {
                const toolInput = { answer: 4 }
                const structured = input.tools["StructuredOutput"]
                if (!structured) throw new Error("StructuredOutput tool missing from the request")
                const output = await structured.execute!(toolInput, {
                  toolCallId: "call_1",
                  messages: input.messages,
                })
                yield { type: "tool-input-start", id: "call_1", toolName: "StructuredOutput" }
                yield { type: "tool-call", toolCallId: "call_1", toolName: "StructuredOutput", input: toolInput }
                yield { type: "tool-result", toolCallId: "call_1", input: toolInput, output }
                yield {
                  type: "finish-step",
                  finishReason: "tool-calls",
                  usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
                }
              }
              yield { type: "finish" }
            })(),
          } as unknown as LLM.StreamOutput
        })

        const session = await Session.create({ title: "Structured retry regression" })
        const result = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          model: { providerID: model.providerID, modelID: model.id },
          parts: [{ type: "text", text: "What is 2 + 2?" }],
          format: {
            type: "json_schema",
            schema: { type: "object", properties: { answer: { type: "number" } }, required: ["answer"] },
            retryCount: 2,
          },
        })

        // First turn missed the tool; the loop nudged once and captured it.
        expect(requests.length).toBe(2)
        expect(result.info.role).toBe("assistant")
        if (result.info.role === "assistant") {
          expect(result.info.structured).toEqual({ answer: 4 })
          expect(result.info.error).toBeUndefined()
        }
        const messages = await Session.messages({ sessionID: session.id })
        expect(
          messages.some((message) =>
            message.parts.some((part) => part.type === "text" && part.text.includes("Structured output recovery")),
          ),
        ).toBe(true)
      },
    })
  })
})
