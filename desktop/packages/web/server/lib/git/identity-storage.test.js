import fs from "fs"
import os from "os"
import path from "path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("git identity storage", () => {
  let tempHome

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "ax-code-git-identity-"))
  })

  afterEach(() => {
    vi.doUnmock("os")
    vi.resetModules()
    fs.rmSync(tempHome, { recursive: true, force: true })
  })

  const importStorage = async () => {
    vi.resetModules()
    vi.doMock("os", () => ({
      default: { homedir: () => tempHome },
      homedir: () => tempHome,
    }))
    return import("./identity-storage.js")
  }

  const storageDir = () => path.join(tempHome, ".config", "openchamber")
  const storageFile = () => path.join(storageDir(), "git-identities.json")

  it("stores profiles in a private directory and file", async () => {
    if (process.platform === "win32") {
      return
    }

    const { createProfile } = await importStorage()

    createProfile({
      id: "work",
      userName: "Test User",
      userEmail: "test@example.com",
      sshKey: "~/.ssh/id_ed25519",
    })

    expect(fs.statSync(storageDir()).mode & 0o777).toBe(0o700)
    expect(fs.statSync(storageFile()).mode & 0o777).toBe(0o600)
  })

  it("cleans up temporary files when saving profiles fails", async () => {
    fs.mkdirSync(storageFile(), { recursive: true })
    const { saveProfiles } = await importStorage()

    expect(() => saveProfiles({ profiles: [] })).toThrow()
    expect(fs.readdirSync(storageDir()).filter((name) => name.startsWith(".git-identities."))).toEqual([])
  })

  it("loads profiles without a preflight existence check", async () => {
    fs.mkdirSync(storageDir(), { recursive: true })
    fs.writeFileSync(storageFile(), JSON.stringify({ profiles: [{ id: "work" }] }), "utf8")
    const { loadProfiles } = await importStorage()
    const existsSync = vi.spyOn(fs, "existsSync").mockImplementation((candidate) => {
      if (candidate === storageFile()) {
        throw new Error("loadProfiles should not call existsSync before reading")
      }
      return false
    })

    try {
      expect(loadProfiles()).toEqual({ profiles: [{ id: "work" }] })
    } finally {
      existsSync.mockRestore()
    }
  })

  it("treats a missing profiles file as empty storage", async () => {
    const { loadProfiles } = await importStorage()

    expect(loadProfiles()).toEqual({ profiles: [] })
  })
})
