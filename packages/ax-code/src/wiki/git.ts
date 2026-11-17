import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const GIT_PROBE_TIMEOUT_MS = 10_000

export async function gitHeadCommit(root: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      timeout: GIT_PROBE_TIMEOUT_MS,
      windowsHide: true,
    })
    return stdout.trim() || undefined
  } catch {
    return undefined
  }
}

export async function gitWorktreeDirty(root: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain", "--untracked-files=normal"], {
      cwd: root,
      timeout: GIT_PROBE_TIMEOUT_MS,
      windowsHide: true,
    })
    return stdout.length > 0
  } catch {
    // The evidence contract has no unknown state. Conservatively mark an
    // unavailable worktree probe dirty instead of claiming a clean snapshot.
    return true
  }
}
