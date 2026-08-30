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

  it("adopts an injected env password over existing state and never rotates it", async () => {
    const { runtime, process, getAuthPassword, getAuthSource } = createRuntime({
      userProvidedPassword: "main-injected-secret",
    })

    // First boot adoption.
    await expect(runtime.ensureLocalAxCodeServerPassword()).resolves.toBe("main-injected-secret")
    expect(getAuthSource()).toBe("user-env")

    // A managed restart (rotateManaged) must keep the injected password —
    // the desktop rotates nothing once Electron main owns the credential.
    await expect(runtime.ensureLocalAxCodeServerPassword({ rotateManaged: true })).resolves.toBe(
      "main-injected-secret",
    )
    expect(getAuthPassword()).toBe("main-injected-secret")
    expect(getAuthSource()).toBe("user-env")
    expect(process.env.AX_CODE_SERVER_PASSWORD).toBe("main-injected-secret")
  })

  it("reuses an existing managed password instead of regenerating (HMR reuse)", async () => {
    const { runtime, getAuthPassword, getAuthSource } = createRuntime()

    const first = await runtime.ensureLocalAxCodeServerPassword()
    // Simulate an HMR reload: same state, no env password, no rotation —
    // the running runtime child must not have its password swapped out.
    const second = await runtime.ensureLocalAxCodeServerPassword()

    expect(second).toBe(first)
    expect(getAuthPassword()).toBe(first)
    expect(getAuthSource()).toBe("generated")
  })
})
