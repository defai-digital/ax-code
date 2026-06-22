import { describe, expect, test } from "vitest"
import { validateRuntimeRestartPort } from "../../src/cli/cmd/runtime/restart"

describe("validateRuntimeRestartPort", () => {
  test("accepts valid TCP ports", () => {
    expect(validateRuntimeRestartPort(1)).toBe(1)
    expect(validateRuntimeRestartPort(4096)).toBe(4096)
    expect(validateRuntimeRestartPort(65535)).toBe(65535)
  })

  test("rejects invalid restart ports before building the restart URL", () => {
    for (const value of [0, -1, 65536, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "4096", undefined]) {
      expect(() => validateRuntimeRestartPort(value)).toThrow("--port must be an integer between 1 and 65535")
    }
  })
})
