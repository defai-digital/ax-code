# AX Code Module Documentation

## Purpose

This module provides ax-code server integration utilities for the web server runtime, including configuration management and provider authentication.

## Entrypoints and structure

- `packages/web/server/lib/ax-code/index.js`: public entrypoint (currently baseline placeholder).
- `packages/web/server/lib/ax-code/auth.js`: provider authentication file operations.
- `packages/web/server/lib/ax-code/auth-state-runtime.js`: managed ax-code server auth password/header runtime.
- `packages/web/server/lib/ax-code/cli-options.js`: CLI/environment option parsing for server startup arguments.
- `packages/web/server/lib/ax-code/cli-entry-runtime.js`: CLI entrypoint runtime that detects direct execution, parses CLI options, and starts server bootstrap.
- `packages/web/server/lib/ax-code/routes.js`: ax-code/provider settings and auth-related route registration.
- `packages/web/server/lib/ax-code/lifecycle.js`: ax-code process lifecycle runtime (startup, restart, readiness, health monitoring).
- `packages/web/server/lib/ax-code/env-runtime.js`: ax-code CLI/binary resolution and shell environment runtime.
- `packages/web/server/lib/ax-code/env-config.js`: ax-code-related environment variable parsing and validation (host/port/hostname).
- `packages/web/server/lib/ax-code/hmr-state-runtime.js`: HMR-persistent runtime state initialization, auth-state bootstrap, and HMR sync helpers.
- `packages/web/server/lib/ax-code/bootstrap-runtime.js`: base app bootstrap runtime for status/auth/notification compatibility route wiring.
- `packages/web/server/lib/ax-code/network-runtime.js`: ax-code URL construction, health-probe readiness checks, and API prefix runtime.
- `packages/web/server/lib/ax-code/project-directory-runtime.js`: request-scoped and settings-backed project directory resolution/validation runtime.
- `packages/web/server/lib/ax-code/config-entity-routes.js`: route registration for agent/command/MCP config orchestration and reload semantics.
- `packages/web/server/lib/ax-code/snippets.js`: ax-code-snippets-compatible snippet file CRUD, discovery, and hashtag expansion.
- `packages/web/server/lib/ax-code/cli-options.js`: CLI/environment option parsing for server startup arguments.
- `packages/web/server/lib/ax-code/core-routes.js`: server status/system routes, auth/access guard routes, and settings utility route registration.
- `packages/web/server/lib/ax-code/shutdown-runtime.js`: graceful shutdown orchestration runtime for watcher/session/terminal/process/server teardown.
- `packages/web/server/lib/ax-code/server-startup-runtime.js`: server listen flow and process/signal handler orchestration runtime.
- `packages/web/server/lib/ax-code/static-routes-runtime.js`: static asset and SPA fallback route registration.
- `packages/web/server/lib/ax-code/feature-routes-runtime.js`: feature route composition runtime for dynamic import-backed config/skill/provider route registration.
- `packages/web/server/lib/ax-code/ax-code-resolution-runtime.js`: ax-code binary resolution snapshot runtime for settings routes and diagnostics.
- `packages/web/server/lib/ax-code/startup-pipeline-runtime.js`: server startup tail orchestration runtime for terminal/proxy/static/start-listen flow.
- `packages/web/server/lib/ax-code/server-utils-runtime.js`: shared server runtime utilities for ax-code proxy wiring, AX Code port/readiness helpers, and snapshot fetchers.
- `packages/web/server/lib/ax-code/openchamber-routes.js`: update status and models metadata route registration.
- `packages/web/server/lib/ax-code/project-icon-routes.js`: project icon upload/read/discovery route registration and icon storage orchestration.
- `packages/web/server/lib/ax-code/skill-routes.js`: route registration for skill config CRUD, supporting files, and skills catalog scan/install flows.
- `packages/web/server/lib/ax-code/settings-runtime.js`: Settings persistence runtime (disk IO, migrations, normalization, project validation, and persisted update serialization).
- `packages/web/server/lib/ax-code/settings-helpers.js`: Settings payload sanitization/format helpers runtime for response shaping and persisted merge prep.
- `packages/web/server/lib/ax-code/settings-normalization-runtime.js`: path/settings normalization and sanitization helpers runtime used by settings/routes/config wiring.
- `packages/web/server/lib/ax-code/theme-runtime.js`: custom theme JSON validation and theme directory loading runtime for settings utility routes.
- `packages/web/server/lib/ax-code/proxy.js`: ax-code API/SSE forwarding and readiness-gate route registration.
- `packages/web/server/lib/ax-code/session-runtime.js`: session status/attention/activity runtime for ax-code SSE events.
- `packages/web/server/lib/ax-code/watcher.js`: global SSE watcher runtime for push/session event fanout.
- `packages/web/server/lib/ax-code/shared.js`: shared utilities for config, markdown, skills, and git helpers.
- `packages/web/server/lib/ui-auth/ui-auth.js`: UI session authentication runtime (outside ax-code module).
- `packages/web/server/lib/ui-auth/ui-passkeys.js`: UI passkey storage and WebAuthn registration/authentication helpers (outside ax-code module).

