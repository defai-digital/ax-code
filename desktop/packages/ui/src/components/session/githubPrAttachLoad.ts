export type GitHubPrAttachLoadResult<T> =
  | { status: "loaded"; value: T }
  | { status: "stale" }
  | { status: "failed"; error: unknown }

export const loadCurrentGitHubPrAttach = async <T>({
  load,
  isCurrent,
}: {
  load: () => Promise<T>
  isCurrent: () => boolean
}): Promise<GitHubPrAttachLoadResult<T>> => {
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
