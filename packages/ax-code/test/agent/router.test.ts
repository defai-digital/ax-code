import { afterEach, describe, expect, test } from "bun:test"
import { route, classifyComplexity } from "../../src/agent/router"

describe("v2-style keyword route", () => {
  test("routes obvious specialist topics on bare keywords", () => {
    expect(route("scan for vulnerabilities in the auth module", "build")?.agent).toBe("security")
    expect(route("debug this crash in the login flow", "build")?.agent).toBe("debug")
    expect(route("write unit tests for the auth module", "build")?.agent).toBe("test")
    expect(route("set up the Dockerfile and CI/CD pipeline", "build")?.agent).toBe("devops")
    expect(route("review the architecture and dependency graph", "build")?.agent).toBe("architect")
    expect(route("the dashboard has a major performance bottleneck", "build")?.agent).toBe("perf")
  })

  test("routes mixed analyze-and-fix asks (no negative-keyword blockers)", () => {
    // v3+ blocked these via ACTION_INTENT negatives. v2 didn't, and neither do we.
    expect(route("fix the security vulnerability in login", "build")?.agent).toBe("security")
    expect(route("improve the performance of this hot path", "build")?.agent).toBe("perf")
    expect(route("refactor the architecture of this module", "build")?.agent).toBe("architect")
  })

  test("returns null when no keyword scores high enough", () => {
    expect(route("hello world", "build")).toBeNull()
    expect(route("can you help me with something", "build")).toBeNull()
    expect(route("", "build")).toBeNull()
  })

  test("skips the current agent so we never self-route", () => {
    expect(route("scan for vulnerabilities in the auth module", "security")).toBeNull()
    expect(route("debug this crash", "debug")).toBeNull()
  })

  test("substring matching is intentional — accepts plural / suffixed forms", () => {
    expect(route("dependencies are tangled, refactor the architecture", "build")?.agent).toBe("architect")
    expect(route("there are vulnerabilities in our auth", "build")?.agent).toBe("security")
  })

  test("multi-rule message picks the highest-confidence specialist", () => {
    // perf rule matches more keywords + patterns than test rule, so perf wins.
    const result = route("write a performance benchmark test", "build")
    expect(result?.agent).toBe("perf")
  })
})

describe("classifyComplexity activation gating", () => {
  const origEnv = process.env["AX_CODE_SMART_LLM"]

  afterEach(() => {
    if (origEnv === undefined) delete process.env["AX_CODE_SMART_LLM"]
    else process.env["AX_CODE_SMART_LLM"] = origEnv
  })

  test("returns null complexity when AX_CODE_SMART_LLM is unset", async () => {
    delete process.env["AX_CODE_SMART_LLM"]
    const result = await classifyComplexity("explain how this caching layer is supposed to work end to end")
    expect(result.complexity).toBeNull()
  })

  test("treats trivially short messages as low complexity without an LLM call", async () => {
    process.env["AX_CODE_SMART_LLM"] = "true"
    const result = await classifyComplexity("what is 2+2?")
    expect(result.complexity).toBe("low")
  })
})
