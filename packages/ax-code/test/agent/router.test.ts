import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { route, classifyComplexity } from "../../src/agent/router"

describe("v2-style keyword route", () => {
  test("schema descriptions do not claim specialist auto-routing is removed", async () => {
    const schema = await Bun.file(path.join(import.meta.dir, "../../src/config/schema.ts")).text()
    const promptInput = await Bun.file(path.join(import.meta.dir, "../../src/session/prompt-input.ts")).text()

    expect(schema).toContain("Disable automatic specialist agent routing")
    expect(schema).toContain("Specialist agent auto-routing and message-complexity routing settings")
    expect(schema).not.toContain("Agent auto-routing was removed")
    expect(promptInput).not.toContain("Agent auto-routing was removed")
  })

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

  test("word-aware matching accepts explicit plural / suffixed keywords", () => {
    expect(route("dependencies are tangled, refactor the architecture", "build")?.agent).toBe("architect")
    expect(route("there are vulnerabilities in our auth", "build")?.agent).toBe("security")
  })

  test("does not route review feedback to debug just because debug terms are mentioned", () => {
    expect(
      route(
        "some user feedback says auto agent switch is not working well; when they ask for review they see debug; please review whether this is real",
        "build",
      ),
    ).toBeNull()
    expect(route("please review this change; it is not working very well", "build")).toBeNull()
  })

  test("does not substring-match debug keywords inside other words", () => {
    expect(route("the status chip showed debug when the user asked for review", "build")).toBeNull()
  })

  test("routes explicit debug commands without requiring an error keyword", () => {
    expect(route("debug the login flow", "build")?.agent).toBe("debug")
    expect(route("please debug this behavior", "build")?.agent).toBe("debug")
    expect(route("can you please debug the login flow", "build")?.agent).toBe("debug")
    expect(route("could you debug the login flow", "build")?.agent).toBe("debug")
  })

  test("routes common debug failure plurals and timeout asks", () => {
    expect(route("find the bugs in the parser", "build")?.agent).toBe("debug")
    expect(route("diagnose the auth timeout", "build")?.agent).toBe("debug")
  })

  test("routes concrete not-working failures to debug without reviving review-feedback false positives", () => {
    expect(route("the app does not work", "build")?.agent).toBe("debug")
    expect(route("the service is not working", "build")?.agent).toBe("debug")
    expect(route("login does not work", "build")?.agent).toBe("debug")
    expect(route("the CLI command does not run", "build")?.agent).toBe("debug")
    expect(
      route(
        "some user feedback says auto agent switch is not working well; when they ask for review they see debug; please review whether this is real",
        "build",
      ),
    ).toBeNull()
  })

  test("keeps development-feature wording on the current agent instead of devops", () => {
    expect(route("fix the deployment button in the dev UI", "build")).toBeNull()
    expect(route("implement the developer workflow for local dev", "build")).toBeNull()
  })

  test("still routes explicit deployment operations to devops", () => {
    expect(route("deploy the service to prod", "build")?.agent).toBe("devops")
    expect(route("set up the Dockerfile and CI/CD pipeline", "build")?.agent).toBe("devops")
  })

  test("routes failing-test maintenance to the test agent", () => {
    expect(route("fix the failing test", "build")?.agent).toBe("test")
    expect(route("the tests are failing", "build")?.agent).toBe("test")
    expect(route("the tests do not pass", "build")?.agent).toBe("test")
    expect(route("tests are not passing", "build")?.agent).toBe("test")
  })

  test("routes concrete build failures to debug", () => {
    expect(route("the build fails", "build")?.agent).toBe("debug")
    expect(route("the build failed after the change", "build")?.agent).toBe("debug")
    expect(route("the build does not pass", "build")?.agent).toBe("debug")
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
