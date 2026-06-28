import { describe, expect, test } from "vitest"
import { parseArgs } from "./smoke-packaged-app.mjs"

describe("smoke-packaged-app args", () => {
  test("uses environment defaults", () => {
    expect(
      parseArgs([], {
        AX_CODE_DESKTOP_SMOKE_APP: "/tmp/AX Code.app",
        AX_CODE_DESKTOP_SMOKE_ARTIFACTS: "/tmp/artifacts",
        AX_CODE_DESKTOP_SMOKE_TIMEOUT_MS: "12000",
      }),
    ).toEqual({
      app: "/tmp/AX Code.app",
      artifacts: "/tmp/artifacts",
      timeoutMs: 12000,
    })
  })

  test("CLI arguments override environment defaults", () => {
    expect(
      parseArgs(["--app", "/tmp/Other.app", "--artifacts", "/tmp/other-artifacts", "--timeout-ms", "7000"], {
        AX_CODE_DESKTOP_SMOKE_APP: "/tmp/AX Code.app",
        AX_CODE_DESKTOP_SMOKE_ARTIFACTS: "/tmp/artifacts",
        AX_CODE_DESKTOP_SMOKE_TIMEOUT_MS: "12000",
      }),
    ).toEqual({
      app: "/tmp/Other.app",
      artifacts: "/tmp/other-artifacts",
      timeoutMs: 7000,
    })
  })

  test("falls back when timeout values are invalid", () => {
    expect(parseArgs([], { AX_CODE_DESKTOP_SMOKE_TIMEOUT_MS: "not-a-number" }).timeoutMs).toBe(45_000)
    expect(parseArgs(["--timeout-ms", "0"], { AX_CODE_DESKTOP_SMOKE_TIMEOUT_MS: "12000" }).timeoutMs).toBe(12000)
    expect(parseArgs(["--timeout-ms", "-5"], { AX_CODE_DESKTOP_SMOKE_TIMEOUT_MS: "12000" }).timeoutMs).toBe(12000)
    expect(parseArgs(["--timeout-ms", "bad"], { AX_CODE_DESKTOP_SMOKE_TIMEOUT_MS: "12000" }).timeoutMs).toBe(12000)
    expect(parseArgs(["--timeout-ms", "12000ms"], { AX_CODE_DESKTOP_SMOKE_TIMEOUT_MS: "9000" }).timeoutMs).toBe(9000)
  })
})
