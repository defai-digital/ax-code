import { describe, expect, test } from "vitest"
import { hasExplicitNetworkBindFlag } from "../../../src/cli/cmd/tui/util/network-flags"

describe("hasExplicitNetworkBindFlag", () => {
  test("detects equals-form bind flags", () => {
    expect(hasExplicitNetworkBindFlag(["bun", "ax-code", "tui", "--port=4096"])).toBe(true)
    expect(hasExplicitNetworkBindFlag(["bun", "ax-code", "tui", "--hostname=0.0.0.0"])).toBe(true)
    expect(hasExplicitNetworkBindFlag(["bun", "ax-code", "tui", "--mdns=true"])).toBe(true)
  })

  test("detects space-form bind flags", () => {
    expect(hasExplicitNetworkBindFlag(["bun", "ax-code", "tui", "--port", "4096"])).toBe(true)
    expect(hasExplicitNetworkBindFlag(["bun", "ax-code", "tui", "--hostname", "0.0.0.0"])).toBe(true)
    expect(hasExplicitNetworkBindFlag(["bun", "ax-code", "tui", "--mdns"])).toBe(true)
  })

  test("ignores absent flags and similar prefixes", () => {
    expect(hasExplicitNetworkBindFlag(["bun", "ax-code", "tui"])).toBe(false)
    expect(hasExplicitNetworkBindFlag(["bun", "ax-code", "tui", "--portable"])).toBe(false)
    expect(hasExplicitNetworkBindFlag(["bun", "ax-code", "tui", "--hostnamefile=hosts"])).toBe(false)
  })

  test("does not treat explicit mdns false forms as network binds", () => {
    expect(hasExplicitNetworkBindFlag(["bun", "ax-code", "tui", "--mdns=false"])).toBe(false)
    expect(hasExplicitNetworkBindFlag(["bun", "ax-code", "tui", "--no-mdns"])).toBe(false)
  })
})
