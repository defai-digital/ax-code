import type { GetGitFileDiffOptions, GitFileDiffResponse } from "@/lib/api/types"

export const DIFF_REQUEST_TIMEOUT_MS = 15000

export type GitFileDiffFetcher = (
  directory: string,
  options: GetGitFileDiffOptions,
) => Promise<GitFileDiffResponse>

export const fetchGitFileDiffWithTimeout = (
  fetchGitFileDiff: GitFileDiffFetcher,
  directory: string,
  options: GetGitFileDiffOptions,
  timeoutMs = DIFF_REQUEST_TIMEOUT_MS,
): Promise<GitFileDiffResponse> => {
  return new Promise<GitFileDiffResponse>((resolve, reject) => {
    let settled = false
    const timeoutHandle = setTimeout(() => {
      settled = true
      reject(new Error(`Timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    fetchGitFileDiff(directory, options).then(
      (result) => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timeoutHandle)
        resolve(result)
      },
      (error: unknown) => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timeoutHandle)
        reject(error)
      },
    )
  })
}
