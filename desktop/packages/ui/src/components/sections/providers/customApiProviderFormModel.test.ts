import { describe, expect, test } from "vitest"
import {
  buildCustomApiProviderSubmission,
  createCustomApiProviderDraft,
  newCustomApiProviderModelDraft,
} from "./customApiProviderFormModel"

describe("custom API provider form model", () => {
  test("builds the URL, token, protocol, and model contract", () => {
    const draft = createCustomApiProviderDraft()
    draft.providerID = "company-gateway"
    draft.name = "Company Gateway"
    draft.protocol = "anthropic-compatible"
    draft.baseURL = "https://api.example.com/v1"
    draft.apiToken = " test-token "
    draft.models = [
      {
        ...newCustomApiProviderModelDraft(),
        id: "company-model",
        name: "Company Model",
        contextWindow: "200000",
        outputLimit: "32000",
        toolCall: true,
        reasoning: true,
        attachment: true,
        temperature: false,
      },
    ]

    expect(buildCustomApiProviderSubmission(draft)).toEqual({
      providerID: "company-gateway",
      input: {
        name: "Company Gateway",
        protocol: "anthropic-compatible",
        baseURL: "https://api.example.com/v1",
        allowInsecureHttp: false,
        apiKey: " test-token ",
        models: [
          {
            id: "company-model",
            name: "Company Model",
            contextWindow: 200_000,
            outputLimit: 32_000,
            toolCall: true,
            reasoning: true,
            attachment: true,
            temperature: false,
          },
        ],
      },
    })
  })

  test("keeps an existing token when the update field is blank", () => {
    const draft = createCustomApiProviderDraft({
      providerID: "company-gateway",
      name: "Company Gateway",
      protocol: "openai-compatible",
      baseURL: "https://api.example.com/v1",
      hasApiKey: true,
      models: [
        {
          id: "model",
          name: "Model",
          contextWindow: 128_000,
          outputLimit: 16_384,
          toolCall: true,
          reasoning: false,
          attachment: false,
          temperature: true,
        },
      ],
    })

    expect(buildCustomApiProviderSubmission(draft).input).not.toHaveProperty("apiKey")
  })

  test("requires explicit acknowledgement for remote HTTP", () => {
    const draft = createCustomApiProviderDraft()
    draft.providerID = "remote-http"
    draft.name = "Remote HTTP"
    draft.baseURL = "http://10.0.0.5/v1"
    draft.apiToken = "token"
    draft.models = [{ ...newCustomApiProviderModelDraft(), id: "model" }]

    expect(() => buildCustomApiProviderSubmission(draft)).toThrow("Confirm insecure HTTP")
    draft.allowInsecureHttp = true
    expect(buildCustomApiProviderSubmission(draft).input.allowInsecureHttp).toBe(true)
  })

  test("rejects duplicate models and unsafe model limits", () => {
    const draft = createCustomApiProviderDraft()
    draft.providerID = "duplicate-models"
    draft.name = "Duplicate Models"
    draft.baseURL = "https://api.example.com/v1"
    draft.models = [
      { ...newCustomApiProviderModelDraft(), id: "model" },
      { ...newCustomApiProviderModelDraft(), id: "model" },
    ]
    expect(() => buildCustomApiProviderSubmission(draft)).toThrow("Duplicate model ID")

    draft.models = [{ ...newCustomApiProviderModelDraft(), id: "model", contextWindow: "10", outputLimit: "11" }]
    expect(() => buildCustomApiProviderSubmission(draft)).toThrow("cannot exceed its context window")
  })

  test("derives name and ID from the base URL and omits empty models", () => {
    const draft = createCustomApiProviderDraft()
    draft.baseURL = "https://llm.example.com/v1"
    draft.apiToken = "token"
    expect(buildCustomApiProviderSubmission(draft)).toEqual({
      providerID: "llm-example-com",
      input: {
        name: "llm.example.com",
        protocol: "openai-compatible",
        baseURL: "https://llm.example.com/v1",
        allowInsecureHttp: false,
        apiKey: "token",
      },
    })
  })
})
