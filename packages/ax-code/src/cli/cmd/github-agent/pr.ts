import { UI } from "../../ui"
import { cmd } from "../cmd"
import { Instance } from "../../../project/instance"
import { Process } from "../../../util/process"
import { git } from "../../../util/git"
import { registerShutdownSignals } from "../../../util/signals"
import { isRecord } from "../../../util/record"
import { parseJsonResult } from "../../../util/json-value"
import { Shell } from "../../../shell/shell"

export interface GitHubPrViewInfo {
  isCrossRepository?: boolean
  headRepository?: {
    name: string
  }
  headRepositoryOwner?: {
    login: string
  }
  headRefName?: string
  body?: string
}

export function decodeGitHubPrViewInfoValue(value: unknown): GitHubPrViewInfo | undefined {
  if (!isRecord(value)) return undefined
  const headRepository =
    isRecord(value.headRepository) && typeof value.headRepository.name === "string"
      ? { name: value.headRepository.name }
      : undefined
  const headRepositoryOwner =
    isRecord(value.headRepositoryOwner) && typeof value.headRepositoryOwner.login === "string"
      ? { login: value.headRepositoryOwner.login }
      : undefined
  return {
    ...(typeof value.isCrossRepository === "boolean" ? { isCrossRepository: value.isCrossRepository } : {}),
    ...(headRepository ? { headRepository } : {}),
    ...(headRepositoryOwner ? { headRepositoryOwner } : {}),
    ...(typeof value.headRefName === "string" ? { headRefName: value.headRefName } : {}),
    ...(typeof value.body === "string" ? { body: value.body } : {}),
  }
}

export function parseGitHubPrViewInfoText(text: string): GitHubPrViewInfo | undefined {
  const parsed = parseJsonResult(text)
  if (!parsed.ok) {
    throw new Error(`Failed to parse PR info from gh CLI: ${text.slice(0, 200)}`, { cause: parsed.error })
  }
  return decodeGitHubPrViewInfoValue(parsed.value)
}

export const PrCommand = cmd({
  command: "pr <number>",
  describe: "fetch and checkout a GitHub PR branch, then run ax-code",
  builder: (yargs) =>
    yargs.positional("number", {
      type: "number",
      describe: "PR number to checkout",
      demandOption: true,
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const project = Instance.project
        if (project.vcs !== "git") {
          UI.error("Could not find git repository. Please run this command from a git repository.")
          process.exit(1)
        }

        const prNumber = args.number
        const localBranchName = `pr/${prNumber}`
        UI.println(`Fetching and checking out PR #${prNumber}...`)

        // Use gh pr checkout with custom branch name
        const result = await Process.run(
          ["gh", "pr", "checkout", `${prNumber}`, "--branch", localBranchName, "--force"],
          {
            nothrow: true,
          },
        )

        if (result.code !== 0) {
          UI.error(`Failed to checkout PR #${prNumber}. Make sure you have gh CLI installed and authenticated.`)
          process.exit(1)
        }

        // Fetch PR info for fork handling and session link detection
        const prInfoResult = await Process.text(
          [
            "gh",
            "pr",
            "view",
            `${prNumber}`,
            "--json",
            "headRepository,headRepositoryOwner,isCrossRepository,headRefName,body",
          ],
          { nothrow: true },
        )

        let sessionId: string | undefined

        if (prInfoResult.code === 0) {
          const prInfoText = prInfoResult.text
          if (prInfoText.trim()) {
            const prInfo = parseGitHubPrViewInfoText(prInfoText)

            // Handle fork PRs
            if (prInfo?.isCrossRepository && prInfo.headRepository && prInfo.headRepositoryOwner) {
              const forkOwner = prInfo.headRepositoryOwner.login
              const forkName = prInfo.headRepository.name
              const remoteName = forkOwner

              // Check if remote already exists
              const remotes = (await git(["remote"], { cwd: Instance.worktree })).text().trim()
              if (!remotes.split("\n").includes(remoteName)) {
                await git(["remote", "add", remoteName, `https://github.com/${forkOwner}/${forkName}.git`], {
                  cwd: Instance.worktree,
                })
                UI.println(`Added fork remote: ${remoteName}`)
              }

              // Set upstream to the fork so pushes go there
              const headRefName = prInfo.headRefName
              await git(["branch", `--set-upstream-to=${remoteName}/${headRefName}`, localBranchName], {
                cwd: Instance.worktree,
              })
            }
          }
        }

        UI.println(`Successfully checked out PR #${prNumber} as branch '${localBranchName}'`)
        UI.println()
        UI.println("Starting ax-code...")
        UI.println()

        const axcodeArgs = sessionId ? ["-s", sessionId] : []
        const axcodeProcess = Process.spawn(["ax-code", ...axcodeArgs], {
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
          cwd: process.cwd(),
        })
        const hasExited = () => axcodeProcess.exitCode !== null || axcodeProcess.signalCode !== null
        const terminateProcess = () =>
          void Shell.killTree(axcodeProcess, {
            exited: () => hasExited(),
          }).catch(() => {})
        const kill = () => {
          terminateProcess()
        }
        const removeSignals = registerShutdownSignals(kill)
        let code: number
        try {
          code = await axcodeProcess.exited
        } finally {
          terminateProcess()
          removeSignals()
        }
        if (code !== 0) throw new Error(`ax-code exited with code ${code}`)
      },
    })
  },
})
