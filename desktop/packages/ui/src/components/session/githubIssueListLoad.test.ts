import { describe, expect, test, vi } from "vitest"

import type { GitHubIssuesListResult } from "@/lib/api/types"
import { loadCurrentGitHubIssueList } from "./githubIssueListLoad"

const listResult: GitHubIssuesListResult = {
  connected: true,
  issues: [
    {
      number: 7,
      title: "Fix project picker",
      url: "https://github.com/acme/repo/issues/7",
      state: "open",
    },
  ],
  page: 1,
  hasMore: false,
}

describe("loadCurrentGitHubIssueList", () => {
  test("returns loaded issue list for the current request", async () => {
    await expect(
      loadCurrentGitHubIssueList({
        load: vi.fn(async () => listResult),
        isCurrent: () => true,
      }),
    ).resolves.toEqual({ status: "loaded", result: listResult })
  })

  test("returns current request errors", async () => {
    const error = new Error("load failed")

    await expect(
      loadCurrentGitHubIssueList({
        load: vi.fn(async () => {
          throw error
        }),
        isCurrent: () => true,
      }),
    ).resolves.toEqual({ status: "failed", error })
  })

  test("suppresses stale issue list responses", async () => {
    await expect(
      loadCurrentGitHubIssueList({
        load: vi.fn(async () => listResult),
        isCurrent: () => false,
      }),
    ).resolves.toEqual({ status: "stale" })
  })

  test("suppresses errors from stale issue list requests", async () => {
    await expect(
      loadCurrentGitHubIssueList({
        load: vi.fn(async () => {
          throw new Error("project changed")
        }),
        isCurrent: () => false,
      }),
    ).resolves.toEqual({ status: "stale" })
  })
})
