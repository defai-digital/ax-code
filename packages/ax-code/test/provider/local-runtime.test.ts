import { afterEach, describe, expect, test, vi } from "vitest"
import {
  isLocalInferenceConnection,
  localLlmRuntimePreset,
  localRuntimeEndpointPreset,
  normalizeLocalRuntimeBaseURL,
} from "../../src/provider/local-runtime"

afterEach(() => vi.unstubAllEnvs())

describe("local inference optimization boundary", () => {
  test.each(["ax-engine", "ollama", "lmstudio", "mtplx", "omlx", "ax-studio", "local-llm"])(
    "admits the local %s connection",
    (providerID) => {
      expect(isLocalInferenceConnection({ providerID, baseURL: "http://127.0.0.1:1234/v1" })).toBe(true)
    },
  )

  test.each([
    { providerID: "openai", baseURL: "http://localhost:1234/v1" },
    { providerID: "defai-01-ax-trust-com", baseURL: "http://localhost:1234/v1" },
    { providerID: "ax-trust-local", baseURL: "http://localhost:1234/v1" },
    { providerID: "local-llm", baseURL: "http://localhost:1234/v1", management: "ax-trust" },
    { providerID: "ax-engine", axTrust: true },
    { providerID: "claude-cli", baseURL: "http://localhost:1234/v1" },
    { providerID: "custom-private-gpu", baseURL: "http://localhost:1234/v1" },
    { providerID: "ollama", baseURL: "https://cloud.example.test/v1" },
    { providerID: "lmstudio", baseURL: "http://192.168.1.10:1234/v1" },
    { providerID: "local-llm", baseURL: "invalid" },
    { providerID: "local-llm", baseURL: "file://localhost/model" },
    { providerID: "local-llm" },
  ])("preserves existing behavior for $providerID at $baseURL", (input) => {
    expect(isLocalInferenceConnection(input)).toBe(false)
  })

  test("recognizes IPv6 loopback without requiring an AX Engine URL", () => {
    expect(isLocalInferenceConnection({ providerID: "lmstudio", baseURL: "http://[::1]:1234/v1" })).toBe(true)
    expect(isLocalInferenceConnection({ providerID: "ax-engine" })).toBe(true)
  })
})

describe("local runtime endpoints", () => {
  test("provides the requested local picker labels and endpoint defaults", () => {
    vi.stubEnv("LMSTUDIO_HOST", undefined)
    vi.stubEnv("LOCAL_LLM_HOST", undefined)
    vi.stubEnv("MTPLX_HOST", undefined)
    vi.stubEnv("OMLX_HOST", undefined)
    expect(
      ["ollama", "lmstudio", "mtplx", "omlx", "ax-studio", "local-llm"].map((id) => localLlmRuntimePreset(id)?.label),
    ).toEqual(["Ollama", "LMStudio", "MTPLX", "oMLX", "AX-Studio", "Others"])
    expect(localRuntimeEndpointPreset("lmstudio", {})).toBe("http://localhost:1234")
    expect(localRuntimeEndpointPreset("local-llm", {})).toBe("")
    expect(localRuntimeEndpointPreset("mtplx", {})).toBe("http://localhost:8000")
    expect(localRuntimeEndpointPreset("omlx", {})).toBe("http://localhost:8000")
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

test.each([
  ["mtplx", "MTPLX_HOST"],
  ["omlx", "OMLX_HOST"],
])("%s uses its own host override and saved endpoint", (id, env) => {
  vi.stubEnv(env, "http://localhost:18088")
  expect(localRuntimeEndpointPreset(id, {})).toBe("http://localhost:18088")
  expect(
    localRuntimeEndpointPreset(id, { provider: { [id]: { options: { baseURL: "http://localhost:18089/v1" } } } }),
  ).toBe("http://localhost:18089/v1")
  expect(
    isLocalInferenceConnection({ providerID: id, baseURL: "http://localhost:8000/v1", management: "ax-trust" }),
  ).toBe(false)
  expect(isLocalInferenceConnection({ providerID: id, baseURL: "https://remote.example.test/v1" })).toBe(false)
})
