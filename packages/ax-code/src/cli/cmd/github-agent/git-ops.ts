import type { GitResult } from "../../../util/git"
import { git } from "../../../util/git"
import { Process } from "../../../util/process"
import { AGENT_USERNAME } from "./types"

export type GitRunner = (args: string[]) => Promise<{ exitCode: number; stdout: Buffer; stderr: Buffer }>
export type GitTextRunner = (args: string[]) => Promise<string>
export type GitStatusRunner = (args: string[]) => Promise<import("../../../util/git").GitResult>

export function createGitHelpers(cwd: string): {
  gitText: GitTextRunner
  gitRun: GitRunner
  gitStatus: (args: string[]) => Promise<GitResult>
} {
  const gitText = async (args: string[]): Promise<string> => {
    const result = await git(args, { cwd })
    if (result.exitCode !== 0) {
      throw new Process.RunFailedError(["git", ...args], result.exitCode, result.stdout, result.stderr)
    }
    return result.text().trim()
  }

  const gitRun = async (args: string[]) => {
    const result = await git(args, { cwd })
    if (result.exitCode !== 0) {
      throw new Process.RunFailedError(["git", ...args], result.exitCode, result.stdout, result.stderr)
    }
    return result
  }

  const gitStatus = (args: string[]) => git(args, { cwd })

  return { gitText, gitRun, gitStatus }
}

export async function commitChanges(gitRun: GitRunner, summary: string, actor?: string) {
  const args = ["commit", "-m", summary]
  if (actor) args.push("-m", `Co-authored-by: ${actor} <${actor}@users.noreply.github.com>`)
  await gitRun(args)
}

export function generateBranchName(type: "issue" | "pr" | "schedule" | "dispatch", issueId: number | undefined) {
  const timestamp = new Date()
    .toISOString()
    .replace(/[:-]/g, "")
    .replace(/\.\d{3}Z/, "")
    .split("T")
    .join("")
  if (type === "schedule" || type === "dispatch") {
    const hex = crypto.randomUUID().slice(0, 6)
    return `ax-code/${type}-${hex}-${timestamp}`
  }
  return `ax-code/${type}${issueId}-${timestamp}`
}

export async function checkoutNewBranch(gitRun: GitRunner, type: "issue" | "schedule" | "dispatch", issueId: number | undefined) {
  console.log("Checking out new branch...")
  const branch = generateBranchName(type, issueId)
  await gitRun(["checkout", "-b", branch])
  return branch
}

export async function checkoutLocalBranch(gitRun: GitRunner, pr: { headRefName: string; commits: { totalCount: number } }) {
  console.log("Checking out local branch...")
  const branch = pr.headRefName
  const depth = Math.max(pr.commits.totalCount, 20)
  await gitRun(["fetch", "origin", `--depth=${depth}`, branch])
  await gitRun(["checkout", branch])
}

export async function checkoutForkBranch(
  gitRun: GitRunner,
  gitStatus: (args: string[]) => Promise<GitResult>,
  pr: { headRefName: string; headRepository: { nameWithOwner: string }; commits: { totalCount: number } },
) {
  console.log("Checking out fork branch...")
  const remoteBranch = pr.headRefName
  const localBranch = generateBranchName("pr", undefined)
  const depth = Math.max(pr.commits.totalCount, 20)

  const remotes = await gitStatus(["remote"])
  const remoteList = remotes.stdout.toString().trim().split("\n").filter(Boolean)
  if (!remoteList.includes("fork")) {
    await gitRun(["remote", "add", "fork", `https://github.com/${pr.headRepository.nameWithOwner}.git`])
  }
  await gitRun(["fetch", "fork", `--depth=${depth}`, remoteBranch])
  await gitRun(["checkout", "-b", localBranch, `fork/${remoteBranch}`])
  return localBranch
}

export async function pushToNewBranch(
  gitRun: GitRunner,
  commitFn: () => Promise<void>,
  branch: string,
  shouldCommit: boolean,
) {
  console.log("Pushing to new branch...")
  if (shouldCommit) await commitFn()
  await gitRun(["push", "-u", "origin", branch])
}

export async function pushToLocalBranch(gitRun: GitRunner, commitFn: () => Promise<void>, shouldCommit: boolean) {
  console.log("Pushing to local branch...")
  if (shouldCommit) await commitFn()
  await gitRun(["push"])
}

