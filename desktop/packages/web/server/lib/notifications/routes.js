export const registerNotificationRoutes = (app, dependencies) => {
  const {
    uiAuthController,
    ensureGlobalWatcherStarted,
    getUiSessionTokenFromRequest,
    getUiNotificationClients,
    writeSseEvent,
    getSessionActivitySnapshot,
    getSessionStateSnapshot,
    getSessionAttentionSnapshot,
    getSessionState,
    getSessionAttentionState,
    markSessionViewed,
    markSessionUnviewed,
    markUserMessageSent,
    setAutoAcceptSession,
  } = dependencies

  const ensureSessionWatcher = async () => {
    if (typeof ensureGlobalWatcherStarted !== "function") {
      return
    }
    try {
      await ensureGlobalWatcherStarted()
    } catch (error) {
      console.warn("[AxCodeWatcher] lazy start failed:", error?.message ?? error)
    }
  }

  app.get("/api/notifications/stream", async (req, res) => {
    await ensureSessionWatcher()

    const uiToken = uiAuthController?.ensureSessionToken
      ? await uiAuthController.ensureSessionToken(req, res)
      : getUiSessionTokenFromRequest(req)
    if (!uiToken) {
      return
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8")
    res.setHeader("Cache-Control", "no-cache, no-transform")
    res.setHeader("Connection", "keep-alive")
    res.setHeader("X-Accel-Buffering", "no")
    res.flushHeaders?.()

    const clients = getUiNotificationClients()
    clients.add(res)

    try {
      writeSseEvent(res, {
        type: "openchamber:notification-stream-ready",
        properties: { uiToken },
      })
    } catch {}

    // Keep the connection alive through reverse proxies / load balancers, which
    // reap idle SSE sockets. Mirrors the /api/openchamber/events heartbeat; the
    // client ignores any event whose type is not "openchamber:notification".
    const heartbeat = setInterval(() => {
      try {
        writeSseEvent(res, {
          type: "openchamber:heartbeat",
          properties: {
            timestamp: Date.now(),
          },
        })
      } catch {
        clearInterval(heartbeat)
        clients.delete(res)
      }
    }, 25_000)
    if (typeof heartbeat.unref === "function") heartbeat.unref()

    req.on("close", () => {
      clearInterval(heartbeat)
      clients.delete(res)
    })
  })

  app.get("/api/session-activity", async (_req, res) => {
    await ensureSessionWatcher()
    res.json(getSessionActivitySnapshot())
  })

  app.get("/api/sessions/snapshot", async (_req, res) => {
    await ensureSessionWatcher()
    res.json({
      statusSessions: getSessionStateSnapshot(),
      attentionSessions: getSessionAttentionSnapshot(),
      serverTime: Date.now(),
    })
  })

  app.get("/api/sessions/status", async (_req, res) => {
    await ensureSessionWatcher()
    const snapshot = getSessionStateSnapshot()
    res.json({
      sessions: snapshot,
      serverTime: Date.now(),
    })
  })

  app.get("/api/sessions/:id/status", async (req, res) => {
    await ensureSessionWatcher()
    const sessionId = req.params.id
    const state = getSessionState(sessionId)

    if (!state) {
      return res.status(404).json({
        error: "Session not found or no state available",
        sessionId,
      })
    }

    return res.json({
      sessionId,
      ...state,
    })
  })

  app.get("/api/sessions/attention", async (_req, res) => {
    await ensureSessionWatcher()
    const snapshot = getSessionAttentionSnapshot()
    res.json({
      sessions: snapshot,
      serverTime: Date.now(),
    })
  })

  app.get("/api/sessions/:id/attention", async (req, res) => {
    await ensureSessionWatcher()
    const sessionId = req.params.id
    const state = getSessionAttentionState(sessionId)

    if (!state) {
      return res.status(404).json({
        error: "Session not found or no attention state available",
        sessionId,
      })
    }

    return res.json({
      sessionId,
      ...state,
    })
  })

  app.post("/api/sessions/:id/view", (req, res) => {
    const sessionId = req.params.id
    const clientId = req.headers["x-client-id"] || req.ip || "anonymous"

    markSessionViewed(sessionId, clientId)

    return res.json({
      success: true,
      sessionId,
      viewed: true,
    })
  })

  app.post("/api/sessions/:id/unview", (req, res) => {
    const sessionId = req.params.id
    const clientId = req.headers["x-client-id"] || req.ip || "anonymous"

    markSessionUnviewed(sessionId, clientId)

    return res.json({
      success: true,
      sessionId,
      viewed: false,
    })
  })

  app.post("/api/sessions/:id/message-sent", (req, res) => {
    const sessionId = req.params.id

    markUserMessageSent(sessionId)

    return res.json({
      success: true,
      sessionId,
      messageSent: true,
    })
  })

  // Mirror client-side Permission Auto-Accept state to the server so it can
  // suppress permission notifications at the source (the 500ms debounce race
  // otherwise leaks notifications for auto-accepted permissions).
  app.post("/api/notifications/auto-accept", (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {}
    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : ""
    const enabled = body.enabled === true
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId required" })
    }
    if (typeof setAutoAcceptSession === "function") {
      setAutoAcceptSession(sessionId, enabled)
    }
    return res.json({ success: true, sessionId, enabled })
  })
}
