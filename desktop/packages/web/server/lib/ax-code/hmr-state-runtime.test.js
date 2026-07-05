import { describe, expect, it } from "vitest"

import { createHmrStateRuntime } from "./hmr-state-runtime.js"

const createRuntime = (env = {}) =>
  createHmrStateRuntime({
    globalThisLike: {},
    os: { homedir: () => "/home/user" },
    processLike: { env },
    stateKey: "__ax_code_test_hmr_state__",
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
})
