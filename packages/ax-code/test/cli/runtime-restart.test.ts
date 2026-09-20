import { describe, expect, test } from "vitest"
import { restartRuntimeServer, validateRuntimeRestartPort } from "../../src/cli/cmd/runtime/restart"
import { tmpdir } from "../fixture/fixture"

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

describe("restartRuntimeServer", () => {
  test("rejects an invalid --port even when no managed runtime resolves", async () => {
    await using tmp = await tmpdir()
    await expect(restartRuntimeServer({ directory: tmp.path, port: 0 })).rejects.toThrow(
      "--port must be an integer between 1 and 65535",
    )
  })

  test("falls back to the raw port POST and reports failure when nothing listens", async () => {
    await using tmp = await tmpdir()
    // Port 1 refuses fast; the managed-runtime registry has no record here, so
    // the restart must degrade to the default-port behavior and report failure
    // instead of hanging or throwing.
    await expect(restartRuntimeServer({ directory: tmp.path, port: 1 })).resolves.toBe(false)
  })
})
