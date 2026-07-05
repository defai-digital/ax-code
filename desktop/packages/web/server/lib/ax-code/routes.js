import { createProjectIdFromPath } from "../projects/project-id.js"
import { compareVersions, evaluateAxCodeCompatibility, MIN_SUPPORTED_AX_CODE_VERSION } from "./version-compat.js"
import { AX_CODE_CONFIG_DIR } from "./shared.js"
import fs from "fs"
import os from "os"
import path from "path"

const PROMPT_ASYNC_IDEMPOTENCY_TTL_MS = 2 * 60 * 1000

export const registerAxCodeRoutes = (app, dependencies) => {
  const {
    crypto,
    clientReloadDelayMs,
    getAxCodeResolutionSnapshot,
    formatSettingsResponse,
    readSettingsFromDisk,
    readSettingsFromDiskMigrated,
    persistSettings,
    sanitizeProjects,
    validateDirectoryPath,
    resolveProjectDirectory,
    getProviderSources,
    removeProviderConfig,
    refreshAxCodeAfterConfigChange,
    backgroundAxCodeReloader,
    buildAxCodeUrl,
    getAxCodeAuthHeaders,
  } = dependencies

  let authLibrary = null
  const pendingMcpAuthContextByState = new Map()
  const promptAsyncRequestsByKey = new Map()
  const PENDING_MCP_AUTH_TTL_MS = 30 * 60 * 1000
  const getAuthLibrary = async () => {
    if (!authLibrary) {
      authLibrary = await import("./auth.js")
    }
    return authLibrary
  }

  const normalizePendingString = (value) => {
    if (typeof value !== "string") {
      return null
    }

    const trimmed = value.trim()
    return trimmed || null
  }

  const fetchLatestAxCodeVersion = async () => {
    // ax-code is not distributed via npm or public GitHub releases.
    // Version update checks are disabled.
    return null
  }

  const pruneExpiredPendingMcpAuthContexts = () => {
    const now = Date.now()
    for (const [state, entry] of pendingMcpAuthContextByState.entries()) {
      if (!entry || typeof entry.expiresAt !== "number" || entry.expiresAt <= now) {
        pendingMcpAuthContextByState.delete(state)
      }
    }
  }

  const prunePromptAsyncRequests = () => {
    const now = Date.now()
    for (const [key, entry] of promptAsyncRequestsByKey.entries()) {
      const completedAt = typeof entry?.completedAt === "number" ? entry.completedAt : 0
      const startedAt = typeof entry?.startedAt === "number" ? entry.startedAt : 0
      const reference = completedAt || startedAt
      if (!reference || now - reference > PROMPT_ASYNC_IDEMPOTENCY_TTL_MS) {
        promptAsyncRequestsByKey.delete(key)
      }
    }
  }

  const buildUpstreamPathWithQuery = (basePath, req) => {
    const requestUrl = typeof req.originalUrl === "string" ? req.originalUrl : req.url
    const parsed = new URL(requestUrl || "/", "http://localhost")
    return `${basePath}${parsed.search || ""}`
  }

  // Read the request body for proxy-style forwarding. `/api/session/*` routes
  // are intentionally NOT run through express.json() (see
  // registerCommonRequestMiddleware — they fall to the `next()` branch so the
  // generic streaming proxy can forward them), so `req.body` is undefined here
  // and the raw stream is still intact. Read it verbatim. If a body parser DID
  // run for this path (other mounts), fall back to the parsed object so this
  // helper stays correct regardless of how the route is wired.
  const readForwardBodyText = (req) =>
    new Promise((resolve, reject) => {
      if (req.body !== undefined && req.body !== null) {
        try {
          resolve(JSON.stringify(req.body))
        } catch {
          resolve("{}")
        }
        return
      }
      const chunks = []
      req.on("data", (chunk) => chunks.push(chunk))
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8") || "{}"))
      req.on("error", reject)
    })

  const fetchAxCodeJsonRoute = async (req, upstreamPath, forwardBody) => {
    const response = await fetch(buildAxCodeUrl(upstreamPath, ""), {
      method: req.method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...getAxCodeAuthHeaders(),
      },
      body:
        req.method === "GET" || req.method === "HEAD"
          ? undefined
          : typeof forwardBody === "string"
            ? forwardBody
            : JSON.stringify(req.body ?? {}),
    })
    const contentType = response.headers.get("content-type") || "application/json"
    const bodyText = await response.text().catch(() => "")
    return {
      status: response.status,
      ok: response.ok,
      contentType,
      bodyText,
    }
  }

  const sendAxCodeRouteResult = (res, result) => {
    res.status(result.status)
    if (result.contentType) {
      res.type(result.contentType)
    }
    if (result.bodyText) {
      return res.send(result.bodyText)
    }
    return res.end()
  }

  const parseJsonBodyText = (text) => {
    if (!text || typeof text !== "string") return null
    try {
      const parsed = JSON.parse(text)
      return parsed && typeof parsed === "object" ? parsed : null
    } catch {
      return null
    }
  }

  app.post("/api/session/:sessionId/prompt_async", async (req, res) => {
    const sessionId = typeof req.params?.sessionId === "string" ? req.params.sessionId : ""
    // The body is not pre-parsed for this route, so read the raw payload and
    // forward it verbatim. Parsing it here (rather than relying on req.body)
    // also recovers the messageID used for the idempotency dedup key.
    const bodyText = await readForwardBodyText(req)
    const parsedBody = parseJsonBodyText(bodyText)
    const messageId = normalizePendingString(parsedBody?.messageID) || ""
    const key = sessionId && messageId ? `${sessionId}:${messageId}` : null
    const upstreamPath = buildUpstreamPathWithQuery(`/session/${encodeURIComponent(sessionId)}/prompt_async`, req)

    try {
      prunePromptAsyncRequests()
      if (key) {
        const existing = promptAsyncRequestsByKey.get(key)
        if (existing?.result) {
          return sendAxCodeRouteResult(res, existing.result)
        }
        if (existing?.promise) {
          const result = await existing.promise
          return sendAxCodeRouteResult(res, result)
        }
      }

      const promise = fetchAxCodeJsonRoute(req, upstreamPath, bodyText)
      if (key) {
        promptAsyncRequestsByKey.set(key, { startedAt: Date.now(), promise })
      }

      const result = await promise
      if (key) {
        if (result.ok) {
          promptAsyncRequestsByKey.set(key, {
            completedAt: Date.now(),
            result,
          })
        } else {
          promptAsyncRequestsByKey.delete(key)
        }
      }
      return sendAxCodeRouteResult(res, result)
    } catch (error) {
      if (key) {
        promptAsyncRequestsByKey.delete(key)
      }
      console.error("Failed to forward prompt_async:", error)
      return res.status(503).json({
        error: error instanceof Error ? error.message : "Failed to send prompt",
        restarting: true,
      })
    }
  })

  app.post("/api/session/:sessionId/command", async (req, res) => {
    const sessionId = typeof req.params?.sessionId === "string" ? req.params.sessionId : ""
    const bodyText = await readForwardBodyText(req)
    const parsedBody = parseJsonBodyText(bodyText)
    const command = normalizePendingString(parsedBody?.command) || ""
    const upstreamPath = buildUpstreamPathWithQuery(`/session/${encodeURIComponent(sessionId)}/command`, req)

    try {
      const result = await fetchAxCodeJsonRoute(req, upstreamPath, bodyText)
      const payload = parseJsonBodyText(result.bodyText)
      if (
        result.status === 500 &&
        payload?.name === "UnknownError" &&
        typeof payload?.message === "string" &&
        payload.message.toLowerCase().includes("internal server error") &&
        command
      ) {
        return res.status(400).json({
          error: `Unknown command: ${command}`,
          message: `Unknown command: ${command}`,
          retryable: false,
        })
      }
      return sendAxCodeRouteResult(res, result)
    } catch (error) {
      console.error("Failed to forward session command:", error)
      return res.status(503).json({
        error: error instanceof Error ? error.message : "Failed to run command",
        restarting: true,
      })
    }
  })

  app.get("/api/config/settings", async (_req, res) => {
    try {
      const settings = await readSettingsFromDiskMigrated()
      res.json(formatSettingsResponse(settings))
    } catch (error) {
      console.error("Failed to read settings:", error)
      res.status(500).json({ error: "Failed to read settings" })
    }
  })

  app.get("/api/config/ax-code-resolution", async (_req, res) => {
    try {
      const settings = await readSettingsFromDiskMigrated()
      const resolution = await getAxCodeResolutionSnapshot(settings)
      res.json(resolution)
    } catch (error) {
      console.error("Failed to resolve ax-code binary:", error)
      res.status(500).json({ error: "Failed to resolve ax-code binary" })
    }
  })

  app.post("/api/ax-code/upgrade", async (req, res) => {
    try {
      const target = normalizePendingString(req.body?.target) || undefined
      const response = await fetch(buildAxCodeUrl("/global/upgrade", ""), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...getAxCodeAuthHeaders(),
        },
        body: JSON.stringify(target ? { target } : {}),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        return res.status(response.status).json({
          success: false,
          error: payload?.error || response.statusText || "Failed to upgrade ax-code",
        })
      }

      try {
        await refreshAxCodeAfterConfigChange("ax-code upgrade")
      } catch (restartError) {
        return res.status(500).json({
          success: false,
          upgraded: true,
          error:
            restartError instanceof Error
              ? `ax-code upgraded, but restart failed: ${restartError.message}`
              : "ax-code upgraded, but restart failed",
        })
      }

      return res.json({ ...(payload ?? { success: true }), restarted: true })
    } catch (error) {
      console.error("Failed to upgrade ax-code:", error)
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to upgrade ax-code",
      })
    }
  })

  app.get("/api/ax-code/upgrade-status", async (_req, res) => {
    try {
      const [healthResponse, latestVersion] = await Promise.all([
        fetch(buildAxCodeUrl("/global/health", ""), {
          method: "GET",
          headers: { Accept: "application/json", ...getAxCodeAuthHeaders() },
        }),
        fetchLatestAxCodeVersion(),
      ])
      const health = await healthResponse.json().catch(() => null)
      if (!healthResponse.ok) {
        return res.status(healthResponse.status).json({
          available: null,
          error: health?.error || healthResponse.statusText || "Failed to read ax-code version",
        })
      }
      const currentVersion = typeof health?.version === "string" ? health.version.replace(/^v/, "") : null
      const compatibility = evaluateAxCodeCompatibility(currentVersion)
      if (!currentVersion || !latestVersion) {
        return res.json({
          available: null,
          currentVersion,
          latestVersion: latestVersion || null,
          minSupportedVersion: MIN_SUPPORTED_AX_CODE_VERSION,
          compatible: compatibility.compatible,
        })
      }
      const available = compareVersions(latestVersion, currentVersion) > 0
      return res.json({
        available,
        currentVersion,
        latestVersion,
        minSupportedVersion: MIN_SUPPORTED_AX_CODE_VERSION,
        compatible: compatibility.compatible,
      })
    } catch (error) {
      return res.status(500).json({
        available: null,
        error: error instanceof Error ? error.message : "Failed to check ax-code upgrade status",
      })
    }
  })

  app.put("/api/config/settings", async (req, res) => {
    console.log("[API:PUT /api/config/settings] Received request")
    try {
      const updated = await persistSettings(req.body ?? {})
      console.log(`[API:PUT /api/config/settings] Success, returning ${updated.projects?.length || 0} projects`)
      res.json(updated)
    } catch (error) {
      console.error("[API:PUT /api/config/settings] Failed to save settings:", error)
      console.error("[API:PUT /api/config/settings] Error stack:", error.stack)
      res.status(500).json({ error: "Failed to save settings" })
    }
  })

  app.post("/api/mcp/auth/pending", async (req, res) => {
    try {
      pruneExpiredPendingMcpAuthContexts()

      const state = normalizePendingString(req.body?.state)
      if (!state) {
        return res.json({ success: true, context: null })
      }

      const name = normalizePendingString(req.body?.name)
      if (!name) {
        return res.status(400).json({ error: "MCP server name is required" })
      }

      const entry = {
        name,
        directory: normalizePendingString(req.body?.directory),
        expiresAt: Date.now() + PENDING_MCP_AUTH_TTL_MS,
      }
      pendingMcpAuthContextByState.set(state, entry)

      return res.json({
        success: true,
        context: {
          name: entry.name,
          directory: entry.directory,
        },
      })
    } catch (error) {
      console.error("Failed to store pending MCP auth context:", error)
      return res.status(500).json({ error: error.message || "Failed to store pending MCP auth context" })
    }
  })

  app.get("/api/mcp/auth/pending", async (req, res) => {
    try {
      pruneExpiredPendingMcpAuthContexts()

      const state = normalizePendingString(Array.isArray(req.query?.state) ? req.query.state[0] : req.query?.state)
      if (!state) {
        return res.json(null)
      }

      const pendingMcpAuthContext = pendingMcpAuthContextByState.get(state) ?? null
      if (!pendingMcpAuthContext) {
        return res.status(404).json({ error: "No pending MCP auth context" })
      }

      return res.json(pendingMcpAuthContext)
    } catch (error) {
      console.error("Failed to read pending MCP auth context:", error)
      return res.status(500).json({ error: error.message || "Failed to read pending MCP auth context" })
    }
  })

  app.delete("/api/mcp/auth/pending", async (req, res) => {
    try {
      pruneExpiredPendingMcpAuthContexts()

      const state = normalizePendingString(Array.isArray(req.query?.state) ? req.query.state[0] : req.query?.state)
      if (!state) {
        return res.json({ success: true })
      }

      pendingMcpAuthContextByState.delete(state)
      return res.json({ success: true })
    } catch (error) {
      console.error("Failed to clear pending MCP auth context:", error)
      return res.status(500).json({ error: error.message || "Failed to clear pending MCP auth context" })
    }
  })

  app.get("/api/provider/:providerId/source", async (req, res) => {
    try {
      const { providerId } = req.params
      if (!providerId) {
        return res.status(400).json({ error: "Provider ID is required" })
      }

      const headerDirectory = typeof req.get === "function" ? req.get("x-ax-code-directory") : null
      const queryDirectory = Array.isArray(req.query?.directory) ? req.query.directory[0] : req.query?.directory
      const requestedDirectory = headerDirectory || queryDirectory || null

      let directory = null
      const resolved = await resolveProjectDirectory(req)
      if (resolved.directory) {
        directory = resolved.directory
      } else if (requestedDirectory) {
        return res.status(400).json({ error: resolved.error })
      }

      const sources = getProviderSources(providerId, directory)
      const { getProviderAuth } = await getAuthLibrary()
      const auth = getProviderAuth(providerId)
      sources.sources.auth.exists = Boolean(auth)

      return res.json({
        providerId,
        sources: sources.sources,
      })
    } catch (error) {
      console.error("Failed to get provider sources:", error)
      return res.status(500).json({ error: error.message || "Failed to get provider sources" })
    }
  })

  // Remove provider auth via ax-code's API (uses file locking, encryption,
  // and per-directory cache invalidation). Falls back to direct auth.json
  // manipulation when ax-code is unreachable.
  const removeProviderAuthViaApi = async (providerId) => {
    try {
      const url = buildAxCodeUrl(`/auth/${encodeURIComponent(providerId)}`, "")
      const response = await fetch(url, {
        method: "DELETE",
        headers: {
          Accept: "application/json",
          ...getAxCodeAuthHeaders(),
        },
        signal: AbortSignal.timeout(10000),
      })
      if (response.ok) {
        await response.body?.cancel()
        return true
      }
      // 404 means the auth entry does not exist — nothing to remove.
      if (response.status === 404) {
        await response.body?.cancel()
        return false
      }
      // Other 4xx (401, 403, 408, etc.) and 5xx: fall back to direct
      // file removal so the entry is cleaned up even when ax-code
      // rejects the API call (e.g. auth header mismatch).
      await response.body?.cancel()
      console.warn(
        `ax-code DELETE /auth/${providerId} returned ${response.status}, falling back to direct file removal`,
      )
    } catch (error) {
      console.warn(
        `Failed to call ax-code DELETE /auth/${providerId}:`,
        error?.message || error,
        "— falling back to direct file removal",
      )
    }
    // Fallback: direct auth.json manipulation
    const { removeProviderAuth } = await getAuthLibrary()
    return removeProviderAuth(providerId)
  }

  app.delete("/api/provider/:providerId/auth", async (req, res) => {
    try {
      const { providerId } = req.params
      if (!providerId) {
        return res.status(400).json({ error: "Provider ID is required" })
      }

      const scope = typeof req.query?.scope === "string" ? req.query.scope : "auth"
      const headerDirectory = typeof req.get === "function" ? req.get("x-ax-code-directory") : null
      const queryDirectory = Array.isArray(req.query?.directory) ? req.query.directory[0] : req.query?.directory
      const requestedDirectory = headerDirectory || queryDirectory || null
      let directory = null

      if (scope === "project" || requestedDirectory) {
        const resolved = await resolveProjectDirectory(req)
        if (!resolved.directory) {
          return res.status(400).json({ error: resolved.error })
        }
        directory = resolved.directory
      } else {
        const resolved = await resolveProjectDirectory(req)
        if (resolved.directory) {
          directory = resolved.directory
        }
      }

      let removed = false
      if (scope === "auth") {
        removed = await removeProviderAuthViaApi(providerId)
      } else if (scope === "user" || scope === "project" || scope === "custom") {
        removed = removeProviderConfig(providerId, directory, scope)
      } else if (scope === "all") {
        const authRemoved = await removeProviderAuthViaApi(providerId)
        const userRemoved = removeProviderConfig(providerId, directory, "user")
        const projectRemoved = directory ? removeProviderConfig(providerId, directory, "project") : false
        const customRemoved = removeProviderConfig(providerId, directory, "custom")
        removed = authRemoved || userRemoved || projectRemoved || customRemoved
      } else {
        return res.status(400).json({ error: "Invalid scope" })
      }

      let reload = null
      if (removed) {
        if (backgroundAxCodeReloader) {
          reload = backgroundAxCodeReloader.start(`provider ${providerId} disconnected (${scope})`)
        } else {
          await refreshAxCodeAfterConfigChange(`provider ${providerId} disconnected (${scope})`)
          reload = { alreadyRunning: false, reloadDelayMs: clientReloadDelayMs }
        }
      }

      return res.json({
        success: true,
        removed,
        requiresReload: removed,
        reloadInProgress: reload?.alreadyRunning,
        message: removed
          ? reload?.alreadyRunning
            ? "Provider disconnected. AX Code is already restarting…"
            : "Provider disconnected. AX Code is restarting…"
          : "Provider was not connected",
        reloadDelayMs: reload?.reloadDelayMs,
        reloadTimeoutMs: reload?.reloadTimeoutMs,
      })
    } catch (error) {
      console.error("Failed to disconnect provider:", error)
      return res.status(500).json({ error: error.message || "Failed to disconnect provider" })
    }
  })

  app.post("/api/ax-code/directory", async (req, res) => {
    try {
      const requestedPath = normalizePendingString(req.body?.path) || ""
      if (!requestedPath) {
        return res.status(400).json({ error: "Path is required" })
      }

      const validated = await validateDirectoryPath(requestedPath)
      if (!validated.ok) {
        return res.status(400).json({ error: validated.error })
      }

      const resolvedPath = validated.directory
      const currentSettings = await readSettingsFromDisk()
      const existingProjects = sanitizeProjects(currentSettings.projects) || []
      const existing = existingProjects.find((project) => project.path === resolvedPath) || null

      const nextProjects = existing
        ? existingProjects
        : [
            ...existingProjects,
            {
              id: createProjectIdFromPath(resolvedPath),
              path: resolvedPath,
              addedAt: Date.now(),
              lastOpenedAt: Date.now(),
            },
          ]

      const activeProjectId = existing ? existing.id : nextProjects[nextProjects.length - 1].id

      const updated = await persistSettings({
        projects: nextProjects,
        activeProjectId,
        lastDirectory: resolvedPath,
      })

      return res.json({
        success: true,
        restarted: false,
        path: resolvedPath,
        settings: updated,
      })
    } catch (error) {
      console.error("Failed to update ax-code working directory:", error)
      return res.status(500).json({ error: error.message || "Failed to update working directory" })
    }
  })

  // Behavior / Global AGENTS.md endpoints
  const AGENTS_MD_PATH = path.join(AX_CODE_CONFIG_DIR, "AGENTS.md")
  const MAX_BEHAVIOR_PROMPT_SIZE = 1024 * 1024 // 1 MB

  app.get("/api/behavior/agents-md", async (_req, res) => {
    try {
      try {
        await fs.promises.access(AGENTS_MD_PATH)
      } catch {
        return res.json({ content: "", exists: false })
      }
      const content = await fs.promises.readFile(AGENTS_MD_PATH, "utf8")
      return res.json({ content, exists: true })
    } catch (error) {
      console.error("Failed to read AGENTS.md:", error)
      return res.status(500).json({ error: "Failed to read AGENTS.md" })
    }
  })

  app.put("/api/behavior/agents-md", async (req, res) => {
    try {
      const content = typeof req.body?.content === "string" ? req.body.content : ""

      if (content.length > MAX_BEHAVIOR_PROMPT_SIZE) {
        return res.status(413).json({ error: `Content exceeds maximum size of ${MAX_BEHAVIOR_PROMPT_SIZE} bytes` })
      }

      // Ensure parent directory exists
      const parentDir = path.dirname(AGENTS_MD_PATH)
      try {
        await fs.promises.access(parentDir)
      } catch {
        await fs.promises.mkdir(parentDir, { recursive: true })
      }

      await fs.promises.writeFile(AGENTS_MD_PATH, content, "utf8")

      // Refresh ax-code so it picks up the new AGENTS.md without a full restart
      try {
        await refreshAxCodeAfterConfigChange("global behavior (AGENTS.md) updated")
      } catch {
        // Non-fatal: file was written successfully
      }

      return res.json({ success: true })
    } catch (error) {
      console.error("Failed to write AGENTS.md:", error)
      return res.status(500).json({ error: error.message || "Failed to write AGENTS.md" })
    }
  })
}
