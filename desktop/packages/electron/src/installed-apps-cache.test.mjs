import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { normalizeInstalledAppsCache } = require("./installed-apps-cache.js")

describe("installed apps cache", () => {
  test("uses a fresh cache with an apps array", () => {
    expect(
      normalizeInstalledAppsCache(
        {
          updatedAt: 1_000,
          apps: [{ name: "Visual Studio Code", iconDataUrl: null }],
        },
        1_100,
        3_600,
      ),
    ).toEqual({
      apps: [{ name: "Visual Studio Code", iconDataUrl: null }],
      hasCache: true,
      isCacheStale: false,
    })
  })

  test("treats caches without an apps array as missing", () => {
    expect(
      normalizeInstalledAppsCache(
        {
          updatedAt: 1_000,
          apps: "not-an-array",
        },
        1_100,
        3_600,
      ),
    ).toEqual({
      apps: [],
      hasCache: false,
      isCacheStale: true,
    })
  })

  test("marks future-dated caches stale so corrupted timestamps cannot block refresh", () => {
    expect(
      normalizeInstalledAppsCache(
        {
          updatedAt: 9_999,
          apps: [{ name: "Cursor", iconDataUrl: null }],
        },
        1_100,
        3_600,
      ),
    ).toEqual({
      apps: [{ name: "Cursor", iconDataUrl: null }],
      hasCache: true,
      isCacheStale: true,
    })
  })
})
