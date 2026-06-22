import { describe, expect, test } from "vitest"

import { resolveAssistantForkSendChoice } from "./assistant-fork"

describe("resolveAssistantForkSendChoice", () => {
  test("prefers source session model context when available", () => {
    expect(
      resolveAssistantForkSendChoice(
        {
          providerID: "source-provider",
          modelID: "source-model",
          agent: "source-agent",
          variant: "source-variant",
        },
        {
          providerID: "current-provider",
          modelID: "current-model",
          agent: "current-agent",
          lastUsedProvider: {
            providerID: "last-provider",
            modelID: "last-model",
          },
        },
      ),
    ).toEqual({
      providerID: "source-provider",
      modelID: "source-model",
      agent: "source-agent",
      variant: "source-variant",
    })
  })

  test("falls back to current and last-used provider choices", () => {
    expect(
      resolveAssistantForkSendChoice(null, {
        providerID: "",
        modelID: null,
        agent: "current-agent",
        lastUsedProvider: {
          providerID: "last-provider",
          modelID: "last-model",
        },
      }),
    ).toEqual({
      providerID: "last-provider",
      modelID: "last-model",
      agent: "current-agent",
      variant: undefined,
    })
  })

  test("does not mix provider and model choices from different sources", () => {
    expect(
      resolveAssistantForkSendChoice(
        {
          providerID: "source-provider",
          agent: "source-agent",
          variant: "source-variant",
        },
        {
          providerID: "current-provider",
          modelID: "",
          agent: "current-agent",
          lastUsedProvider: {
            providerID: "last-provider",
            modelID: "last-model",
          },
        },
      ),
    ).toEqual({
      providerID: "last-provider",
      modelID: "last-model",
      agent: "source-agent",
      variant: undefined,
    })
  })

  test("returns null before creating a session when provider or model is unavailable", () => {
    expect(
      resolveAssistantForkSendChoice({ providerID: "source-provider" }, { modelID: null, lastUsedProvider: null }),
    ).toBeNull()
  })
})
