import { describe, expect, test, vi } from "vitest"
import { sanitizeAxCodeEnv } from "./sanitize-env"
import { Isolation } from "../../src/isolation"

describe("sanitizeAxCodeEnv", () => {
  test("deletes inherited AX_CODE_* flags and the bare AX_CODE marker, preserves the opt-in profiling switch", () => {
    const env: NodeJS.ProcessEnv = {
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      AX_CODE: "1",
      AX_CODE_PID: "44165",
      AX_CODE_ORIGINAL_CWD: "/some/cwd",
      AX_CODE_ISOLATION_MODE: "full-access",
      AX_CODE_ISOLATION_NETWORK: "true",
      AX_CODE_AUTONOMOUS: "true",
      AX_CODE_SUPER_LONG: "false",
      AX_CODE_SMART_LLM: "false",
      AX_CODE_NATIVE_RENDER: "0",
      AX_CODE_TEST_HOME: "/stale/host/home",
      AX_CODE_PROFILE_NATIVE: "1",
    }

    const deleted = sanitizeAxCodeEnv(env)

    expect(deleted.sort()).toEqual([
      "AX_CODE",
      "AX_CODE_AUTONOMOUS",
      "AX_CODE_ISOLATION_MODE",
      "AX_CODE_ISOLATION_NETWORK",
      "AX_CODE_NATIVE_RENDER",
      "AX_CODE_ORIGINAL_CWD",
      "AX_CODE_PID",
      "AX_CODE_SMART_LLM",
      "AX_CODE_SUPER_LONG",
      "AX_CODE_TEST_HOME",
    ])
    // AX_CODE_TEST_* is not preserved: preload.ts re-asserts the per-PID
    // values after sanitization, so a stale host value must not survive.
    expect(env).toEqual({
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      AX_CODE_PROFILE_NATIVE: "1",
    })
  })

  test("is a no-op on a clean environment", () => {
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin" }
    expect(sanitizeAxCodeEnv(env)).toEqual([])
    expect(env).toEqual({ PATH: "/usr/bin" })
  })

  test("AX_CODE_ISOLATION_MODE intentionally overrides config — the reason this sanitizer exists", () => {
    // Contract test: env-over-config is deliberate product behavior (the
    // --sandbox CLI flag sets the env in yargs middleware). It is why the
    // suite must strip inherited AX_CODE_* flags — otherwise tests running
    // inside an ax-code session silently inherit its isolation policy.
    const previous = process.env.AX_CODE_ISOLATION_MODE
    process.env.AX_CODE_ISOLATION_MODE = "full-access"
    try {
      const state = Isolation.resolve({ mode: "read-only", network: false }, "/tmp/sanitize-env-test")
      expect(state.mode).toBe("full-access")
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_ISOLATION_MODE
      else process.env.AX_CODE_ISOLATION_MODE = previous
    }
  })

  test("evaluating vitest.config.ts sanitizes the coordinator environment", async () => {
    process.env.AX_CODE = "1"
    process.env.AX_CODE_ISOLATION_MODE = "full-access"
    process.env.AX_CODE_AUTONOMOUS = "true"
    process.env.AX_CODE_PROFILE_NATIVE = "1"
    vi.resetModules()
    try {
      await import("../../vitest.config")
      expect(process.env.AX_CODE).toBeUndefined()
      expect(process.env.AX_CODE_ISOLATION_MODE).toBeUndefined()
      expect(process.env.AX_CODE_AUTONOMOUS).toBeUndefined()
      expect(process.env.AX_CODE_PROFILE_NATIVE).toBe("1")
    } finally {
      vi.resetModules()
      delete process.env.AX_CODE
      delete process.env.AX_CODE_ISOLATION_MODE
      delete process.env.AX_CODE_AUTONOMOUS
      delete process.env.AX_CODE_PROFILE_NATIVE
    }
  })
})
