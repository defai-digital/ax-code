import { beforeEach, describe, expect, test, vi } from "vitest"

import type { GitHubAPI, GitHubPullRequestStatus, RuntimeAPIs } from "@/lib/api/types"

const loadStore = async () => {
  const module = await import("./useGitHubPrStatusStore")
  return module
}

const makeStatus = (remoteName: string, number: number): GitHubPullRequestStatus => ({
  connected: true,
  resolvedRemoteName: remoteName,
  pr: {
    number,
    state: "open",
    draft: false,
    title: `${remoteName} PR`,
    url: `https://github.com/example/repo/pull/${number}`,
    base: "main",
    head: "feature",
    mergeable: true,
    mergeableState: "clean",
  },
  checks: {
    state: "success",
    total: 1,
    success: 1,
    failure: 0,
    pending: 0,
  },
  canMerge: true,
  repo: {
    owner: "example",
    repo: "repo",
    url: "https://github.com/example/repo",
  },
})

describe("useGitHubPrStatusStore", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  test("separates PR status entries for different remotes on the same branch", async () => {
    const { getGitHubPrStatusKey, useGitHubPrStatusStore } = await loadStore()
    const prStatus = vi.fn(
      async (_directory: string, _branch: string, remote?: string): Promise<GitHubPullRequestStatus> =>
        makeStatus(remote ?? "origin", remote === "upstream" ? 22 : 11),
    )
    const github = { prStatus: prStatus as GitHubAPI["prStatus"] } as RuntimeAPIs["github"]

    const originKey = getGitHubPrStatusKey("/workspace/repo", "feature", "origin")
    const upstreamKey = getGitHubPrStatusKey("/workspace/repo", "feature", "upstream")

    useGitHubPrStatusStore.getState().ensureEntry(originKey)
    useGitHubPrStatusStore.getState().setParams(originKey, {
      directory: "/workspace/repo",
      branch: "feature",
      remoteName: "origin",
      canShow: true,
      github,
      githubAuthChecked: true,
      githubConnected: true,
    })

    useGitHubPrStatusStore.getState().ensureEntry(upstreamKey)
    useGitHubPrStatusStore.getState().setParams(upstreamKey, {
      directory: "/workspace/repo",
      branch: "feature",
      remoteName: "upstream",
      canShow: true,
      github,
      githubAuthChecked: true,
      githubConnected: true,
    })

    await useGitHubPrStatusStore.getState().refresh(originKey, { force: true })
    await useGitHubPrStatusStore.getState().refresh(upstreamKey, { force: true })

    expect(originKey).not.toBe(upstreamKey)
    expect(prStatus).toHaveBeenCalledTimes(2)
    expect(prStatus.mock.calls.map((call) => call[2])).toEqual(["origin", "upstream"])
    expect(useGitHubPrStatusStore.getState().entries[originKey]?.status?.pr?.number).toBe(11)
    expect(useGitHubPrStatusStore.getState().entries[upstreamKey]?.status?.pr?.number).toBe(22)
  })
})
