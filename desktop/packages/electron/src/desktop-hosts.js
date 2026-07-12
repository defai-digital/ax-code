"use strict"

const LOCAL_HOST_ID = "local"

const normalizeHostUrl = (raw) => {
  const trimmed = typeof raw === "string" ? raw.trim() : ""
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    if (!["http:", "https:"].includes(parsed.protocol)) return null
    parsed.username = ""
    parsed.password = ""
    parsed.search = ""
    parsed.hash = ""
    return parsed.toString()
  } catch {
    return null
  }
}

const normalizeHostname = (hostname) =>
  String(hostname || "")
    .replace(/^\[|\]$/g, "")
    .toLowerCase()

const isLoopbackDesktopHostname = (hostname) => {
  const normalized = normalizeHostname(hostname)
  return normalized === "localhost" || normalized === "::1" || /^127(?:\.\d{1,3}){3}$/.test(normalized)
}

const isLocalDesktopSenderUrl = (raw, { serverPort = 0, devRendererUrl = "" } = {}) => {
  try {
    const url = new URL(String(raw || ""))
    if (url.protocol !== "http:" && url.protocol !== "https:") return false
    if (!isLoopbackDesktopHostname(url.hostname)) return false

    if (serverPort > 0 && url.port === String(serverPort)) return true
    if (devRendererUrl) {
      const devUrl = new URL(devRendererUrl)
      return url.origin === devUrl.origin
    }
    return false
  } catch {
    return false
  }
}

const sanitizeHostUrlForStorage = (raw) => normalizeHostUrl(raw)

const sanitizeClientTokenForStorage = (raw) => {
  const token = typeof raw === "string" ? raw.trim() : ""
  return token.length > 0 ? token : null
}

const normalizePathForHostMatch = (pathname) => {
  const normalized = typeof pathname === "string" ? pathname.replace(/\/+$/, "") : ""
  return normalized || "/"
}

const targetMatchesHostUrl = (targetRaw, hostRaw) => {
  const target = normalizeHostUrl(targetRaw)
  const host = normalizeHostUrl(hostRaw)
  if (!target || !host) return false

  try {
    const targetUrl = new URL(target)
    const hostUrl = new URL(host)
    if (targetUrl.origin !== hostUrl.origin) return false

    const hostPath = normalizePathForHostMatch(hostUrl.pathname)
    const targetPath = normalizePathForHostMatch(targetUrl.pathname)
    if (hostPath === "/") return true
    return targetPath === hostPath || targetPath.startsWith(`${hostPath}/`)
  } catch {
    return false
  }
}

const isAllowedDesktopHostTargetUrl = (targetRaw, { localOrigin, hosts, includeApiUrls = false } = {}) => {
  if (targetMatchesHostUrl(targetRaw, localOrigin)) return true

  const hostList = Array.isArray(hosts) ? hosts : []
  return hostList.some(
    (host) =>
      targetMatchesHostUrl(targetRaw, host?.url) || (includeApiUrls && targetMatchesHostUrl(targetRaw, host?.apiUrl)),
  )
}

const isLocalOnlyDesktopHostsConfigInput = (input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false
  if (input.hosts !== undefined && (!Array.isArray(input.hosts) || input.hosts.length > 0)) return false
  const defaultHostId = typeof input.defaultHostId === "string" ? input.defaultHostId.trim() : ""
  return !defaultHostId || defaultHostId === LOCAL_HOST_ID
}

const DISABLED_REMOTE_SETTINGS_KEYS = [
  "desktopHosts",
  "desktopDefaultHostId",
  "desktopInitialHostChoiceCompleted",
  "desktopLocalClientToken",
  "desktopSshInstances",
  "desktopLanAccessEnabled",
  "desktopUiPassword",
  "publicOrigin",
]

const removeDisabledRemoteAccessSettingsFromRoot = (root) => {
  if (!root || typeof root !== "object" || Array.isArray(root)) return false
  let changed = false
  for (const key of DISABLED_REMOTE_SETTINGS_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(root, key)) continue
    delete root[key]
    changed = true
  }
  return changed
}

