import fs from "fs"
import os from "os"
import path from "path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { derivePasswordBinding } from "./ui-auth.js"

describe("ui auth", () => {
  let tempRoot
  const originalDataDir = process.env.AX_CODE_DESKTOP_DATA_DIR

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ax-code-ui-auth-"))
  })

  const originalJwtSecret = process.env.AX_CODE_JWT_SECRET

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    fs.rmSync(tempRoot, { recursive: true, force: true })
    if (originalDataDir === undefined) {
      delete process.env.AX_CODE_DESKTOP_DATA_DIR
    } else {
      process.env.AX_CODE_DESKTOP_DATA_DIR = originalDataDir
    }
    if (originalJwtSecret === undefined) {
      delete process.env.AX_CODE_JWT_SECRET
    } else {
      process.env.AX_CODE_JWT_SECRET = originalJwtSecret
    }
  })

  it("derives a stable passkey password binding with scrypt", () => {
    const first = derivePasswordBinding("correct horse battery staple", "jwt-secret")
    const second = derivePasswordBinding("correct horse battery staple", "jwt-secret")
    const rotated = derivePasswordBinding("correct horse battery staple", "rotated-secret")

    expect(first).toBe(second)
    expect(first).not.toBe(rotated)
    expect(first).toMatch(/^[a-f0-9]{128}$/)
  })

  it("loads an existing JWT secret without a preflight existence check", async () => {
    process.env.AX_CODE_DESKTOP_DATA_DIR = tempRoot
    const secretFile = path.join(tempRoot, "jwt-secret")
    fs.writeFileSync(secretFile, "persisted-secret", "utf8")
    const existsSync = vi.spyOn(fs, "existsSync").mockImplementation((candidate) => {
      if (candidate === secretFile) {
        return false
      }
      return false
    })
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    vi.resetModules()

    const { createUiAuth } = await import("./ui-auth.js")
    const auth = createUiAuth({ password: "correct horse battery staple" })

    try {
      expect(fs.readFileSync(secretFile, "utf8")).toBe("persisted-secret")
      expect(log).not.toHaveBeenCalledWith(
        expect.stringContaining("[JWT] Generated and persisted new secret to"),
        secretFile,
      )
    } finally {
      auth.dispose()
      existsSync.mockRestore()
      log.mockRestore()
    }
  })

  it("refuses reset-auth without deleting passkeys when the JWT secret is env-pinned", async () => {
    process.env.AX_CODE_DESKTOP_DATA_DIR = tempRoot
    process.env.AX_CODE_JWT_SECRET = "env-pinned-secret"
    vi.resetModules()

    const { createUiAuth } = await import("./ui-auth.js")
    const auth = createUiAuth({ password: "correct horse battery staple" })

    // Spy only after init so we observe writes made by the reset call itself.
    const writeSpy = vi.spyOn(fs, "writeFileSync")
    const res = {
      statusCode: 200,
      body: undefined,
      status(code) {
        this.statusCode = code
        return this
      },
      json(payload) {
        this.body = payload
        return this
      },
    }

    try {
      auth.handleResetAuth({ headers: {} }, res)

      // The guard must fire before any destructive action.
      expect(res.statusCode).toBe(400)
      // The passkey store must never be rewritten (clearAllPasskeys not reached).
      const touchedPasskeyStore = writeSpy.mock.calls.some(([target]) =>
        String(target).includes("ui-passkeys"),
      )
      expect(touchedPasskeyStore).toBe(false)
    } finally {
      auth.dispose()
      writeSpy.mockRestore()
    }
  })
})
