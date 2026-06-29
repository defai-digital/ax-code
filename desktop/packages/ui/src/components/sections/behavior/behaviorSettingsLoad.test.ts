import { describe, expect, test, vi } from "vitest"

import { API_ENDPOINTS } from "@/lib/http"
import {
  fetchBehaviorSettings,
  normalizeAgentsMdContent,
  sanitizeResponseStylePreset,
} from "./behaviorSettingsLoad"

const jsonResponse = (body: unknown, ok = true): Response =>
  ({
    ok,
    json: vi.fn(async () => body),
  }) as unknown as Response

describe("behaviorSettingsLoad", () => {
  test("uses saved behavior settings when present", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      if (url === API_ENDPOINTS.config.settings) {
        return jsonResponse({
          globalBehaviorPrompt: "Project rules",
          responseStyleEnabled: true,
          responseStylePreset: "custom",
          responseStyleCustomInstructions: "Be direct",
        })
      }
      return jsonResponse({ content: "Fallback rules" })
    })

    await expect(fetchBehaviorSettings({ fetchImpl })).resolves.toEqual({
      prompt: "Project rules",
      responseStyleEnabled: true,
      responseStylePreset: "custom",
      responseStyleCustomInstructions: "Be direct",
    })
  })

  test("falls back to AGENTS.md content when no saved prompt exists", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      if (url === API_ENDPOINTS.config.settings) {
        return jsonResponse({
          responseStyleEnabled: false,
          responseStylePreset: "detailed",
        })
      }
      return jsonResponse({ content: "Fallback rules" })
    })

    await expect(fetchBehaviorSettings({ fetchImpl })).resolves.toMatchObject({
      prompt: "Fallback rules",
      responseStylePreset: "detailed",
    })
  })

  test("normalizes invalid response style presets", () => {
    expect(sanitizeResponseStylePreset("unknown")).toBe("concise")
    expect(sanitizeResponseStylePreset("custom")).toBe("custom")
  })

  test("adds a trailing newline when saving non-empty AGENTS.md content", () => {
    expect(normalizeAgentsMdContent("rules")).toBe("rules\n")
    expect(normalizeAgentsMdContent("rules\n")).toBe("rules\n")
    expect(normalizeAgentsMdContent("")).toBe("")
  })
})