## Public exports (auth.js)

- `readAuthFile()`: Reads and parses `~/.local/share/ax-code/auth.json`.
- `writeAuthFile(auth)`: Writes auth file with automatic backup.
- `removeProviderAuth(providerId)`: Removes a provider's auth entry.
- `getProviderAuth(providerId)`: Returns auth for a specific provider or null.
- `listProviderAuths()`: Returns list of provider IDs with configured auth.
- `AUTH_FILE`: Auth file path constant.
- `AX_CODE_DATA_DIR: ax-code data directory path constant.

## Public exports (shared.js)

- `AX_CODE_CONFIG_DIR, AGENT_DIR, COMMAND_DIR, SKILL_DIR, CONFIG_FILE, CUSTOM_CONFIG_FILE: Path constants.
- `AGENT_SCOPE`, `COMMAND_SCOPE`, `SKILL_SCOPE`: Scope constants with USER and PROJECT values.
- `ensureDirs()`: Creates required ax-code directories.
- `ensureProjectAxCodeResourceDirs(workingDirectory, primarySegment, legacySegment)`: Creates paired plural/current and legacy project resource directories under `.ax-code`.
- `resolveProjectAxCodeResourcePath(workingDirectory, primarySegments, legacySegments)`, `resolveUserAxCodeResourcePath(primarySegments, legacySegments)`: Resolve current-vs-legacy resource paths while preferring legacy only when the current path is absent.
- `parseMdFile(filePath)`, `writeMdFile(filePath, frontmatter, body)`: Markdown file operations with YAML frontmatter.
- `getProjectConfigCandidates(workingDirectory)`, `getProjectConfigPath(workingDirectory)`, `ensureProjectConfigPath(workingDirectory)`: Project config path discovery/write-target helpers.
- `resolveAxCodeConfigDir(customConfigFile?)`, `getUserConfigPaths(configDir?)`, `getPrimaryUserConfigPath(userPaths, fallbackPath?)`: User/custom config path helpers shared by config and plugin runtimes.
- `getConfigPaths(workingDirectory, options?)`, `readConfigLayers(workingDirectory)`, `readConfig(workingDirectory)`: Config file operations with layer merging (user, project, custom).
- `writeConfig(config, filePath)`: Writes config with automatic backup.
- `getJsonEntrySource(layers, sectionKey, entryName)`: Resolves which config layer provides an entry.
- `getJsonWriteTarget(layers, preferredScope)`: Determines write target for config updates.
- `getConfigEntitySources(options)`: Builds shared markdown/JSON source summaries for agent and command config entities.
- `getAncestors(startDir, stopDir)`, `findWorktreeRoot(startDir)`: Git worktree helpers.
- `isPromptFileReference(value)`, `resolvePromptFilePath(reference)`, `writePromptFile(filePath, content)`: Prompt file reference handling.
- `walkSkillMdFiles(rootDir)`: Recursively finds all SKILL.md files.
- `addSkillFromMdFile(skillsMap, skillMdPath, scope, source)`: Parses and indexes a skill file.
- `resolveSkillSearchDirectories(workingDirectory)`: Returns skill search path order (config, project, home, custom).
- `listSkillSupportingFiles(skillDir)`, `readSkillSupportingFile(skillDir, relativePath)`, `writeSkillSupportingFile(skillDir, relativePath, content)`, `deleteSkillSupportingFile(skillDir, relativePath)`: Skill supporting file management.

## Public exports (routes.js)

- `registerAxCodeRoutes(app, dependencies)`: Registers ax-code-owned HTTP routes and internal module runtime:
  - `GET /api/config/settings`
  - `PUT /api/config/settings`
  - `GET /api/config/ax-code-resolution`
  - `POST /api/ax-code/upgrade` (proxies ax-code upgrade, then restarts managed ax-code so the new binary is active)
  - `GET /api/ax-code/upgrade-status`
  - `POST /api/ax-code/directory`
  - `GET /api/provider/:providerId/source`
  - `DELETE /api/provider/:providerId/auth`
