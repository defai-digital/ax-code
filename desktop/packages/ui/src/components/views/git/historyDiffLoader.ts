import { getCommitFileDiff, type CommitFileDiffResponse } from "@/lib/gitApi"

export const HISTORY_DIFF_REQUEST_TIMEOUT_MS = 15000

export const fetchHistoryCommitFileDiff = (
  directory: string,
  commitHash: string,
  filePath: string,
  timeoutMs = HISTORY_DIFF_REQUEST_TIMEOUT_MS,
): Promise<CommitFileDiffResponse> => {
  return new Promise<CommitFileDiffResponse>((resolve, reject) => {
    let settled = false
    const timeoutHandle = setTimeout(() => {
      settled = true
      reject(new Error(`Timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    getCommitFileDiff(directory, commitHash, filePath, false).then(
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
