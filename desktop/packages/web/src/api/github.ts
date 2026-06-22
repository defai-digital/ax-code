import type {
  GitHubAPI,
  GitHubAuthStatus,
  GitHubIssueCommentsResult,
  GitHubIssueGetResult,
  GitHubIssuesListResult,
  GitHubPullRequestContextResult,
  GitHubPullRequestsListResult,
  GitHubPullRequest,
  GitHubPullRequestCreateInput,
  GitHubPullRequestMergeInput,
  GitHubPullRequestMergeResult,
  GitHubPullRequestReadyInput,
  GitHubPullRequestReadyResult,
  GitHubPullRequestUpdateInput,
  GitHubPullRequestStatus,
  GitHubRepoUpstreamResult,
  GitHubDeviceFlowComplete,
  GitHubDeviceFlowStart,
  GitHubUserSummary,
} from "@openchamber/ui/api/types"
import { API_ENDPOINTS, HTTP_DEFAULTS, HTTP_QUERY_STRINGS, buildQueryUrl } from "./constants"

const jsonOrNull = async <T>(response: Response): Promise<T | null> => {
  return (await response.json().catch(() => null)) as T | null
}

export const createWebGitHubAPI = (): GitHubAPI => ({
  async authStatus(): Promise<GitHubAuthStatus> {
    const response = await fetch(API_ENDPOINTS.github.authStatus, {
      method: HTTP_DEFAULTS.method.get,
      headers: HTTP_DEFAULTS.headers.acceptJson,
    })
    const payload = await jsonOrNull<GitHubAuthStatus & { error?: string }>(response)
    if (!response.ok || !payload) {
      throw new Error(payload?.error || response.statusText || "Failed to load GitHub status")
    }
    return payload
  },

  async authStart(): Promise<GitHubDeviceFlowStart> {
    const response = await fetch(API_ENDPOINTS.github.authStart, {
      method: HTTP_DEFAULTS.method.post,
      headers: HTTP_DEFAULTS.headers.acceptAndContentTypeJson,
      body: JSON.stringify({}),
    })
    const payload = await jsonOrNull<GitHubDeviceFlowStart & { error?: string }>(response)
    if (!response.ok || !payload || !("deviceCode" in payload)) {
      throw new Error(
        (payload as { error?: string } | null)?.error || response.statusText || "Failed to start GitHub auth",
      )
    }
    return payload
  },

  async authComplete(deviceCode: string): Promise<GitHubDeviceFlowComplete> {
    const response = await fetch(API_ENDPOINTS.github.authComplete, {
      method: HTTP_DEFAULTS.method.post,
      headers: HTTP_DEFAULTS.headers.acceptAndContentTypeJson,
      body: JSON.stringify({ deviceCode }),
    })
    const payload = await jsonOrNull<GitHubDeviceFlowComplete & { error?: string }>(response)
    if (!response.ok || !payload) {
      throw new Error(
        (payload as { error?: string } | null)?.error || response.statusText || "Failed to complete GitHub auth",
      )
    }
    return payload
  },

  async authDisconnect(): Promise<{ removed: boolean }> {
    const response = await fetch(API_ENDPOINTS.github.auth, {
      method: HTTP_DEFAULTS.method.delete,
      headers: HTTP_DEFAULTS.headers.acceptJson,
    })
    const payload = await jsonOrNull<{ removed?: boolean; error?: string }>(response)
    if (!response.ok) {
      throw new Error(payload?.error || response.statusText || "Failed to disconnect GitHub")
    }
    return { removed: Boolean(payload?.removed) }
  },

  async authActivate(accountId: string): Promise<GitHubAuthStatus> {
    const response = await fetch(API_ENDPOINTS.github.authActivate, {
      method: HTTP_DEFAULTS.method.post,
      headers: HTTP_DEFAULTS.headers.acceptAndContentTypeJson,
      body: JSON.stringify({ accountId }),
    })
    const payload = await jsonOrNull<GitHubAuthStatus & { error?: string }>(response)
    if (!response.ok || !payload) {
      throw new Error(payload?.error || response.statusText || "Failed to activate GitHub account")
    }
    return payload
  },

  async me(): Promise<GitHubUserSummary> {
    const response = await fetch(API_ENDPOINTS.github.me, {
      method: HTTP_DEFAULTS.method.get,
      headers: HTTP_DEFAULTS.headers.acceptJson,
    })
    const payload = await jsonOrNull<GitHubUserSummary & { error?: string }>(response)
    if (!response.ok || !payload) {
      throw new Error(payload?.error || response.statusText || "Failed to fetch GitHub user")
    }
    return payload
  },

  async prStatus(
    directory: string,
    branch: string,
    remote?: string,
    options?: { force?: boolean },
  ): Promise<GitHubPullRequestStatus> {
    const params = new URLSearchParams({
      directory,
      branch,
      ...(remote ? { remote } : {}),
      ...(options?.force ? { force: HTTP_QUERY_STRINGS.true } : {}),
    })
    const response = await fetch(buildQueryUrl(API_ENDPOINTS.github.prStatus, params), {
      method: HTTP_DEFAULTS.method.get,
      headers: HTTP_DEFAULTS.headers.acceptJson,
    })
    const payload = await jsonOrNull<GitHubPullRequestStatus & { error?: string }>(response)
    if (!response.ok || !payload) {
      throw new Error(payload?.error || response.statusText || "Failed to load PR status")
    }
    return payload
  },

  async prCreate(payload: GitHubPullRequestCreateInput): Promise<GitHubPullRequest> {
    const response = await fetch(API_ENDPOINTS.github.prCreate, {
      method: HTTP_DEFAULTS.method.post,
      headers: HTTP_DEFAULTS.headers.acceptAndContentTypeJson,
      body: JSON.stringify(payload),
    })
    const body = await jsonOrNull<GitHubPullRequest & { error?: string }>(response)
    if (!response.ok || !body) {
      throw new Error((body as { error?: string } | null)?.error || response.statusText || "Failed to create PR")
    }
    return body
  },

  async prUpdate(payload: GitHubPullRequestUpdateInput): Promise<GitHubPullRequest> {
    const response = await fetch(API_ENDPOINTS.github.prUpdate, {
      method: HTTP_DEFAULTS.method.post,
      headers: HTTP_DEFAULTS.headers.acceptAndContentTypeJson,
      body: JSON.stringify(payload),
    })
    const body = await jsonOrNull<GitHubPullRequest & { error?: string }>(response)
    if (!response.ok || !body) {
      throw new Error((body as { error?: string } | null)?.error || response.statusText || "Failed to update PR")
    }
    return body
  },

  async prMerge(payload: GitHubPullRequestMergeInput): Promise<GitHubPullRequestMergeResult> {
    const response = await fetch(API_ENDPOINTS.github.prMerge, {
      method: HTTP_DEFAULTS.method.post,
      headers: HTTP_DEFAULTS.headers.acceptAndContentTypeJson,
      body: JSON.stringify(payload),
    })
    const body = await jsonOrNull<GitHubPullRequestMergeResult & { error?: string }>(response)
    if (!response.ok || !body) {
      throw new Error((body as { error?: string } | null)?.error || response.statusText || "Failed to merge PR")
    }
    return body
  },

  async prReady(payload: GitHubPullRequestReadyInput): Promise<GitHubPullRequestReadyResult> {
    const response = await fetch(API_ENDPOINTS.github.prReady, {
      method: HTTP_DEFAULTS.method.post,
      headers: HTTP_DEFAULTS.headers.acceptAndContentTypeJson,
      body: JSON.stringify(payload),
    })
    const body = await jsonOrNull<GitHubPullRequestReadyResult & { error?: string }>(response)
    if (!response.ok || !body) {
      throw new Error((body as { error?: string } | null)?.error || response.statusText || "Failed to mark PR ready")
    }
    return body
  },

  async repoUpstream(directory: string): Promise<GitHubRepoUpstreamResult> {
    const response = await fetch(
      buildQueryUrl(API_ENDPOINTS.github.repoUpstream, `directory=${encodeURIComponent(directory)}`),
      {
        method: HTTP_DEFAULTS.method.get,
        headers: HTTP_DEFAULTS.headers.acceptJson,
      },
    )
    const body = await jsonOrNull<GitHubRepoUpstreamResult & { error?: string }>(response)
    if (!response.ok || !body) {
      throw new Error(body?.error || response.statusText || "Failed to detect upstream repo")
    }
    return body
  },

  async repoBranches(owner: string, repo: string): Promise<string[]> {
    const response = await fetch(
      buildQueryUrl(
        API_ENDPOINTS.github.repoBranches,
        `owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`,
      ),
      {
        method: HTTP_DEFAULTS.method.get,
        headers: HTTP_DEFAULTS.headers.acceptJson,
      },
    )
    const body = await jsonOrNull<{ branches?: string[]; error?: string }>(response)
    if (!response.ok || !body) {
      throw new Error(body?.error || response.statusText || "Failed to fetch repo branches")
    }
    return body.branches ?? []
  },

  async prsList(directory: string, options?: { page?: number }): Promise<GitHubPullRequestsListResult> {
    const page = options?.page ?? 1
    const response = await fetch(
      buildQueryUrl(
        API_ENDPOINTS.github.pullsList,
        `directory=${encodeURIComponent(directory)}&page=${encodeURIComponent(String(page))}`,
      ),
      {
        method: HTTP_DEFAULTS.method.get,
        headers: HTTP_DEFAULTS.headers.acceptJson,
      },
    )
    const body = await jsonOrNull<GitHubPullRequestsListResult & { error?: string }>(response)
    if (!response.ok || !body) {
      throw new Error(body?.error || response.statusText || "Failed to load pull requests")
    }
    return body
  },

  async prContext(
    directory: string,
    number: number,
    options?: {
      includeDiff?: boolean
      includeCheckDetails?: boolean
      sourceRepo?: { owner: string; repo: string } | null
    },
  ): Promise<GitHubPullRequestContextResult> {
    const url = new URL(API_ENDPOINTS.github.pullsContext, window.location.origin)
    url.searchParams.set("directory", directory)
    url.searchParams.set("number", String(number))
    if (options?.includeDiff) {
      url.searchParams.set("diff", HTTP_QUERY_STRINGS.one)
    }
    if (options?.includeCheckDetails) {
      url.searchParams.set("checkDetails", HTTP_QUERY_STRINGS.one)
    }
    if (options?.sourceRepo?.owner && options.sourceRepo.repo) {
      url.searchParams.set("owner", options.sourceRepo.owner)
      url.searchParams.set("repo", options.sourceRepo.repo)
    }
    const response = await fetch(url.toString(), {
      method: HTTP_DEFAULTS.method.get,
      headers: HTTP_DEFAULTS.headers.acceptJson,
    })
    const body = await jsonOrNull<GitHubPullRequestContextResult & { error?: string }>(response)
    if (!response.ok || !body) {
      throw new Error(body?.error || response.statusText || "Failed to load pull request context")
    }
    return body
  },

  async issuesList(directory: string, options?: { page?: number }): Promise<GitHubIssuesListResult> {
    const page = options?.page ?? 1
    const response = await fetch(
      buildQueryUrl(
        API_ENDPOINTS.github.issuesList,
        `directory=${encodeURIComponent(directory)}&page=${encodeURIComponent(String(page))}`,
      ),
      {
        method: HTTP_DEFAULTS.method.get,
        headers: HTTP_DEFAULTS.headers.acceptJson,
      },
    )
    const payload = await jsonOrNull<GitHubIssuesListResult & { error?: string }>(response)
    if (!response.ok || !payload) {
      throw new Error(payload?.error || response.statusText || "Failed to load issues")
    }
    return payload
  },

  async issueGet(
    directory: string,
    number: number,
    options?: { sourceRepo?: { owner: string; repo: string } | null },
  ): Promise<GitHubIssueGetResult> {
    const url = new URL(API_ENDPOINTS.github.issuesGet, window.location.origin)
    url.searchParams.set("directory", directory)
    url.searchParams.set("number", String(number))
    if (options?.sourceRepo?.owner && options.sourceRepo.repo) {
      url.searchParams.set("owner", options.sourceRepo.owner)
      url.searchParams.set("repo", options.sourceRepo.repo)
    }
    const response = await fetch(url.toString(), {
      method: HTTP_DEFAULTS.method.get,
      headers: HTTP_DEFAULTS.headers.acceptJson,
    })
    const payload = await jsonOrNull<GitHubIssueGetResult & { error?: string }>(response)
    if (!response.ok || !payload) {
      throw new Error(payload?.error || response.statusText || "Failed to load issue")
    }
    return payload
  },

  async issueComments(
    directory: string,
    number: number,
    options?: { sourceRepo?: { owner: string; repo: string } | null },
  ): Promise<GitHubIssueCommentsResult> {
    const url = new URL(API_ENDPOINTS.github.issuesComments, window.location.origin)
    url.searchParams.set("directory", directory)
    url.searchParams.set("number", String(number))
    if (options?.sourceRepo?.owner && options.sourceRepo.repo) {
      url.searchParams.set("owner", options.sourceRepo.owner)
      url.searchParams.set("repo", options.sourceRepo.repo)
    }
    const response = await fetch(url.toString(), {
      method: HTTP_DEFAULTS.method.get,
      headers: HTTP_DEFAULTS.headers.acceptJson,
    })
    const payload = await jsonOrNull<GitHubIssueCommentsResult & { error?: string }>(response)
    if (!response.ok || !payload) {
      throw new Error(payload?.error || response.statusText || "Failed to load issue comments")
    }
    return payload
  },
})
