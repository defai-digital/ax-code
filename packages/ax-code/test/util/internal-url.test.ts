import { describe, expect, test } from "vitest"
import { internalBaseUrl, isInternalHostname } from "../../src/util/internal-url"

describe("internal URL identity", () => {
  test("defaults to the AX synthetic hostname", () => {
    expect(internalBaseUrl()).toBe("http://ax-code.internal")
  })

  test("accepts AX and compatibility hostnames but not the retired TUI hostname", () => {
    expect(isInternalHostname("ax-code.internal")).toBe(true)
    expect(isInternalHostname("opencode.internal")).toBe(true)
    expect(isInternalHostname("opentui.internal")).toBe(false)
  })
})
