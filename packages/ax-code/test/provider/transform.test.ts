import { describe, expect, test } from "vitest"
import { ProviderTransform } from "../../src/provider/transform"
import { ModelID, ProviderID } from "../../src/provider/schema"

const OUTPUT_TOKEN_MAX = 32000

describe("ProviderTransform.options - setCacheKey", () => {
  const sessionID = "test-session-123"

  const mockModel = {
    id: "anthropic/claude-3-5-sonnet",
    providerID: "anthropic",
    api: {
      id: "claude-3-5-sonnet-20241022",
      url: "https://api.anthropic.com",
      npm: "@ai-sdk/google-vertex/anthropic",
    },
    name: "Claude 3.5 Sonnet",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    limit: {
      context: 200000,
      output: 8192,
    },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("should set promptCacheKey when providerOptions.setCacheKey is true", () => {
    const result = ProviderTransform.options({
      model: mockModel,
      sessionID,
      providerOptions: { setCacheKey: true },
    })
    expect(result.promptCacheKey).toBe(sessionID)
  })

  test("should not set promptCacheKey when providerOptions.setCacheKey is false", () => {
    const result = ProviderTransform.options({
      model: mockModel,
      sessionID,
      providerOptions: { setCacheKey: false },
    })
    expect(result.promptCacheKey).toBeUndefined()
  })

  test("should not set promptCacheKey when providerOptions is undefined", () => {
    const result = ProviderTransform.options({
      model: mockModel,
      sessionID,
      providerOptions: undefined,
    })
    expect(result.promptCacheKey).toBeUndefined()
  })

  test("should not set promptCacheKey when providerOptions does not have setCacheKey", () => {
    const result = ProviderTransform.options({ model: mockModel, sessionID, providerOptions: {} })
    expect(result.promptCacheKey).toBeUndefined()
  })
})

describe("ProviderTransform.options - google thinkingConfig gating", () => {
  const sessionID = "test-session-123"

  const createGoogleModel = (reasoning: boolean, npm: "@ai-sdk/google" | "@ai-sdk/google-vertex") =>
    ({
      id: `${npm === "@ai-sdk/google" ? "google" : "google-vertex"}/gemini-3-flash`,
      providerID: npm === "@ai-sdk/google" ? "google" : "google-vertex",
      api: {
        id: "gemini-3-flash",
        url: npm === "@ai-sdk/google" ? "https://generativelanguage.googleapis.com" : "https://vertexai.googleapis.com",
        npm,
      },
      name: "Gemini 2.0 Flash",
      capabilities: {
        temperature: true,
        reasoning,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: true },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      limit: {
        context: 1_000_000,
        output: 8192,
      },
      status: "active",
      options: {},
      headers: {},
    }) as any

  test("does not set thinkingConfig for google models without reasoning capability", () => {
    const result = ProviderTransform.options({
      model: createGoogleModel(false, "@ai-sdk/google"),
      sessionID,
      providerOptions: {},
    })
    expect(result.thinkingConfig).toBeUndefined()
  })

  test("sets thinkingConfig for google models with reasoning capability", () => {
    const result = ProviderTransform.options({
      model: createGoogleModel(true, "@ai-sdk/google"),
      sessionID,
      providerOptions: {},
    })
    expect(result.thinkingConfig).toEqual({
      includeThoughts: true,
      thinkingLevel: "high",
    })
  })

  test("does not set thinkingConfig for vertex models without reasoning capability", () => {
    const result = ProviderTransform.options({
      model: createGoogleModel(false, "@ai-sdk/google-vertex"),
      sessionID,
      providerOptions: {},
    })
    expect(result.thinkingConfig).toBeUndefined()
  })
})

describe("ProviderTransform.providerOptions", () => {
  const createModel = (overrides: Partial<any> = {}) =>
    ({
      id: "test/test-model",
      providerID: "test",
      api: {
        id: "test-model",
        url: "https://api.test.com",
        npm: "@ai-sdk/openai",
      },
      name: "Test Model",
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      limit: {
        context: 200_000,
        output: 64_000,
      },
      status: "active",
      options: {},
      headers: {},
      release_date: "2024-01-01",
      ...overrides,
    }) as any

  test("strips ax-engine runtime metadata before provider request options are built", () => {
    const model = createModel({
      providerID: "ax-engine",
      api: {
        id: "qwen3",
        url: "http://127.0.0.1:18181/v1",
        npm: "@ai-sdk/openai-compatible",
      },
    })
    const sanitized = ProviderTransform.sanitizeOptions(model, {
      modelID: "qwen3-coder-next",
      quantization: "mlx4bit",
      modelPath: "/models/qwen",
      binaryPath: "/bin/ax-engine",
      baseURL: "http://127.0.0.1:18181/v1",
      port: 18181,
      temperature: 0.2,
    })

    expect(sanitized).toEqual({ temperature: 0.2 })
    expect(ProviderTransform.providerOptions(model, sanitized)).toEqual({
      "ax-engine": { temperature: 0.2 },
    })
  })
})

describe("ProviderTransform.schema - gemini array items", () => {
  test("adds missing items for array properties", () => {
    const geminiModel = {
      providerID: "google",
      api: {
        id: "gemini-3-pro",
      },
    } as any

    const schema = {
      type: "object",
      properties: {
        nodes: { type: "array" },
        edges: { type: "array", items: { type: "string" } },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.nodes.items).toBeDefined()
    expect(result.properties.edges.items.type).toBe("string")
  })
})

describe("ProviderTransform.schema - gemini nested array items", () => {
  const geminiModel = {
    providerID: "google",
    api: {
      id: "gemini-3-pro",
    },
  } as any

  test("adds type to 2D array with empty inner items", () => {
    const schema = {
      type: "object",
      properties: {
        values: {
          type: "array",
          items: {
            type: "array",
            items: {}, // Empty items object
          },
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    // Inner items should have a default type
    expect(result.properties.values.items.items.type).toBe("string")
  })

  test("adds items and type to 2D array with missing inner items", () => {
    const schema = {
      type: "object",
      properties: {
        data: {
          type: "array",
          items: { type: "array" }, // No items at all
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.data.items.items).toBeDefined()
    expect(result.properties.data.items.items.type).toBe("string")
  })

  test("handles deeply nested arrays (3D)", () => {
    const schema = {
      type: "object",
      properties: {
        matrix: {
          type: "array",
          items: {
            type: "array",
            items: {
              type: "array",
              // No items
            },
          },
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.matrix.items.items.items).toBeDefined()
    expect(result.properties.matrix.items.items.items.type).toBe("string")
  })

  test("preserves existing item types in nested arrays", () => {
    const schema = {
      type: "object",
      properties: {
        numbers: {
          type: "array",
          items: {
            type: "array",
            items: { type: "number" }, // Has explicit type
          },
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    // Should preserve the explicit type
    expect(result.properties.numbers.items.items.type).toBe("number")
  })

  test("handles mixed nested structures with objects and arrays", () => {
    const schema = {
      type: "object",
      properties: {
        spreadsheetData: {
          type: "object",
          properties: {
            rows: {
              type: "array",
              items: {
                type: "array",
                items: {}, // Empty items
              },
            },
          },
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.spreadsheetData.properties.rows.items.items.type).toBe("string")
  })
})

describe("ProviderTransform.schema - gemini combiner nodes", () => {
  const geminiModel = {
    providerID: "google",
    api: {
      id: "gemini-3-pro",
    },
  } as any

  const walk = (node: any, cb: (node: any, path: (string | number)[]) => void, path: (string | number)[] = []) => {
    if (node === null || typeof node !== "object") {
      return
    }
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, cb, [...path, i]))
      return
    }
    cb(node, path)
    Object.entries(node).forEach(([key, value]) => walk(value, cb, [...path, key]))
  }

  test("keeps edits.items.anyOf without adding type", () => {
    const schema = {
      type: "object",
      properties: {
        edits: {
          type: "array",
          items: {
            anyOf: [
              {
                type: "object",
                properties: {
                  old_string: { type: "string" },
                  new_string: { type: "string" },
                },
                required: ["old_string", "new_string"],
              },
              {
                type: "object",
                properties: {
                  old_string: { type: "string" },
                  new_string: { type: "string" },
                  replace_all: { type: "boolean" },
                },
                required: ["old_string", "new_string"],
              },
            ],
          },
        },
      },
      required: ["edits"],
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(Array.isArray(result.properties.edits.items.anyOf)).toBe(true)
    expect(result.properties.edits.items.type).toBeUndefined()
  })

  test("does not add sibling keys to combiner nodes during sanitize", () => {
    const schema = {
      type: "object",
      properties: {
        edits: {
          type: "array",
          items: {
            anyOf: [{ type: "string" }, { type: "number" }],
          },
        },
        value: {
          oneOf: [{ type: "string" }, { type: "boolean" }],
        },
        meta: {
          allOf: [
            {
              type: "object",
              properties: { a: { type: "string" } },
            },
            {
              type: "object",
              properties: { b: { type: "string" } },
            },
          ],
        },
      },
    } as any
    const input = JSON.parse(JSON.stringify(schema))
    const result = ProviderTransform.schema(geminiModel, schema) as any

    walk(result, (node, path) => {
      const hasCombiner = Array.isArray(node.anyOf) || Array.isArray(node.oneOf) || Array.isArray(node.allOf)
      if (!hasCombiner) {
        return
      }
      const before = path.reduce((acc: any, key) => acc?.[key], input)
      const added = Object.keys(node).filter((key) => !(key in before))
      expect(added).toEqual([])
    })
  })
})

describe("ProviderTransform.schema - gemini non-object properties removal", () => {
  const geminiModel = {
    providerID: "google",
    api: {
      id: "gemini-3-pro",
    },
  } as any

  test("removes properties from non-object types", () => {
    const schema = {
      type: "object",
      properties: {
        data: {
          type: "string",
          properties: { invalid: { type: "string" } },
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.data.type).toBe("string")
    expect(result.properties.data.properties).toBeUndefined()
  })

  test("removes required from non-object types", () => {
    const schema = {
      type: "object",
      properties: {
        data: {
          type: "array",
          items: { type: "string" },
          required: ["invalid"],
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.data.type).toBe("array")
    expect(result.properties.data.required).toBeUndefined()
  })

  test("removes properties and required from nested non-object types", () => {
    const schema = {
      type: "object",
      properties: {
        outer: {
          type: "object",
          properties: {
            inner: {
              type: "number",
              properties: { bad: { type: "string" } },
              required: ["bad"],
            },
          },
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.outer.properties.inner.type).toBe("number")
    expect(result.properties.outer.properties.inner.properties).toBeUndefined()
    expect(result.properties.outer.properties.inner.required).toBeUndefined()
  })

  test("keeps properties and required on object types", () => {
    const schema = {
      type: "object",
      properties: {
        data: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.data.type).toBe("object")
    expect(result.properties.data.properties).toBeDefined()
    expect(result.properties.data.required).toEqual(["name"])
  })

  test("does not affect non-gemini providers", () => {
    const openaiModel = {
      providerID: "openai",
      api: {
        id: "gpt-4",
      },
    } as any

    const schema = {
      type: "object",
      properties: {
        data: {
          type: "string",
          properties: { invalid: { type: "string" } },
        },
      },
    } as any

    const result = ProviderTransform.schema(openaiModel, schema) as any

    expect(result.properties.data.properties).toBeDefined()
  })
})

describe("ProviderTransform.schema - gemini circular schemas", () => {
  const geminiModel = {
    providerID: "google",
    api: {
      id: "gemini-3-pro",
    },
  } as any

  test("does not recurse forever on circular schema objects", () => {
    const schema = {
      type: "object",
      properties: {},
    } as any
    schema.properties.self = schema

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.self).toEqual({})
    expect(() => JSON.stringify(result)).not.toThrow()
  })
})

describe("ProviderTransform.message - DeepSeek reasoning content", () => {
  test("DeepSeek with tool calls includes reasoning_content in providerOptions", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Let me think about this..." },
          {
            type: "tool-call",
            toolCallId: "test",
            toolName: "bash",
            input: { command: "echo hello" },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(
      msgs,
      {
        id: ModelID.make("deepseek/deepseek-chat"),
        providerID: ProviderID.make("deepseek"),
        api: {
          id: "deepseek-chat",
          url: "https://api.deepseek.com",
          npm: "@ai-sdk/openai-compatible",
        },
        name: "DeepSeek Chat",
        capabilities: {
          temperature: true,
          reasoning: true,
          attachment: false,
          toolcall: true,
          input: { text: true, audio: false, image: false, video: false, pdf: false },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: {
            field: "reasoning_content",
          },
        },
        limit: {
          context: 128000,
          output: 8192,
        },
        status: "active",
        options: {},
        headers: {},
        release_date: "2023-04-01",
      },
      {},
    )

    expect(result).toHaveLength(1)
    expect(result[0].content).toEqual([
      {
        type: "tool-call",
        toolCallId: "test",
        toolName: "bash",
        input: { command: "echo hello" },
      },
    ])
    expect(result[0].providerOptions?.openaiCompatible?.reasoning_content).toBe("Let me think about this...")
  })

  test("Non-DeepSeek providers leave reasoning content unchanged", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Should not be processed" },
          { type: "text", text: "Answer" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(
      msgs,
      {
        id: ModelID.make("groq/llama-3.1-8b"),
        providerID: ProviderID.make("groq"),
        api: {
          id: "llama-3.1-8b-instant",
          url: "https://api.groq.com",
          npm: "@ai-sdk/groq",
        },
        name: "Llama 3.1 8B",
        capabilities: {
          temperature: true,
          reasoning: false,
          attachment: true,
          toolcall: true,
          input: { text: true, audio: false, image: true, video: false, pdf: false },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: false,
        },
        limit: {
          context: 128000,
          output: 4096,
        },
        status: "active",
        options: {},
        headers: {},
        release_date: "2023-04-01",
      },
      {},
    )

    expect(result[0].content).toEqual([
      { type: "reasoning", text: "Should not be processed" },
      { type: "text", text: "Answer" },
    ])
    expect(result[0].providerOptions?.openaiCompatible?.reasoning_content).toBeUndefined()
  })
})

describe("ProviderTransform.message - empty image handling", () => {
  const mockModel = {
    id: "groq/llama-3.1-70b",
    providerID: "groq",
    api: {
      id: "llama-3.1-70b-versatile",
      url: "https://api.groq.com",
      npm: "@ai-sdk/groq",
    },
    name: "Llama 3.1 70B",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    limit: {
      context: 200000,
      output: 8192,
    },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("should replace empty base64 image with error text", () => {
    const msgs = [
      {
        role: "user",
        content: [
          { type: "text", text: "What is in this image?" },
          { type: "image", image: "data:image/png;base64," },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, mockModel, {})

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(2)
    expect(result[0].content[0]).toEqual({ type: "text", text: "What is in this image?" })
    expect(result[0].content[1]).toEqual({
      type: "text",
      text: "ERROR: Image file is empty or corrupted. Please provide a valid image.",
    })
  })

  test("should replace empty base64 image with case-insensitive data URL scheme", () => {
    const msgs = [
      {
        role: "user",
        content: [
          { type: "text", text: "What is in this image?" },
          { type: "image", image: "DATA:image/png;base64," },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, mockModel, {})

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(2)
    expect(result[0].content[1]).toEqual({
      type: "text",
      text: "ERROR: Image file is empty or corrupted. Please provide a valid image.",
    })
  })

  test("should keep valid base64 images unchanged", () => {
    const validBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    const msgs = [
      {
        role: "user",
        content: [
          { type: "text", text: "What is in this image?" },
          { type: "image", image: `data:image/png;base64,${validBase64}` },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, mockModel, {})

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(2)
    expect(result[0].content[0]).toEqual({ type: "text", text: "What is in this image?" })
    expect(result[0].content[1]).toEqual({ type: "image", image: `data:image/png;base64,${validBase64}` })
  })

  test("should keep file image parts unchanged when model supports image input", () => {
    const filePart = {
      type: "file" as const,
      data: "data:image/png;base64,AA==",
      mediaType: "image/png",
      filename: "screenshot.png",
    }
    const msgs = [
      {
        role: "user",
        content: [{ type: "text", text: "What is in this screenshot?" }, filePart],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, mockModel, {})

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(2)
    expect(result[0].content[0]).toEqual({ type: "text", text: "What is in this screenshot?" })
    expect(result[0].content[1]).toEqual(filePart)
  })

  test("should handle mixed valid and empty images", () => {
    const validBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    const msgs = [
      {
        role: "user",
        content: [
          { type: "text", text: "Compare these images" },
          { type: "image", image: `data:image/png;base64,${validBase64}` },
          { type: "image", image: "data:image/jpeg;base64," },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, mockModel, {})

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(3)
    expect(result[0].content[0]).toEqual({ type: "text", text: "Compare these images" })
    expect(result[0].content[1]).toEqual({ type: "image", image: `data:image/png;base64,${validBase64}` })
    expect(result[0].content[2]).toEqual({
      type: "text",
      text: "ERROR: Image file is empty or corrupted. Please provide a valid image.",
    })
  })
})

describe("ProviderTransform.variants", () => {
  const createMockModel = (overrides: Partial<any> = {}): any => ({
    id: "test/test-model",
    providerID: "test",
    api: {
      id: "test-model",
      url: "https://api.test.com",
      npm: "@ai-sdk/openai",
    },
    name: "Test Model",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    limit: {
      context: 200_000,
      output: 64_000,
    },
    status: "active",
    options: {},
    headers: {},
    release_date: "2024-01-01",
    ...overrides,
  })

  test("returns empty object when model has no reasoning capabilities", () => {
    const model = createMockModel({
      capabilities: { reasoning: false },
    })
    const result = ProviderTransform.variants(model)
    expect(result).toEqual({})
  })

  test("deepseek returns empty object", () => {
    const model = createMockModel({
      id: "deepseek/deepseek-chat",
      providerID: "deepseek",
      api: {
        id: "deepseek-chat",
        url: "https://api.deepseek.com",
        npm: "@ai-sdk/openai-compatible",
      },
    })
    const result = ProviderTransform.variants(model)
    expect(result).toEqual({})
  })

  test("minimax returns empty object", () => {
    const model = createMockModel({
      id: "minimax/minimax-model",
      providerID: "minimax",
      api: {
        id: "minimax-model",
        url: "https://api.minimax.com",
        npm: "@ai-sdk/openai-compatible",
      },
    })
    const result = ProviderTransform.variants(model)
    expect(result).toEqual({})
  })

  test("glm returns empty object", () => {
    const model = createMockModel({
      id: "glm/glm-5",
      providerID: "glm",
      api: {
        id: "glm-5",
        url: "https://api.glm.com",
        npm: "@ai-sdk/openai-compatible",
      },
    })
    const result = ProviderTransform.variants(model)
    expect(result).toEqual({})
  })

  test("mistral returns empty object", () => {
    const model = createMockModel({
      id: "mistral/mistral-large",
      providerID: "mistral",
      api: {
        id: "mistral-large-latest",
        url: "https://api.mistral.com",
        npm: "@ai-sdk/mistral",
      },
    })
    const result = ProviderTransform.variants(model)
    expect(result).toEqual({})
  })

  describe("@ai-sdk/xai", () => {
    test("grok-4.3 does not auto-generate reasoningEffort variants", () => {
      const model = createMockModel({
        id: "xai/grok-4.3",
        providerID: "xai",
        api: {
          id: "grok-4.3",
          url: "https://api.x.ai",
          npm: "@ai-sdk/xai",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(result).toEqual({})
    })

    test("sanitizes unsupported reasoningEffort request options", () => {
      const model = createMockModel({
        id: "xai/grok-4.3",
        providerID: "xai",
        api: {
          id: "grok-4.3",
          url: "https://api.x.ai",
          npm: "@ai-sdk/xai",
        },
      })
      const result = ProviderTransform.sanitizeOptions(model, {
        reasoningEffort: "high",
        reasoning_effort: "high",
        temperature: 0.2,
      })
      expect(result).toEqual({ temperature: 0.2 })
    })

    test("options() injects default Live Search searchParameters for grok-4.3", () => {
      const model = createMockModel({
        id: "xai/grok-4.3",
        providerID: "xai",
        api: { id: "grok-4.3", url: "https://api.x.ai", npm: "@ai-sdk/xai" },
      })
      const result = ProviderTransform.options({ model, sessionID: "s1", providerOptions: {} })
      expect(result.searchParameters).toBeDefined()
      expect(result.searchParameters.mode).toBe("auto")
      expect(result.searchParameters.returnCitations).toBe(true)
      expect(result.searchParameters.sources).toEqual([{ type: "web" }, { type: "x" }, { type: "news" }])
    })

    test("options() skips Live Search for grok-code-fast-1 alias", () => {
      const model = createMockModel({
        id: "xai/grok-code-fast-1",
        providerID: "xai",
        api: { id: "grok-code-fast-1", url: "https://api.x.ai", npm: "@ai-sdk/xai" },
      })
      const result = ProviderTransform.options({ model, sessionID: "s1", providerOptions: {} })
      expect(result.searchParameters).toBeUndefined()
    })

    test("options() skips Live Search for grok-build-0.1", () => {
      const model = createMockModel({
        id: "xai/grok-build-0.1",
        providerID: "xai",
        api: { id: "grok-build-0.1", url: "https://api.x.ai", npm: "@ai-sdk/xai" },
      })
      const result = ProviderTransform.options({ model, sessionID: "s1", providerOptions: {} })
      expect(result.searchParameters).toBeUndefined()
    })

    test("options() skips Live Search for multi-agent models", () => {
      const model = createMockModel({
        id: "xai/grok-4.20-multi-agent-0309",
        providerID: "xai",
        api: { id: "grok-4.20-multi-agent-0309", url: "https://api.x.ai", npm: "@ai-sdk/xai" },
      })
      const result = ProviderTransform.options({ model, sessionID: "s1", providerOptions: {} })
      expect(result.searchParameters).toBeUndefined()
    })

    test("options() honours explicit { mode: 'off' } override and omits the key", () => {
      const model = createMockModel({
        id: "xai/grok-4.3",
        providerID: "xai",
        api: { id: "grok-4.3", url: "https://api.x.ai", npm: "@ai-sdk/xai" },
      })
      const result = ProviderTransform.options({
        model,
        sessionID: "s1",
        providerOptions: { searchParameters: { mode: "off" } },
      })
      expect(result.searchParameters).toBeUndefined()
    })

    test("options() shallow-merges user searchParameters overrides over defaults", () => {
      const model = createMockModel({
        id: "xai/grok-4.3",
        providerID: "xai",
        api: { id: "grok-4.3", url: "https://api.x.ai", npm: "@ai-sdk/xai" },
      })
      const result = ProviderTransform.options({
        model,
        sessionID: "s1",
        providerOptions: { searchParameters: { mode: "on", maxSearchResults: 3 } },
      })
      expect(result.searchParameters.mode).toBe("on")
      expect(result.searchParameters.maxSearchResults).toBe(3)
      expect(result.searchParameters.returnCitations).toBe(true)
    })
  })

  describe("Alibaba DashScope internet search", () => {
    const mkQwen = (providerID: string, apiId = "qwen3.6-plus") =>
      createMockModel({
        id: `${providerID}/${apiId}`,
        providerID,
        api: { id: apiId, url: "https://dashscope.aliyuncs.com", npm: "@ai-sdk/openai-compatible" },
      })

    test("options() enables enable_search for Qwen on alibaba-coding-plan", () => {
      const result = ProviderTransform.options({
        model: mkQwen("alibaba-coding-plan"),
        sessionID: "s1",
        providerOptions: {},
      })
      expect(result.enable_search).toBe(true)
      expect(result.search_options).toEqual({ enable_source: true, enable_citation: true })
    })

    test("options() enables enable_search for Qwen on alibaba-token-plan-cn", () => {
      const result = ProviderTransform.options({
        model: mkQwen("alibaba-token-plan-cn", "qwen3.7-max"),
        sessionID: "s1",
        providerOptions: {},
      })
      expect(result.enable_search).toBe(true)
    })

    test("options() skips enable_search for non-Qwen models on Alibaba plans", () => {
      const result = ProviderTransform.options({
        model: mkQwen("alibaba-coding-plan", "deepseek-v4-pro"),
        sessionID: "s1",
        providerOptions: {},
      })
      expect(result.enable_search).toBeUndefined()
      expect(result.search_options).toBeUndefined()
    })

    test("options() skips enable_search for image-only Qwen models on Alibaba plans", () => {
      const result = ProviderTransform.options({
        model: createMockModel({
          id: "alibaba-coding-plan/qwen-image-2.0",
          providerID: "alibaba-coding-plan",
          api: { id: "qwen-image-2.0", url: "https://dashscope.aliyuncs.com", npm: "@ai-sdk/openai-compatible" },
          capabilities: {
            input: { text: true, audio: false, image: false, video: false, pdf: false },
            output: { text: false, audio: false, image: true, video: false, pdf: false },
          },
        }),
        sessionID: "s1",
        providerOptions: {},
      })
      expect(result.enable_search).toBeUndefined()
      expect(result.search_options).toBeUndefined()
    })

    test("options() skips enable_search for Qwen on non-Alibaba providers", () => {
      const model = createMockModel({
        id: "together/qwen3.6-plus",
        providerID: "togetherai",
        api: { id: "qwen3.6-plus", url: "https://api.together.xyz/v1", npm: "@ai-sdk/openai-compatible" },
      })
      const result = ProviderTransform.options({ model, sessionID: "s1", providerOptions: {} })
      expect(result.enable_search).toBeUndefined()
    })

    test("options() honours explicit enable_search:false opt-out", () => {
      const result = ProviderTransform.options({
        model: mkQwen("alibaba-coding-plan"),
        sessionID: "s1",
        providerOptions: { enable_search: false },
      })
      expect(result.enable_search).toBeUndefined()
      expect(result.search_options).toBeUndefined()
    })

    test("options() merges user search_options over defaults", () => {
      const result = ProviderTransform.options({
        model: mkQwen("alibaba-coding-plan"),
        sessionID: "s1",
        providerOptions: { search_options: { forced_search: true, search_strategy: "pro" } },
      })
      expect(result.search_options).toEqual({
        enable_source: true,
        enable_citation: true,
        forced_search: true,
        search_strategy: "pro",
      })
    })
  })

  describe("@ai-sdk/openai-compatible", () => {
    test("returns WIDELY_SUPPORTED_EFFORTS with reasoningEffort", () => {
      const model = createMockModel({
        id: "custom-provider/custom-model",
        providerID: "custom-provider",
        api: {
          id: "custom-model",
          url: "https://api.custom.com",
          npm: "@ai-sdk/openai-compatible",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
      expect(result.low).toEqual({ reasoningEffort: "low" })
      expect(result.high).toEqual({ reasoningEffort: "high" })
    })

    test("does not apply generic reasoningEffort variants to Alibaba plans", () => {
      const model = createMockModel({
        id: "alibaba-token-plan/qwen3.6-plus",
        providerID: "alibaba-token-plan",
        api: {
          id: "qwen3.6-plus",
          url: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
          npm: "@ai-sdk/openai-compatible",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(result).toEqual({})
    })

    test("keeps generic reasoningEffort variants for Alibaba coding plan", () => {
      const model = createMockModel({
        id: "alibaba-coding-plan/qwen3.6-plus",
        providerID: "alibaba-coding-plan",
        api: {
          id: "qwen3.6-plus",
          url: "https://coding-intl.dashscope.aliyuncs.com/v1",
          npm: "@ai-sdk/openai-compatible",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
      expect(result.high).toEqual({ reasoningEffort: "high" })
    })
  })

  describe("@ai-sdk/google", () => {
    test("gemini-3 returns low and high with thinkingLevel", () => {
      const model = createMockModel({
        id: "google/gemini-3-pro",
        providerID: "google",
        api: {
          id: "gemini-3-pro",
          url: "https://generativelanguage.googleapis.com",
          npm: "@ai-sdk/google",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "high"])
      expect(result.low).toEqual({
        thinkingConfig: {
          includeThoughts: true,
          thinkingLevel: "low",
        },
      })
      expect(result.high).toEqual({
        thinkingConfig: {
          includeThoughts: true,
          thinkingLevel: "high",
        },
      })
    })

    test("gemini-3.1 adds medium thinking level", () => {
      const model = createMockModel({
        id: "google/gemini-3.1-pro",
        providerID: "google",
        api: {
          id: "gemini-3.1-pro",
          url: "https://generativelanguage.googleapis.com",
          npm: "@ai-sdk/google",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
    })
  })

  describe("@ai-sdk/google-vertex", () => {
    test("gemini-3 returns low and high with thinkingLevel", () => {
      const model = createMockModel({
        id: "google-vertex/gemini-3-pro",
        providerID: "google-vertex",
        api: {
          id: "gemini-3-pro",
          url: "https://vertexai.googleapis.com",
          npm: "@ai-sdk/google-vertex",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "high"])
    })

    test("gemini-3.1 vertex adds medium thinking level", () => {
      const model = createMockModel({
        id: "google-vertex/gemini-3.1-pro",
        providerID: "google-vertex",
        api: {
          id: "gemini-3.1-pro",
          url: "https://vertexai.googleapis.com",
          npm: "@ai-sdk/google-vertex",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
    })
  })

  // @ai-sdk/groq provider was removed in v2.23.3
})

describe("ProviderTransform family matching", () => {
  const createModel = (overrides: Partial<any> = {}) =>
    ({
      id: "test/test-model",
      providerID: "test",
      api: {
        id: "test-model",
        url: "https://api.test.com",
        npm: "@ai-sdk/openai-compatible",
      },
      name: "Test Model",
      family: undefined,
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      limit: {
        context: 200_000,
        output: 64_000,
      },
      status: "active",
      options: {},
      headers: {},
      ...overrides,
    }) as any

  test("ignores family tokens that only appear in provider path segments", () => {
    const model = createModel({
      id: "accounts/qwen-tools/models/custom-model",
    })

    expect(ProviderTransform.temperature(model)).toBeUndefined()
    expect(ProviderTransform.topP(model)).toBeUndefined()
    expect(ProviderTransform.topK(model)).toBeUndefined()
    expect(Object.keys(ProviderTransform.variants(model))).toEqual(["low", "medium", "high"])
  })

  test("applies minimax-m2 tuning to dotted, dashed and dashless id spellings", () => {
    // These all denote the minimax-m2 family; some providers spell the version
    // without a separator (minimax-m25 == minimax-m2.5), which the family
    // boundary check would otherwise reject.
    for (const id of ["minimax-m2.5", "minimax-m2-7", "minimax-m25", "minimax-m27", "minimax/minimax-m25"]) {
      const model = createModel({ id, family: "minimax" })
      expect(ProviderTransform.temperature(model)).toBe(1.0)
      expect(ProviderTransform.topP(model)).toBe(0.95)
      expect(ProviderTransform.topK(model)).toBe(40)
    }
  })

  test("base minimax-m2 uses the narrower top-k", () => {
    const model = createModel({ id: "minimax-m2", family: "minimax" })
    expect(ProviderTransform.temperature(model)).toBe(1.0)
    expect(ProviderTransform.topP(model)).toBe(0.95)
    expect(ProviderTransform.topK(model)).toBe(20)
  })

  test("non-m2 minimax models receive no m2 sampling tuning", () => {
    const model = createModel({ id: "minimax-m1", family: "minimax" })
    expect(ProviderTransform.temperature(model)).toBeUndefined()
    expect(ProviderTransform.topP(model)).toBeUndefined()
    expect(ProviderTransform.topK(model)).toBeUndefined()
  })

  test("matches model families from the final id segment", () => {
    const qwen = createModel({
      id: "accounts/fireworks/models/qwen3-next",
      family: "qwen",
      capabilities: { reasoning: false },
    })
    const gemini = createModel({
      id: "google/gemini-3-flash",
      family: "gemini-flash",
      capabilities: { reasoning: false },
    })

    expect(ProviderTransform.temperature(qwen)).toBe(0.55)
    expect(ProviderTransform.topP(qwen)).toBe(1)
    expect(ProviderTransform.topK(gemini)).toBe(64)
  })
})

describe("ProviderTransform.maxOutputTokens", () => {
  test("caps Alibaba Token Plan requests to avoid over-allocating short-window quota", () => {
    const model = {
      id: "alibaba-token-plan/qwen3.6-plus",
      providerID: ProviderID.make("alibaba-token-plan"),
      api: {
        id: "qwen3.6-plus",
      },
      limit: {
        output: 65_536,
      },
    } as any

    expect(ProviderTransform.maxOutputTokens(model)).toBe(4_096)
  })

  test("caps Alibaba Coding Plan (DashScope) requests at the same short-window ceiling", () => {
    const model = {
      id: "alibaba-coding-plan/qwen3.6-plus",
      providerID: ProviderID.make("alibaba-coding-plan"),
      api: {
        id: "qwen3.6-plus",
      },
      limit: {
        output: 65_536,
      },
    } as any

    expect(ProviderTransform.maxOutputTokens(model)).toBe(4_096)
  })

  test("honors lower Alibaba model output limits below the short-window cap", () => {
    const model = {
      id: "alibaba-token-plan/qwen3.6-plus",
      providerID: ProviderID.make("alibaba-token-plan"),
      api: {
        id: "qwen3.6-plus",
      },
      limit: {
        output: 512,
      },
    } as any

    expect(ProviderTransform.maxOutputTokens(model)).toBe(512)
  })

  test("caps every Alibaba-backed model regardless of family — reservation is platform-level", () => {
    const model = {
      id: "alibaba-token-plan/deepseek-v3.2",
      providerID: ProviderID.make("alibaba-token-plan"),
      api: {
        id: "deepseek-v3.2",
      },
      limit: {
        output: 65_536,
      },
    } as any

    expect(ProviderTransform.maxOutputTokens(model)).toBe(4_096)
  })

  test("keeps the global output cap for other providers", () => {
    const model = {
      providerID: ProviderID.make("custom-provider"),
      limit: {
        output: 65_536,
      },
    } as any

    expect(ProviderTransform.maxOutputTokens(model)).toBe(OUTPUT_TOKEN_MAX)
  })

  test("raises output cap to 65 536 for qwen3.7-max on non-Alibaba routes", () => {
    const model = {
      id: "qwen3.7-max",
      providerID: ProviderID.make("togetherai"),
      limit: { output: 65_536 },
    } as any
    expect(ProviderTransform.maxOutputTokens(model)).toBe(65_536)
  })

  test("keeps Alibaba quota cap for qwen3.7-max on Alibaba routes", () => {
    const model = {
      id: "qwen3.7-max",
      providerID: ProviderID.make("alibaba-coding-plan"),
      limit: { output: 65_536 },
    } as any
    expect(ProviderTransform.maxOutputTokens(model)).toBe(4_096)
  })

  test("raises output cap to 131 072 for GLM 5.x including the [1m] variant", () => {
    for (const [providerID, id] of [
      ["zai-coding-plan", "glm-5.2"],
      ["zai-coding-plan", "glm-5.2[1m]"],
      ["zhipuai-coding-plan", "glm-5.1[1m]"],
      ["zhipuai", "glm-5.1"],
      ["zhipuai", "glm-5-turbo"],
    ] as const) {
      const model = {
        id,
        family: "glm",
        providerID: ProviderID.make(providerID),
        limit: { output: 131_072 },
      } as any
      expect(ProviderTransform.maxOutputTokens(model)).toBe(131_072)
    }
  })

  test("keeps Alibaba quota cap for GLM routed through a DashScope plan", () => {
    const model = {
      id: "glm-5.1",
      family: "glm",
      providerID: ProviderID.make("alibaba-coding-plan"),
      limit: { output: 131_072 },
    } as any
    expect(ProviderTransform.maxOutputTokens(model)).toBe(4_096)
  })
})

describe("ProviderTransform.options - Alibaba Token Plan Team Edition", () => {
  function createModel(modelID: string, reasoning = true, providerID = "alibaba-token-plan") {
    return {
      id: `${providerID}/${modelID}`,
      providerID: ProviderID.make(providerID),
      api: {
        id: modelID,
        url: providerID.endsWith("-cn")
          ? "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
          : "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
        npm: "@ai-sdk/openai-compatible",
      },
      capabilities: {
        reasoning,
      },
      limit: {
        output: 65_536,
      },
    } as any
  }

  test("pairs enable_thinking with a bounded thinking_budget for qwen3.6-plus", () => {
    const result = ProviderTransform.options({
      model: createModel("qwen3.6-plus"),
      sessionID: "session-test",
      providerOptions: {},
    })

    // thinking_budget is clamped to maxOutputTokens (4096 — the Alibaba
    // short-window cap), which is below the 8192 documented ceiling.
    expect(result.enable_thinking).toBe(true)
    expect(result.thinking_budget).toBe(4096)
    expect(result.thinking).toBeUndefined()
  })

  test("keeps thinking_budget at or below a lower configured output limit", () => {
    const model = createModel("qwen3.6-plus")
    model.limit.output = 512
    const result = ProviderTransform.options({
      model,
      sessionID: "session-test",
      providerOptions: {},
    })

    expect(result.enable_thinking).toBe(true)
    expect(result.thinking_budget).toBe(512)
    expect(ProviderTransform.maxOutputTokens(model)).toBe(512)
  })

  test("sanitizes merged options that would reintroduce unsupported Token Plan fields", () => {
    const model = createModel("qwen3.6-plus")
    const result = ProviderTransform.sanitizeOptions(model, {
      thinking: { type: "enabled", budgetTokens: 8192 },
      thinking_budget: 8192,
      reasoning: { effort: "high" },
      reasoningEffort: "high",
      reasoning_effort: "high",
      thinkingConfig: { thinkingLevel: "high" },
      custom: "keep",
    })

    // The Anthropic-shaped `thinking` block and reasoning-effort variants
    // are stripped; the user-supplied `thinking_budget: 8192` is clamped
    // down to maxOutputTokens (4096).
    expect(result).toEqual({
      enable_thinking: true,
      thinking_budget: 4096,
      custom: "keep",
    })
  })

  test("fills missing Token Plan thinking_budget after config merges", () => {
    const model = createModel("qwen3.6-plus")
    const result = ProviderTransform.sanitizeOptions(model, {})

    expect(result.enable_thinking).toBe(true)
    expect(result.thinking_budget).toBe(4096)
  })

  test("rebuilds invalid Token Plan thinking_budget after config merges", () => {
    const model = createModel("qwen3.6-plus")
    for (const budget of [undefined, null, false, -1, NaN, "bad"]) {
      const result = ProviderTransform.sanitizeOptions(model, {
        thinking_budget: budget as any,
      })

      expect(result.enable_thinking).toBe(true)
      expect(result.thinking_budget).toBe(4096)
    }
  })

  test("floors fractional Token Plan thinking_budget", () => {
    const model = createModel("qwen3.6-plus")
    const result = ProviderTransform.sanitizeOptions(model, {
      thinking_budget: 511.9,
    })

    expect(result.thinking_budget).toBe(511)
  })

  test("pairs enable_thinking with a bounded thinking_budget for glm-5", () => {
    const result = ProviderTransform.options({
      model: createModel("glm-5"),
      sessionID: "session-test",
      providerOptions: {},
    })

    expect(result.enable_thinking).toBe(true)
    expect(result.thinking_budget).toBe(4096)
    expect(result.thinking).toBeUndefined()
  })

  test("pairs enable_thinking with a bounded thinking_budget for China Token Plan MiniMax-M2.5", () => {
    const model = createModel("MiniMax-M2.5", true, "alibaba-token-plan-cn")
    const result = ProviderTransform.options({
      model,
      sessionID: "session-test",
      providerOptions: {},
    })

    expect(result.enable_thinking).toBe(true)
    expect(result.thinking_budget).toBe(4096)
    // alibaba-token-plan-cn is subject to the same short-window cap as every
    // other Alibaba-backed provider.
    expect(ProviderTransform.maxOutputTokens(model)).toBe(4_096)
  })

  test("pairs enable_thinking for international Token Plan MiniMax-M2.5", () => {
    // Capability-driven: any reasoning model on Token Plan picks up
    // thinking, including MiniMax-M2.5 on the international plan which
    // used to be excluded by a hand-kept whitelist.
    const result = ProviderTransform.options({
      model: createModel("MiniMax-M2.5"),
      sessionID: "session-test",
      providerOptions: {},
    })

    expect(result.enable_thinking).toBe(true)
    expect(result.thinking_budget).toBe(4096)
  })

  test("does not enable thinking for non-reasoning Token Plan models", () => {
    const result = ProviderTransform.options({
      model: createModel("deepseek-v3.2", false),
      sessionID: "session-test",
      providerOptions: {},
    })

    expect(result.thinking).toBeUndefined()
    expect(result.enable_thinking).toBeUndefined()
    expect(result.thinking_budget).toBeUndefined()
  })
})

describe("ProviderTransform.options - Alibaba Coding Plan (DashScope)", () => {
  function createModel(modelID: string, reasoning = true, providerID = "alibaba-coding-plan") {
    return {
      id: `${providerID}/${modelID}`,
      providerID: ProviderID.make(providerID),
      api: {
        id: modelID,
        url: providerID.endsWith("-cn")
          ? "https://coding.dashscope.aliyuncs.com/v1"
          : "https://coding-intl.dashscope.aliyuncs.com/v1",
        npm: "@ai-sdk/openai-compatible",
      },
      capabilities: {
        reasoning,
      },
      limit: {
        output: 65_536,
      },
    } as any
  }

  test("pairs enable_thinking with a bounded thinking_budget for qwen3.6-plus", () => {
    const result = ProviderTransform.options({
      model: createModel("qwen3.6-plus"),
      sessionID: "session-test",
      providerOptions: {},
    })

    // thinking_budget is clamped to maxOutputTokens (4096 — the Alibaba
    // short-window cap), which is below the 8192 documented ceiling.
    expect(result.enable_thinking).toBe(true)
    expect(result.thinking_budget).toBe(4096)
    expect(result.thinking).toBeUndefined()
  })

  test("pairs enable_thinking with a bounded thinking_budget for glm-5", () => {
    const result = ProviderTransform.options({
      model: createModel("glm-5"),
      sessionID: "session-test",
      providerOptions: {},
    })

    expect(result.enable_thinking).toBe(true)
    expect(result.thinking_budget).toBe(4096)
    expect(result.thinking).toBeUndefined()
  })

  test("pairs enable_thinking with a bounded thinking_budget on the China Coding Plan", () => {
    const result = ProviderTransform.options({
      model: createModel("qwen3.6-plus", true, "alibaba-coding-plan-cn"),
      sessionID: "session-test",
      providerOptions: {},
    })

    expect(result.enable_thinking).toBe(true)
    expect(result.thinking_budget).toBe(4096)
  })

  test("does not enable thinking for non-reasoning Coding Plan models", () => {
    const result = ProviderTransform.options({
      model: createModel("deepseek-v3.2", false),
      sessionID: "session-test",
      providerOptions: {},
    })

    expect(result.enable_thinking).toBeUndefined()
    expect(result.thinking_budget).toBeUndefined()
    expect(result.thinking).toBeUndefined()
  })
})

describe("ProviderTransform.smallOptions - Alibaba thinking models", () => {
  function createModel(providerID: string, modelID = "qwen3.6-plus", reasoning = true) {
    return {
      id: `${providerID}/${modelID}`,
      providerID: ProviderID.make(providerID),
      api: {
        id: modelID,
        url: "https://example.invalid/v1",
        npm: "@ai-sdk/openai-compatible",
      },
      capabilities: {
        reasoning,
      },
      limit: {
        output: 65_536,
      },
    } as any
  }

  test("disables thinking for auxiliary calls on Token Plan", () => {
    const result = ProviderTransform.smallOptions(createModel("alibaba-token-plan"))
    expect(result).toEqual({ enable_thinking: false })
  })

  test("disables thinking for auxiliary calls on Coding Plan", () => {
    const result = ProviderTransform.smallOptions(createModel("alibaba-coding-plan"))
    expect(result).toEqual({ enable_thinking: false })
  })

  test("returns no thinking override for non-reasoning Alibaba models", () => {
    const result = ProviderTransform.smallOptions(createModel("alibaba-token-plan", "deepseek-v3.2", false))
    expect(result).toEqual({})
  })

  test("sanitizeOptions preserves an explicit enable_thinking=false and drops budget", () => {
    const model = createModel("alibaba-coding-plan")
    const result = ProviderTransform.sanitizeOptions(model, {
      enable_thinking: false,
      thinking_budget: 8192,
      thinking: { type: "enabled", budgetTokens: 8192 },
      custom: "keep",
    })

    expect(result).toEqual({
      enable_thinking: false,
      custom: "keep",
    })
  })
})

describe("ProviderTransform.options - preserve_thinking (Phase 2)", () => {
  function mkAlibabaThinking(providerID: string, modelID = "qwen3.7-max") {
    return {
      id: `${providerID}/${modelID}`,
      providerID: ProviderID.make(providerID),
      api: {
        id: modelID,
        url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        npm: "@ai-sdk/openai-compatible",
      },
      capabilities: { reasoning: true },
      limit: { output: 65_536 },
    } as any
  }

  function mkNonAlibaba(modelID = "claude-3-5-sonnet") {
    return {
      id: `anthropic/${modelID}`,
      providerID: ProviderID.make("anthropic"),
      api: { id: modelID, url: "https://api.anthropic.com", npm: "@ai-sdk/anthropic" },
      capabilities: { reasoning: true },
      limit: { output: 32_000 },
    } as any
  }

  test("options() emits preserve_thinking when longAgent=true on Alibaba thinking model", () => {
    const result = ProviderTransform.options({
      model: mkAlibabaThinking("alibaba-coding-plan"),
      sessionID: "s1",
      providerOptions: {},
      longAgent: true,
    })
    expect(result.preserve_thinking).toBe(true)
    expect(result.enable_thinking).toBe(true)
  })

  test("options() omits preserve_thinking when longAgent=false", () => {
    const result = ProviderTransform.options({
      model: mkAlibabaThinking("alibaba-token-plan"),
      sessionID: "s1",
      providerOptions: {},
      longAgent: false,
    })
    expect(result.preserve_thinking).toBeUndefined()
    expect(result.enable_thinking).toBe(true)
  })

  test("options() omits preserve_thinking when longAgent is absent", () => {
    const result = ProviderTransform.options({
      model: mkAlibabaThinking("alibaba-coding-plan-cn"),
      sessionID: "s1",
      providerOptions: {},
    })
    expect(result.preserve_thinking).toBeUndefined()
  })

  test("options() never emits preserve_thinking for non-Alibaba models", () => {
    const result = ProviderTransform.options({
      model: mkNonAlibaba(),
      sessionID: "s1",
      providerOptions: {},
      longAgent: true,
    })
    expect(result.preserve_thinking).toBeUndefined()
  })

  test("sanitizeOptions carries preserve_thinking through when enable_thinking is true", () => {
    const model = mkAlibabaThinking("alibaba-coding-plan")
    const result = ProviderTransform.sanitizeOptions(model, {
      enable_thinking: true,
      thinking_budget: 8192,
      preserve_thinking: true,
      custom: "keep",
    })
    expect(result.preserve_thinking).toBe(true)
    expect(result.enable_thinking).toBe(true)
    expect(result.custom).toBe("keep")
  })

  test("sanitizeOptions strips preserve_thinking when enable_thinking=false (smallOptions path)", () => {
    const model = mkAlibabaThinking("alibaba-token-plan")
    const result = ProviderTransform.sanitizeOptions(model, {
      enable_thinking: false,
      thinking_budget: 8192,
      preserve_thinking: true,
    })
    expect(result.preserve_thinking).toBeUndefined()
    expect(result.enable_thinking).toBe(false)
  })

  test("sanitizeOptions omits preserve_thinking when not set (normal thinking path)", () => {
    const model = mkAlibabaThinking("alibaba-coding-plan")
    const result = ProviderTransform.sanitizeOptions(model, {
      enable_thinking: true,
      thinking_budget: 8192,
    })
    expect(result.preserve_thinking).toBeUndefined()
  })

  test("options() omits preserve_thinking when providerOptions.preserveThinking=false (opt-out)", () => {
    const result = ProviderTransform.options({
      model: mkAlibabaThinking("alibaba-coding-plan"),
      sessionID: "s-opt-out",
      providerOptions: { preserveThinking: false },
      longAgent: true,
    })
    expect(result.preserve_thinking).toBeUndefined()
    // promptCacheKey is still set — opt-out is independent of session caching
    expect(result.promptCacheKey).toBe("s-opt-out")
  })

  test("options() still emits preserve_thinking when providerOptions.preserveThinking=true (explicit enable)", () => {
    const result = ProviderTransform.options({
      model: mkAlibabaThinking("alibaba-coding-plan"),
      sessionID: "s-explicit",
      providerOptions: { preserveThinking: true },
      longAgent: true,
    })
    expect(result.preserve_thinking).toBe(true)
  })

  test("options() emits preserve_thinking when providerOptions.preserveThinking is absent (default on)", () => {
    const result = ProviderTransform.options({
      model: mkAlibabaThinking("alibaba-coding-plan"),
      sessionID: "s-default",
      providerOptions: {},
      longAgent: true,
    })
    expect(result.preserve_thinking).toBe(true)
  })
})

describe("ProviderTransform.options - promptCacheKey for Alibaba longAgent (Phase 3)", () => {
  function mkAlibabaThinking(providerID: string, modelID = "qwen3.7-max") {
    return {
      id: `${providerID}/${modelID}`,
      providerID: ProviderID.make(providerID),
      api: {
        id: modelID,
        url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        npm: "@ai-sdk/openai-compatible",
      },
      capabilities: { reasoning: true },
      limit: { output: 65_536 },
    } as any
  }

  test("options() sets promptCacheKey for Alibaba thinking model when longAgent=true", () => {
    const result = ProviderTransform.options({
      model: mkAlibabaThinking("alibaba-coding-plan"),
      sessionID: "sess-abc",
      providerOptions: {},
      longAgent: true,
    })
    expect(result.promptCacheKey).toBe("sess-abc")
  })

  test("options() omits promptCacheKey for Alibaba thinking model when longAgent=false", () => {
    const result = ProviderTransform.options({
      model: mkAlibabaThinking("alibaba-token-plan"),
      sessionID: "sess-abc",
      providerOptions: {},
      longAgent: false,
    })
    expect(result.promptCacheKey).toBeUndefined()
  })

  test("options() omits promptCacheKey when longAgent is absent", () => {
    const result = ProviderTransform.options({
      model: mkAlibabaThinking("alibaba-coding-plan-cn"),
      sessionID: "sess-abc",
      providerOptions: {},
    })
    expect(result.promptCacheKey).toBeUndefined()
  })

  test("sanitizeOptions preserves promptCacheKey through the Alibaba sanitize pass", () => {
    const model = mkAlibabaThinking("alibaba-coding-plan")
    const result = ProviderTransform.sanitizeOptions(model, {
      enable_thinking: true,
      thinking_budget: 8192,
      preserve_thinking: true,
      promptCacheKey: "sess-xyz",
    })
    expect(result.promptCacheKey).toBe("sess-xyz")
  })

  test("options() respects explicit setCacheKey for any provider", () => {
    const model = mkAlibabaThinking("alibaba-token-plan")
    const result = ProviderTransform.options({
      model,
      sessionID: "sess-set-cache",
      providerOptions: { setCacheKey: true },
    })
    expect(result.promptCacheKey).toBe("sess-set-cache")
  })
})

// Snapshot guard for z.ai / Zhipu-served GLM 5.x. transform.ts deliberately
// sends NO provider-specific options for z.ai (see the v3.1.0->v3.1.2 revert
// note at the z.ai branch): thinking enablement is gated on a live wire probe
// (ADR-040 M2). This test locks the current output shape so a future @ai-sdk
// bump that silently reintroduces a `thinking`/`reasoning_effort` field — the
// exact churn documented in the codebase — fails at PR time instead of
// silently changing wire behavior.
describe("ProviderTransform.options - z.ai / Zhipu GLM snapshot guard", () => {
  function createZaiModel(providerID: string, modelID = "glm-5.2") {
    return {
      id: `${providerID}/${modelID}`,
      family: "glm",
      providerID: ProviderID.make(providerID),
      api: {
        id: modelID,
        url: "https://api.z.ai/api/paas/v4/",
        npm: "@ai-sdk/openai-compatible",
      },
      capabilities: {
        reasoning: true,
      },
      limit: {
        output: 131_072,
      },
    } as any
  }

  test("z.ai-coding-plan glm-5.2 sends NO thinking/reasoning/cache params by default", () => {
    const model = createZaiModel("zai-coding-plan")
    const result = ProviderTransform.options({
      model,
      sessionID: "sess-zai",
      providerOptions: {},
    })

    // The locked shape: z.ai intentionally gets no provider options.
    // If any of these become defined, a wire-param change slipped in —
    // confirm it was intended (ADR-040 M2 probe result) before updating.
    expect(result).toEqual({})
    expect(result.thinking).toBeUndefined()
    expect(result.enable_thinking).toBeUndefined()
    expect(result.thinking_budget).toBeUndefined()
    expect(result.reasoning_effort).toBeUndefined()
    expect(result.reasoningEffort).toBeUndefined()
    expect(result.preserve_thinking).toBeUndefined()
    expect(result.promptCacheKey).toBeUndefined()
  })

  test("z.ai glm-5.2[1m] variant and Zhipu providers share the no-op shape", () => {
    for (const [providerID, id] of [
      ["zai", "glm-5.2[1m]"],
      ["zhipuai-coding-plan", "glm-5.2"],
      ["zhipuai", "glm-5"],
    ] as const) {
      const result = ProviderTransform.options({
        model: createZaiModel(providerID, id),
        sessionID: "sess-zai",
        providerOptions: {},
      })
      expect(result).toEqual({})
    }
  })

  test("longAgent does NOT add z.ai preserve_thinking/promptCacheKey (deferred to ADR-040 M2)", () => {
    const result = ProviderTransform.options({
      model: createZaiModel("zai-coding-plan"),
      sessionID: "sess-zai-long",
      providerOptions: {},
      longAgent: true,
    })
    // Unlike Alibaba, the z.ai longAgent path is intentionally a no-op until
    // a wire probe confirms the accepted param shape. This guards against
    // accidentally wiring the Alibaba branch onto z.ai.
    expect(result).toEqual({})
    expect(result.preserve_thinking).toBeUndefined()
    expect(result.promptCacheKey).toBeUndefined()
  })

  test("smallOptions does not add z.ai-specific thinking opt-out", () => {
    const result = ProviderTransform.smallOptions(createZaiModel("zai-coding-plan"))
    expect(result).toEqual({})
  })
})
