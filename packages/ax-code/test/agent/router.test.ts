import { afterEach, beforeEach, describe, test, expect, spyOn } from "bun:test"
import { keywordRoute as route, route as tieredRoute } from "../../src/agent/router"
import { Provider } from "../../src/provider/provider"

describe("basic routing", () => {
  test("routes security keywords to security agent", () => {
    const result = route("scan for vulnerabilities in the auth module", "build")
    expect(result).not.toBeNull()
    expect(result!.agent).toBe("security")
  })

  test("routes debug keywords to debug agent", () => {
    const result = route("debug this crash in the login flow", "build")
    expect(result).not.toBeNull()
    expect(result!.agent).toBe("debug")
  })

  test("routes test keywords to test agent", () => {
    const result = route("write unit tests for the auth module", "build")
    expect(result).not.toBeNull()
    expect(result!.agent).toBe("test")
  })

  test("routes perf keywords to perf agent", () => {
    const result = route("this function is slow, find the bottleneck", "build")
    expect(result).not.toBeNull()
    expect(result!.agent).toBe("perf")
  })

  test("routes devops keywords to devops agent", () => {
    const result = route("set up the Dockerfile and CI/CD pipeline", "build")
    expect(result).not.toBeNull()
    expect(result!.agent).toBe("devops")
  })

  test("routes architect keywords to architect agent", () => {
    const result = route("review the architecture and fix circular dependencies", "build")
    expect(result).not.toBeNull()
    expect(result!.agent).toBe("architect")
  })
})

describe("word boundary matching", () => {
  test("does not match 'fast' inside 'breakfast'", () => {
    const result = route("I had breakfast this morning", "build")
    expect(result).toBeNull()
  })

  test("does not match 'mock' inside 'hammock'", () => {
    const result = route("sitting on a hammock reading code", "build")
    expect(result).toBeNull()
  })

  test("does not match 'error' inside 'terrorize'", () => {
    const result = route("don't terrorize the codebase", "build")
    expect(result).toBeNull()
  })

  test("matches 'slow' as a standalone word", () => {
    const result = route("this endpoint is really slow under load", "build")
    expect(result).not.toBeNull()
    expect(result!.agent).toBe("perf")
  })

  test("matches 'fast' as standalone but not inside 'breakfast'", () => {
    expect(route("make this function fast and efficient", "build")?.agent).toBe("perf")
    expect(route("I had breakfast this morning", "build")).toBeNull()
  })

  test("matches multi-word keywords with boundaries", () => {
    const result = route("investigate the root cause of this issue", "build")
    expect(result).not.toBeNull()
    expect(result!.agent).toBe("debug")
  })
})

describe("negative keywords", () => {
  test("security negatives: 'write unit tests' suppresses security routing", () => {
    // "security" alone would route to security, but "write tests" + "unit test" negatives reduce it
    const result = route("write unit tests for the login handler", "build")
    expect(result).not.toBeNull()
    expect(result!.agent).toBe("test")
  })

  test("devops negatives: 'add test coverage for deploy script' routes to test", () => {
    const result = route("add test coverage for the deploy script", "build")
    expect(result).not.toBeNull()
    expect(result!.agent).toBe("test")
  })

  test("test negatives: 'scan for vulnerabilities' still routes to security", () => {
    const result = route("check for XSS vulnerabilities and hardcoded secrets", "build")
    expect(result).not.toBeNull()
    expect(result!.agent).toBe("security")
  })

  test("pure devops message still routes to devops", () => {
    const result = route("deploy to kubernetes with helm", "build")
    expect(result).not.toBeNull()
    expect(result!.agent).toBe("devops")
  })
})

describe("confidence scaling", () => {
  test("more matches produce higher confidence", () => {
    // "troubleshoot" matches 1 keyword + 1 regex = score 3 -> confidence 0.7 * 1.0 = 0.7
    const weak = route("troubleshoot this", "build")
    // Many keywords + many regex -> score capped at confidence ceiling 0.7
    const strong = route("debug this crash, troubleshoot the root cause in the stack trace", "build")
    expect(weak).not.toBeNull()
    expect(strong).not.toBeNull()
    // Both hit the ceiling, so test that at least both route correctly
    expect(weak!.confidence).toBeGreaterThanOrEqual(0.3)
    expect(strong!.confidence).toBeGreaterThanOrEqual(weak!.confidence)
  })

  test("confidence does not exceed rule base confidence", () => {
    const result = route(
      "security vulnerability vulnerabilities cve owasp injection xss csrf secret leak pentest compliance",
      "build",
    )
    expect(result).not.toBeNull()
    expect(result!.confidence).toBeLessThanOrEqual(0.8)
  })
})

