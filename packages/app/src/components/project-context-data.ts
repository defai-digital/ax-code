import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"

export type ProjectContextFile = {
  name: string
  path: string
  exists: boolean
  scope: "project" | "global"
}

export type ProjectContextInfo = {
  directory: string
  worktree: string
  files: ProjectContextFile[]
  instructions: ProjectContextFile[]
  templates: ProjectContextTemplate[]
  checks: ProjectContextCheck[]
  memory: {
    exists: boolean
    totalTokens: number
    lastUpdated: string
    contentHash: string
    sections: string[]
  } | null
}

export type ProjectContextCheck = {
  id: string
  title: string
  command: string
  cwd: string
  source: "root" | "directory"
}

export type ProjectContextTemplate = {
  key: "repo-rules" | "dir-rules" | "review-checklist" | "frontend-style-guide" | "release-checklist"
  title: string
  description: string
  path: string
  exists: boolean
  kind: "instruction" | "checklist"
}

export function useProjectContextRequest() {
  const sdk = useSDK()
  const server = useServer()
  const platform = usePlatform()
  const language = useLanguage()

  return async <T>(pathname: string, init?: RequestInit) => {
    const current = server.current
    if (!current) throw new Error(language.t("error.globalSDK.noServerAvailable"))

    const run = platform.fetch ?? fetch
    const headers = new Headers(init?.headers)
    headers.set("x-ax-code-directory", encodeURIComponent(sdk.directory))
    if (current.http.password) {
      headers.set("Authorization", `Basic ${btoa(`${current.http.username ?? "ax-code"}:${current.http.password}`)}`)
    }

    const res = await run(new URL(pathname, sdk.url), {
      ...init,
      headers,
    })
    const data = await res.json().catch(() => undefined)
    if (!res.ok) {
      const message =
        data &&
        typeof data === "object" &&
        "data" in data &&
        data.data &&
        typeof data.data === "object" &&
        "message" in data.data
          ? String(data.data.message)
          : data && typeof data === "object" && "message" in data
            ? String(data.message)
            : res.statusText
      throw new Error(message || language.t("common.requestFailed"))
    }
    return data as T
  }
}
