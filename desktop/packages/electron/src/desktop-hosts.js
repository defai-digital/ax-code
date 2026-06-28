"use strict"

const LOCAL_HOST_ID = "local"

const normalizeHostUrl = (raw) => {
  const trimmed = typeof raw === "string" ? raw.trim() : ""
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    if (!["http:", "https:"].includes(parsed.protocol)) return null
    parsed.hash = ""
    return parsed.toString()
  } catch {
    return null
  }
}

const sanitizeHostUrlForStorage = (raw) => normalizeHostUrl(raw)

const sanitizeClientTokenForStorage = (raw) => {
  const token = typeof raw === "string" ? raw.trim() : ""
  return token.length > 0 ? token : null
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
          const apiUrl = hasApiUrl ? sanitizeHostUrlForStorage(entry?.apiUrl) || url : existing?.apiUrl || url
          const clientToken = hasClientToken
            ? sanitizeClientTokenForStorage(entry?.clientToken)
            : sanitizeClientTokenForStorage(existing?.clientToken)

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
  normalizeHostUrl,
  readDesktopHostsConfigFromRoot,
  sanitizeClientTokenForStorage,
}
