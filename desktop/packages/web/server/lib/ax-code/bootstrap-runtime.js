import { rateLimit } from "express-rate-limit"

const createDesktopRouteRateLimiter = () =>
  rateLimit({
    windowMs: 60_000,
    limit: 1_200,
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
    message: { error: "Too many requests" },
  })

export const createBootstrapRuntime = (dependencies) => {
  const {
    createUiAuth,
    registerServerStatusRoutes,
    registerCommonRequestMiddleware,
    registerAuthAndAccessRoutes,
    registerNotificationRoutes,
    registerOpenChamberRoutes,
    express,
  } = dependencies

  const setupBaseRoutes = (app, options) => {
    const {
      process,
      openchamberVersion,
      runtimeName,
      serverStartedAt,
      gracefulShutdown,
      getHealthSnapshot,
      getStartupDiagnosticsSnapshot,
      verboseRequestLogs,
      uiPassword,
      readSettingsFromDiskMigrated,
      ensureGlobalWatcherStarted,
      getUiSessionTokenFromRequest,
      getUiNotificationClients,
      writeSseEvent,
      sessionRuntime,
      modelsDevApiUrl,
      modelsMetadataCacheTtl,
      fetchFreeZenModels,
      getCachedZenModels,
      setAutoAcceptSession,
    } = options

    const uiAuthController = createUiAuth({
      password: uiPassword,
      readSettingsFromDiskMigrated,
    })
    if (uiAuthController.enabled) {
      console.log("UI password protection enabled for browser sessions")
    }

    registerServerStatusRoutes(app, {
      express,
      process,
      openchamberVersion,
      runtimeName,
      serverStartedAt,
      gracefulShutdown,
      getHealthSnapshot,
      getStartupDiagnosticsSnapshot,
      uiAuthController,
    })

    registerCommonRequestMiddleware(app, { express, verboseRequestLogs })

    app.use("/api", createDesktopRouteRateLimiter())
    app.use("/auth", createDesktopRouteRateLimiter())

    registerAuthAndAccessRoutes(app, {
      express,
      uiAuthController,
    })

    registerNotificationRoutes(app, {
      uiAuthController,
      ensureGlobalWatcherStarted,
      getUiSessionTokenFromRequest,
      getUiNotificationClients,
      writeSseEvent,
      getSessionActivitySnapshot: sessionRuntime.getSessionActivitySnapshot,
      getSessionStateSnapshot: sessionRuntime.getSessionStateSnapshot,
      getSessionAttentionSnapshot: sessionRuntime.getSessionAttentionSnapshot,
      getSessionState: sessionRuntime.getSessionState,
      getSessionAttentionState: sessionRuntime.getSessionAttentionState,
      markSessionViewed: sessionRuntime.markSessionViewed,
      markSessionUnviewed: sessionRuntime.markSessionUnviewed,
      markUserMessageSent: sessionRuntime.markUserMessageSent,
      setAutoAcceptSession,
    })

    registerOpenChamberRoutes(app, {
      modelsDevApiUrl,
      modelsMetadataCacheTtl,
      fetchFreeZenModels,
      getCachedZenModels,
    })

    return {
      uiAuthController,
    }
  }

  return {
    setupBaseRoutes,
  }
}
