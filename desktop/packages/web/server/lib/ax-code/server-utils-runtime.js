import { registerAxCodeProxy } from "./proxy.js"
import { pathLooksUserConfigured, mergePathValues } from "./path-utils.js"

export const createServerUtilsRuntime = (dependencies) => {
  const {
    fs,
    os,
    path,
    process,
    axCodeReadyGraceMs,
    longRequestTimeoutMs,
    getRuntime,
    getAxCodeAuthHeaders,
    buildAxCodeUrl,
    ensureAxCodeApiPrefix,
    getUiNotificationClients,
    sseMetrics,
    recordStartupEvent,
    getAxCodePort,
    setAxCodePortState,
    syncToHmrState,
    markAxCodeNotReady,
    setAxCodeNotReadySince,
    clearLastAxCodeError,
    getLoginShellPath,
    settingsFilePath,
  } = dependencies

  const setAxCodePort = (port) => {
    if (!Number.isFinite(port) || port <= 0) {
      return
    }

    const numericPort = Math.trunc(port)
    const currentPort = getAxCodePort()
    const portChanged = currentPort !== numericPort

    if (portChanged || currentPort === null) {
      setAxCodePortState(numericPort)
      syncToHmrState()
      console.log(`Detected ax-code port: ${numericPort}`)

      if (portChanged) {
        markAxCodeNotReady()
      }
      setAxCodeNotReadySince(Date.now())
    }

    clearLastAxCodeError()
  }

  const waitForAxCodePort = async (timeoutMs = 15000) => {
    if (getAxCodePort() !== null) {
      return getAxCodePort()
    }

    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      if (getAxCodePort() !== null) {
        return getAxCodePort()
      }
    }

    throw new Error("Timed out waiting for ax-code port")
  }

  const buildAugmentedPath = () => {
    const currentPath = process.env.PATH || ""
    const loginShellPath = getLoginShellPath()
    const home = os.homedir()
    const currentPathLooksUserConfigured = pathLooksUserConfigured(currentPath, home, path.delimiter)
    const primaryPath = currentPathLooksUserConfigured ? currentPath : loginShellPath
    const fallbackPath = currentPathLooksUserConfigured ? loginShellPath : currentPath

    return mergePathValues(primaryPath, fallbackPath, path.delimiter)
  }

  const buildManagedAxCodePath = () => {
    const currentPath = process.env.PATH || ""
    const loginShellPath = getLoginShellPath()

    return mergePathValues(loginShellPath || "", currentPath, path.delimiter)
  }

  const parseSseDataPayload = (block) => {
    if (!block || typeof block !== "string") {
      return null
    }
    const dataLines = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^\s/, ""))

    if (dataLines.length === 0) {
      return null
    }

    const payloadText = dataLines.join("\n").trim()
    if (!payloadText) {
      return null
    }

    try {
      const parsed = JSON.parse(payloadText)
      if (parsed && typeof parsed === "object" && typeof parsed.payload === "object" && parsed.payload !== null) {
        return parsed.payload
      }
      return parsed
    } catch {
      return null
    }
  }

  const fetchArraySnapshot = async (route, invalidMessage) => {
    if (!getAxCodePort()) {
      throw new Error("ax-code port is not available")
    }

    const response = await fetch(buildAxCodeUrl(route), {
      method: "GET",
      headers: { Accept: "application/json", ...getAxCodeAuthHeaders() },
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      response.body?.cancel()
      throw new Error(`Failed to fetch ${invalidMessage} (status ${response.status})`)
    }

    const payload = await response.json().catch(() => null)
    if (!Array.isArray(payload)) {
      throw new Error(`Invalid payload from ax-code`)
    }
    return payload
  }

  const fetchObjectSnapshot = async (route, invalidMessage) => {
    if (!getAxCodePort()) {
      throw new Error("ax-code port is not available")
    }

    const response = await fetch(buildAxCodeUrl(route), {
      method: "GET",
      headers: { Accept: "application/json", ...getAxCodeAuthHeaders() },
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      response.body?.cancel()
      throw new Error(`Failed to fetch ${invalidMessage} (status ${response.status})`)
    }

    const payload = await response.json().catch(() => null)
    if (!payload || typeof payload !== "object") {
      const preview = typeof payload === "string" ? payload.slice(0, 100) : String(payload)
      throw new Error(`Invalid payload from ax-code ${route}: expected object, got ${typeof payload} (${preview})`)
    }
    return payload
  }

  const fetchAgentsSnapshot = () => fetchArraySnapshot("/agent", "agents snapshot")
  const fetchProvidersSnapshot = async () => {
    const result = await fetchObjectSnapshot("/provider", "providers snapshot")
    if (!Array.isArray(result.all)) {
      const keys = result && typeof result === "object" ? Object.keys(result).join(", ") : "none"
      throw new Error(`Invalid providers snapshot: expected 'all' array, got keys: ${keys}`)
    }
    return result.all
  }
  const fetchModelsSnapshot = async () => {
    const result = await fetchObjectSnapshot("/provider", "models snapshot")
    if (!Array.isArray(result.all)) {
      const keys = result && typeof result === "object" ? Object.keys(result).join(", ") : "none"
      throw new Error(`Invalid models snapshot: expected 'all' array, got keys: ${keys}`)
    }
    // Flatten models from all providers into a single array.
    const models = []
    for (const provider of result.all) {
      if (provider && provider.models && typeof provider.models === "object") {
        for (const model of Object.values(provider.models)) {
          if (model && typeof model === "object") {
            models.push({ ...model, providerID: provider.id })
          }
        }
      }
    }
    return models
  }

  const setupProxy = (app) => {
    registerAxCodeProxy(app, {
      fs,
      os,
      path,
      OPEN_CODE_READY_GRACE_MS: axCodeReadyGraceMs,
      LONG_REQUEST_TIMEOUT_MS: longRequestTimeoutMs,
      getRuntime,
      getAxCodeAuthHeaders,
      buildAxCodeUrl,
      ensureAxCodeApiPrefix,
      getUiNotificationClients,
      sseMetrics,
      recordStartupEvent,
      settingsFilePath,
    })
  }

  return {
    setAxCodePort,
    waitForAxCodePort,
    buildAugmentedPath,
    buildManagedAxCodePath,
    parseSseDataPayload,
    fetchAgentsSnapshot,
    fetchProvidersSnapshot,
    fetchModelsSnapshot,
    setupProxy,
  }
}
