import { describe, expect, test, vi, beforeEach } from "vitest"

const mockProviders: Record<string, any> = {
  "alibaba-token-plan": {
    id: "alibaba-token-plan",
    name: "Alibaba Token Plan",
    source: "config" as const,
    env: [],
    options: {},
    models: {
      "qwen3-max-preview": {
        id: "qwen3-max-preview",
        name: "Qwen3 Max Preview",
        providerID: "alibaba-token-plan",
        api: { id: "qwen3-max-preview", url: "https://example.com", npm: "@ai-sdk/openai-compatible" },
        capabilities: {
          temperature: true,
          reasoning: false,
          attachment: false,
          toolcall: true,
          input: { text: true, audio: false, image: false, video: false, pdf: false },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: false,
        },
        limit: { context: 262144, output: 32768 },
        status: "active",
        options: {},
        headers: {},
        release_date: "",
      },
      "qwen3.5-122b": {
        id: "qwen3.5-122b",
        name: "Qwen3.5-122B",
        providerID: "alibaba-token-plan",
        api: { id: "qwen3.5-122b", url: "https://example.com", npm: "@ai-sdk/openai-compatible" },
        capabilities: {
          temperature: true,
          reasoning: true,
          attachment: true,
          toolcall: true,
          input: { text: true, audio: false, image: true, video: false, pdf: false },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: { field: "reasoning_content" },
        },
        limit: { context: 262144, output: 16384 },
        status: "active",
        options: {},
        headers: {},
        release_date: "",
      },
    },
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    source: "config" as const,
    env: [],
    options: {},
    models: {
      "gpt-4o": {
        id: "gpt-4o",
        name: "GPT-4o",
        providerID: "openai",
        api: { id: "gpt-4o", url: "https://api.openai.com", npm: "@ai-sdk/openai" },
        capabilities: {
          temperature: true,
          reasoning: false,
          attachment: true,
          toolcall: true,
          input: { text: true, audio: false, image: true, video: false, pdf: false },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: false,
        },
        limit: { context: 128000, output: 16384 },
        status: "active",
        options: {},
        headers: {},
        release_date: "",
      },
    },
  },
}

vi.mock("@/provider/provider-impl", () => ({
  Provider: {
    list: vi.fn(),
    defaultModel: vi.fn(),
    getModel: vi.fn(),
  },
}))

import { Provider } from "@/provider/provider-impl"
import {
  findVisionCapableModels,
  visualRoutingDiagnostic,
  checkVisualRouting,
  sessionModelFromMessages,
} from "../../src/visual/router"

const mockedProvider = vi.mocked(Provider)

