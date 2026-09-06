import { afterEach, describe, expect, test, vi } from "vitest"
import {
  localLlmRuntimePreset,
  localRuntimeEndpointPreset,
  normalizeLocalRuntimeBaseURL,
} from "../../src/provider/local-runtime"

afterEach(() => vi.unstubAllEnvs())

describe("local runtime endpoints", () => {
  test("provides the requested local picker labels and endpoint defaults", () => {
    vi.stubEnv("LMSTUDIO_HOST", undefined)
    vi.stubEnv("LOCAL_LLM_HOST", undefined)
    expect(["ollama", "lmstudio", "ax-studio", "local-llm"].map((id) => localLlmRuntimePreset(id)?.label)).toEqual([
      "Ollama",
      "LMStudio",
      "AX-Studio",
      "Others",
    ])
    expect(localRuntimeEndpointPreset("lmstudio", {})).toBe("http://localhost:1234")
    expect(localRuntimeEndpointPreset("local-llm", {})).toBe("")
  })

  test("uses saved endpoints before environment overrides and presets", () => {
    vi.stubEnv("LMSTUDIO_HOST", "http://localhost:4321")
    expect(localRuntimeEndpointPreset("lmstudio", {})).toBe("http://localhost:4321")
    expect(
      localRuntimeEndpointPreset("lmstudio", {
        provider: { lmstudio: { options: { baseURL: "http://localhost:5678/v1" } } },
      }),
    ).toBe("http://localhost:5678/v1")
  })

  test.each([
    [" localhost:1234 ", "http://localhost:1234/v1"],
    ["http://127.0.0.1:8080/v1/", "http://127.0.0.1:8080/v1"],
    ["http://[::1]:1234", "http://[::1]:1234/v1"],
    ["https://runtime.example.test/api/", "https://runtime.example.test/api/v1"],
  ])("normalizes %s without duplicating the API path", (input, expected) => {
    expect(normalizeLocalRuntimeBaseURL(input)).toBe(expected)
  })

  test.each([
    "",
    "ftp://localhost:1234",
    "http://token@localhost:1234",
    "http://localhost:1234?token=secret",
    "http://localhost:1234#fragment",
  ])("rejects an invalid endpoint before saving: %s", (input) => {
    expect(() => normalizeLocalRuntimeBaseURL(input)).toThrow()
  })
})
