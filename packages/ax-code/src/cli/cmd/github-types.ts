import { MessageV2 } from "../../session/message-v2"

export type GitHubAuthor = {
  login: string
  name?: string
}

export type GitHubComment = {
  id: string
  databaseId: string
  body: string
  author: GitHubAuthor
  createdAt: string
}

export type GitHubReviewComment = GitHubComment & {
  path: string
  line: number | null
}

export type GitHubCommit = {
  oid: string
  message: string
  author: {
    name: string
    email: string
  }
}

export type GitHubFile = {
  path: string
  additions: number
  deletions: number
  changeType: string
}

export type GitHubReview = {
  id: string
  databaseId: string
  author: GitHubAuthor
  body: string
  state: string
  submittedAt: string
  comments: {
    nodes: GitHubReviewComment[]
  }
}

export type GitHubPullRequest = {
  title: string
  body: string
  author: GitHubAuthor
  baseRefName: string
  headRefName: string
  headRefOid: string
  createdAt: string
  additions: number
  deletions: number
  state: string
  baseRepository: {
    nameWithOwner: string
  }
  headRepository: {
    nameWithOwner: string
  }
  commits: {
    totalCount: number
    nodes: Array<{
      commit: GitHubCommit
    }>
  }
  files: {
    nodes: GitHubFile[]
  }
  comments: {
    nodes: GitHubComment[]
  }
  reviews: {
    nodes: GitHubReview[]
  }
}

export type GitHubIssue = {
  title: string
  body: string
  author: GitHubAuthor
  createdAt: string
  state: string
  comments: {
    nodes: GitHubComment[]
  }
}

export type PullRequestQueryResponse = {
  repository: {
    pullRequest: GitHubPullRequest
  }
}

export type IssueQueryResponse = {
  repository: {
    issue: GitHubIssue
  }
}

export const AGENT_USERNAME = "ax-code-agent[bot]"
export const AGENT_REACTION = "eyes"
export const WORKFLOW_FILE = ".github/workflows/ax-code.yml"

export const USER_EVENTS = ["issue_comment", "pull_request_review_comment", "issues", "pull_request"] as const
export const REPO_EVENTS = ["schedule", "workflow_dispatch"] as const
export const SUPPORTED_EVENTS = [...USER_EVENTS, ...REPO_EVENTS] as const

export type UserEvent = (typeof USER_EVENTS)[number]
export type RepoEvent = (typeof REPO_EVENTS)[number]

export function parseGitHubRemote(url: string): { owner: string; repo: string } | null {
  const match = url.match(/^(?:(?:https?|ssh):\/\/)?(?:git@)?github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/)
  if (!match) return null
  return { owner: match[1], repo: match[2] }
}

export function extractResponseText(parts: MessageV2.Part[]): string | null {
  const textPart = parts.findLast((p) => p.type === "text")
  if (textPart) return textPart.text
  if (parts.length > 0) return null
  throw new Error("Failed to parse response: no parts returned")
}

export function formatPromptTooLargeError(files: { filename: string; content: string }[]): string {
  const fileDetails =
    files.length > 0
      ? `\n\nFiles in prompt:\n${files.map((f) => `  - ${f.filename} (${((f.content.length * 0.75) / 1024).toFixed(0)} KB)`).join("\n")}`
      : ""
  return `PROMPT_TOO_LARGE: The prompt exceeds the model's context limit.${fileDetails}`
}