export async function pushToForkBranch(
  gitRun: GitRunner,
  commitFn: () => Promise<void>,
  remoteBranch: string,
  shouldCommit: boolean,
) {
  console.log("Pushing to fork branch...")
  if (shouldCommit) await commitFn()
  await gitRun(["push", "fork", `HEAD:${remoteBranch}`])
}

export async function branchIsDirty(
  gitText: GitTextRunner,
  gitStatus: (args: string[]) => Promise<GitResult>,
  originalHead: string,
  expectedBranch: string,
) {
  console.log("Checking if branch is dirty...")
  const current = await gitText(["rev-parse", "--abbrev-ref", "HEAD"])
  if (current !== expectedBranch) {
    console.log(`Branch changed during chat: expected ${expectedBranch}, now on ${current}`)
    return { dirty: true, uncommittedChanges: false, switched: true }
  }

  const ret = await gitStatus(["status", "--porcelain"])
  const status = ret.stdout.toString().trim()
  if (status.length > 0) {
    return { dirty: true, uncommittedChanges: true, switched: false }
  }
  const head = await gitText(["rev-parse", "HEAD"])
  return {
    dirty: head !== originalHead,
    uncommittedChanges: false,
    switched: false,
  }
}

export async function hasNewCommits(gitStatus: (args: string[]) => Promise<GitResult>, base: string, head: string) {
  const result = await gitStatus(["rev-list", "--count", `${base}..${head}`])
  if (result.exitCode !== 0) {
    console.log(`rev-list failed, fetching origin/${base}...`)
    await gitStatus(["fetch", "origin", base, "--depth=1"])
    const retry = await gitStatus(["rev-list", "--count", `origin/${base}..${head}`])
    if (retry.exitCode !== 0) return true
    const count = parseInt(retry.stdout.toString().trim(), 10)
    return Number.isFinite(count) && count > 0
  }
  const count = parseInt(result.stdout.toString().trim(), 10)
  return Number.isFinite(count) && count > 0
}

export async function configureGit(
  gitRun: GitRunner,
  gitStatus: (args: string[]) => Promise<GitResult>,
  appToken: string,
  isMock: boolean,
): Promise<{ savedUserName: string | undefined; savedUserEmail: string | undefined; savedGitConfig: string | undefined }> {
  if (isMock) return { savedUserName: undefined, savedUserEmail: undefined, savedGitConfig: undefined }

  console.log("Configuring git...")
  const config = "http.https://github.com/.extraheader"
  let savedGitConfig: string | undefined
  const ret = await gitStatus(["config", "--local", "--get", config])
  if (ret.exitCode === 0) {
    savedGitConfig = ret.stdout.toString().trim()
    await gitRun(["config", "--local", "--unset-all", config])
  }

  let savedUserName: string | undefined
  let savedUserEmail: string | undefined
  const savedNameRet = await gitStatus(["config", "--local", "--get", "user.name"])
  if (savedNameRet.exitCode === 0) {
    savedUserName = savedNameRet.stdout.toString().trim()
  }
  const savedEmailRet = await gitStatus(["config", "--local", "--get", "user.email"])
  if (savedEmailRet.exitCode === 0) {
    savedUserEmail = savedEmailRet.stdout.toString().trim()
  }

  const newCredentials = Buffer.from(`x-access-token:${appToken}`, "utf8").toString("base64")
  await gitRun(["config", "--local", config, `AUTHORIZATION: basic ${newCredentials}`])
  await gitRun(["config", "--local", "user.name", AGENT_USERNAME])
  await gitRun(["config", "--local", "user.email", `${AGENT_USERNAME}@users.noreply.github.com`])

  return { savedUserName, savedUserEmail, savedGitConfig }
}

export async function restoreGitConfig(
  gitRun: GitRunner,
  isMock: boolean,
  savedUserName: string | undefined,
  savedUserEmail: string | undefined,
  savedGitConfig: string | undefined,
) {
  if (isMock) return
  if (savedUserName !== undefined) {
    await gitRun(["config", "--local", "user.name", savedUserName])
  } else {
    await gitRun(["config", "--local", "--unset-all", "user.name"])
  }
  if (savedUserEmail !== undefined) {
    await gitRun(["config", "--local", "user.email", savedUserEmail])
  } else {
    await gitRun(["config", "--local", "--unset-all", "user.email"])
  }
  if (savedGitConfig !== undefined) {
    const config = "http.https://github.com/.extraheader"
    await gitRun(["config", "--local", config, savedGitConfig])
  }
}
