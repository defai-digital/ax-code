import { describe, expect, it, vi } from "vitest"

import { createHmrStateRuntime } from "./hmr-state-runtime.js"

const createRuntime = (env = {}, { logger } = {}) =>
  createHmrStateRuntime({
    globalThisLike: {},
    os: { homedir: () => "/home/user" },
    processLike: { env },
    stateKey: "__ax_code_test_hmr_state__",
    ...(logger ? { logger } : {}),
  })

describe("hmr state runtime", () => {
  it("trims the initial user-provided server password", () => {
    const runtime = createRuntime({ AX_CODE_SERVER_PASSWORD: " secret " })
    const state = runtime.getOrCreateHmrState()

    runtime.ensureUserProvidedAxCodePassword(state)

    expect(state.userProvidedAxCodePassword).toBe("secret")
    expect(runtime.getUserProvidedAxCodePassword(state)).toBe("secret")
  })

  it("preserves an existing user-provided password state", () => {
    const runtime = createRuntime({ AX_CODE_SERVER_PASSWORD: "new-secret" })
    const state = { userProvidedAxCodePassword: " existing-secret " }

    runtime.ensureUserProvidedAxCodePassword(state)

    expect(state.userProvidedAxCodePassword).toBe(" existing-secret ")
    expect(runtime.getUserProvidedAxCodePassword(state)).toBe("existing-secret")
  })

  it("falls back to user auth source when state auth is blank", () => {
    const runtime = createRuntime()

    expect(
      runtime.resolveAxCodeAuthFromState({
        hmrState: {
          axCodeAuthPassword: "   ",
          axCodeAuthSource: "",
        },
        userProvidedAxCodePassword: "user-secret",
      }),
    ).toEqual({
      axCodeAuthPassword: "user-secret",
      axCodeAuthSource: "user-env",
    })
  })

  it("prefers the env password over a conflicting HMR-state password and warns without logging it", () => {
    const logger = { warn: vi.fn() }
    const runtime = createRuntime({}, { logger })

    expect(
      runtime.resolveAxCodeAuthFromState({
        hmrState: {
          axCodeAuthPassword: "stale-hmr-secret",
          axCodeAuthSource: "generated",
        },
        userProvidedAxCodePassword: "env-secret",
      }),
    ).toEqual({
      axCodeAuthPassword: "env-secret",
      axCodeAuthSource: "user-env",
    })
    expect(logger.warn).toHaveBeenCalledTimes(1)
    const warning = logger.warn.mock.calls[0][0]
    expect(warning).not.toContain("stale-hmr-secret")
    expect(warning).not.toContain("env-secret")
  })

  it("does not warn when HMR state and env hold the same password", () => {
    const logger = { warn: vi.fn() }
    const runtime = createRuntime({}, { logger })

    expect(
      runtime.resolveAxCodeAuthFromState({
        hmrState: {
          axCodeAuthPassword: "env-secret",
          axCodeAuthSource: "user-env",
        },
        userProvidedAxCodePassword: "env-secret",
      }),
    ).toEqual({
      axCodeAuthPassword: "env-secret",
      axCodeAuthSource: "user-env",
    })
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it("keeps the HMR-state password when no env password is present (standalone mode)", () => {
    const logger = { warn: vi.fn() }
    const runtime = createRuntime({}, { logger })

    expect(
      runtime.resolveAxCodeAuthFromState({
        hmrState: {
          axCodeAuthPassword: "generated-secret",
          axCodeAuthSource: "generated",
        },
        userProvidedAxCodePassword: null,
      }),
    ).toEqual({
      axCodeAuthPassword: "generated-secret",
      axCodeAuthSource: "generated",
    })
    expect(logger.warn).not.toHaveBeenCalled()
  })
})
