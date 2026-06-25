import path from "path"
import { execFile } from "child_process"
import { GITHUB_REPO_URL, GITHUB_ACTION_REF } from "../../../constants/project"
import { Filesystem } from "../../../util/filesystem"
import * as prompts from "@clack/prompts"
import { map, pipe, sortBy, values } from "remeda"
import { UI } from "../../ui"
import { cmd } from "../cmd"
import { ModelsDev } from "../../../provider/models"
import { Instance } from "../../../project/instance"
import { git } from "../../../util/git"
import { setTimeout as sleep } from "node:timers/promises"
import { parseGitHubRemote, WORKFLOW_FILE } from "./types"

function requireOidcBaseUrl(): string {
  const value = process.env["OIDC_BASE_URL"]
  if (!value) throw new Error("OIDC_BASE_URL environment variable is required for GitHub App integration")
  return value.replace(/\/+$/, "")
}

function browserOpenCommand(url: string): { command: string; args: string[] } {
  if (process.platform === "win32") return { command: "start", args: ["", url] }
  if (process.platform === "darwin") return { command: "open", args: [url] }
  return { command: "xdg-open", args: [url] }
}

export const GithubInstallCommand = cmd({
  command: "install",
  describe: "install the GitHub agent",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        {
          UI.empty()
          prompts.intro("Install GitHub agent")
          const app = await getAppInfo()
          await installGitHubApp()

          const providers = await ModelsDev.get()

          const provider = await promptProvider()
          const model = await promptModel()

          await addWorkflowFiles()
          printNextSteps()

          function printNextSteps() {
            const step2 = [
              `    2. Add the following secrets in org or repo (${app.owner}/${app.repo}) settings`,
              "",
              ...providers[provider].env.map((e) => `       - ${e}`),
            ].join("\n")

            prompts.outro(
              [
                "Next steps:",
                "",
                `    1. Commit the \`${WORKFLOW_FILE}\` file and push`,
                step2,
                "",
                "    3. Go to a GitHub issue and comment `/oc summarize` to see the agent in action",
                "",
                `   Learn more about the GitHub agent - ${GITHUB_REPO_URL}`,
              ].join("\n"),
            )
          }

          async function getAppInfo() {
            const project = Instance.project
            if (project.vcs !== "git") {
              prompts.log.error(`Could not find git repository. Please run this command from a git repository.`)
              throw new UI.CancelledError()
            }

            const info = (await git(["remote", "get-url", "origin"], { cwd: Instance.worktree })).text().trim()
            const parsed = parseGitHubRemote(info)
            if (!parsed) {
              prompts.log.error(`Could not find git repository. Please run this command from a git repository.`)
              throw new UI.CancelledError()
            }
            return { owner: parsed.owner, repo: parsed.repo, root: Instance.worktree }
          }

          async function promptProvider() {
            const priority: Record<string, number> = {
              "ax-code": 0,
              google: 1,
            }
            let provider = await prompts.select({
              message: "Select provider",
              maxItems: 8,
              options: pipe(
                providers,
                values(),
                sortBy(
                  (x) => priority[x.id] ?? 99,
                  (x) => x.name ?? x.id,
                ),
                map((x) => ({
                  label: x.name,
                  value: x.id,
                  hint: priority[x.id] === 0 ? "recommended" : undefined,
                })),
              ),
            })

            if (prompts.isCancel(provider)) throw new UI.CancelledError()

            return provider
          }

          async function promptModel() {
            const providerData = providers[provider]!

            const model = await prompts.select({
              message: "Select model",
              maxItems: 8,
              options: pipe(
                providerData.models,
                values(),
                sortBy((x) => x.name ?? x.id),
                map((x) => ({
                  label: x.name ?? x.id,
                  value: x.id,
                })),
              ),
            })

            if (prompts.isCancel(model)) throw new UI.CancelledError()
            return model
          }

          async function installGitHubApp() {
            const s = prompts.spinner()
            s.start("Installing GitHub app")

            const installation = await getInstallation()
            if (installation) return s.stop("GitHub app already installed")

            const url = "https://github.com/apps/ax-code-agent"
            const { command, args } = browserOpenCommand(url)
            execFile(command, args, (error) => {
              if (error) {
                prompts.log.warn(`Could not open browser. Please visit: ${url}`)
              }
            })

            s.message("Waiting for GitHub app to be installed")
            const MAX_RETRIES = 120
            let retries = 0
            do {
              const installation = await getInstallation()
              if (installation) break

              if (retries > MAX_RETRIES) {
                s.stop(
                  `Failed to detect GitHub app installation. Make sure to install the app for the \`${app.owner}/${app.repo}\` repository.`,
                )
                throw new UI.CancelledError()
              }

              retries++
              await sleep(1000)
            } while (true)

            s.stop("Installed GitHub app")

            async function getInstallation() {
              try {
                const response = await fetch(
                  `${requireOidcBaseUrl()}/get_github_app_installation?owner=${app.owner}&repo=${app.repo}`,
                )
                if (!response.ok) return null

                const data = (await response.json()) as { installation?: unknown }
                return data.installation ?? null
              } catch {
                return null
              }
            }
          }

          async function addWorkflowFiles() {
            const envStr = `\n        env:${providers[provider].env.map((e) => `\n          ${e}: \${{ secrets.${e} }}`).join("")}`

            await Filesystem.write(
              path.join(app.root, WORKFLOW_FILE),
              `name: ax-code

on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]

jobs:
  "ax-code":
    if: |
      contains(github.event.comment.body, ' /oc') ||
      startsWith(github.event.comment.body, '/oc') ||
      contains(github.event.comment.body, ' /ax-code') ||
      startsWith(github.event.comment.body, '/ax-code')
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
      pull-requests: read
      issues: read
    steps:
      - name: Checkout repository
        uses: actions/checkout@v6
        with:
          persist-credentials: false

      - name: Run ax-code
        uses: ${GITHUB_ACTION_REF}@latest${envStr}
        with:
          model: ${provider}/${model}`,
            )

            prompts.log.success(`Added workflow file: "${WORKFLOW_FILE}"`)
          }
        }
      },
    })
  },
})
