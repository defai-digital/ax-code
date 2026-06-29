import { describe, expect, test, vi } from "vitest"

import type { GitHubPullRequestsListResult } from "@/lib/api/types"
import { loadCurrentGitHubPrList } from "./githubPrListLoad"

const listResult: GitHubPullRequestsListResult = {
  connected: true,
  prs: [
    {
      number: 1,
      title: "Fix login",
      url: "https://github.com/acme/repo/pull/1",
      head: "fix-login",
      base: "main",
      state: "open",
      draft: false,
    },
  ],
  page: 1,
  hasMore: false,
}

describe("loadCurrentGitHubPrList", () => {
  test("returns loaded PR list for the current request", async () => {
    await expect(
      loadCurrentGitHubPrList({
        load: vi.fn(async () => listResult),
        isCurrent: () => true,
      }),
    ).resolves.toEqual({ status: "loaded", result: listResult })
  })

  test("suppresses stale PR list responses", async () => {
    await expect(
      loadCurrentGitHubPrList({
        load: vi.fn(async () => listResult),
        isCurrent: () => false,
      }),
    ).resolves.toEqual({ status: "stale" })
  })

  test("suppresses errors from stale PR list requests", async () => {
    await expect(
      loadCurrentGitHubPrList({
        load: vi.fn(async () => {
          throw new Error("project changed")
        }),
        isCurrent: () => false,
      }),
    ).resolves.toEqual({ status: "stale" })
  })
})
