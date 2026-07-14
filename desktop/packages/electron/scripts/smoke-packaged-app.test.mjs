import { describe, expect, test } from "vitest"
import { buildSmokeAppArgs, buildSmokeBundleIdentifier, parseArgs } from "./smoke-packaged-app.mjs"

describe("smoke-packaged-app args", () => {
  test("uses an isolated Electron profile", () => {
    expect(buildSmokeAppArgs({ userDataDir: "/tmp/ax-code-smoke-user-data" })).toEqual([
      "--user-data-dir=/tmp/ax-code-smoke-user-data",
    ])
  })

  test("creates a distinct macOS bundle identifier for each smoke app copy", () => {
    expect(buildSmokeBundleIdentifier("smoke-run-123")).toBe("ai.defai.ax-code-app.smoke.smokerun123")
    expect(() => buildSmokeBundleIdentifier("")).toThrow("smoke run identifier")
  })

  test("requires a temporary Electron profile", () => {
    expect(() => buildSmokeAppArgs({ userDataDir: "" })).toThrow("temporary Electron user-data directory")
  })

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
      skipIfMissing: false,
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
      skipIfMissing: false,
      timeoutMs: 7000,
    })
  })

  test("allows missing packaged apps to be skipped explicitly", () => {
    expect(parseArgs(["--skip-if-missing"], {}).skipIfMissing).toBe(true)
    expect(parseArgs([], { AX_CODE_DESKTOP_SMOKE_SKIP_IF_MISSING: "1" }).skipIfMissing).toBe(true)
  })

  test("falls back when timeout values are invalid", () => {
    expect(parseArgs([], { AX_CODE_DESKTOP_SMOKE_TIMEOUT_MS: "not-a-number" }).timeoutMs).toBe(45_000)
    expect(parseArgs(["--timeout-ms", "0"], { AX_CODE_DESKTOP_SMOKE_TIMEOUT_MS: "12000" }).timeoutMs).toBe(12000)
    expect(parseArgs(["--timeout-ms", "-5"], { AX_CODE_DESKTOP_SMOKE_TIMEOUT_MS: "12000" }).timeoutMs).toBe(12000)
    expect(parseArgs(["--timeout-ms", "bad"], { AX_CODE_DESKTOP_SMOKE_TIMEOUT_MS: "12000" }).timeoutMs).toBe(12000)
    expect(parseArgs(["--timeout-ms", "12000ms"], { AX_CODE_DESKTOP_SMOKE_TIMEOUT_MS: "9000" }).timeoutMs).toBe(9000)
  })
})
