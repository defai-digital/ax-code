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

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    fs.rmSync(tempRoot, { recursive: true, force: true })
    if (originalDataDir === undefined) {
      delete process.env.AX_CODE_DESKTOP_DATA_DIR
    } else {
      process.env.AX_CODE_DESKTOP_DATA_DIR = originalDataDir
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
})
