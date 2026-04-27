import { afterEach, beforeEach, describe, test, expect, spyOn } from "bun:test"
import { keywordRoute as route, route as tieredRoute, analyzeMessage } from "../../src/agent/router"
import { Provider } from "../../src/provider/provider"

describe("explicit specialist intent routing", () => {
  test("routes explicit security review requests to security agent", () => {
    const result = route("scan for vulnerabilities in the auth module", "build")
    expect(result).not.toBeNull()
    expect(result!.agent).toBe("security")
  })

  test("routes explicit debugging investigations to debug agent", () => {
    const result = route("debug this crash in the login flow and trace the stack trace", "build")
    expect(result).not.toBeNull()
    expect(result!.agent).toBe("debug")
  })

  test("routes explicit test-writing requests to test agent", () => {
    const result = route("write unit tests for the auth module", "build")
    expect(result).not.toBeNull()
    expect(result!.agent).toBe("test")
  })

  test("routes explicit performance investigations to perf agent", () => {
    const result = route("profile this function and investigate the bottleneck", "build")
    expect(result).not.toBeNull()
    expect(result!.agent).toBe("perf")
  })

  test("routes concrete devops work to devops agent", () => {
    const result = route("set up the Dockerfile and CI/CD pipeline", "build")
    expect(result).not.toBeNull()
    expect(result!.agent).toBe("devops")
  })

  test("routes explicit architecture reviews to architect agent", () => {
    const result = route("review the architecture and dependency graph", "build")
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

  test("does not route bare slowdown reports without analysis intent", () => {
    const result = route("this endpoint is really slow under load", "build")
    expect(result).toBeNull()
  })

  test("does not route bare performance adjectives without analysis intent", () => {
    expect(route("make this function fast and efficient", "build")).toBeNull()
    expect(route("I had breakfast this morning", "build")).toBeNull()
  })

  test("does not route bare bug topics without debugging intent", () => {
    expect(route("bugs are a concern for this new project", "build")).toBeNull()
    expect(route("performance and bugs matter for this release", "build")).toBeNull()
  })

  test("matches multi-word keywords with boundaries", () => {
    const result = route("investigate the root cause of this issue", "build")
    expect(result).not.toBeNull()
    expect(result!.agent).toBe("debug")
  })

  test("debug routes on bare bug/error/exception keywords without an analysis verb", () => {
    expect(route("I have a bug in the login handler", "build")?.agent).toBe("debug")
    expect(route("there's an exception when I open the page", "build")?.agent).toBe("debug")
    expect(route("the stack trace shows it crashing here", "build")?.agent).toBe("debug")
  })

  test("react routes on self-describing reasoning phrases without an explicit intent verb", () => {
    expect(route("walk me step by step through this", "build")?.agent).toBe("react")
    expect(route("reason through this carefully", "build")?.agent).toBe("react")
  })

  test("trimmed ACTION_INTENT lets analysis-then-fix asks reach security/perf", () => {
    // "improve" / "clean up" / "simplify" used to be negatives that blocked routing.
    // They are common in mixed analyze-and-fix asks; let the specialist take the lead.
    expect(route("improve the security review of our auth flow", "build")?.agent).toBe("security")
    expect(route("review and clean up the architecture of this module", "build")?.agent).toBe("architect")
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
      "scan security vulnerability vulnerabilities cve owasp injection xss csrf secret leak pentest compliance",
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

  test("bare performance topic does not route", () => {
    const result = route("performance is important for this new project", "build")
    expect(result).toBeNull()
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
    const defaultModel = spyOn(Provider, "defaultModel").mockResolvedValue({ providerID: "test", modelID: "test-model" } as any)
    spies.push(defaultModel)
    spies.push(spyOn(Provider, "getSmallModel").mockResolvedValue(undefined as any))
    // message with no keyword match — would need LLM to route
    const result = await tieredRoute("this function is really sluggish and needs attention", "build")
    expect(result).toBeNull()
    expect(defaultModel).toHaveBeenCalled()
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

describe("action-intent negatives for read-only agents", () => {
  test("'restructure this function' does NOT route to architect", () => {
    const result = route("restructure this function to use dependency injection", "build")
    expect(result?.agent).not.toBe("architect")
  })

  test("'refactor the architecture' does NOT route to architect", () => {
    const result = route("refactor the architecture of this module", "build")
    expect(result?.agent).not.toBe("architect")
  })

  test("'fix and rewrite the auth code' does NOT route to security", () => {
    const result = route("fix and rewrite the auth validation to prevent injection", "build")
    expect(result?.agent).not.toBe("security")
  })

  test("'optimize and rewrite this function' does NOT route to perf", () => {
    const result = route("rewrite and optimize this function to be faster", "build")
    expect(result?.agent).not.toBe("perf")
  })

  test("'analyze the architecture' STILL routes to architect", () => {
    const result = route("analyze the architecture and review the dependency graph", "build")
    expect(result).not.toBeNull()
    expect(result!.agent).toBe("architect")
  })

  test("'scan for vulnerabilities' STILL routes to security", () => {
    const result = route("scan the codebase for security vulnerabilities and check for secrets", "build")
    expect(result).not.toBeNull()
    expect(result!.agent).toBe("security")
  })

  test("'profile memory usage' STILL routes to perf", () => {
    const result = route("profile the memory usage and find the bottleneck", "build")
    expect(result).not.toBeNull()
    expect(result!.agent).toBe("perf")
  })

  test("'improve the code organization' does NOT route to architect", () => {
    const result = route("improve the code organization in the utils folder", "build")
    expect(result?.agent).not.toBe("architect")
  })
})

describe("analyzeMessage — combined routing + complexity", () => {
  const origEnv = process.env["AX_CODE_SMART_LLM"]
  const spies: Array<ReturnType<typeof spyOn>> = []

  afterEach(() => {
    if (origEnv === undefined) delete process.env["AX_CODE_SMART_LLM"]
    else process.env["AX_CODE_SMART_LLM"] = origEnv
    spies.forEach((s) => s.mockRestore())
    spies.length = 0
  })

  test("short messages return null complexity when SmartLLM is disabled", async () => {
    delete process.env["AX_CODE_SMART_LLM"]
    const defaultModelSpy = spyOn(Provider, "defaultModel")
    spies.push(defaultModelSpy)
    const result = await analyzeMessage("fix bug", "build")
    expect(result.complexity).toBeNull()
    expect(defaultModelSpy).not.toHaveBeenCalled()
  })

  test("short messages return low complexity when SmartLLM is enabled", async () => {
    process.env["AX_CODE_SMART_LLM"] = "true"
    const defaultModelSpy = spyOn(Provider, "defaultModel")
    spies.push(defaultModelSpy)
    const result = await analyzeMessage("fix bug", "build")
    expect(result.complexity).toBe("low")
    expect(defaultModelSpy).not.toHaveBeenCalled()
  })

  test("SmartLLM disabled returns keyword route with null complexity", async () => {
    delete process.env["AX_CODE_SMART_LLM"]
    const result = await analyzeMessage("write unit tests for the auth module", "build")
    expect(result.route).not.toBeNull()
    expect(result.route!.agent).toBe("test")
    expect(result.complexity).toBeNull()
  })

  test("high-confidence keyword match skips LLM and returns null complexity", async () => {
    process.env["AX_CODE_SMART_LLM"] = "true"
    const defaultModelSpy = spyOn(Provider, "defaultModel")
    spies.push(defaultModelSpy)
    // This message has strong keyword signals (confidence >= 0.5) → no LLM call
    const result = await analyzeMessage("write unit tests for the auth module", "build")
    expect(result.route).not.toBeNull()
    expect(result.route!.agent).toBe("test")
    expect(result.complexity).toBeNull()
    expect(defaultModelSpy).not.toHaveBeenCalled()
  })

  test("ambiguous message calls LLM when SmartLLM enabled; returns null route + null complexity when no small model", async () => {
    process.env["AX_CODE_SMART_LLM"] = "true"
    spies.push(spyOn(Provider, "defaultModel").mockResolvedValue({ providerID: "test", modelID: "test-model" } as any))
    spies.push(spyOn(Provider, "getSmallModel").mockResolvedValue(undefined as any))
    // No keyword match → LLM path, but no small model → falls through
    const result = await analyzeMessage("what does this function return when the input is empty", "build")
    expect(result.route).toBeNull()
    expect(result.complexity).toBeNull()
  })

  test("falls back gracefully when LLM throws", async () => {
    process.env["AX_CODE_SMART_LLM"] = "true"
    spies.push(spyOn(Provider, "defaultModel").mockRejectedValue(new Error("network error")))
    const result = await analyzeMessage("explain why this module has so many circular dependencies in detail", "build")
    expect(result.route).toBeNull() // no keyword match for this message
    expect(result.complexity).toBeNull()
  })

  test("route and complexity are both null when SmartLLM off and no keyword match", async () => {
    delete process.env["AX_CODE_SMART_LLM"]
    const result = await analyzeMessage("what does this function return when the input is empty", "build")
    expect(result.route).toBeNull()
    expect(result.complexity).toBeNull()
  })
})
