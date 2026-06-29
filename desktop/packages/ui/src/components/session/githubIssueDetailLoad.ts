export type GitHubIssueDetailLoadResult<T> =
  | { status: "loaded"; value: T }
  | { status: "stale" }
  | { status: "failed"; error: unknown }

export const loadCurrentGitHubIssueDetail = async <T>({
  load,
  isCurrent,
}: {
  load: () => Promise<T>
  isCurrent: () => boolean
}): Promise<GitHubIssueDetailLoadResult<T>> => {
  try {
    const value = await load()
    if (!isCurrent()) {
      return { status: "stale" }
    }
    return { status: "loaded", value }
  } catch (error) {
    if (!isCurrent()) {
      return { status: "stale" }
    }
    return { status: "failed", error }
  }
}
