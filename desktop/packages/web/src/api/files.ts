import type {
  DirectoryListResult,
  FileReadOptions,
  FileSearchQuery,
  FileSearchResult,
  ListDirectoryOptions,
  FilesAPI,
} from "@openchamber/ui/api/types"
import { API_ENDPOINTS, HTTP_DEFAULTS, HTTP_QUERY_STRINGS, buildQueryUrl } from "./constants"

const normalizePath = (path: string): string => path.replace(/\\/g, "/")

type WebDirectoryEntry = {
  name?: string
  path?: string
  isDirectory?: boolean
  isFile?: boolean
  isSymbolicLink?: boolean
}

type WebDirectoryListResponse = {
  directory?: string
  path?: string
  entries?: WebDirectoryEntry[]
}

const toDirectoryListResult = (fallbackDirectory: string, payload: WebDirectoryListResponse): DirectoryListResult => {
  const directory = normalizePath(payload?.directory || payload?.path || fallbackDirectory)
  const entries = Array.isArray(payload?.entries) ? payload.entries : []

  return {
    directory,
    entries: entries
      .filter((entry): entry is Required<Pick<WebDirectoryEntry, "name" | "path">> & { isDirectory?: boolean } =>
        Boolean(entry && typeof entry.name === "string" && typeof entry.path === "string"),
      )
      .map((entry) => ({
        name: entry.name,
        path: normalizePath(entry.path),
        isDirectory: Boolean(entry.isDirectory),
      })),
  }
}