describe("visual.router", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedProvider.list.mockResolvedValue(mockProviders)
  })

  describe("findVisionCapableModels", () => {
    test("returns vision-capable models from all providers", async () => {
      const results = await findVisionCapableModels()
      expect(results.length).toBe(2)
      expect(results.map((r) => r.modelID)).toContain("qwen3.5-122b")
      expect(results.map((r) => r.modelID)).toContain("gpt-4o")
    })

    test("prefers models from the same provider", async () => {
      const results = await findVisionCapableModels("alibaba-token-plan")
      expect(results[0].providerID).toBe("alibaba-token-plan")
      expect(results[0].modelID).toBe("qwen3.5-122b")
    })

    test("excludes text-only models", async () => {
      const results = await findVisionCapableModels()
      const modelIDs = results.map((r) => r.modelID)
      expect(modelIDs).not.toContain("qwen3-max-preview")
    })

    test("respects the limit parameter", async () => {
      const results = await findVisionCapableModels(undefined, 1)
      expect(results.length).toBe(1)
    })
  })

  describe("visualRoutingDiagnostic", () => {
    test("returns undefined when model has required capabilities", async () => {
      const model = mockProviders["alibaba-token-plan"].models["qwen3.5-122b"]
      const result = await visualRoutingDiagnostic({
        model,
        providerID: "alibaba-token-plan",
        required: { visionInput: true },
      })
      expect(result).toBeUndefined()
    })

    test("returns diagnostic with alternatives when vision is missing", async () => {
      const model = mockProviders["alibaba-token-plan"].models["qwen3-max-preview"]
      const result = await visualRoutingDiagnostic({
        model,
        providerID: "alibaba-token-plan",
        required: { visionInput: true },
      })
      expect(result).toBeDefined()
      expect(result).toContain("vision_input")
      expect(result).toContain("Suggested vision-capable alternatives")
      expect(result).toContain("qwen3.5-122b")
    })

    test("mentions no models configured when none have vision", async () => {
      mockedProvider.list.mockResolvedValue({
        "text-only": {
          ...mockProviders["openai"],
          id: "text-only",
          models: {
            "text-model": {
              ...mockProviders["openai"].models["gpt-4o"],
              capabilities: {
                ...mockProviders["openai"].models["gpt-4o"].capabilities,
                input: { text: true, audio: false, image: false, video: false, pdf: false },
              },
            },
          },
        },
      } as any)
      const model = mockProviders["alibaba-token-plan"].models["qwen3-max-preview"]
      const result = await visualRoutingDiagnostic({
        model,
        providerID: "alibaba-token-plan",
        required: { visionInput: true },
      })
      expect(result).toContain("No vision-capable models")
    })
  })

  describe("checkVisualRouting", () => {
    test("returns ok when default model supports vision", async () => {
      const visionModel = mockProviders["alibaba-token-plan"].models["qwen3.5-122b"]
      mockedProvider.defaultModel.mockResolvedValue({
        providerID: "alibaba-token-plan" as any,
        modelID: "qwen3.5-122b" as any,
      })
      mockedProvider.getModel.mockResolvedValue(visionModel)

      const result = await checkVisualRouting({ visionInput: true })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.caps.visionInput).toBe(true)
      }
    })

    test("returns diagnostic when default model lacks vision", async () => {
      const textModel = mockProviders["alibaba-token-plan"].models["qwen3-max-preview"]
      mockedProvider.defaultModel.mockResolvedValue({
        providerID: "alibaba-token-plan" as any,
        modelID: "qwen3-max-preview" as any,
      })
      mockedProvider.getModel.mockResolvedValue(textModel)

      const result = await checkVisualRouting({ visionInput: true })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.diagnostic).toContain("vision_input")
        expect(result.diagnostic).toContain("Suggested")
      }
    })

    test("gates on the explicit session model, not the default model", async () => {
      // default model is text-only, but the session runs a vision model
      const textModel = mockProviders["alibaba-token-plan"].models["qwen3-max-preview"]
      const visionModel = mockProviders["openai"].models["gpt-4o"]
      mockedProvider.defaultModel.mockResolvedValue({
        providerID: "alibaba-token-plan" as any,
        modelID: "qwen3-max-preview" as any,
      })
      mockedProvider.getModel.mockImplementation(async (providerID: any, modelID: any) =>
        modelID === "gpt-4o" ? visionModel : textModel,
      )

      const result = await checkVisualRouting(
        { visionInput: true },
        { model: { providerID: "openai" as any, modelID: "gpt-4o" as any } },
      )
      expect(result.ok).toBe(true)
      expect(mockedProvider.getModel).toHaveBeenCalledWith("openai", "gpt-4o")
      expect(mockedProvider.defaultModel).not.toHaveBeenCalled()
    })

    test("fails with a diagnostic when the session model lacks vision even though the default has it", async () => {
      const textModel = mockProviders["alibaba-token-plan"].models["qwen3-max-preview"]
      const visionModel = mockProviders["openai"].models["gpt-4o"]
      mockedProvider.defaultModel.mockResolvedValue({
        providerID: "openai" as any,
        modelID: "gpt-4o" as any,
      })
      mockedProvider.getModel.mockImplementation(async (_providerID: any, modelID: any) =>
        modelID === "gpt-4o" ? visionModel : textModel,
      )

      const result = await checkVisualRouting(
        { visionInput: true },
        { model: { providerID: "alibaba-token-plan" as any, modelID: "qwen3-max-preview" as any } },
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.diagnostic).toContain("vision_input")
      }
    })
  })

  describe("sessionModelFromMessages", () => {
    test("returns the model from the last user message", () => {
      const messages = [
        { info: { role: "user", model: { providerID: "openai", modelID: "gpt-4o" } }, parts: [] },
        { info: { role: "assistant" }, parts: [] },
        { info: { role: "user", model: { providerID: "alibaba-token-plan", modelID: "qwen3.5-122b" } }, parts: [] },
      ] as any
      expect(sessionModelFromMessages(messages)).toEqual({
        providerID: "alibaba-token-plan",
        modelID: "qwen3.5-122b",
      })
    })

    test("returns undefined when no user message is present", () => {
      const messages = [{ info: { role: "assistant" }, parts: [] }] as any
      expect(sessionModelFromMessages(messages)).toBeUndefined()
      expect(sessionModelFromMessages([])).toBeUndefined()
    })
  })
})
