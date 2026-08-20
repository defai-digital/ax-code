import { describe, expect, test } from "vitest"
import { internalBaseUrl, isInternalHostname } from "../../src/util/internal-url"

describe("internal URL identity", () => {
  test("defaults to the AX synthetic hostname", () => {
    expect(internalBaseUrl()).toBe("http://ax-code.internal")
  })

  test("accepts AX and legacy compatibility hostnames", () => {
    expect(isInternalHostname("ax-code.internal")).toBe(true)
    expect(isInternalHostname("opencode.internal")).toBe(true)
    expect(isInternalHostname("legacy-tui.internal")).toBe(false)
  })
})
