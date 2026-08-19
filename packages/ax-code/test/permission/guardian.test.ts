import { afterEach, expect, test, vi } from "vitest"

// Mock the "ai" generateObject and the provider so the guardian can be driven
// deterministically without loading the real provider graph or making network
// calls. Mirrors test/tool/council-tool.test.ts.
vi.mock("ai", () => ({ generateObject: vi.fn() }))

vi.mock("@/provider/provider", () => ({
  Provider: {
    defaultModel: vi.fn(),
    getModel: vi.fn(),
    getLanguage: vi.fn(),
    parseModel: vi.fn(),
  },
}))

import { generateObject } from "ai"
import { Guardian } from "../../src/permission/guardian"
import { Provider } from "../../src/provider/provider"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

test("guardian is disabled by default", () => {
  expect(Guardian.enabled()).toBe(false)
})

test("guardian enables via AX_CODE_AUTONOMOUS_GUARDIAN=1", () => {
  vi.stubEnv("AX_CODE_AUTONOMOUS_GUARDIAN", "1")
  expect(Guardian.enabled()).toBe(true)
})

test("review fails closed to ask when provider resolution throws", async () => {
  vi.mocked(Provider.defaultModel).mockRejectedValue(new Error("no models found"))
  const verdict = await Guardian.review({ permission: "bash", patterns: ["curl https://evil.example"] })
  expect(verdict.action).toBe("ask")
  expect(verdict.reason).toBe("guardian unavailable")
})

test("review maps a deny verdict from the model", async () => {
  vi.mocked(Provider.defaultModel).mockResolvedValue({ providerID: "test", modelID: "test" } as never)
  vi.mocked(Provider.getModel).mockResolvedValue({ id: "test/test" } as never)
  vi.mocked(Provider.getLanguage).mockResolvedValue({} as never)
  vi.mocked(generateObject).mockResolvedValue({
    object: { action: "deny", reason: "credential exfiltration" },
  } as never)
  const verdict = await Guardian.review({ permission: "bash", patterns: ["cat ~/.aws/credentials"] })
  expect(verdict.action).toBe("deny")
  expect(verdict.reason).toBe("credential exfiltration")
})

test("review uses the dedicated guardian model override when configured", async () => {
  vi.stubEnv("AX_CODE_AUTONOMOUS_GUARDIAN_MODEL", "openai/gpt-5-mini")
  vi.mocked(Provider.parseModel).mockReturnValue({ providerID: "openai", modelID: "gpt-5-mini" } as never)
  vi.mocked(Provider.getModel).mockResolvedValue({ id: "openai/gpt-5-mini" } as never)
  vi.mocked(Provider.getLanguage).mockResolvedValue({} as never)
  vi.mocked(generateObject).mockResolvedValue({ object: { action: "allow", reason: "safe read" } } as never)

  const verdict = await Guardian.review({ permission: "bash", patterns: ["ls"] })

  expect(Provider.parseModel).toHaveBeenCalledWith("openai/gpt-5-mini")
  expect(Provider.defaultModel).not.toHaveBeenCalled()
  expect(verdict.action).toBe("allow")
})