- Owns lazy auth library loading for provider auth checks/removal.
- Keeps route behavior independent from composition root; `index.js` now supplies dependencies only.

## Public exports (session-runtime.js)

- `createSessionRuntime({ writeSseEvent, getNotificationClients, broadcastEvent? })`: creates runtime-owned state machine and APIs for session status.
- Returned API:
  - `processAxCodeSsePayload(payload)`
  - `getSessionActivitySnapshot()`
  - `getSessionStateSnapshot()`
  - `getSessionAttentionSnapshot()`
  - `getSessionState(sessionId)`
  - `getSessionAttentionState(sessionId)`
  - `markSessionViewed(sessionId, clientId)`
  - `markSessionUnviewed(sessionId, clientId)`
  - `markUserMessageSent(sessionId)`
  - `resetAllSessionActivityToIdle()`
  - `dispose()`

## Public exports (lifecycle.js)

- `createAxCodeLifecycleRuntime(dependencies)`: creates lifecycle runtime for managed/external ax-code process orchestration.
- Returned API:
  - `startAxCode()`
  - `restartAxCode()`
  - `waitForAxCodeReady(timeoutMs?, intervalMs?)`
  - `waitForAgentPresence(agentName, timeoutMs?, intervalMs?)`
  - `refreshAxCodeAfterConfigChange(reason, options?)`
  - `bootstrapAxCodeAtStartup()`
  - `startHealthMonitoring(healthCheckIntervalMs)`
  - `waitForPortRelease(port, timeoutMs, hostname?)`
  - `killProcessOnPort(port)`

## Public exports (env-runtime.js)

- `createAX CodeEnvRuntime(dependencies)`: creates runtime that owns AX Code CLI environment and binary discovery state.
- Returned API:
  - `applyLoginShellEnvSnapshot()`
  - `getLoginShellEnvSnapshot()`
  - `ensureAxCodeCliEnv()`
  - `applyAxCodeBinaryFromSettings()`
  - `resolveAxCodeCliPath()`
  - `resolveManagedAX CodeLaunchSpec(ax-codePath)`: resolves the effective managed AX Code launch target, unwrapping Windows package-manager shims to a direct native binary or explicit runtime+script when possible.
  - `resolveGitBinaryForSpawn()`
  - `resolveWslExecutablePath()`
  - `buildWslExecArgs(execArgs, distroOverride?)`
  - `isExecutable(filePath)`
  - `searchPathFor(binaryName)`
  - `clearResolvedAX CodeBinary()`

## Public exports (env-config.js)

- `resolveAX CodeEnvConfig(options?)`: resolves and validates AX Code host/port/hostname environment configuration.
- Returned object fields:
  - `configuredAX CodePort`
  - `configuredAX CodeHost`
  - `effectivePort`
  - `configuredAX CodeHostname`

## Public exports (hmr-state-runtime.js)

- `createHmrStateRuntime(dependencies)`: creates runtime for HMR state container initialization and runtime<->HMR state synchronization.
- Returned API:
  - `getOrCreateHmrState()`
  - `ensureUserProvidedAX CodePassword(hmrState)`
  - `getUserProvidedAX CodePassword(hmrState)`
  - `resolveAX CodeAuthFromState({ hmrState, userProvidedAX CodePassword })`
  - `syncStateFromRuntime(hmrState, runtime)`
  - `restoreRuntimeFromState({ hmrState, userProvidedAX CodePassword })`

## Public exports (bootstrap-runtime.js)

- `createBootstrapRuntime(dependencies)`: creates runtime for base app route bootstrap and UI auth controller initialization.
- Returned API:
  - `setupBaseRoutes(app, options)`

## Public exports (network-runtime.js)

- `createAX CodeNetworkRuntime(dependencies)`: creates runtime for AX Code network and URL concerns.
- Returned API:
  - `waitForReady(url, timeoutMs?)`
  - `normalizeApiPrefix(prefix)`
  - `setDetectedAX CodeApiPrefix()`
  - `buildAX CodeUrl(path, prefixOverride?)`
  - `ensureAX CodeApiPrefix()`
  - `scheduleAX CodeApiDetection()`

## Public exports (settings-runtime.js)

- `createSettingsRuntime(dependencies)`: creates settings lifecycle runtime for read/migrate/persist concerns.
- Returned API:
  - `readSettingsFromDisk()`
  - `readSettingsFromDiskMigrated()`
  - `writeSettingsToDisk(settings)`
  - `persistSettings(changes)`