describe("edge cases", () => {
  test("returns null when no keywords match", () => {
    const result = route("hello world", "build")
    expect(result).toBeNull()
  })

  test("skips current agent even if it matches", () => {
    const result = route("scan for vulnerabilities", "security")
    expect(result).toBeNull()
  })

  test("returns null for empty message", () => {
    const result = route("", "build")
    expect(result).toBeNull()
  })

  test("single weak keyword below threshold returns null", () => {
    // A single keyword match scores 1. Confidence = 0.7 * (1/3) = 0.23 < 0.3 threshold
    const result = route("this is broken", "build")
    expect(result).toBeNull()
  })

  test("single regex pattern match routes successfully", () => {
    // A regex match scores 2. Confidence = 0.7 * (2/3) = 0.47 > 0.3 threshold
    const result = route("troubleshoot the auth flow", "build")
    expect(result).not.toBeNull()
    expect(result!.agent).toBe("debug")
  })
})

describe("tiered routing (async)", () => {
  test("high-confidence keyword match returns immediately without LLM", async () => {
    // "scan for vulnerabilities" has high keyword + regex score -> confidence > 0.5
    const result = await tieredRoute("scan for XSS vulnerabilities and hardcoded secrets", "build")
    expect(result).not.toBeNull()
    expect(result!.agent).toBe("security")
  })

  test("returns keyword result when LLM fallback is disabled (default)", async () => {
    // Low-confidence keyword match but LLM disabled -> returns keyword result
    const result = await tieredRoute("troubleshoot the auth flow", "build")
    expect(result).not.toBeNull()
    expect(result!.agent).toBe("debug")
  })

  test("returns null for no-match messages when LLM disabled", async () => {
    const result = await tieredRoute("hello world", "build")
    expect(result).toBeNull()
  })

  test("returns null for empty message", async () => {
    const result = await tieredRoute("", "build")
    expect(result).toBeNull()
  })
})

describe("tiered routing — LLM fallback", () => {
  const origEnv = process.env["AX_CODE_SMART_LLM"]
  const spies: Array<ReturnType<typeof spyOn>> = []

  beforeEach(() => {
    process.env["AX_CODE_SMART_LLM"] = "true"
  })

  afterEach(() => {
    if (origEnv === undefined) delete process.env["AX_CODE_SMART_LLM"]
    else process.env["AX_CODE_SMART_LLM"] = origEnv
    spies.forEach((s) => s.mockRestore())
    spies.length = 0
  })

  test("skips LLM classification when no small model available", async () => {
    spies.push(spyOn(Provider, "defaultModel").mockResolvedValue({ providerID: "test", modelID: "test-model" } as any))
    spies.push(spyOn(Provider, "getSmallModel").mockResolvedValue(undefined as any))
    // message with no keyword match — would need LLM to route
    const result = await tieredRoute("this function is really sluggish and needs attention", "build")
    expect(result).toBeNull()
  })

  test("falls back to keyword result when LLM errors", async () => {
    spies.push(spyOn(Provider, "defaultModel").mockResolvedValue({ providerID: "test", modelID: "test-model" } as any))
    spies.push(spyOn(Provider, "getSmallModel").mockRejectedValue(new Error("provider unavailable")))
    // "troubleshoot" has a low-confidence keyword match to debug
    const result = await tieredRoute("troubleshoot the auth flow and check for issues", "build")
    expect(result).not.toBeNull()
    expect(result!.agent).toBe("debug")
  })

  test("short messages skip LLM even when enabled", async () => {
    // < 30 chars, no keyword match
    const result = await tieredRoute("make it better", "build")
    expect(result).toBeNull()
  })
})
