import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Mock child_process to prevent real spawnSync calls that would hang in tests
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(() => ({ status: 0, stdout: "/usr/local/bin", stderr: "" })),
}))

const { checkForUpdates } = await import("./package-manager.js")

describe("checkForUpdates (remote sources hard-disabled)", () => {
  let fetchMock
  let originalFetch

  // These env vars used to enable remote update checks. They are now ignored:
  // remote update sources are hard-disabled so the app never contacts npm or
  // any external update API, even when the vars are set.
  const UPDATE_ENV = {
    AX_CODE_UPDATE_API_URL: "https://updates.ax-code.test/v1/update/check",
    AX_CODE_UPDATE_NPM_PACKAGE: "@ax-code/web",
    AX_CODE_UPDATE_CHANGELOG_URL: "https://raw.ax-code.test/CHANGELOG.md",
  }
  let savedEnv

  beforeEach(() => {
    // Any outbound fetch is a failure: the contract is "no network calls".
    fetchMock = vi.fn(() => Promise.reject(new Error("Unexpected network call")))
    originalFetch = globalThis.fetch
    globalThis.fetch = fetchMock

    savedEnv = {}
    for (const [key, value] of Object.entries(UPDATE_ENV)) {
      savedEnv[key] = process.env[key]
      process.env[key] = value
    }
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it("reports no update and makes no remote calls even when update env vars are set", async () => {
    const result = await checkForUpdates({ currentVersion: "1.9.10" })

    expect(result.available).toBe(false)
    expect(result.currentVersion).toBe("1.9.10")
    expect(result.error).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("makes no remote calls for desktop app types either", async () => {
    const result = await checkForUpdates({ appType: "desktop-electron", currentVersion: "1.9.10" })

    expect(result.available).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("detectPackageManagerDetails", () => {
  const ENV_KEYS = ["AX_CODE_DESKTOP_PACKAGE_MANAGER", "AX_CODE_DESKTOP_RUNTIME"]
  let savedEnv

  beforeEach(() => {
    savedEnv = {}
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it("trims forced package manager env before detection", async () => {
    vi.resetModules()
    process.env.AX_CODE_DESKTOP_PACKAGE_MANAGER = " pnpm "

    const { detectPackageManagerDetails } = await import("./package-manager.js")
    const details = detectPackageManagerDetails()

    expect(details).toMatchObject({
      packageManager: "pnpm",
      reason: "forced-env",
    })
  })
})
