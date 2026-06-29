import type { GitHubIssuesListResult } from "@/lib/api/types"

export type GitHubIssueListLoadResult =
  | { status: "loaded"; result: GitHubIssuesListResult }
  | { status: "stale" }
  | { status: "failed"; error: unknown }

export const loadCurrentGitHubIssueList = async ({
  load,
  isCurrent,
}: {
  load: () => Promise<GitHubIssuesListResult>
  isCurrent: () => boolean
}): Promise<GitHubIssueListLoadResult> => {
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