## Public exports (settings-helpers.js)

- `createSettingsHelpers(dependencies)`: creates settings helper runtime for settings request/response shaping.
- Returned API:
  - `normalizePwaAppName(value, fallback?)`
  - `sanitizeSettingsUpdate(payload)`
  - `mergePersistedSettings(current, changes)`
  - `formatSettingsResponse(settings)`

## Public exports (settings-normalization-runtime.js)

- `createSettingsNormalizationRuntime(dependencies)`: creates normalization/sanitization runtime for shared settings helper logic.
- Returned API:
  - `normalizeDirectoryPath(value)`
  - `normalizePathForPersistence(value)`
  - `normalizeSettingsPaths(input)`
  - `isUnsafeSkillRelativePath(value)`
  - `sanitizeTypographySizesPartial(input)`
  - `normalizeStringArray(input)`
  - `sanitizeModelRefs(input, limit)`
  - `sanitizeSkillCatalogs(input)`
  - `sanitizeProjects(input)`

## Public exports (theme-runtime.js)

- `createThemeRuntime(dependencies)`: creates custom theme runtime for on-disk theme discovery and JSON normalization/validation.
- Returned API:
  - `normalizeThemeJson(raw)`
  - `readCustomThemesFromDisk()`

## Public exports (project-directory-runtime.js)

- `createProjectDirectoryRuntime(dependencies)`: creates runtime for request/project directory candidate normalization and validation.
- Returned API:
  - `resolveDirectoryCandidate(value)`
  - `validateDirectoryPath(candidate)`
  - `resolveProjectDirectory(req)`
  - `resolveOptionalProjectDirectory(req)`

## Public exports (config-entity-routes.js)

- `registerConfigEntityRoutes(app, dependencies)`: registers configuration entity routes:
  - Agents: `/api/config/agents/:name` and `/api/config/agents/:name/config`
  - Commands: `/api/config/commands/:name`
  - MCP servers: `/api/config/mcp` and `/api/config/mcp/:name`
  - Snippets: `/api/config/snippets`, `/api/config/snippets/:name`, and `/api/config/snippets/expand`

## Public exports (auth-state-runtime.js)

- `createAX CodeAuthStateRuntime(dependencies)`: creates runtime for managed AX Code auth password state and request headers.
- Returned API:
  - `getAX CodeAuthHeaders()`
  - `isAX CodeConnectionSecure()`
  - `ensureLocalAX CodeServerPassword(options?)`

## Public exports (core-routes.js)

- `registerServerStatusRoutes(app, dependencies)`: registers status/system endpoints:
  - `GET /health`
  - `POST /api/system/shutdown`
  - `GET /api/system/info`
- `registerAuthAndAccessRoutes(app, dependencies)`: registers browser auth/session exchange and API access middleware:
  - `GET /auth/session`
  - `POST /auth/session`
  - `GET /auth/passkey/status`
  - `POST /auth/passkey/authenticate/options`
  - `POST /auth/passkey/authenticate/verify`
  - `POST /auth/passkey/register/options`
  - `POST /auth/passkey/register/verify`
  - `GET /api/passkeys`
  - `DELETE /api/passkeys/:id`
  - `POST /api/auth/reset`
  - `POST /api/system/probe-url`
  - `app.use('/api', ...)` auth guard
- `registerSettingsUtilityRoutes(app, dependencies)`: registers small settings utility endpoints:
  - `GET /api/config/themes`
  - `POST /api/config/reload`
- `registerCommonRequestMiddleware(app, dependencies)`: registers shared request middleware stack:
  - conditional JSON body parser behavior for `/api/*` vs non-API requests
  - URL-encoded parser setup
  - request logging middleware

## Public exports (cli-options.js)

- `parseServeCliOptions(options)`: parses serve CLI flags and environment-derived defaults:
  - Port/host/ui-password

## Public exports (cli-entry-runtime.js)

- `runCliEntryIfMain(dependencies)`: detects direct CLI execution and runs server startup with parsed CLI options.

## Public exports (server-utils-runtime.js)

- `createServerUtilsRuntime(dependencies)`: creates server utility runtime for AX Code orchestration helpers.
- Returned API:
  - `setAX CodePort(port)`
  - `waitForAX CodePort(timeoutMs?)`
  - `buildAugmentedPath()`
  - `parseSseDataPayload(block)`
  - `fetchAgentsSnapshot()`
  - `fetchProvidersSnapshot()`
  - `fetchModelsSnapshot()`
  - `setupProxy(app)`

