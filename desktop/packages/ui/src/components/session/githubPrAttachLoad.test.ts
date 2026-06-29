import { describe, expect, test, vi } from "vitest"

import { loadCurrentGitHubPrAttach } from "./githubPrAttachLoad"

describe("loadCurrentGitHubPrAttach", () => {
  test("returns loaded attach payload for the current request", async () => {
    await expect(
      loadCurrentGitHubPrAttach({
        load: vi.fn(async () => ({ prNumber: 12, instructionsText: "Review this PR" })),
        isCurrent: () => true,
      }),
    ).resolves.toEqual({ status: "loaded", value: { prNumber: 12, instructionsText: "Review this PR" } })
  })

  test("returns current request errors", async () => {
    const error = new Error("load failed")

    await expect(
      loadCurrentGitHubPrAttach({
        load: vi.fn(async () => {
          throw error
        }),
        isCurrent: () => true,
      }),
    ).resolves.toEqual({ status: "failed", error })
  })

  test("suppresses stale attach payloads", async () => {
    await expect(
      loadCurrentGitHubPrAttach({
        load: vi.fn(async () => ({ prNumber: 12 })),
        isCurrent: () => false,
      }),
    ).resolves.toEqual({ status: "stale" })
  })

  test("suppresses errors from stale attach requests", async () => {
    await expect(
      loadCurrentGitHubPrAttach({
        load: vi.fn(async () => {
          throw new Error("dialog closed")
        }),
        isCurrent: () => false,
      }),
    ).resolves.toEqual({ status: "stale" })
  })
})
