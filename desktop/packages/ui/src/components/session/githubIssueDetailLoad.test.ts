import { describe, expect, test, vi } from "vitest"

import { loadCurrentGitHubIssueDetail } from "./githubIssueDetailLoad"

describe("loadCurrentGitHubIssueDetail", () => {
  test("returns loaded issue detail for the current request", async () => {
    await expect(
      loadCurrentGitHubIssueDetail({
        load: vi.fn(async () => ({ issueNumber: 7, comments: [] })),
        isCurrent: () => true,
      }),
    ).resolves.toEqual({ status: "loaded", value: { issueNumber: 7, comments: [] } })
  })

  test("returns current request errors", async () => {
    const error = new Error("load failed")

    await expect(
      loadCurrentGitHubIssueDetail({
        load: vi.fn(async () => {
          throw error
        }),
        isCurrent: () => true,
      }),
    ).resolves.toEqual({ status: "failed", error })
  })

  test("suppresses stale issue details", async () => {
    await expect(
      loadCurrentGitHubIssueDetail({
        load: vi.fn(async () => ({ issueNumber: 7 })),
        isCurrent: () => false,
      }),
    ).resolves.toEqual({ status: "stale" })
  })

  test("suppresses errors from stale issue detail requests", async () => {
    await expect(
      loadCurrentGitHubIssueDetail({
        load: vi.fn(async () => {
          throw new Error("dialog closed")
        }),
        isCurrent: () => false,
      }),
    ).resolves.toEqual({ status: "stale" })
  })
})