## Public exports (shutdown-runtime.js)

- `createGracefulShutdownRuntime(dependencies)`: creates graceful shutdown runtime for managed AX Code and web server teardown sequencing.
- Returned API:
  - `gracefulShutdown(options?)`

## Public exports (server-startup-runtime.js)

- `createServerStartupRuntime(dependencies)`: creates runtime for server bind/listen and process handler wiring.
- Returned API:
  - `resolveBindHost(host)`
  - `startListening(options)`
  - `attachProcessHandlers(options)`

## Public exports (static-routes-runtime.js)

- `createStaticRoutesRuntime(dependencies)`: creates runtime for static dist resolution and static route registration.
- Returned API:
  - `registerStaticRoutes(app)`

## Public exports (feature-routes-runtime.js)

- `createFeatureRoutesRuntime(dependencies)`: creates runtime for main feature route registration orchestration.
- Returned API:
  - `registerRoutes(app, routeDependencies)`

## Public exports (ax-code-resolution-runtime.js)

- `createAX CodeResolutionRuntime(dependencies)`: creates runtime for AX Code binary/source snapshot resolution.
- Returned API:
  - `getAX CodeResolutionSnapshot(settings)`: returns configured/resolved AX Code binary details plus effective managed-launch fields (`launchBinary`, `launchArgs`, `launchWrapperType`) when applicable.

## Public exports (startup-pipeline-runtime.js)

- `createStartupPipelineRuntime(dependencies)`: creates runtime for terminal wiring, proxy/bootstrap scheduling, static route registration, and server startup/listen flow.
- Returned API:
  - `run(options)`

## Public exports (openchamber-routes.js)

- Legacy compatibility route registration:
  - `GET /api/openchamber/update-check`
  - `GET /api/openchamber/models-metadata`
  - `GET /api/zen/models`

## Public exports (project-icon-routes.js)

- `registerProjectIconRoutes(app, dependencies)`: registers project icon routes and owns icon storage/discovery flow:
  - `GET /api/projects/:projectId/icon`
  - `PUT /api/projects/:projectId/icon`
  - `DELETE /api/projects/:projectId/icon`
  - `POST /api/projects/:projectId/icon/discover`

## Public exports (skill-routes.js)

- `registerSkillRoutes(app, dependencies)`: registers skills-related routes:
  - Skills config CRUD and metadata under `/api/config/skills*`
  - Skills catalog listing/source pagination, scan, and install routes
  - Supporting skill file read/write/delete routes

## Public exports (proxy.js)

- `registerAX CodeProxy(app, dependencies)`: registers AX Code proxy routes and middleware.
- Owns:
  - SSE forwarders: `GET /api/global/event`, `GET /api/event`
  - Session message forwarder: `POST /api/session/:sessionId/message`
  - Generic `/api/*` forwarding with hop-by-hop header filtering
  - Windows `/session` merge fallback path behavior
  - AX Code readiness gate for proxied `/api` requests

## Public exports (watcher.js)

- `createAX CodeWatcherRuntime(dependencies)`: creates global event watcher runtime backed by the shared upstream SSE reader.
- Returned API:
  - `start()`
  - `stop()`
- Behavior:
  - Waits for AX Code readiness before attaching the watcher.
  - In production wiring, subscribes to the shared global message-stream hub instead of opening its own `/global/event` connection.
  - Can still create its own `/global/event` reader when no shared hub is provided, which keeps module tests and isolated reuse simple.
  - Reuses event-stream parsing, `Last-Event-ID`, stall timeout, and reconnect behavior.
  - Forwards unwrapped global event payloads into notification/session side effects.

## Storage and configuration

- Provider auth: `~/.local/share/ax-code/auth.json`.
- User config: `~/.config/ax-code/ax-code.json`.
- Project config: `<workingDirectory>/.ax-code/ax-code.json` or `ax-code.json`.
- Custom config: `AX_CODE_CONFIG` env var path.
- Rate limit config: `AX_CODE_DESKTOP_RATE_LIMIT_MAX_ATTEMPTS`, `AX_CODE_DESKTOP_RATE_LIMIT_NO_IP_MAX_ATTEMPTS` env vars.

## Notes for contributors

- This module serves as foundation for AX Code-related server utilities.
- Route ownership moved to module-level `routes.js`; `index.js` wires dependencies only.
- All file writes include automatic backup before modification.
- Config merging follows priority: custom > project > user.
- UI auth uses scrypt for password hashing with constant-time comparison.
