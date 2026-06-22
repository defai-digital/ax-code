export const createAxCodeNetworkRuntime = (deps) => {
  const { state, getAxCodeAuthHeaders } = deps

  const normalizeApiPrefix = (prefix) => {
    if (!prefix) {
      return ""
    }

    if (prefix.includes("://")) {
      try {
        const parsed = new URL(prefix)
        return normalizeApiPrefix(parsed.pathname)
      } catch {
        return ""
      }
    }

    const trimmed = prefix.trim()
    if (!trimmed || trimmed === "/") {
      return ""
    }
    const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`
    return withLeading.endsWith("/") ? withLeading.slice(0, -1) : withLeading
  }

  const waitForReady = async (url, timeoutMs = 10000) => {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      let timeout = null
      try {
        const controller = new AbortController()
        timeout = setTimeout(() => controller.abort(), 3000)
        const response = await fetch(`${url.replace(/\/+$/, "")}/global/health`, {
          method: "GET",
          headers: {
            Accept: "application/json",
            ...getAxCodeAuthHeaders(),
          },
          signal: controller.signal,
        })
        clearTimeout(timeout)
        timeout = null

        if (response.ok) {
          const body = await response.json().catch(() => null)
          if (body?.healthy === true) {
            return true
          }
        } else {
          response.body?.cancel()
        }
      } catch {
      } finally {
        if (timeout) {
          clearTimeout(timeout)
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    return false
  }

  const setDetectedAxCodeApiPrefix = () => {
    state.axCodeApiPrefix = ""
    state.axCodeApiPrefixDetected = true
    if (state.axCodeApiDetectionTimer) {
      clearTimeout(state.axCodeApiDetectionTimer)
      state.axCodeApiDetectionTimer = null
    }
  }

  const buildAxCodeUrl = (path, prefixOverride) => {
    if (!state.axCodePort) {
      throw new Error("ax-code port is not available")
    }
    const normalizedPath = path.startsWith("/") ? path : `/${path}`
    const prefix = normalizeApiPrefix(prefixOverride !== undefined ? prefixOverride : "")
    const fullPath = `${prefix}${normalizedPath}`
    const base = state.axCodeBaseUrl ?? `http://localhost:${state.axCodePort}`
    return `${base}${fullPath}`
  }

  const detectAxCodeApiPrefix = () => {
    state.axCodeApiPrefixDetected = true
    state.axCodeApiPrefix = ""
    return true
  }

  const ensureAxCodeApiPrefix = () => detectAxCodeApiPrefix()

  const scheduleAxCodeApiDetection = () => {
    return
  }

  return {
    waitForReady,
    normalizeApiPrefix,
    setDetectedAxCodeApiPrefix,
    buildAxCodeUrl,
    ensureAxCodeApiPrefix,
    scheduleAxCodeApiDetection,
  }
}
