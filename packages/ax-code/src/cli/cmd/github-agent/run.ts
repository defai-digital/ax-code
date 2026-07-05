import { Octokit } from "@octokit/rest"
import { graphql } from "@octokit/graphql"
import * as core from "@actions/core"
import * as github from "@actions/github"
import type { Context } from "@actions/github/lib/context"
import type {
  IssueCommentEvent,
  IssuesEvent,
  PullRequestReviewCommentEvent,
  WorkflowDispatchEvent,
  WorkflowRunEvent,
  PullRequestEvent,
} from "@octokit/webhooks-types"
import { cmd } from "../cmd"
import { bootstrap } from "../../bootstrap"
import { Session } from "../../../session"
import type { SessionID } from "../../../session/schema"
import { MessageID, PartID } from "../../../session/schema"
import { Provider } from "../../../provider/provider"
import { Bus } from "../../../bus"
import { MessageV2 } from "../../../session/message-v2"
import { toErrorMessage } from "../../../util/error-message"
import { SessionPrompt } from "../../../session/prompt"
import { Instance } from "../../../project/instance"
import { isNonEmptyRecord } from "../../../util/record"
import { parseJsonResult } from "../../../util/json-value"
import { Process } from "../../../util/process"
import { UI } from "../../ui"
import {
  SUPPORTED_EVENTS,
  USER_EVENTS,
  REPO_EVENTS,
} from "./types"
import type { UserEvent, RepoEvent } from "./types"
import { extractResponseText, formatPromptTooLargeError } from "./types"
import {
  createGitHelpers,
  commitChanges,
  checkoutNewBranch,
  checkoutLocalBranch,
  checkoutForkBranch,
  pushToNewBranch,
  pushToLocalBranch,
  pushToForkBranch,
  branchIsDirty,
  configureGit,
  restoreGitConfig,
} from "./git-ops"
import {
  getOidcToken,
  exchangeForAppToken,
  revokeAppToken,
  assertPermissions,
  addReaction,
  removeReaction,
  createComment,
  createPR,
  fetchRepo,
} from "./github-api"
import {
  getUserPrompt,
  buildPromptDataForIssue,
  buildPromptDataForPR,
  fetchIssueData,
  fetchPRData,
} from "./prompts"
import type { PromptFile } from "./prompts"

function requireOidcBaseUrl(): string {
  const value = process.env["OIDC_BASE_URL"]
  if (!value) throw new Error("OIDC_BASE_URL environment variable is required for GitHub App integration")
  return value.replace(/\/+$/, "")
}

export function formatGitHubAgentToolTitle(input: { title?: unknown; input?: unknown }): string {
  if (typeof input.title === "string" && input.title.length > 0) return input.title
  if (!isNonEmptyRecord(input.input)) return "Unknown"
  const seen = new WeakSet<object>()
  try {
    return (
      JSON.stringify(input.input, (_key, value) => {
        if (typeof value === "bigint") return value.toString()
        if (value && typeof value === "object") {
          if (seen.has(value)) return "[Circular]"
          seen.add(value)
        }
        return value
      }) ?? "Unknown"
    )
  } catch {
    return "Unknown"
  }
}

export function formatGitHubAgentFailureMessage(error: unknown): string {
  if (error instanceof Process.RunFailedError) return error.stderr.toString()
  return toErrorMessage(error)
}

export function formatGitHubAgentPermissionCheckFailureMessage(actor: string | undefined, error: unknown): string {
  return `Failed to check permissions for user ${actor}: ${formatGitHubAgentFailureMessage(error)}`
}

export function formatGitHubAgentExistingPrCheckWarning(error: unknown): string {
  return `Failed to check for existing PR: ${formatGitHubAgentFailureMessage(error)}`
}

export function parseGitHubRunContextText(text: string): Context {
  const parsed = parseJsonResult(text)
  if (!parsed.ok) {
    throw new Error(`Failed to parse --event as JSON: ${text}`, { cause: parsed.error })
  }
  return parsed.value as Context
}

