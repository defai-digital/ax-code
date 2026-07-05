import { describe, expect, it, vi } from "vitest"

import { createAxCodeAuthStateRuntime } from "./auth-state-runtime.js"

const createRuntime = ({ userProvidedPassword = null } = {}) => {
  let authPassword = null
  let authSource = null
  const process = { env: {} }
  const syncToHmrState = vi.fn()
  const runtime = createAxCodeAuthStateRuntime({
    crypto: {
      randomBytes: () => Buffer.from("generated-password-32-byte-value!!"),
    },
    process,
    getAuthPassword: () => authPassword,
    setAuthPassword: (value) => {
      authPassword = value
    },
    getAuthSource: () => authSource,
    setAuthSource: (value) => {
      authSource = value
    },
    getUserProvidedPassword: () => userProvidedPassword,
    syncToHmrState,
  })

  return {
    runtime,
    process,
    getAuthPassword: () => authPassword,
    getAuthSource: () => authSource,
    syncToHmrState,
  }
}

describe("ax-code auth state runtime", () => {
  it("trims user-provided passwords before storing auth state", async () => {
    const { runtime, process, getAuthPassword, getAuthSource } = createRuntime({
      userProvidedPassword: " secret ",
    })

    await expect(runtime.ensureLocalAxCodeServerPassword()).resolves.toBe("secret")
    expect(getAuthPassword()).toBe("secret")
    expect(getAuthSource()).toBe("user-env")
    expect(process.env.AX_CODE_SERVER_PASSWORD).toBe("secret")
    expect(runtime.getAxCodeAuthHeaders()).toEqual({
      Authorization: `Basic ${Buffer.from("ax-code:secret").toString("base64")}`,
    })
  })

  it("generates a managed password when user-provided password is blank", async () => {
    const { runtime, getAuthSource } = createRuntime({
      userProvidedPassword: "   ",
    })

    await expect(runtime.ensureLocalAxCodeServerPassword()).resolves.toBeTruthy()
    expect(getAuthSource()).toBe("generated")
    expect(runtime.isAxCodeConnectionSecure()).toBe(true)
  })
})
