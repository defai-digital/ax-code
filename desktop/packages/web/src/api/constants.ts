import { API_ENDPOINTS as UI_API_ENDPOINTS, API_PATHS } from "@openchamber/ui/api/endpoints"

// Endpoint values are derived from the master catalog in
// packages/ui/src/lib/http.ts (via the @openchamber/ui public API surface) so
// each path is defined exactly once. Only the grouping below is web-specific.
export const API_BASE_PATH = API_PATHS.base

export const API_ENDPOINTS = {
  config: {
    settings: UI_API_ENDPOINTS.config.settings,
    reload: UI_API_ENDPOINTS.config.reload,
  },
  files: {
    findFile: UI_API_ENDPOINTS.find.file,
    fsList: UI_API_ENDPOINTS.fs.list,
    fsMkdir: UI_API_ENDPOINTS.fs.mkdir,
    fsStat: UI_API_ENDPOINTS.fs.stat,
    fsRead: UI_API_ENDPOINTS.fs.read,
    fsWrite: UI_API_ENDPOINTS.fs.write,
    fsDelete: UI_API_ENDPOINTS.fs.delete,
    fsRename: UI_API_ENDPOINTS.fs.rename,
    fsRaw: UI_API_ENDPOINTS.fs.raw,
    fsReveal: UI_API_ENDPOINTS.fs.reveal,
  },
  github: UI_API_ENDPOINTS.github,
  tools: UI_API_ENDPOINTS.tools,
  notifications: {
    stream: UI_API_ENDPOINTS.notifications.stream,
  },
} as const

export const HTTP_QUERY_STRINGS = {
  true: "true",
  false: "false",
  one: "1",
} as const

export const HTTP_DEFAULTS = {
  method: {
    get: "GET",
    post: "POST",
    put: "PUT",
    delete: "DELETE",
  },
  headers: {
    acceptJson: {
      Accept: "application/json",
    },
    contentTypeJson: {
      "Content-Type": "application/json",
    },
    acceptAndContentTypeJson: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  },
  runtime: {
    web: "web",
    desktop: "desktop",
  },
  terminal: {
    defaultRetryMaxRetries: 3,
    defaultInitialRetryDelayMs: 1000,
    defaultMaxRetryDelayMs: 8000,
    defaultConnectionTimeoutMs: 10000,
  },
  cache: {
    noStore: "no-store",
    default: "default",
  },
} as const

export const buildQueryUrl = (path: string, params?: URLSearchParams | string): string => {
  if (!params) {
    return path
  }
  const query = typeof params === "string" ? params : params.toString()
  if (!query) {
    return path
  }
  return `${path}?${query}`
}
