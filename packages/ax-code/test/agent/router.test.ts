import { afterEach, describe, expect, test } from "bun:test"
import { classifyComplexity } from "../../src/agent/router"

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

  test("returns null complexity when AX_CODE_SMART_LLM is explicitly false", async () => {
    process.env["AX_CODE_SMART_LLM"] = "false"
    const result = await classifyComplexity("explain how this caching layer is supposed to work end to end")
    expect(result.complexity).toBeNull()
  })

  test("treats trivially short messages as low complexity without an LLM call", async () => {
    process.env["AX_CODE_SMART_LLM"] = "true"
    // <30 chars — short-circuits before any provider lookup, so this works without
    // a configured provider in the test environment.
    const result = await classifyComplexity("what is 2+2?")
    expect(result.complexity).toBe("low")
  })

  test("trivially short message bypass also fires when SMART_LLM is on", async () => {
    process.env["AX_CODE_SMART_LLM"] = "true"
    const result = await classifyComplexity("hi")
    expect(result.complexity).toBe("low")
  })
})
