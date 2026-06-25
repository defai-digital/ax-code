import type { Octokit } from "@octokit/rest"
import type { graphql } from "@octokit/graphql"
import * as core from "@actions/core"
import { toErrorMessage } from "../../../util/error-message"
import { AGENT_USERNAME, AGENT_REACTION } from "./types"
import { hasNewCommits } from "./git-ops"
import type { GitStatusRunner } from "./git-ops"

export type GitHubClients = {
  octoRest: Octokit
  octoGraph: typeof graphql
}

// --- Token management ---

export async function getOidcToken(): Promise<string> {
  try {
    return await core.getIDToken("ax-code-github-action")
  } catch (error) {
    console.error("Failed to get OIDC token:", error instanceof Error ? error.message : error)
    throw new Error(
      "Could not fetch an OIDC token. Make sure to add `id-token: write` to your workflow permissions.",
    )
  }
}

export async function exchangeForAppToken(
  oidcBaseUrl: string,
  token: string,
  owner: string,
  repo: string,
): Promise<string> {
  const response = token.startsWith("github_pat_")
    ? await fetch(`${oidcBaseUrl}/exchange_github_app_token_with_pat`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ owner, repo }),
      })
    : await fetch(`${oidcBaseUrl}/exchange_github_app_token`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })

  if (!response.ok) {
    let detail = response.statusText
    try {
      const responseJson = (await response.json()) as { error?: string }
      detail = responseJson.error ?? detail
    } catch {}
    throw new Error(`App token exchange failed: ${response.status} ${response.statusText} - ${detail}`)
  }

  let responseJson: { token?: unknown }
  try {
    responseJson = (await response.json()) as { token?: unknown }
  } catch {
    throw new Error("App token exchange returned invalid JSON")
  }
  if (typeof responseJson.token !== "string" || responseJson.token.length === 0) {
    throw new Error("App token exchange returned an invalid token response")
  }
  return responseJson.token
}

export async function revokeAppToken(appToken: string) {
  await fetch("https://api.github.com/installation/token", {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${appToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  })
}

// --- Permissions ---

export async function assertPermissions(octoRest: Octokit, owner: string, repo: string, actor: string) {
  console.log(`Asserting permissions for user ${actor}...`)

  let permission
  try {
    const response = await octoRest.repos.getCollaboratorPermissionLevel({
      owner,
      repo,
      username: actor,
    })
    permission = response.data.permission
    console.log(`  permission: ${permission}`)
  } catch (error) {
    console.error(`Failed to check permissions: ${toErrorMessage(error)}`)
    throw new Error(`Failed to check permissions for user ${actor}: ${toErrorMessage(error)}`, { cause: error })
  }

  if (!["admin", "write"].includes(permission)) throw new Error(`User ${actor} does not have write permissions`)
}

// --- Reactions ---

export async function addReaction(
  octoRest: Octokit,
  owner: string,
  repo: string,
  triggerCommentId: number | undefined,
  issueId: number | undefined,
  commentType?: "issue" | "pr_review",
) {
  console.log("Adding reaction...")
  if (triggerCommentId) {
    if (commentType === "pr_review") {
      return await octoRest.rest.reactions.createForPullRequestReviewComment({
        owner,
        repo,
        comment_id: triggerCommentId,
        content: AGENT_REACTION,
      })
    }
    return await octoRest.rest.reactions.createForIssueComment({
      owner,
      repo,
      comment_id: triggerCommentId,
      content: AGENT_REACTION,
    })
  }
  return await octoRest.rest.reactions.createForIssue({
    owner,
    repo,
    issue_number: issueId!,
    content: AGENT_REACTION,
  })
}

export async function removeReaction(
  octoRest: Octokit,
  owner: string,
  repo: string,
  triggerCommentId: number | undefined,
  issueId: number | undefined,
  commentType?: "issue" | "pr_review",
) {
  console.log("Removing reaction...")
  if (triggerCommentId) {
    if (commentType === "pr_review") {
      const reactions = await octoRest.rest.reactions.listForPullRequestReviewComment({
        owner,
        repo,
        comment_id: triggerCommentId,
        content: AGENT_REACTION,
      })
      const eyesReaction = reactions.data.find((r) => r.user?.login === AGENT_USERNAME)
      if (!eyesReaction) return
      return await octoRest.rest.reactions.deleteForPullRequestComment({
        owner,
        repo,
        comment_id: triggerCommentId,
        reaction_id: eyesReaction.id,
      })
    }

    const reactions = await octoRest.rest.reactions.listForIssueComment({
      owner,
      repo,
      comment_id: triggerCommentId,
      content: AGENT_REACTION,
    })
    const eyesReaction = reactions.data.find((r) => r.user?.login === AGENT_USERNAME)
    if (!eyesReaction) return
    return await octoRest.rest.reactions.deleteForIssueComment({
      owner,
      repo,
      comment_id: triggerCommentId,
      reaction_id: eyesReaction.id,
    })
  }

  const reactions = await octoRest.rest.reactions.listForIssue({
    owner,
    repo,
    issue_number: issueId!,
    content: AGENT_REACTION,
  })
  const eyesReaction = reactions.data.find((r) => r.user?.login === AGENT_USERNAME)
  if (!eyesReaction) return
  await octoRest.rest.reactions.deleteForIssue({
    owner,
    repo,
    issue_number: issueId!,
    reaction_id: eyesReaction.id,
  })
}

// --- Comments ---

export async function createComment(
  octoRest: Octokit,
  owner: string,
  repo: string,
  issueId: number,
  body: string,
) {
  console.log("Creating comment...")
  return await octoRest.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueId,
    body,
  })
}

// --- PR management ---

export async function createPR(
  octoRest: Octokit,
  owner: string,
  repo: string,
  base: string,
  branch: string,
  title: string,
  body: string,
  gitStatus: GitStatusRunner,
): Promise<number | null> {
  console.log("Creating pull request...")

  try {
    const existing = await withRetry(() =>
      octoRest.rest.pulls.list({
        owner,
        repo,
        head: `${owner}:${branch}`,
        base,
        state: "open",
      }),
    )

    if (existing.data.length > 0) {
      console.log(`PR #${existing.data[0].number} already exists for branch ${branch}`)
      return existing.data[0].number
    }
  } catch (e) {
    core.warning(`Failed to check for existing PR: ${toErrorMessage(e)}`)
  }

  if (!(await hasNewCommits(gitStatus, base, branch))) {
    console.log(`No commits between ${base} and ${branch}, skipping PR creation`)
    return null
  }

  try {
    const pr = await withRetry(() =>
      octoRest.rest.pulls.create({
        owner,
        repo,
        head: branch,
        base,
        title,
        body,
      }),
    )
    return pr.data.number
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("No commits between")) {
      console.log(`GitHub rejected PR: ${e.message}`)
      return null
    }
    throw e
  }
}

// --- Repo data ---

export async function fetchRepo(octoRest: Octokit, owner: string, repo: string) {
  return await octoRest.rest.repos.get({ owner, repo })
}

// --- Retry helper ---

export async function withRetry<T>(fn: () => Promise<T>, retries = 1, delayMs = 5000): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (retries > 0) {
      console.log(`Retrying after ${delayMs}ms...`)
      const { setTimeout: sleep } = await import("node:timers/promises")
      await sleep(delayMs)
      return withRetry(fn, retries - 1, delayMs)
    }
    throw e
  }
}
