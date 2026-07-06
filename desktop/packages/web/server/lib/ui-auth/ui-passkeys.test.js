import fs from "fs"
import os from "os"
import path from "path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@simplewebauthn/server", () => ({
  generateAuthenticationOptions: vi.fn(async () => ({ challenge: "auth-challenge" })),
  generateRegistrationOptions: vi.fn(async () => ({ challenge: "registration-challenge" })),
  verifyAuthenticationResponse: vi.fn(async () => ({
    verified: true,
    authenticationInfo: { newCounter: 2 },
  })),
  verifyRegistrationResponse: vi.fn(async () => ({
    verified: true,
    registrationInfo: {
      credential: {
        id: "credential-id",
        publicKey: Uint8Array.from([1, 2, 3]),
        counter: 1,
        transports: ["internal"],
      },
      credentialDeviceType: "singleDevice",
      credentialBackedUp: false,
    },
  })),
}))

const simpleWebAuthn = await import("@simplewebauthn/server")
const { createUiPasskeys } = await import("./ui-passkeys.js")
const { createMockRequest } = await import("../../test-helpers/route-harness.js")

describe("ui passkeys", () => {
  let tempRoot
  let storeFile

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ax-code-ui-passkeys-"))
    storeFile = path.join(tempRoot, "ui-passkeys.json")
    vi.clearAllMocks()
  })

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  })

  it("stores passkeys in a private directory and file", () => {
    if (process.platform === "win32") {
      return
    }

    storeFile = path.join(tempRoot, "nested", "ui-passkeys.json")
    const passkeys = createUiPasskeys({
      passwordBinding: "password-binding",
      readSettingsFromDiskMigrated: async () => ({}),
      storeFile,
    })

    passkeys.getStatus(createMockRequest({ host: "localhost:3000" }))

    expect(fs.statSync(path.dirname(storeFile)).mode & 0o777).toBe(0o700)
    expect(fs.statSync(storeFile).mode & 0o777).toBe(0o600)
  })

  it("loads an existing passkey store without a preflight existence check", () => {
    const stored = {
      version: 1,
      userID: Buffer.from("user").toString("base64url"),
      passwordBinding: "password-binding",
      passkeys: [
        {
          id: "credential-id",
          publicKey: Buffer.from([1, 2, 3]).toString("base64url"),
          counter: 1,
          transports: ["internal"],
          deviceType: "singleDevice",
          backedUp: false,
          createdAt: 1,
          lastUsedAt: null,
          label: "Laptop",
          rpID: "localhost",
        },
      ],
    }
    fs.writeFileSync(storeFile, `${JSON.stringify(stored, null, 2)}\n`, "utf8")
    const existsSync = vi.spyOn(fs, "existsSync").mockImplementation((candidate) => {
      if (candidate === storeFile) {
        return false
      }
      return false
    })
    const passkeys = createUiPasskeys({
      passwordBinding: "password-binding",
      readSettingsFromDiskMigrated: async () => ({}),
      storeFile,
    })

    try {
      expect(passkeys.listPasskeys(createMockRequest({ host: "localhost:3000" }))).toEqual([
        {
          id: "credential-id",
          label: "Laptop",
          createdAt: 1,
          lastUsedAt: null,
          deviceType: "singleDevice",
          backedUp: false,
        },
      ])
      expect(JSON.parse(fs.readFileSync(storeFile, "utf8"))).toEqual(stored)
    } finally {
      existsSync.mockRestore()
    }
  })

  it("normalizes request origins before WebAuthn verification", async () => {
    const passkeys = createUiPasskeys({
      passwordBinding: "password-binding",
      readSettingsFromDiskMigrated: async () => ({}),
      storeFile,
    })

    const registration = await passkeys.beginRegistration(createMockRequest({ host: "LOCALHOST:3000" }))
    await passkeys.finishRegistration({
      requestId: registration.requestId,
      response: { id: "credential-id" },
    })

    expect(simpleWebAuthn.verifyRegistrationResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedOrigin: ["http://localhost:3000"],
        expectedRPID: ["localhost"],
      }),
    )
  })

  it("uses forwarded host and protocol for WebAuthn expectations", async () => {
    const passkeys = createUiPasskeys({
      passwordBinding: "password-binding",
      readSettingsFromDiskMigrated: async () => ({}),
      storeFile,
    })

    const registration = await passkeys.beginRegistration(
      createMockRequest({
        host: "internal.local:3902",
        forwardedHost: "desktop.example.com",
        forwardedProto: "https",
      }),
    )
    await passkeys.finishRegistration({
      requestId: registration.requestId,
      response: { id: "credential-id" },
    })

    expect(simpleWebAuthn.verifyRegistrationResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedOrigin: ["https://desktop.example.com"],
        expectedRPID: ["desktop.example.com"],
      }),
    )
  })

  it("trims passkey ids before revoking them", async () => {
    const passkeys = createUiPasskeys({
      passwordBinding: "password-binding",
      readSettingsFromDiskMigrated: async () => ({}),
      storeFile,
    })
    const req = createMockRequest({ host: "localhost:3000" })

    const registration = await passkeys.beginRegistration(req)
    await passkeys.finishRegistration({
      requestId: registration.requestId,
      response: { id: "credential-id" },
    })

    expect(passkeys.revokePasskey(req, " credential-id ")).toMatchObject({
      revoked: true,
      passkeyCount: 0,
    })
    expect(passkeys.listPasskeys(req)).toEqual([])
  })
})
