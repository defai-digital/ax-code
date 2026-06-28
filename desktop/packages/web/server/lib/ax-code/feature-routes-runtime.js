import { registerFsRoutes } from "../fs/routes.js"
import { registerQuotaRoutes } from "../quota/routes.js"
import { registerGitHubRoutes } from "../github/routes.js"
import { registerGitRoutes } from "../git/routes.js"
import { registerMagicPromptRoutes } from "../magic-prompts/routes.js"
import { registerSessionFoldersRoutes } from "../session-folders/routes.js"
import { registerCanvasRoutes } from "../canvas/routes.js"
import { registerConfigEntityRoutes } from "./config-entity-routes.js"
import { registerSettingsUtilityRoutes } from "./core-routes.js"
import { registerProjectIconRoutes } from "./project-icon-routes.js"
import { registerScheduledTaskRoutes } from "../scheduled-tasks/routes.js"
import { registerSkillRoutes } from "./skill-routes.js"
import { registerPluginRoutes } from "./plugin-routes.js"
import { getNpmInfo, clearCache as clearNpmCache } from "./npm-registry.js"
import { parseNpmSpec, parsePathSpec, isExactSemver } from "./plugin-spec.js"
import { registerAxCodeRoutes } from "./routes.js"
import { createBackgroundAxCodeReloader } from "./background-reload.js"