const resolveStoredClientTokenForUrl = (targetRaw, { hosts } = {}) => {
  const normalizedTarget = normalizeHostUrl(targetRaw)
  if (!normalizedTarget) return ""

  const hostList = Array.isArray(hosts) ? hosts : []
  for (const host of hostList) {
    const hostUrl = normalizeHostUrl(host?.url)
    const apiUrl = normalizeHostUrl(host?.apiUrl || host?.url)
    if (targetMatchesHostUrl(normalizedTarget, hostUrl) || targetMatchesHostUrl(normalizedTarget, apiUrl)) {
      return sanitizeClientTokenForStorage(host?.clientToken) || ""
    }
  }
  return ""
}

const readDesktopHostsConfigFromRoot = (root, { includeSecrets = false } = {}) => {
  const hostsRaw = Array.isArray(root?.desktopHosts) ? root.desktopHosts : []
  const hosts = hostsRaw
    .map((entry) => {
      const id = typeof entry?.id === "string" ? entry.id.trim() : ""
      const url = sanitizeHostUrlForStorage(entry?.url)
      if (!id || id === LOCAL_HOST_ID || !url) return null
      const apiUrl = sanitizeHostUrlForStorage(entry?.apiUrl) || url
      const clientToken = sanitizeClientTokenForStorage(entry?.clientToken)
      const label = typeof entry?.label === "string" && entry.label.trim() ? entry.label.trim() : url
      return { id, label, url, apiUrl, ...(includeSecrets && clientToken ? { clientToken } : {}) }
    })
    .filter(Boolean)

  return {
    hosts,
    defaultHostId:
      typeof root?.desktopDefaultHostId === "string" && root.desktopDefaultHostId.trim()
        ? root.desktopDefaultHostId.trim()
        : null,
    initialHostChoiceCompleted: root?.desktopInitialHostChoiceCompleted === true,
  }
}

const applyDesktopHostsConfigToRoot = (root, config) => {
  const existingById = new Map()
  for (const host of readDesktopHostsConfigFromRoot(root, { includeSecrets: true }).hosts) {
    existingById.set(host.id, host)
  }

  root.desktopHosts = Array.isArray(config?.hosts)
    ? config.hosts
        .map((entry) => {
          const id = typeof entry?.id === "string" ? entry.id.trim() : ""
          const url = sanitizeHostUrlForStorage(entry?.url)
          if (!id || id === LOCAL_HOST_ID || !url) return null

          const existing = existingById.get(id)
          const hasApiUrl = Object.prototype.hasOwnProperty.call(entry, "apiUrl")
          const hasClientToken = Object.prototype.hasOwnProperty.call(entry, "clientToken")
          const existingUrl = sanitizeHostUrlForStorage(existing?.url)
          const existingApiUrl = sanitizeHostUrlForStorage(existing?.apiUrl) || existingUrl
          const apiUrl = hasApiUrl
            ? sanitizeHostUrlForStorage(entry?.apiUrl) || url
            : existingUrl === url
              ? existingApiUrl || url
              : url
          const clientToken = hasClientToken
            ? sanitizeClientTokenForStorage(entry?.clientToken)
            : existingUrl === url && existingApiUrl === apiUrl
              ? sanitizeClientTokenForStorage(existing?.clientToken)
              : null

          return {
            id,
            label: typeof entry?.label === "string" && entry.label.trim() ? entry.label.trim() : url,
            url,
            apiUrl,
            ...(clientToken ? { clientToken } : {}),
          }
        })
        .filter(Boolean)
    : []

  root.desktopDefaultHostId =
    typeof config?.defaultHostId === "string" && config.defaultHostId.trim() ? config.defaultHostId.trim() : null
  if (typeof config?.initialHostChoiceCompleted === "boolean") {
    root.desktopInitialHostChoiceCompleted = config.initialHostChoiceCompleted
  }
  if (Object.prototype.hasOwnProperty.call(config || {}, "localClientToken")) {
    const localClientToken = sanitizeClientTokenForStorage(config.localClientToken)
    if (localClientToken) {
      root.desktopLocalClientToken = localClientToken
    } else {
      delete root.desktopLocalClientToken
    }
  }
}

module.exports = {
  applyDesktopHostsConfigToRoot,
  isAllowedDesktopHostTargetUrl,
  isLocalOnlyDesktopHostsConfigInput,
  isLocalDesktopSenderUrl,
  isLoopbackDesktopHostname,
  normalizeHostUrl,
  readDesktopHostsConfigFromRoot,
  removeDisabledRemoteAccessSettingsFromRoot,
  resolveStoredClientTokenForUrl,
  sanitizeClientTokenForStorage,
}
