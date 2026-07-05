import fs from "fs"
import os from "os"
import path from "path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("git credentials", () => {
  let tempHome

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "ax-code-git-credentials-"))
  })

  afterEach(() => {
    vi.doUnmock("os")
    vi.resetModules()
    fs.rmSync(tempHome, { recursive: true, force: true })
  })

  const importCredentials = async () => {
    vi.resetModules()
    vi.doMock("os", () => ({
      default: { homedir: () => tempHome },
      homedir: () => tempHome,
    }))
    return import("./credentials.js")
  }

  const credentialsFile = () => path.join(tempHome, ".git-credentials")

  it("discovers unique git credential hosts without a preflight existence check", async () => {
    fs.writeFileSync(
      credentialsFile(),
      [
        "https://alice:token@example.com",
        "https://alice:other@example.com",
        "https://bob:token@example.com/org",
        "not a url",
        "",
      ].join("\n"),
      "utf8",
    )
    const { discoverGitCredentials } = await importCredentials()
    const existsSync = vi.spyOn(fs, "existsSync").mockImplementation((candidate) => {
      if (candidate === credentialsFile()) {
        throw new Error("discoverGitCredentials should not call existsSync before reading")
      }
      return false
    })

    try {
      expect(discoverGitCredentials()).toEqual([
        { host: "example.com", username: "alice" },
        { host: "example.com/org", username: "bob" },
      ])
    } finally {
      existsSync.mockRestore()
    }
  })

  it("returns a credential for the requested host without a preflight existence check", async () => {
    fs.writeFileSync(credentialsFile(), "https://alice:token@example.com/org\n", "utf8")
    const { getCredentialForHost } = await importCredentials()
    const existsSync = vi.spyOn(fs, "existsSync").mockImplementation((candidate) => {
      if (candidate === credentialsFile()) {
        throw new Error("getCredentialForHost should not call existsSync before reading")
      }
      return false
    })

    try {
      expect(getCredentialForHost("example.com/org")).toEqual({ username: "alice", token: "token" })
    } finally {
      existsSync.mockRestore()
    }
  })

  it("treats a missing credentials file as empty credentials", async () => {
    const { discoverGitCredentials, getCredentialForHost } = await importCredentials()

    expect(discoverGitCredentials()).toEqual([])
    expect(getCredentialForHost("example.com")).toBeNull()
  })
})
