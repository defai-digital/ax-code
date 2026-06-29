import { describe, expect, test, vi } from "vitest"

import { loadCurrentGitHubIntegrationList } from "./githubIntegrationListLoad"

describe("loadCurrentGitHubIntegrationList", () => {
  test("returns list data for the current request", async () => {
    await expect(
      loadCurrentGitHubIntegrationList({
        load: vi.fn(async () => ({ connected: true, page: 1, hasMore: false })),
        isCurrent: () => true,
      }),
    ).resolves.toEqual({ status: "loaded", result: { connected: true, page: 1, hasMore: false } })
  })

  test("returns current request errors", async () => {
    const error = new Error("load failed")

    await expect(
      loadCurrentGitHubIntegrationList({
        load: vi.fn(async () => {
          throw error
        }),
        isCurrent: () => true,
      }),
    ).resolves.toEqual({ status: "failed", error })
  })

  test("suppresses stale list data", async () => {
    await expect(
      loadCurrentGitHubIntegrationList({
        load: vi.fn(async () => ({ connected: true, page: 1 })),
        isCurrent: () => false,
      }),
    ).resolves.toEqual({ status: "stale" })
  })

  test("suppresses errors from stale list requests", async () => {
    await expect(
      loadCurrentGitHubIntegrationList({
        load: vi.fn(async () => {
          throw new Error("tab changed")
        }),
        isCurrent: () => false,
      }),
    ).resolves.toEqual({ status: "stale" })
  })
})