export const createFeatureRoutesRuntime = (dependencies) => {
  const { clientReloadDelayMs } = dependencies

  let quotaProviders = null
  const getQuotaProviders = async () => {
    if (!quotaProviders) {
      quotaProviders = await import("../quota/index.js")
    }
    return quotaProviders
  }

  const registerRoutes = async (app, routeDependencies) => {
    const {
      crypto,
      fs,
      os,
      path,
      fsPromises,
      spawn,
      resolveGitBinaryForSpawn,
      createFsSearchRuntime,
      openchamberDataDir,
      openchamberUserConfigRoot,
      normalizeDirectoryPath,
      resolveProjectDirectory,
      resolveOptionalProjectDirectory,
      validateDirectoryPath,
      readCustomThemesFromDisk,
      refreshAxCodeAfterConfigChange,
      getAxCodeResolutionSnapshot,
      formatSettingsResponse,
      readSettingsFromDisk,
      readSettingsFromDiskMigrated,
      persistSettings,
      sanitizeProjects,
      sanitizeSkillCatalogs,
      isUnsafeSkillRelativePath,
      buildAxCodeUrl,
      getAxCodeAuthHeaders,
      getAxCodePort,
      buildAugmentedPath,
      projectConfigRuntime,
      scheduledTasksRuntime,
      getOpenChamberEventClients,
      writeSseEvent,
    } = routeDependencies

    const { getProviderSources, removeProviderConfig } = await import("./index.js")
    const backgroundAxCodeReloader = createBackgroundAxCodeReloader({
      refreshAxCodeAfterConfigChange,
      clientReloadDelayMs,
    })

    registerSettingsUtilityRoutes(app, {
      readCustomThemesFromDisk,
      refreshAxCodeAfterConfigChange,
      clientReloadDelayMs,
      backgroundAxCodeReloader,
    })

    registerAxCodeRoutes(app, {
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
    })

    registerProjectIconRoutes(app, {
      fsPromises,
      path,
      crypto,
      openchamberDataDir,
      sanitizeProjects,
      readSettingsFromDiskMigrated,
      persistSettings,
      createFsSearchRuntime,
      spawn,
      resolveGitBinaryForSpawn,
    })

    registerScheduledTaskRoutes(app, {
      readSettingsFromDiskMigrated,
      sanitizeProjects,
      projectConfigRuntime,
      scheduledTasksRuntime,
      getOpenChamberEventClients,
      writeSseEvent,
    })

    const {
      getAgentSources,
      getAgentConfig,
      createAgent,
      updateAgent,
      deleteAgent,
      getCommandSources,
      createCommand,
      updateCommand,
      deleteCommand,
      listMcpConfigs,
      getMcpConfig,
      createMcpConfig,
      updateMcpConfig,
      deleteMcpConfig,
      listSnippets,
      getSnippet,
      createSnippet,
      updateSnippet,
      deleteSnippet,
      expandSnippets,
      listPluginEntries,
      getPluginEntry,
      createPluginEntry,
      updatePluginEntry,
      deletePluginEntry,
      listPluginDirFiles,
      readPluginDirFile,
      writePluginDirFile,
      deletePluginDirFile,
      encodePluginId,
      decodePluginId,
    } = await import("./index.js")

    registerConfigEntityRoutes(app, {
      resolveProjectDirectory,
      resolveOptionalProjectDirectory,
      refreshAxCodeAfterConfigChange,
      clientReloadDelayMs,
      getAgentSources,
      getAgentConfig,
      createAgent,
      updateAgent,
      deleteAgent,
      getCommandSources,
      createCommand,
      updateCommand,
      deleteCommand,
      listMcpConfigs,
      getMcpConfig,
      createMcpConfig,
      updateMcpConfig,
      deleteMcpConfig,
      listSnippets,
      getSnippet,
      createSnippet,
      updateSnippet,
      deleteSnippet,
      expandSnippets,
    })

    registerPluginRoutes(app, {
      resolveOptionalProjectDirectory,
      refreshAxCodeAfterConfigChange,
      clientReloadDelayMs,
      listPluginEntries,
      getPluginEntry,
      createPluginEntry,
      updatePluginEntry,
      deletePluginEntry,
      listPluginDirFiles,
      readPluginDirFile,
      writePluginDirFile,
      deletePluginDirFile,
      encodePluginId,
      decodePluginId,
      getNpmInfo,
      parseNpmSpec,
      parsePathSpec,
      isExactSemver,
    })

    const {
      getSkillSources,
      discoverSkills,
      mergeDiscoveredSkills,
      createSkill,
      updateSkill,
      deleteSkill,
      readSkillSupportingFile,
      writeSkillSupportingFile,
      deleteSkillSupportingFile,
      SKILL_SCOPE,
      SKILL_DIR,
    } = await import("./index.js")

    const {
      getCuratedSkillsSources,
      getCacheKey,
      getCachedScan,
      setCachedScan,
      parseSkillRepoSource,
      scanSkillsRepository,
      installSkillsFromRepository,
      scanClawdHubPage,
      installSkillsFromClawdHub,
      isClawdHubSource,
    } = await import("../skills-catalog/index.js")
    const { getProfiles, getProfile } = await import("../git/index.js")

    registerSkillRoutes(app, {
      fs,
      path,
      os,
      resolveProjectDirectory,
      resolveOptionalProjectDirectory,
      readSettingsFromDisk,
      sanitizeSkillCatalogs,
      isUnsafeSkillRelativePath,
      refreshAxCodeAfterConfigChange,
      clientReloadDelayMs,
      buildAxCodeUrl,
      getAxCodeAuthHeaders,
      getAxCodePort,
      getSkillSources,
      discoverSkills,
      mergeDiscoveredSkills,
      createSkill,
      updateSkill,
      deleteSkill,
      readSkillSupportingFile,
      writeSkillSupportingFile,
      deleteSkillSupportingFile,
      SKILL_SCOPE,
      SKILL_DIR,
      getCuratedSkillsSources,
      getCacheKey,
      getCachedScan,
      setCachedScan,
      parseSkillRepoSource,
      scanSkillsRepository,
      installSkillsFromRepository,
      scanClawdHubPage,
      installSkillsFromClawdHub,
      isClawdHubSource,
      getProfiles,
      getProfile,
    })

    registerQuotaRoutes(app, { getQuotaProviders })
    registerGitHubRoutes(app)
    registerGitRoutes(app)
    registerMagicPromptRoutes(app, {
      fsPromises,
      path,
      openchamberDataDir,
    })
    registerSessionFoldersRoutes(app, {
      fsPromises,
      path,
      openchamberDataDir,
    })
    registerCanvasRoutes(app, {
      fsPromises,
      path,
      resolveProjectDirectory,
    })
    registerFsRoutes(app, {
      os,
      path,
      fsPromises,
      spawn,
      crypto,
      normalizeDirectoryPath,
      resolveProjectDirectory,
      readSettingsFromDiskMigrated,
      buildAugmentedPath,
      resolveGitBinaryForSpawn,
      openchamberUserConfigRoot,
    })
  }

  return {
    registerRoutes,
  }
}