export const createWebFilesAPI = (): FilesAPI => ({
  async listDirectory(path: string, options?: ListDirectoryOptions): Promise<DirectoryListResult> {
    const target = normalizePath(path)
    const params = new URLSearchParams()
    if (target) {
      params.set("path", target)
    }
    if (options?.respectGitignore) {
      params.set("respectGitignore", HTTP_QUERY_STRINGS.true)
    }

    const response = await fetch(buildQueryUrl(API_ENDPOINTS.files.fsList, params))

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error((error as { error?: string }).error || "Failed to list directory")
    }

    const result = (await response.json()) as WebDirectoryListResponse
    return toDirectoryListResult(target, result)
  },

  async search(payload: FileSearchQuery): Promise<FileSearchResult[]> {
    const params = new URLSearchParams()

    const directory = normalizePath(payload.directory)
    if (directory) {
      params.set("directory", directory)
    }

    params.set("query", payload.query)
    params.set("dirs", HTTP_QUERY_STRINGS.false)
    params.set("type", "file")

    if (typeof payload.maxResults === "number" && Number.isFinite(payload.maxResults)) {
      params.set("limit", String(payload.maxResults))
    }

    const response = await fetch(buildQueryUrl(API_ENDPOINTS.files.findFile, params))

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error((error as { error?: string }).error || "Failed to search files")
    }

    const result = (await response.json()) as string[]
    const files = Array.isArray(result) ? result : []

    return files.map((relativePath) => ({
      path: normalizePath(directory ? `${directory}/${relativePath}` : relativePath),
      preview: [normalizePath(relativePath)],
    }))
  },

  async createDirectory(path: string): Promise<{ success: boolean; path: string }> {
    const target = normalizePath(path)
    const response = await fetch(API_ENDPOINTS.files.fsMkdir, {
      method: HTTP_DEFAULTS.method.post,
      headers: HTTP_DEFAULTS.headers.contentTypeJson,
      body: JSON.stringify({ path: target }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error((error as { error?: string }).error || "Failed to create directory")
    }

    const result = await response.json()
    return {
      success: Boolean(result?.success),
      path: typeof result?.path === "string" ? normalizePath(result.path) : target,
    }
  },

  async statFile(
    path: string,
    options?: FileReadOptions,
  ): Promise<{ path: string; isFile: boolean; size: number; mtimeMs?: number }> {
    const target = normalizePath(path)
    const params = new URLSearchParams({ path: target })
    if (options?.allowOutsideWorkspace) {
      params.set("allowOutsideWorkspace", HTTP_QUERY_STRINGS.true)
    }
    const response = await fetch(buildQueryUrl(API_ENDPOINTS.files.fsStat, params))

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error((error as { error?: string }).error || "Failed to stat file")
    }

    const result = await response.json().catch(() => ({}))
    return {
      path:
        typeof (result as { path?: string }).path === "string"
          ? normalizePath((result as { path: string }).path)
          : target,
      isFile: Boolean((result as { isFile?: boolean }).isFile),
      size: typeof (result as { size?: number }).size === "number" ? (result as { size: number }).size : 0,
      mtimeMs:
        typeof (result as { mtimeMs?: number }).mtimeMs === "number"
          ? (result as { mtimeMs: number }).mtimeMs
          : undefined,
    }
  },

  async readFile(path: string, options?: FileReadOptions): Promise<{ content: string; path: string }> {
    const target = normalizePath(path)
    const params = new URLSearchParams({ path: target })
    if (options?.allowOutsideWorkspace) {
      params.set("allowOutsideWorkspace", HTTP_QUERY_STRINGS.true)
    }
    if (options?.optional) {
      params.set("optional", HTTP_QUERY_STRINGS.true)
    }
    const response = await fetch(buildQueryUrl(API_ENDPOINTS.files.fsRead, params), {
      cache: options?.optional ? HTTP_DEFAULTS.cache.noStore : HTTP_DEFAULTS.cache.default,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error((error as { error?: string }).error || "Failed to read file")
    }

    const content = await response.text()
    return { content, path: target }
  },

  async writeFile(path: string, content: string): Promise<{ success: boolean; path: string }> {
    const target = normalizePath(path)
    const response = await fetch(API_ENDPOINTS.files.fsWrite, {
      method: HTTP_DEFAULTS.method.post,
      headers: HTTP_DEFAULTS.headers.contentTypeJson,
      body: JSON.stringify({ path: target, content }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error((error as { error?: string }).error || "Failed to write file")
    }

    const result = await response.json().catch(() => ({}))
    return {
      success: Boolean((result as { success?: boolean }).success),
      path:
        typeof (result as { path?: string }).path === "string"
          ? normalizePath((result as { path: string }).path)
          : target,
    }
  },

  async delete(path: string): Promise<{ success: boolean }> {
    const target = normalizePath(path)
    const response = await fetch(API_ENDPOINTS.files.fsDelete, {
      method: HTTP_DEFAULTS.method.post,
      headers: HTTP_DEFAULTS.headers.contentTypeJson,
      body: JSON.stringify({ path: target }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error((error as { error?: string }).error || "Failed to delete file")
    }

    const result = await response.json().catch(() => ({}))
    return { success: Boolean((result as { success?: boolean }).success) }
  },

  async rename(oldPath: string, newPath: string): Promise<{ success: boolean; path: string }> {
    const normalizedOld = normalizePath(oldPath)
    const normalizedNew = normalizePath(newPath)
    const response = await fetch(API_ENDPOINTS.files.fsRename, {
      method: HTTP_DEFAULTS.method.post,
      headers: HTTP_DEFAULTS.headers.contentTypeJson,
      body: JSON.stringify({ oldPath: normalizedOld, newPath: normalizedNew }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error((error as { error?: string }).error || "Failed to rename file")
    }

    const result = await response.json().catch(() => ({}))
    return {
      success: Boolean((result as { success?: boolean }).success),
      path:
        typeof (result as { path?: string }).path === "string"
          ? normalizePath((result as { path: string }).path)
          : normalizedNew,
    }
  },

  async revealPath(targetPath: string): Promise<{ success: boolean }> {
    const response = await fetch(API_ENDPOINTS.files.fsReveal, {
      method: HTTP_DEFAULTS.method.post,
      headers: HTTP_DEFAULTS.headers.contentTypeJson,
      body: JSON.stringify({ path: normalizePath(targetPath) }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error((error as { error?: string }).error || "Failed to reveal path")
    }

    const result = await response.json().catch(() => ({}))
    return { success: Boolean((result as { success?: boolean }).success) }
  },

  async downloadFile(path: string): Promise<void> {
    const target = normalizePath(path)
    const url = buildQueryUrl(
      API_ENDPOINTS.files.fsRaw,
      new URLSearchParams({
        path: target,
        download: HTTP_QUERY_STRINGS.true,
      }),
    )
    const a = document.createElement("a")
    a.href = url
    a.download = target.split("/").pop() || "file"
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  },
})
