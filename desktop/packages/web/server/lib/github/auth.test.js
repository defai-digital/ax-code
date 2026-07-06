import fs from "fs"
import os from "os"
import path from "path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("github auth storage", () => {
  let tempRoot
  const originalDataDir = process.env.AX_CODE_DESKTOP_DATA_DIR
  const originalClientId = process.env.AX_CODE_DESKTOP_GITHUB_CLIENT_ID
  const originalScopes = process.env.AX_CODE_DESKTOP_GITHUB_SCOPES

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ax-code-github-auth-"))
    process.env.AX_CODE_DESKTOP_DATA_DIR = tempRoot
    delete process.env.AX_CODE_DESKTOP_GITHUB_CLIENT_ID
    delete process.env.AX_CODE_DESKTOP_GITHUB_SCOPES
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
    if (originalClientId === undefined) {
      delete process.env.AX_CODE_DESKTOP_GITHUB_CLIENT_ID
    } else {
      process.env.AX_CODE_DESKTOP_GITHUB_CLIENT_ID = originalClientId
    }
    if (originalScopes === undefined) {
      delete process.env.AX_CODE_DESKTOP_GITHUB_SCOPES
    } else {
      process.env.AX_CODE_DESKTOP_GITHUB_SCOPES = originalScopes
    }
  })

  const authFile = () => path.join(tempRoot, "github-auth.json")
  const settingsFile = () => path.join(tempRoot, "settings.json")

  const importAuth = async () => {
    vi.resetModules()
    return import("./auth.js")
  }

  it("loads existing accounts without a preflight existence check", async () => {
    fs.mkdirSync(tempRoot, { recursive: true })
    fs.writeFileSync(
      authFile(),
      JSON.stringify([
        {
          accessToken: "token",
          scope: "repo",
          tokenType: "bearer",
          user: { login: "octo", id: 1 },
          current: true,
          accountId: "octo",
        },
      ]),
      "utf8",
    )
    const existsSync = vi.spyOn(fs, "existsSync").mockImplementation((candidate) => {
      if (candidate === authFile()) {
        return false
      }
      return false
    })
    const { getGitHubAuthAccounts } = await importAuth()

    expect(getGitHubAuthAccounts()).toEqual([
      {
        id: "octo",
        user: {
          login: "octo",
          avatarUrl: null,
          id: 1,
          name: null,
          email: null,
        },
        scope: "repo",
        current: true,
      },
    ])
    existsSync.mockRestore()
  })

  it("removes the final current account without a preflight existence check", async () => {
    const { setGitHubAuth, clearGitHubAuth } = await importAuth()
    setGitHubAuth({
      accessToken: "token",
      scope: "repo",
      tokenType: "bearer",
      user: { login: "octo", id: 1 },
    })
    const originalExistsSync = fs.existsSync
    const existsSync = vi.spyOn(fs, "existsSync").mockImplementation((candidate) => {
      if (candidate === authFile()) {
        return false
      }
      return originalExistsSync(candidate)
    })

    try {
      expect(clearGitHubAuth()).toBe(true)
      expect(fs.existsSync(authFile())).toBe(false)
    } finally {
      existsSync.mockRestore()
    }
  })

  it("loads a configured GitHub client id without a preflight existence check", async () => {
    fs.writeFileSync(settingsFile(), JSON.stringify({ githubClientId: "custom-client" }), "utf8")
    const originalExistsSync = fs.existsSync
    const existsSync = vi.spyOn(fs, "existsSync").mockImplementation((candidate) => {
      if (candidate === settingsFile()) {
        return false
      }
      return originalExistsSync(candidate)
    })

    try {
      const { getGitHubClientId } = await importAuth()

      expect(getGitHubClientId()).toBe("custom-client")
    } finally {
      existsSync.mockRestore()
    }
  })

  it("loads configured GitHub scopes without a preflight existence check", async () => {
    fs.writeFileSync(settingsFile(), JSON.stringify({ githubScopes: "repo workflow" }), "utf8")
    const originalExistsSync = fs.existsSync
    const existsSync = vi.spyOn(fs, "existsSync").mockImplementation((candidate) => {
      if (candidate === settingsFile()) {
        return false
      }
      return originalExistsSync(candidate)
    })

    try {
      const { getGitHubScopes } = await importAuth()

      expect(getGitHubScopes()).toBe("repo workflow")
    } finally {
      existsSync.mockRestore()
    }
  })
})
