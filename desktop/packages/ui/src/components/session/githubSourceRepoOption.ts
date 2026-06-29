import type { GitHubRepoSelector } from "@/lib/api/types"

type GitHubSourceRepoHolder = {
  sourceRepo?: (GitHubRepoSelector & { source?: string }) | null
}

export const resolveGitHubSourceRepoOption = (
  item: GitHubSourceRepoHolder | null | undefined,
): GitHubRepoSelector | null => {
  const owner = item?.sourceRepo?.owner?.trim()
  const repo = item?.sourceRepo?.repo?.trim()

  if (!owner || !repo) {
    return null
  }

  return { owner, repo }
}
