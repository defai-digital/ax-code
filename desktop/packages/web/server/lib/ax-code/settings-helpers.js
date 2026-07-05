export const createSettingsHelpers = (dependencies) => {
  const {
    normalizePathForPersistence,
    normalizeDirectoryPath,
    sanitizeTypographySizesPartial,
    normalizeStringArray,
    sanitizeModelRefs,
    sanitizeSkillCatalogs,
    sanitizeProjects,
  } = dependencies

  const nonEmptyStrings = (values) => values.filter((value) => typeof value === "string" && value.length > 0)
  const uniqueNonEmptyStrings = (values) => Array.from(new Set(nonEmptyStrings(values)))

  const normalizePathStringArray = (values) =>
    normalizeStringArray(
      nonEmptyStrings(
        values.map((entry) => (typeof entry === "string" ? normalizePathForPersistence(entry) : entry)),
      ),
    )

  const sanitizeProviderStringMap = (value) => {
    if (!value || typeof value !== "object") {
      return undefined
    }

    const sanitized = {}
    for (const [providerId, values] of Object.entries(value)) {
      if (typeof providerId !== "string" || !Array.isArray(values)) {
        continue
      }
      const validValues = nonEmptyStrings(values)
      if (validValues.length > 0) {
        sanitized[providerId] = validValues
      }
    }

    return Object.keys(sanitized).length > 0 ? sanitized : undefined
  }

  const sanitizeSettingsUpdate = (payload) => {
    if (!payload || typeof payload !== "object") {
      return {}
    }

    const candidate = payload
    const result = {}

    if (typeof candidate.themeId === "string" && candidate.themeId.length > 0) {
      result.themeId = candidate.themeId
    }
    if (
      typeof candidate.themeVariant === "string" &&
      (candidate.themeVariant === "light" || candidate.themeVariant === "dark")
    ) {
      result.themeVariant = candidate.themeVariant
    }
    if (typeof candidate.useSystemTheme === "boolean") {
      result.useSystemTheme = candidate.useSystemTheme
    }
    if (typeof candidate.lightThemeId === "string" && candidate.lightThemeId.length > 0) {
      result.lightThemeId = candidate.lightThemeId
    }
    if (typeof candidate.darkThemeId === "string" && candidate.darkThemeId.length > 0) {
      result.darkThemeId = candidate.darkThemeId
    }
    if (typeof candidate.splashBgLight === "string" && candidate.splashBgLight.trim().length > 0) {
      result.splashBgLight = candidate.splashBgLight.trim()
    }
    if (typeof candidate.splashFgLight === "string" && candidate.splashFgLight.trim().length > 0) {
      result.splashFgLight = candidate.splashFgLight.trim()
    }
    if (typeof candidate.splashBgDark === "string" && candidate.splashBgDark.trim().length > 0) {
      result.splashBgDark = candidate.splashBgDark.trim()
    }
    if (typeof candidate.splashFgDark === "string" && candidate.splashFgDark.trim().length > 0) {
      result.splashFgDark = candidate.splashFgDark.trim()
    }
    if (typeof candidate.lastDirectory === "string" && candidate.lastDirectory.length > 0) {
      const normalized = normalizePathForPersistence(candidate.lastDirectory)
      if (typeof normalized === "string" && normalized.length > 0) {
        result.lastDirectory = normalized
      }
    }
    if (typeof candidate.homeDirectory === "string" && candidate.homeDirectory.length > 0) {
      const normalized = normalizePathForPersistence(candidate.homeDirectory)
      if (typeof normalized === "string" && normalized.length > 0) {
        result.homeDirectory = normalized
      }
    }

    // Absolute path to the ax-code CLI binary (optional override).
    // Accept empty-string to clear (we persist an empty string sentinel so the running
    // process can reliably drop a previously applied AX_CODE_BINARY override).
    if (typeof candidate.axCodeBinary === "string") {
      const normalized = normalizeDirectoryPath(candidate.axCodeBinary).trim()
      result.axCodeBinary = normalized
    }
    if (typeof candidate.desktopLanAccessEnabled === "boolean") {
      result.desktopLanAccessEnabled = candidate.desktopLanAccessEnabled
    }
    if (typeof candidate.desktopUiPassword === "string") {
      result.desktopUiPassword = candidate.desktopUiPassword.trim()
    }
    if (Array.isArray(candidate.projects)) {
      const projects = sanitizeProjects(candidate.projects)
      if (projects) {
        result.projects = projects
      }
    }
    if (typeof candidate.activeProjectId === "string" && candidate.activeProjectId.length > 0) {
      result.activeProjectId = candidate.activeProjectId
    }

    if (Array.isArray(candidate.approvedDirectories)) {
      result.approvedDirectories = normalizePathStringArray(candidate.approvedDirectories)
    }
    if (Array.isArray(candidate.securityScopedBookmarks)) {
      result.securityScopedBookmarks = normalizeStringArray(candidate.securityScopedBookmarks)
    }
    if (Array.isArray(candidate.pinnedDirectories)) {
      result.pinnedDirectories = normalizePathStringArray(candidate.pinnedDirectories)
    }
    if (Array.isArray(candidate.draftStarters)) {
      const seenStarters = new Set()
      const starters = []
      for (const entry of candidate.draftStarters) {
        if (!entry || typeof entry !== "object") continue
        const type = entry.type === "command" || entry.type === "skill" ? entry.type : null
        const name = typeof entry.name === "string" ? entry.name.trim() : ""
        if (!type || !name) continue
        const key = `${type}:${name}`
        if (seenStarters.has(key)) continue
        seenStarters.add(key)
        starters.push({ type, name })
      }
      result.draftStarters = starters
    }

    if (typeof candidate.uiFont === "string" && candidate.uiFont.length > 0) {
      result.uiFont = candidate.uiFont
    }
    if (typeof candidate.monoFont === "string" && candidate.monoFont.length > 0) {
      result.monoFont = candidate.monoFont
    }
    if (typeof candidate.markdownDisplayMode === "string" && candidate.markdownDisplayMode.length > 0) {
      result.markdownDisplayMode = candidate.markdownDisplayMode
    }
    if (typeof candidate.githubClientId === "string") {
      const trimmed = candidate.githubClientId.trim()
      if (trimmed.length > 0) {
        result.githubClientId = trimmed
      }
    }
    if (typeof candidate.githubScopes === "string") {
      const trimmed = candidate.githubScopes.trim()
      if (trimmed.length > 0) {
        result.githubScopes = trimmed
      }
    }
    if (typeof candidate.showReasoningTraces === "boolean") {
      result.showReasoningTraces = candidate.showReasoningTraces
    }
    if (typeof candidate.collapsibleThinkingBlocks === "boolean") {
      result.collapsibleThinkingBlocks = candidate.collapsibleThinkingBlocks
    }
    if (typeof candidate.showTextJustificationActivity === "boolean") {
      result.showTextJustificationActivity = candidate.showTextJustificationActivity
    }
    if (typeof candidate.showDeletionDialog === "boolean") {
      result.showDeletionDialog = candidate.showDeletionDialog
    }
    if (typeof candidate.nativeNotificationsEnabled === "boolean") {
      result.nativeNotificationsEnabled = candidate.nativeNotificationsEnabled
    }
    if (typeof candidate.notificationMode === "string") {
      const mode = candidate.notificationMode.trim()
      if (mode === "always" || mode === "hidden-only") {
        result.notificationMode = mode
      }
    }
    if (typeof candidate.notifyOnSubtasks === "boolean") {
      result.notifyOnSubtasks = candidate.notifyOnSubtasks
    }
    if (typeof candidate.notifyOnCompletion === "boolean") {
      result.notifyOnCompletion = candidate.notifyOnCompletion
    }
    if (typeof candidate.notifyOnError === "boolean") {
      result.notifyOnError = candidate.notifyOnError
    }
    if (typeof candidate.notifyOnQuestion === "boolean") {
      result.notifyOnQuestion = candidate.notifyOnQuestion
    }
    if (candidate.notificationTemplates && typeof candidate.notificationTemplates === "object") {
      result.notificationTemplates = candidate.notificationTemplates
    }
    if (typeof candidate.summarizeLastMessage === "boolean") {
      result.summarizeLastMessage = candidate.summarizeLastMessage
    }
    if (typeof candidate.summaryThreshold === "number" && Number.isFinite(candidate.summaryThreshold)) {
      result.summaryThreshold = Math.max(0, Math.round(candidate.summaryThreshold))
    }
    if (typeof candidate.summaryLength === "number" && Number.isFinite(candidate.summaryLength)) {
      result.summaryLength = Math.max(10, Math.round(candidate.summaryLength))
    }
    if (typeof candidate.maxLastMessageLength === "number" && Number.isFinite(candidate.maxLastMessageLength)) {
      result.maxLastMessageLength = Math.max(10, Math.round(candidate.maxLastMessageLength))
    }
    if (typeof candidate.usageAutoRefresh === "boolean") {
      result.usageAutoRefresh = candidate.usageAutoRefresh
    }
    if (typeof candidate.usageRefreshIntervalMs === "number" && Number.isFinite(candidate.usageRefreshIntervalMs)) {
      result.usageRefreshIntervalMs = Math.max(30000, Math.min(300000, Math.round(candidate.usageRefreshIntervalMs)))
    }
    if (candidate.usageDisplayMode === "usage" || candidate.usageDisplayMode === "remaining") {
      result.usageDisplayMode = candidate.usageDisplayMode
    }
    if (typeof candidate.usageShowPredValues === "boolean") {
      result.usageShowPredValues = candidate.usageShowPredValues
    }
    if (Array.isArray(candidate.usageDropdownProviders)) {
      result.usageDropdownProviders = normalizeStringArray(candidate.usageDropdownProviders)
    }
    if (typeof candidate.autoDeleteEnabled === "boolean") {
      result.autoDeleteEnabled = candidate.autoDeleteEnabled
    }
    if (typeof candidate.autoDeleteAfterDays === "number" && Number.isFinite(candidate.autoDeleteAfterDays)) {
      const normalizedDays = Math.max(1, Math.min(365, Math.round(candidate.autoDeleteAfterDays)))
      result.autoDeleteAfterDays = normalizedDays
    }
    const typography = sanitizeTypographySizesPartial(candidate.typographySizes)
    if (typography) {
      result.typographySizes = typography
    }

    if (typeof candidate.defaultModel === "string") {
      const trimmed = candidate.defaultModel.trim()
      result.defaultModel = trimmed.length > 0 ? trimmed : undefined
    }
    if (typeof candidate.defaultVariant === "string") {
      const trimmed = candidate.defaultVariant.trim()
      result.defaultVariant = trimmed.length > 0 ? trimmed : undefined
    }
    if (typeof candidate.defaultAgent === "string") {
      const trimmed = candidate.defaultAgent.trim()
      result.defaultAgent = trimmed.length > 0 ? trimmed : undefined
    }
    if (typeof candidate.defaultGitIdentityId === "string") {
      const trimmed = candidate.defaultGitIdentityId.trim()
      result.defaultGitIdentityId = trimmed.length > 0 ? trimmed : undefined
    }
    if (typeof candidate.queueModeEnabled === "boolean") {
      result.queueModeEnabled = candidate.queueModeEnabled
    }
    if (typeof candidate.autoCreateWorktree === "boolean") {
      result.autoCreateWorktree = candidate.autoCreateWorktree
    }
    if (typeof candidate.gitmojiEnabled === "boolean") {
      result.gitmojiEnabled = candidate.gitmojiEnabled
    }
    if (typeof candidate.defaultFileViewerPreview === "boolean") {
      result.defaultFileViewerPreview = candidate.defaultFileViewerPreview
    }
    if (typeof candidate.zenModel === "string") {
      const trimmed = candidate.zenModel.trim()
      result.zenModel = trimmed.length > 0 ? trimmed : undefined
    }
    if (typeof candidate.gitProviderId === "string") {
      const trimmed = candidate.gitProviderId.trim()
      result.gitProviderId = trimmed.length > 0 ? trimmed : undefined
    }
    if (typeof candidate.gitModelId === "string") {
      const trimmed = candidate.gitModelId.trim()
      result.gitModelId = trimmed.length > 0 ? trimmed : undefined
    }
    if (typeof candidate.toolCallExpansion === "string") {
      const mode = candidate.toolCallExpansion.trim()
      if (mode === "collapsed" || mode === "activity" || mode === "detailed" || mode === "changes") {
        result.toolCallExpansion = mode
      }
    }
    if (typeof candidate.inputSpellcheckEnabled === "boolean") {
      result.inputSpellcheckEnabled = candidate.inputSpellcheckEnabled
    }
    if (typeof candidate.showToolFileIcons === "boolean") {
      result.showToolFileIcons = candidate.showToolFileIcons
    }
    if (typeof candidate.showExpandedBashTools === "boolean") {
      result.showExpandedBashTools = candidate.showExpandedBashTools
    }
    if (typeof candidate.showExpandedEditTools === "boolean") {
      result.showExpandedEditTools = candidate.showExpandedEditTools
    }
    if (typeof candidate.timeFormatPreference === "string") {
      const mode = candidate.timeFormatPreference.trim()
      if (mode === "auto" || mode === "12h" || mode === "24h") {
        result.timeFormatPreference = mode
      }
    }
    if (typeof candidate.weekStartPreference === "string") {
      const mode = candidate.weekStartPreference.trim()
      if (mode === "auto" || mode === "sunday" || mode === "monday") {
        result.weekStartPreference = mode
      }
    }
    if (typeof candidate.chatRenderMode === "string") {
      const mode = candidate.chatRenderMode.trim()
      if (mode === "sorted" || mode === "live") {
        result.chatRenderMode = mode
      }
    }
    if (typeof candidate.messageStreamTransport === "string") {
      const mode = candidate.messageStreamTransport.trim()
      if (mode === "auto" || mode === "ws" || mode === "sse") {
        result.messageStreamTransport = mode
      }
    }
    if (typeof candidate.activityRenderMode === "string") {
      const mode = candidate.activityRenderMode.trim()
      if (mode === "collapsed" || mode === "summary") {
        result.activityRenderMode = mode
      }
    }
    if (typeof candidate.mermaidRenderingMode === "string") {
      const mode = candidate.mermaidRenderingMode.trim()
      if (mode === "svg" || mode === "ascii") {
        result.mermaidRenderingMode = mode
      }
    }
    if (typeof candidate.userMessageRenderingMode === "string") {
      const mode = candidate.userMessageRenderingMode.trim()
      if (mode === "markdown" || mode === "plain") {
        result.userMessageRenderingMode = mode
      }
    }
    if (typeof candidate.stickyUserHeader === "boolean") {
      result.stickyUserHeader = candidate.stickyUserHeader
    }
    if (typeof candidate.showSplitAssistantMessageActions === "boolean") {
      result.showSplitAssistantMessageActions = candidate.showSplitAssistantMessageActions
    }
    if (typeof candidate.fontSize === "number" && Number.isFinite(candidate.fontSize)) {
      result.fontSize = Math.max(50, Math.min(200, Math.round(candidate.fontSize)))
    }
    if (typeof candidate.terminalFontSize === "number" && Number.isFinite(candidate.terminalFontSize)) {
      result.terminalFontSize = Math.max(9, Math.min(52, Math.round(candidate.terminalFontSize)))
    }
    if (typeof candidate.padding === "number" && Number.isFinite(candidate.padding)) {
      result.padding = Math.max(50, Math.min(200, Math.round(candidate.padding)))
    }
    if (typeof candidate.cornerRadius === "number" && Number.isFinite(candidate.cornerRadius)) {
      result.cornerRadius = Math.max(0, Math.min(32, Math.round(candidate.cornerRadius)))
    }
    if (typeof candidate.inputBarOffset === "number" && Number.isFinite(candidate.inputBarOffset)) {
      result.inputBarOffset = Math.max(0, Math.min(100, Math.round(candidate.inputBarOffset)))
    }

    const favoriteModels = sanitizeModelRefs(candidate.favoriteModels, 64)
    if (favoriteModels) {
      result.favoriteModels = favoriteModels
    }

    const recentModels = sanitizeModelRefs(candidate.recentModels, 16)
    if (recentModels) {
      result.recentModels = recentModels
    }
    if (typeof candidate.diffLayoutPreference === "string") {
      const mode = candidate.diffLayoutPreference.trim()
      if (mode === "dynamic" || mode === "inline" || mode === "side-by-side") {
        result.diffLayoutPreference = mode
      }
    }
    if (typeof candidate.diffViewMode === "string") {
      const mode = candidate.diffViewMode.trim()
      if (mode === "single" || mode === "stacked") {
        result.diffViewMode = mode
      }
    }
    if (typeof candidate.gitChangesViewMode === "string") {
      const mode = candidate.gitChangesViewMode.trim()
      if (mode === "flat" || mode === "tree") {
        result.gitChangesViewMode = mode
      }
    }
    if (typeof candidate.directoryShowHidden === "boolean") {
      result.directoryShowHidden = candidate.directoryShowHidden
    }
    if (typeof candidate.filesViewShowGitignored === "boolean") {
      result.filesViewShowGitignored = candidate.filesViewShowGitignored
    }
    if (typeof candidate.openInAppId === "string") {
      const trimmed = candidate.openInAppId.trim()
      if (trimmed.length > 0) {
        result.openInAppId = trimmed
      }
    }

    // Message limit — single setting for fetch / trim / Load More chunk
    if (typeof candidate.messageLimit === "number" && Number.isFinite(candidate.messageLimit)) {
      result.messageLimit = Math.max(10, Math.min(500, Math.round(candidate.messageLimit)))
    }

    const skillCatalogs = sanitizeSkillCatalogs(candidate.skillCatalogs)
    if (skillCatalogs) {
      result.skillCatalogs = skillCatalogs
    }

    // Usage model selections - which models appear in dropdown
    const usageSelectedModels = sanitizeProviderStringMap(candidate.usageSelectedModels)
    if (usageSelectedModels) {
      result.usageSelectedModels = usageSelectedModels
    }

    // Usage page collapsed families - for "Other Models" section
    const usageCollapsedFamilies = sanitizeProviderStringMap(candidate.usageCollapsedFamilies)
    if (usageCollapsedFamilies) {
      result.usageCollapsedFamilies = usageCollapsedFamilies
    }

    // Header dropdown expanded families (inverted - stores EXPANDED, default all collapsed)
    const usageExpandedFamilies = sanitizeProviderStringMap(candidate.usageExpandedFamilies)
    if (usageExpandedFamilies) {
      result.usageExpandedFamilies = usageExpandedFamilies
    }

    // Custom model groups configuration
    if (candidate.usageModelGroups && typeof candidate.usageModelGroups === "object") {
      const sanitized = {}
      for (const [providerId, config] of Object.entries(candidate.usageModelGroups)) {
        if (typeof providerId !== "string") continue

        const providerConfig = {}

        // customGroups: array of {id, label, models, order}
        if (Array.isArray(config.customGroups)) {
          const validGroups = config.customGroups
            .filter((g) => g && typeof g.id === "string" && typeof g.label === "string")
            .map((g) => ({
              id: g.id.slice(0, 64),
              label: g.label.slice(0, 128),
              models: Array.isArray(g.models) ? g.models.filter((m) => typeof m === "string").slice(0, 500) : [],
              order: typeof g.order === "number" ? g.order : 0,
            }))
          if (validGroups.length > 0) {
            providerConfig.customGroups = validGroups
          }
        }

        // modelAssignments: Record<modelName, groupId>
        if (config.modelAssignments && typeof config.modelAssignments === "object") {
          const assignments = {}
          for (const [model, groupId] of Object.entries(config.modelAssignments)) {
            if (typeof model === "string" && typeof groupId === "string") {
              assignments[model] = groupId
            }
          }
          if (Object.keys(assignments).length > 0) {
            providerConfig.modelAssignments = assignments
          }
        }

        // renamedGroups: Record<groupId, label>
        if (config.renamedGroups && typeof config.renamedGroups === "object") {
          const renamed = {}
          for (const [groupId, label] of Object.entries(config.renamedGroups)) {
            if (typeof groupId === "string" && typeof label === "string") {
              renamed[groupId] = label.slice(0, 128)
            }
          }
          if (Object.keys(renamed).length > 0) {
            providerConfig.renamedGroups = renamed
          }
        }

        if (Object.keys(providerConfig).length > 0) {
          sanitized[providerId] = providerConfig
        }
      }
      if (Object.keys(sanitized).length > 0) {
        result.usageModelGroups = sanitized
      }
    }

    // Global behavior prompt — synced to ~/.config/ax-code/AGENTS.md
    if (typeof candidate.globalBehaviorPrompt === "string") {
      const value = candidate.globalBehaviorPrompt
      if (value.length <= 1024 * 1024) {
        result.globalBehaviorPrompt = value
      }
    }

    if (typeof candidate.responseStyleEnabled === "boolean") {
      result.responseStyleEnabled = candidate.responseStyleEnabled
    }

    if (
      typeof candidate.responseStylePreset === "string" &&
      ["concise", "detailed", "mentor", "pushback", "noFiller", "matchEnergy", "warmPeer", "custom"].includes(
        candidate.responseStylePreset,
      )
    ) {
      result.responseStylePreset = candidate.responseStylePreset
    }

    if (typeof candidate.responseStyleCustomInstructions === "string") {
      const value = candidate.responseStyleCustomInstructions
      if (value.length <= 50_000) {
        result.responseStyleCustomInstructions = value
      }
    }

    return result
  }

  const mergePersistedSettings = (current, changes) => {
    const baseApproved = Array.isArray(changes.approvedDirectories)
      ? changes.approvedDirectories
      : Array.isArray(current.approvedDirectories)
        ? current.approvedDirectories
        : []

    const additionalApproved = []
    if (typeof changes.lastDirectory === "string" && changes.lastDirectory.length > 0) {
      additionalApproved.push(changes.lastDirectory)
    }
    if (typeof changes.homeDirectory === "string" && changes.homeDirectory.length > 0) {
      additionalApproved.push(changes.homeDirectory)
    }
    const projectEntries = Array.isArray(changes.projects)
      ? changes.projects
      : Array.isArray(current.projects)
        ? current.projects
        : []
    projectEntries.forEach((project) => {
      if (project && typeof project.path === "string" && project.path.length > 0) {
        additionalApproved.push(project.path)
      }
    })
    const approvedSource = [...baseApproved, ...additionalApproved]

    const baseBookmarks = Array.isArray(changes.securityScopedBookmarks)
      ? changes.securityScopedBookmarks
      : Array.isArray(current.securityScopedBookmarks)
        ? current.securityScopedBookmarks
        : []

    const nextTypographySizes = changes.typographySizes
      ? {
          ...(current.typographySizes || {}),
          ...changes.typographySizes,
        }
      : current.typographySizes

    const next = {
      ...current,
      ...changes,
      approvedDirectories: uniqueNonEmptyStrings(approvedSource),
      securityScopedBookmarks: uniqueNonEmptyStrings(baseBookmarks),
      typographySizes: nextTypographySizes,
    }

    return next
  }

  const formatSettingsResponse = (settings) => {
    const sanitized = sanitizeSettingsUpdate(settings)
    const approved = normalizeStringArray(settings.approvedDirectories)
    const bookmarks = normalizeStringArray(settings.securityScopedBookmarks)
    return {
      ...sanitized,
      approvedDirectories: approved,
      securityScopedBookmarks: bookmarks,
      pinnedDirectories: normalizeStringArray(settings.pinnedDirectories),
      typographySizes: sanitizeTypographySizesPartial(settings.typographySizes),
      showReasoningTraces:
        typeof settings.showReasoningTraces === "boolean"
          ? settings.showReasoningTraces
          : typeof sanitized.showReasoningTraces === "boolean"
            ? sanitized.showReasoningTraces
            : false,
      collapsibleThinkingBlocks:
        typeof settings.collapsibleThinkingBlocks === "boolean"
          ? settings.collapsibleThinkingBlocks
          : typeof sanitized.collapsibleThinkingBlocks === "boolean"
            ? sanitized.collapsibleThinkingBlocks
            : true,
    }
  }

  return {
    sanitizeSettingsUpdate,
    mergePersistedSettings,
    formatSettingsResponse,
  }
}
