import { describe, expect, test, vi } from "vitest"

import { API_ENDPOINTS } from "@/lib/http"
import { loadDefaultsSettings, parseDefaultsSettingsPayload } from "./defaultsSettingsLoad"

const jsonResponse = (body: unknown, ok = true): Response =>
  ({
    ok,
    json: vi.fn(async () => body),
  }) as unknown as Response

describe("defaultsSettingsLoad", () => {
  test("loads trimmed defaults from the runtime settings API first", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ defaultModel: "server/model", defaultVariant: "large", defaultAgent: "server-agent" }),
    )

    await expect(
      loadDefaultsSettings({
        fetchImpl,
        loadRuntimeSettings: vi.fn(async () => ({
          settings: { defaultModel: " openai/gpt-5 ", defaultVariant: " fast ", defaultAgent: " build " },
        })),
      }),
    ).resolves.toEqual({ defaultModel: "openai/gpt-5", defaultVariant: "fast", defaultAgent: "build" })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test("falls back to server settings when runtime settings fail", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ defaultModel: "server/model", defaultVariant: "large", defaultAgent: "server-agent" }),
    )

    await expect(
      loadDefaultsSettings({
        fetchImpl,
        loadRuntimeSettings: vi.fn(async () => {
          throw new Error("runtime unavailable")
        }),
      }),
    ).resolves.toEqual({ defaultModel: "server/model", defaultVariant: "large", defaultAgent: "server-agent" })
    expect(fetchImpl).toHaveBeenCalledWith(
      API_ENDPOINTS.config.settings,
      expect.objectContaining({ method: "GET", headers: { Accept: "application/json" } }),
    )
  })

  test("normalizes unsupported or empty default values", () => {
    expect(parseDefaultsSettingsPayload({ defaultModel: "  ", defaultVariant: 1, defaultAgent: null })).toEqual({
      defaultModel: undefined,
      defaultVariant: undefined,
      defaultAgent: undefined,
    })
    expect(parseDefaultsSettingsPayload(null)).toBeNull()
  })
})
