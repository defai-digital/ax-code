import type { GitHubPullRequestsListResult } from "@/lib/api/types"

export type GitHubPrListLoadResult =
  | { status: "loaded"; result: GitHubPullRequestsListResult }
  | { status: "stale" }
  | { status: "failed"; error: unknown }

export const loadCurrentGitHubPrList = async ({
  load,
  isCurrent,
}: {
  load: () => Promise<GitHubPullRequestsListResult>
  isCurrent: () => boolean
}): Promise<GitHubPrListLoadResult> => {
  try {
    const result = await load()
    if (!isCurrent()) {
      return { status: "stale" }
    }
    return { status: "loaded", result }
  } catch (error) {
    if (!isCurrent()) {
      return { status: "stale" }
    }
    return { status: "failed", error }
  }
}