function isIssueCommentEvent(
  event: IssueCommentEvent | IssuesEvent | PullRequestReviewCommentEvent | WorkflowDispatchEvent | WorkflowRunEvent | PullRequestEvent,
): event is IssueCommentEvent {
  return "issue" in event && "comment" in event
}

export const GithubRunCommand = cmd({
  command: "run",
  describe: "run the GitHub agent",
  builder: (yargs) =>
    yargs
      .option("event", {
        type: "string",
        describe: "GitHub mock event to run the agent for",
      })
      .option("token", {
        type: "string",
        describe: "GitHub personal access token (github_pat_********)",
      }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const isMock = !!(args.token && args.event)

      let context: Context
      if (isMock) {
        try {
          context = parseGitHubRunContextText(args.event!)
        } catch (error) {
          core.setFailed(error instanceof Error ? error.message : `Failed to parse --event as JSON: ${args.event}`)
          process.exit(1)
        }
      } else {
        context = github.context
      }
      if (!SUPPORTED_EVENTS.includes(context.eventName as (typeof SUPPORTED_EVENTS)[number])) {
        core.setFailed(`Unsupported event type: ${context.eventName}`)
        process.exit(1)
      }

      const isUserEvent = USER_EVENTS.includes(context.eventName as UserEvent)
      const isRepoEvent = REPO_EVENTS.includes(context.eventName as RepoEvent)
      const isCommentEvent = ["issue_comment", "pull_request_review_comment"].includes(context.eventName)
      const isIssuesEvent = context.eventName === "issues"
      const isScheduleEvent = context.eventName === "schedule"
      const isWorkflowDispatchEvent = context.eventName === "workflow_dispatch"

      const { providerID, modelID } = normalizeModel()
      const variant = process.env["VARIANT"] || undefined
      const runId = normalizeRunId()
      const oidcBaseUrl = () => requireOidcBaseUrl()
      const { owner, repo } = context.repo
      const payload = context.payload as
        | IssueCommentEvent
        | IssuesEvent
        | PullRequestReviewCommentEvent
        | WorkflowDispatchEvent
        | WorkflowRunEvent
        | PullRequestEvent
      const issueEvent = isIssueCommentEvent(payload) ? payload : undefined
      const actor = isScheduleEvent ? undefined : context.actor

      const issueId = isRepoEvent
        ? undefined
        : context.eventName === "issue_comment" || context.eventName === "issues"
          ? (payload as IssueCommentEvent | IssuesEvent).issue.number
          : (payload as PullRequestEvent | PullRequestReviewCommentEvent).pull_request.number
      const runUrl = `/${owner}/${repo}/actions/runs/${runId}`

      let appToken: string
      let octoRest: Octokit
      let octoGraph: typeof graphql
      let session: { id: SessionID; title: string; version: string }
      let exitCode = 0
      const triggerCommentId = isCommentEvent
        ? (payload as IssueCommentEvent | PullRequestReviewCommentEvent).comment.id
        : undefined
      const useGithubToken = normalizeUseGithubToken()
      const commentType = isCommentEvent
        ? context.eventName === "pull_request_review_comment"
          ? "pr_review"
          : "issue"
        : undefined

      const { gitText, gitRun, gitStatus } = createGitHelpers(Instance.worktree)
      const doCommitChanges = async (summary: string, commitActor?: string) => commitChanges(gitRun, summary, commitActor)

      let savedUserName: string | undefined
      let savedUserEmail: string | undefined
      let savedGitConfig: string | undefined

      try {
        if (useGithubToken) {
          const githubToken = process.env["GITHUB_TOKEN"]
          if (!githubToken) {
            throw new Error(
              "GITHUB_TOKEN environment variable is not set. When using use_github_token, you must provide GITHUB_TOKEN.",
            )
          }
          appToken = githubToken
        } else {
          const actionToken = isMock ? args.token! : await getOidcToken()
          appToken = await exchangeForAppToken(oidcBaseUrl(), actionToken, owner, repo)
        }
        octoRest = new Octokit({ auth: appToken })
        octoGraph = graphql.defaults({
          headers: { authorization: `token ${appToken}` },
        })

        const { userPrompt, promptFiles } = await getUserPrompt({
          eventName: context.eventName,
          payload: payload as IssueCommentEvent | IssuesEvent | PullRequestReviewCommentEvent,
          isRepoEvent,
          isIssuesEvent,
          isCommentEvent,
          appToken,
        })

        if (!useGithubToken) {
          const config = await configureGit(gitRun, gitStatus, appToken, isMock)
          savedUserName = config.savedUserName
          savedUserEmail = config.savedUserEmail
          savedGitConfig = config.savedGitConfig
        }

        if (isUserEvent) {
          await assertPermissions(octoRest, owner, repo, actor!)
          await addReaction(octoRest, owner, repo, triggerCommentId, issueId, commentType)
        }

        const repoData = await fetchRepo(octoRest, owner, repo)
        session = await Session.create({
          permission: [{ permission: "question", action: "deny", pattern: "*" }],
        })
        subscribeSessionEvents()
        console.log("ax-code session", session.id)

        if (isRepoEvent) {
          if (isWorkflowDispatchEvent && actor) {
            console.log(`Triggered by: ${actor}`)
          }
          const branchPrefix = isWorkflowDispatchEvent ? "dispatch" : "schedule"
          const branch = await checkoutNewBranch(gitRun, branchPrefix, issueId)
          const head = await gitText(["rev-parse", "HEAD"])
          const response = await chat(userPrompt, promptFiles)
          const { dirty, uncommittedChanges, switched } = await branchIsDirty(gitText, gitStatus, head, branch)
          if (switched) {
            console.log("Agent managed its own branch, skipping infrastructure push/PR")
            console.log("Response:", response)
          } else if (dirty) {
            const summary = await summarize(response)
            const doCommit = () => doCommitChanges(summary, isScheduleEvent ? undefined : actor)
            await pushToNewBranch(gitRun, doCommit, branch, uncommittedChanges)
            const triggerType = isWorkflowDispatchEvent ? "workflow_dispatch" : "scheduled workflow"
            const pr = await createPR(
              octoRest, owner, repo,
              repoData.data.default_branch, branch, summary,
              `${response}\n\nTriggered by ${triggerType}${footer()}`,
              gitStatus,
            )
            if (pr) console.log(`Created PR #${pr}`)
            else console.log("Skipped PR creation (no new commits)")
          } else {
            console.log("Response:", response)
          }
        } else if (
          ["pull_request", "pull_request_review_comment"].includes(context.eventName) ||
          issueEvent?.issue?.pull_request
        ) {
          const prData = await fetchPRData(octoGraph, owner, repo, issueId!)
          if (prData.headRepository.nameWithOwner === prData.baseRepository.nameWithOwner) {
            await checkoutLocalBranch(gitRun, prData)
            const head = await gitText(["rev-parse", "HEAD"])
            const dataPrompt = buildPromptDataForPR(prData)
            const response = await chat(`${userPrompt}\n\n${dataPrompt}`, promptFiles)
            const { dirty, uncommittedChanges, switched } = await branchIsDirty(gitText, gitStatus, head, prData.headRefName)
            if (switched) console.log("Agent managed its own branch, skipping infrastructure push")
            if (dirty && !switched) {
              const summary = await summarize(response)
              await pushToLocalBranch(gitRun, () => doCommitChanges(summary, actor), uncommittedChanges)
            }
            await createComment(octoRest, owner, repo, issueId!, `${response}${footer()}`)
            await removeReaction(octoRest, owner, repo, triggerCommentId, issueId, commentType)
          } else {
            const forkBranch = await checkoutForkBranch(gitRun, gitStatus, prData)
            const head = await gitText(["rev-parse", "HEAD"])
            const dataPrompt = buildPromptDataForPR(prData)
            const response = await chat(`${userPrompt}\n\n${dataPrompt}`, promptFiles)
            const { dirty, uncommittedChanges, switched } = await branchIsDirty(gitText, gitStatus, head, forkBranch)
            if (switched) console.log("Agent managed its own branch, skipping infrastructure push")
            if (dirty && !switched) {
              const summary = await summarize(response)
              await pushToForkBranch(gitRun, () => doCommitChanges(summary, actor), prData.headRefName, uncommittedChanges)
            }
            await createComment(octoRest, owner, repo, issueId!, `${response}${footer()}`)
            await removeReaction(octoRest, owner, repo, triggerCommentId, issueId, commentType)
          }
        } else {
          const branch = await checkoutNewBranch(gitRun, "issue", issueId)
          const head = await gitText(["rev-parse", "HEAD"])
          const issueData = await fetchIssueData(octoGraph, owner, repo, issueId!)
          const dataPrompt = buildPromptDataForIssue(issueData)
          const response = await chat(`${userPrompt}\n\n${dataPrompt}`, promptFiles)
          const { dirty, uncommittedChanges, switched } = await branchIsDirty(gitText, gitStatus, head, branch)
          if (switched) {
            await createComment(octoRest, owner, repo, issueId!, `${response}${footer()}`)
            await removeReaction(octoRest, owner, repo, triggerCommentId, issueId, commentType)
          } else if (dirty) {
            const summary = await summarize(response)
            const doCommit = () => doCommitChanges(summary, actor)
            await pushToNewBranch(gitRun, doCommit, branch, uncommittedChanges)
            const pr = await createPR(
              octoRest, owner, repo,
              repoData.data.default_branch, branch, summary,
              `${response}\n\nCloses #${issueId}${footer()}`,
              gitStatus,
            )
            if (pr) await createComment(octoRest, owner, repo, issueId!, `Created PR #${pr}${footer()}`)
            else await createComment(octoRest, owner, repo, issueId!, `${response}${footer()}`)
            await removeReaction(octoRest, owner, repo, triggerCommentId, issueId, commentType)
          } else {
            await createComment(octoRest, owner, repo, issueId!, `${response}${footer()}`)
            await removeReaction(octoRest, owner, repo, triggerCommentId, issueId, commentType)
          }
        }
      } catch (e: unknown) {
        exitCode = 1
        console.error(toErrorMessage(e))
        const msg = formatGitHubAgentFailureMessage(e)
        if (isUserEvent) {
          await createComment(octoRest!, owner, repo, issueId!, `${msg}${footer()}`)
          await removeReaction(octoRest!, owner, repo, triggerCommentId, issueId, commentType)
        }
        core.setFailed(msg)
      } finally {
        if (!useGithubToken) {
          await restoreGitConfig(gitRun, isMock, savedUserName, savedUserEmail, savedGitConfig)
          await revokeAppToken(appToken!)
        }
      }
      process.exit(exitCode)

      function normalizeModel() {
        const value = process.env["MODEL"]
        if (!value) throw new Error(`Environment variable "MODEL" is not set`)
        const { providerID, modelID } = Provider.parseModel(value)
        if (!providerID.length || !modelID.length)
          throw new Error(`Invalid model ${value}. Model must be in the format "provider/model".`)
        return { providerID, modelID }
      }

      function normalizeRunId() {
        const value = process.env["GITHUB_RUN_ID"]
        if (!value) throw new Error(`Environment variable "GITHUB_RUN_ID" is not set`)
        return value
      }

      function normalizeUseGithubToken() {
        const value = process.env["USE_GITHUB_TOKEN"]
        if (!value) return false
        if (value === "true") return true
        if (value === "false") return false
        throw new Error(`Invalid use_github_token value: ${value}. Must be a boolean.`)
      }

      function subscribeSessionEvents() {
        const TOOL: Record<string, [string, string]> = {
          todowrite: ["Todo", UI.Style.TEXT_WARNING_BOLD],
          todoread: ["Todo", UI.Style.TEXT_WARNING_BOLD],
          bash: ["Bash", UI.Style.TEXT_DANGER_BOLD],
          edit: ["Edit", UI.Style.TEXT_SUCCESS_BOLD],
          glob: ["Glob", UI.Style.TEXT_INFO_BOLD],
          grep: ["Grep", UI.Style.TEXT_INFO_BOLD],
          list: ["List", UI.Style.TEXT_INFO_BOLD],
          read: ["Read", UI.Style.TEXT_HIGHLIGHT_BOLD],
          write: ["Write", UI.Style.TEXT_SUCCESS_BOLD],
          websearch: ["Search", UI.Style.TEXT_DIM_BOLD],
        }

        function printEvent(color: string, type: string, title: string) {
          UI.println(
            color + `|`,
            UI.Style.TEXT_NORMAL + UI.Style.TEXT_DIM + ` ${type.padEnd(7, " ")}`,
            "",
            UI.Style.TEXT_NORMAL + title,
          )
        }

        let text = ""
        Bus.subscribe(MessageV2.Event.PartUpdated, async (evt) => {
          if (evt.properties.part.sessionID !== session.id) return
          const part = evt.properties.part

          if (part.type === "tool" && part.state.status === "completed") {
            const [tool, color] = TOOL[part.tool] ?? [part.tool, UI.Style.TEXT_INFO_BOLD]
            const title = formatGitHubAgentToolTitle({ title: part.state.title, input: part.state.input })
            console.log()
            printEvent(color, tool, title)
          }

          if (part.type === "text") {
            text = part.text
            if (part.time?.end) {
              UI.empty()
              UI.println(UI.markdown(text))
              UI.empty()
              text = ""
            }
          }
        })
      }

      async function summarize(response: string) {
        try {
          return await chat(`Summarize the following in less than 40 characters:\n\n${response}`)
        } catch {
          const title = issueEvent
            ? issueEvent.issue.title
            : (payload as PullRequestReviewCommentEvent).pull_request.title
          return `Fix issue: ${title}`
        }
      }

      async function chat(message: string, files: PromptFile[] = []) {
        console.log("Sending message to ax-code...")

        const result = await SessionPrompt.prompt({
          sessionID: session.id,
          messageID: MessageID.ascending(),
          variant,
          model: { providerID, modelID },
          parts: [
            { id: PartID.ascending(), type: "text", text: message },
            ...files.flatMap((f) => [
              {
                id: PartID.ascending(),
                type: "file" as const,
                mime: f.mime,
                url: `data:${f.mime};base64,${f.content}`,
                filename: f.filename,
                source: {
                  type: "file" as const,
                  text: { value: f.replacement, start: f.start, end: f.end },
                  path: f.filename,
                },
              },
            ]),
          ],
        })

        if (result.info.role === "assistant" && result.info.error) {
          const err = result.info.error
          console.error("Agent error:", err)
          if (err.name === "ContextOverflowError") throw new Error(formatPromptTooLargeError(files))
          const errorMsg = err.data?.message || ""
          throw new Error(`${err.name}: ${errorMsg}`, { cause: err })
        }

        const text = extractResponseText(result.parts)
        if (text) return text

        console.log("Requesting summary from agent...")
        const summary = await SessionPrompt.prompt({
          sessionID: session.id,
          messageID: MessageID.ascending(),
          variant,
          model: { providerID, modelID },
          tools: { "*": false },
          parts: [
            {
              id: PartID.ascending(),
              type: "text",
              text: "Summarize the actions (tool calls & reasoning) you did for the user in 1-2 sentences.",
            },
          ],
        })

        if (summary.info.role === "assistant" && summary.info.error) {
          const err = summary.info.error
          console.error("Summary agent error:", err)
          if (err.name === "ContextOverflowError") throw new Error(formatPromptTooLargeError(files))
          const errorMsg = err.data?.message || ""
          throw new Error(`${err.name}: ${errorMsg}`, { cause: err })
        }

        const summaryText = extractResponseText(summary.parts)
        if (!summaryText) throw new Error("Failed to get summary from agent")
        return summaryText
      }

      function footer() {
        return `\n\n[github run](${runUrl})`
      }
    })
  },
})
