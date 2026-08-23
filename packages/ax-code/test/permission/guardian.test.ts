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
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  await Instance.disposeAll()
})

function mockModelResolution() {
  vi.mocked(Provider.defaultModel).mockResolvedValue({ providerID: "test", modelID: "test" } as never)
  vi.mocked(Provider.getModel).mockResolvedValue({ id: "test/test" } as never)
  vi.mocked(Provider.getLanguage).mockResolvedValue({} as never)
}

function mockVerdict(action: "allow" | "deny" | "ask") {
  vi.mocked(generateObject).mockResolvedValue({
    object: { action, reason: `mocked ${action}` },
  } as never)
}

// The denial breaker is scoped via Instance.state (ADR-060), so reviews must
// run inside an Instance context — as they do in production (Permission.ask).
async function reviewInInstance(input: Guardian.ReviewInput) {
  await using tmp = await tmpdir({ git: true })
  return Instance.provide({ directory: tmp.path, fn: () => Guardian.review(input) })
}

test("guardian is disabled by default", () => {
  expect(Guardian.enabled()).toBe(false)
})

test("guardian enables via AX_CODE_AUTONOMOUS_GUARDIAN=1", () => {
  vi.stubEnv("AX_CODE_AUTONOMOUS_GUARDIAN", "1")
  expect(Guardian.enabled()).toBe(true)
})

test("review fails closed to ask when provider resolution throws", async () => {
  vi.mocked(Provider.defaultModel).mockRejectedValue(new Error("no models found"))
  const verdict = await reviewInInstance({ permission: "bash", patterns: ["curl https://evil.example"] })
  expect(verdict.action).toBe("ask")
  expect(verdict.reason).toBe("guardian unavailable")
})

test("review maps a deny verdict from the model", async () => {
  mockModelResolution()
  vi.mocked(generateObject).mockResolvedValue({
    object: { action: "deny", reason: "credential exfiltration" },
  } as never)
  const verdict = await reviewInInstance({ permission: "bash", patterns: ["cat ~/.aws/credentials"] })
  expect(verdict.action).toBe("deny")
  expect(verdict.reason).toBe("credential exfiltration")
})

test("review uses the dedicated guardian model override when configured", async () => {
  vi.stubEnv("AX_CODE_AUTONOMOUS_GUARDIAN_MODEL", "openai/gpt-5-mini")
  vi.mocked(Provider.parseModel).mockReturnValue({ providerID: "openai", modelID: "gpt-5-mini" } as never)
  vi.mocked(Provider.getModel).mockResolvedValue({ id: "openai/gpt-5-mini" } as never)
  vi.mocked(Provider.getLanguage).mockResolvedValue({} as never)
  vi.mocked(generateObject).mockResolvedValue({ object: { action: "allow", reason: "safe read" } } as never)

  const verdict = await reviewInInstance({ permission: "bash", patterns: ["ls"] })

  expect(Provider.parseModel).toHaveBeenCalledWith("openai/gpt-5-mini")
  expect(Provider.defaultModel).not.toHaveBeenCalled()
  expect(verdict.action).toBe("allow")
})

test("review retries a transient error exactly once, then fails closed to ask", async () => {
  mockModelResolution()
  const overloaded = Object.assign(new Error("Provider is overloaded"), { statusCode: 503 })
  vi.mocked(generateObject).mockRejectedValue(overloaded)

  const verdict = await reviewInInstance({ permission: "bash", patterns: ["rm -rf /"] })

  expect(generateObject).toHaveBeenCalledTimes(2)
  expect(verdict.action).toBe("ask")
  expect(verdict.reason).toBe("guardian unavailable")
})

test("review retries a transient stream disconnect once and returns the retried verdict", async () => {
  mockModelResolution()
  const disconnect = new Error("response stream disconnected: socket hang up")
  vi.mocked(generateObject).mockRejectedValueOnce(disconnect)
  vi.mocked(generateObject).mockResolvedValueOnce({
    object: { action: "allow", reason: "safe read" },
  } as never)

  const verdict = await reviewInInstance({ permission: "bash", patterns: ["ls"] })

  expect(generateObject).toHaveBeenCalledTimes(2)
  expect(verdict.action).toBe("allow")
})

test("review does not retry non-retryable errors and fails closed to ask", async () => {
  mockModelResolution()
  const auth = Object.assign(new Error("Unauthorized"), { statusCode: 401 })
  vi.mocked(generateObject).mockRejectedValue(auth)

  const verdict = await reviewInInstance({ permission: "bash", patterns: ["ls"] })

  expect(generateObject).toHaveBeenCalledTimes(1)
  expect(verdict.action).toBe("ask")
  expect(verdict.reason).toBe("guardian unavailable")
})

test("guardian timeout fails closed to ask without retrying", async () => {
  mockModelResolution()
  vi.mocked(generateObject).mockImplementation(
    (options) =>
      new Promise((_, reject) => {
        options.abortSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))
      }) as never,
  )

  const verdict = await reviewInInstance({ permission: "bash", patterns: ["ls"], timeoutMs: 25 })

  expect(generateObject).toHaveBeenCalledTimes(1)
  expect(verdict.action).toBe("ask")
  expect(verdict.reason).toBe("guardian timeout")
})

test("denial breaker downgrades the fourth consecutive deny to ask, and a non-denial resets the streak", async () => {
  mockModelResolution()
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const review = () => Guardian.review({ permission: "bash", patterns: ["rm -rf /"] })
      mockVerdict("deny")
      expect((await review()).action).toBe("deny")
      expect((await review()).action).toBe("deny")
      expect((await review()).action).toBe("deny")

      // Fourth consecutive denial: breaker trips, deny downgrades to ask.
      const tripped = await review()
      expect(tripped.action).toBe("ask")
      expect(tripped.reason).toContain("guardian breaker")

      // The breaker keeps downgrading while the model keeps denying.
      expect((await review()).action).toBe("ask")

      // A non-denial verdict resets the streak.
      mockVerdict("allow")
      expect((await review()).action).toBe("allow")

      // The streak restarts from zero after the reset.
      mockVerdict("deny")
      expect((await review()).action).toBe("deny")
      expect((await review()).action).toBe("deny")
      expect((await review()).action).toBe("deny")
      expect((await review()).action).toBe("ask")
    },
  })
})

test("denial breaker state is instance-scoped", async () => {
  mockModelResolution()
  mockVerdict("deny")
  await using first = await tmpdir({ git: true })
  await using second = await tmpdir({ git: true })

  const review = () => Guardian.review({ permission: "bash", patterns: ["rm -rf /"] })

  // Trip the breaker in the first instance.
  await Instance.provide({
    directory: first.path,
    fn: async () => {
      expect((await review()).action).toBe("deny")
      expect((await review()).action).toBe("deny")
      expect((await review()).action).toBe("deny")
      expect((await review()).action).toBe("ask")
    },
  })

  // The second instance has its own window: denials are not downgraded.
  await Instance.provide({
    directory: second.path,
    fn: async () => {
      expect((await review()).action).toBe("deny")
      expect((await review()).action).toBe("deny")
      expect((await review()).action).toBe("deny")
      expect((await review()).action).toBe("ask")
    },
  })
})
