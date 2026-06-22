import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import * as npm from "./npm-registry.js"

const originalFetch = globalThis.fetch

let fetchMock

describe("npm registry client (access disabled)", () => {
  beforeEach(() => {
    // Any outbound fetch is a contract violation: npm registry access is disabled.
    fetchMock = vi.fn(() => Promise.reject(new Error("Unexpected network call")))
    globalThis.fetch = fetchMock
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    npm.clearCache()
  })

  test("lookupNpmPackage returns a network-disabled error without fetching", async () => {
    const result = await npm.lookupNpmPackage("foo")

    expect(result.ok).toBe(false)
    expect(result.status).toBe("network")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("getNpmInfo returns a network-disabled error without fetching, even with forceRefresh", async () => {
    const result = await npm.getNpmInfo("@scope/pkg", { forceRefresh: true })

    expect(result.ok).toBe(false)
    expect(result.status).toBe("network")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("clearCache is a no-op and does not throw", () => {
    expect(() => npm.clearCache()).not.toThrow()
  })
})
