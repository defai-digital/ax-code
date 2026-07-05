import fs from "fs"
import path from "path"
import os from "os"
import yaml from "yaml"
import { parse as parseJsonc } from "jsonc-parser"

// ============== PATH CONSTANTS ==============

// Respect XDG_CONFIG_HOME (used by ax-code via xdg-basedir) so the desktop
// reads/writes config, agents, commands, and skills in the same directory even
// when the user has customised XDG paths.
const XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
const AX_CODE_CONFIG_DIR = path.join(XDG_CONFIG_HOME, "ax-code")
const AGENT_DIR = path.join(AX_CODE_CONFIG_DIR, "agents")
const COMMAND_DIR = path.join(AX_CODE_CONFIG_DIR, "commands")
const SKILL_DIR = path.join(AX_CODE_CONFIG_DIR, "skills")
const CONFIG_FILE = path.join(AX_CODE_CONFIG_DIR, "config.json")
const CUSTOM_CONFIG_FILE = process.env.AX_CODE_CONFIG ? path.resolve(process.env.AX_CODE_CONFIG) : null
const PROMPT_FILE_PATTERN = /^\{file:(.+)\}$/i

// ============== SCOPE TYPE CONSTANTS ==============

const CONFIG_SCOPE = {
  USER: "user",
  PROJECT: "project",
}

const AGENT_SCOPE = {
  USER: CONFIG_SCOPE.USER,
  PROJECT: CONFIG_SCOPE.PROJECT,
}

const COMMAND_SCOPE = {
  USER: CONFIG_SCOPE.USER,
  PROJECT: CONFIG_SCOPE.PROJECT,
}

const SKILL_SCOPE = {
  USER: CONFIG_SCOPE.USER,
  PROJECT: CONFIG_SCOPE.PROJECT,
}

// ============== DIRECTORY OPERATIONS ==============

function ensureDirs() {
  if (!fs.existsSync(AX_CODE_CONFIG_DIR)) {
    fs.mkdirSync(AX_CODE_CONFIG_DIR, { recursive: true })
  }
  if (!fs.existsSync(AGENT_DIR)) {
    fs.mkdirSync(AGENT_DIR, { recursive: true })
  }
  if (!fs.existsSync(COMMAND_DIR)) {
    fs.mkdirSync(COMMAND_DIR, { recursive: true })
  }
  if (!fs.existsSync(SKILL_DIR)) {
    fs.mkdirSync(SKILL_DIR, { recursive: true })
  }
}

function ensureProjectAxCodeResourceDirs(workingDirectory, primarySegment, legacySegment) {
  const primaryDir = path.join(workingDirectory, ".ax-code", primarySegment)
  fs.mkdirSync(primaryDir, { recursive: true })

  const legacyDir = path.join(workingDirectory, ".ax-code", legacySegment)
  fs.mkdirSync(legacyDir, { recursive: true })

  return primaryDir
}

function preferExistingLegacyPath(primaryPath, legacyPath) {
  if (fs.existsSync(legacyPath) && !fs.existsSync(primaryPath)) {
    return legacyPath
  }
  return primaryPath
}

function resolveProjectAxCodeResourcePath(workingDirectory, primarySegments, legacySegments) {
  const primaryPath = path.join(workingDirectory, ".ax-code", ...primarySegments)
  const legacyPath = path.join(workingDirectory, ".ax-code", ...legacySegments)
  return preferExistingLegacyPath(primaryPath, legacyPath)
}

function resolveUserAxCodeResourcePath(primarySegments, legacySegments) {
  const primaryPath = path.join(AX_CODE_CONFIG_DIR, ...primarySegments)
  const legacyPath = path.join(AX_CODE_CONFIG_DIR, ...legacySegments)
  return preferExistingLegacyPath(primaryPath, legacyPath)
}

// ============== MARKDOWN FILE OPERATIONS ==============

function parseMdFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8")
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)

  if (!match) {
    return { frontmatter: {}, body: content.trim() }
  }

  let frontmatter = {}
  try {
    frontmatter = yaml.parse(match[1]) || {}
  } catch (error) {
    console.warn(`Failed to parse markdown frontmatter ${filePath}, treating as empty:`, error)
    frontmatter = {}
  }

  const body = match[2].trim()
  return { frontmatter, body }
}

function writeMdFile(filePath, frontmatter, body) {
  try {
    const cleanedFrontmatter = Object.fromEntries(Object.entries(frontmatter).filter(([, value]) => value != null))
    const yamlStr = yaml.stringify(cleanedFrontmatter)
    const content = `---\n${yamlStr}---\n\n${body}`
    fs.writeFileSync(filePath, content, "utf8")
    console.log(`Successfully wrote markdown file: ${filePath}`)
  } catch (error) {
    console.error(`Failed to write markdown file ${filePath}:`, error)
    throw new Error("Failed to write agent markdown file")
  }
}

// ============== CONFIG FILE OPERATIONS ==============

function getProjectConfigCandidates(workingDirectory) {
  if (!workingDirectory) return []
  return [
    path.join(workingDirectory, "ax-code.json"),
    path.join(workingDirectory, "ax-code.jsonc"),
    path.join(workingDirectory, ".ax-code", "ax-code.json"),
    path.join(workingDirectory, ".ax-code", "ax-code.jsonc"),
  ]
}

function getProjectConfigPath(workingDirectory) {
  if (!workingDirectory) return null

  const candidates = getProjectConfigCandidates(workingDirectory)

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  return candidates[0]
}

function ensureProjectConfigPath(workingDirectory) {
  const configDir = path.join(workingDirectory, ".ax-code")
  fs.mkdirSync(configDir, { recursive: true })
  return path.join(configDir, "ax-code.json")
}

function resolveAxCodeConfigDir(customConfigFile = CUSTOM_CONFIG_FILE) {
  if (customConfigFile) {
    return path.dirname(path.resolve(customConfigFile))
  }
  return AX_CODE_CONFIG_DIR
}

function getUserConfigPaths(configDir = AX_CODE_CONFIG_DIR) {
  return [
    path.join(configDir, "config.json"),
    path.join(configDir, "ax-code.json"),
    path.join(configDir, "ax-code.jsonc"),
  ]
}

function getConfigPaths(workingDirectory, options = {}) {
  const customPath = Object.hasOwn(options, "customPath")
    ? options.customPath
      ? path.resolve(options.customPath)
      : null
    : CUSTOM_CONFIG_FILE
  const configDir = options.configDir ? path.resolve(options.configDir) : AX_CODE_CONFIG_DIR
  return {
    userPaths: getUserConfigPaths(configDir),
    projectPath: getProjectConfigPath(workingDirectory),
    customPath,
  }
}

function getPrimaryUserConfigPath(userPaths, fallbackPath = CONFIG_FILE) {
  for (const userPath of userPaths) {
    if (fs.existsSync(userPath)) {
      return userPath
    }
  }

  return fallbackPath
}

function readConfigFile(filePath, options = {}) {
  if (!filePath || !fs.existsSync(filePath)) {
    return {}
  }
  try {
    const content = fs.readFileSync(filePath, "utf8")
    const normalized = content.trim()
    if (!normalized) {
      return {}
    }
    return parseJsonc(normalized, [], { allowTrailingComma: true })
  } catch (error) {
    console.error(`Failed to read config file: ${filePath}`, error)
    if (options.tolerateParseErrors === true) {
      return {}
    }
    throw new Error("Failed to read ax-code configuration")
  }
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
}

function mergeConfigs(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override
  }
  const result = { ...base }
  for (const [key, value] of Object.entries(override)) {
    if (key in result) {
      const baseValue = result[key]
      if (isPlainObject(baseValue) && isPlainObject(value)) {
        result[key] = mergeConfigs(baseValue, value)
      } else {
        result[key] = value
      }
    } else {
      result[key] = value
    }
  }
  return result
}

function readConfigLayers(workingDirectory, options = {}) {
  const { userPaths, projectPath, customPath } = getConfigPaths(workingDirectory)
  const userPath = getPrimaryUserConfigPath(userPaths)
  const userConfig = readConfigFile(userPath, options)
  const projectConfig = readConfigFile(projectPath, options)
  const customConfig = readConfigFile(customPath, options)
  const mergedConfig = mergeConfigs(mergeConfigs(userConfig, projectConfig), customConfig)

  return {
    userConfig,
    projectConfig,
    customConfig,
    mergedConfig,
    paths: { userPath, projectPath, customPath },
  }
}

function readConfig(workingDirectory) {
  return readConfigLayers(workingDirectory).mergedConfig
}

function getConfigForPath(layers, targetPath) {
  if (!targetPath) {
    return layers.userConfig
  }
  if (layers.paths.customPath && targetPath === layers.paths.customPath) {
    return layers.customConfig
  }
  if (layers.paths.projectPath && targetPath === layers.paths.projectPath) {
    return layers.projectConfig
  }
  return layers.userConfig
}

function writeConfig(config, filePath = CONFIG_FILE) {
  try {
    const backupFile = `${filePath}.openchamber.backup`
    try {
      fs.copyFileSync(filePath, backupFile)
      console.log(`Created config backup: ${backupFile}`)
    } catch (error) {
      if (!error || error.code !== "ENOENT") throw error
    }

    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), "utf8")
    console.log(`Successfully wrote config file: ${filePath}`)
  } catch (error) {
    console.error(`Failed to write config file: ${filePath}`, error)
    throw new Error("Failed to write ax-code configuration")
  }
}

function getJsonEntrySource(layers, sectionKey, entryName) {
  const { userConfig, projectConfig, customConfig, paths } = layers
  const customSection = customConfig?.[sectionKey]?.[entryName]
  if (customSection !== undefined) {
    return { section: customSection, config: customConfig, path: paths.customPath, exists: true }
  }

  const projectSection = projectConfig?.[sectionKey]?.[entryName]
  if (projectSection !== undefined) {
    return { section: projectSection, config: projectConfig, path: paths.projectPath, exists: true }
  }

  const userSection = userConfig?.[sectionKey]?.[entryName]
  if (userSection !== undefined) {
    return { section: userSection, config: userConfig, path: paths.userPath, exists: true }
  }

  return { section: null, config: null, path: null, exists: false }
}

function getJsonWriteTarget(layers, preferredScope) {
  const { userConfig, projectConfig, customConfig, paths } = layers
  if (paths.customPath) {
    return { config: customConfig, path: paths.customPath }
  }
  if (preferredScope === CONFIG_SCOPE.PROJECT && paths.projectPath) {
    return { config: projectConfig, path: paths.projectPath }
  }
  return { config: userConfig, path: paths.userPath }
}

function getConfigEntitySources({
  workingDirectory,
  entityName,
  sectionKey,
  bodyField,
  scopes,
  getProjectPath,
  getUserPath,
}) {
  const projectPath = workingDirectory ? getProjectPath(workingDirectory, entityName) : null
  const projectExists = projectPath && fs.existsSync(projectPath)

  const userPath = getUserPath(entityName)
  const userExists = fs.existsSync(userPath)

  const mdPath = projectExists ? projectPath : userExists ? userPath : null
  const mdExists = !!mdPath
  const mdScope = projectExists ? scopes.PROJECT : userExists ? scopes.USER : null

  const layers = readConfigLayers(workingDirectory)
  const jsonSource = getJsonEntrySource(layers, sectionKey, entityName)
  const jsonSection = jsonSource.section
  const jsonPath = jsonSource.path || layers.paths.customPath || layers.paths.projectPath || layers.paths.userPath
  const jsonScope = jsonSource.path === layers.paths.projectPath ? scopes.PROJECT : scopes.USER

  const sources = {
    md: {
      exists: mdExists,
      path: mdPath,
      scope: mdScope,
      fields: [],
    },
    json: {
      exists: jsonSource.exists,
      path: jsonPath,
      scope: jsonSource.exists ? jsonScope : null,
      fields: [],
    },
    projectMd: {
      exists: projectExists,
      path: projectPath,
    },
    userMd: {
      exists: userExists,
      path: userPath,
    },
  }

  if (mdExists) {
    const { frontmatter, body } = parseMdFile(mdPath)
    sources.md.fields = Object.keys(frontmatter)
    if (body) {
      sources.md.fields.push(bodyField)
    }
  }

  if (jsonSection) {
    sources.json.fields = Object.keys(jsonSection)
  }

  return sources
}

// ============== GIT/WORKTREE HELPERS ==============

function getAncestors(startDir, stopDir) {
  if (!startDir) return []
  const result = []
  let current = path.resolve(startDir)
  const resolvedStop = stopDir ? path.resolve(stopDir) : null

  while (true) {
    result.push(current)
    if (resolvedStop && current === resolvedStop) {
      break
    }
    const parent = path.dirname(current)
    if (parent === current) {
      break
    }
    current = parent
  }

  return result
}

function findWorktreeRoot(startDir) {
  if (!startDir) return null
  let current = path.resolve(startDir)

  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) {
      return current
    }
    const parent = path.dirname(current)
    if (parent === current) {
      return null
    }
    current = parent
  }
}

// ============== PROMPT FILE HELPERS ==============

function isPromptFileReference(value) {
  if (typeof value !== "string") {
    return false
  }
  return PROMPT_FILE_PATTERN.test(value.trim())
}

function resolvePromptFilePath(reference) {
  const match = typeof reference === "string" ? reference.trim().match(PROMPT_FILE_PATTERN) : null
  if (!match) {
    return null
  }
  let target = match[1].trim()
  if (!target) {
    return null
  }

  if (target.startsWith("./")) {
    target = target.slice(2)
    target = path.join(AX_CODE_CONFIG_DIR, target)
  } else if (!path.isAbsolute(target)) {
    target = path.join(AX_CODE_CONFIG_DIR, target)
  }

  return target
}

function writePromptFile(filePath, content) {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(filePath, content ?? "", "utf8")
  console.log(`Updated prompt file: ${filePath}`)
}

// ============== SKILL FILE OPERATIONS ==============

function walkSkillMdFiles(rootDir) {
  if (!rootDir || !fs.existsSync(rootDir)) return []

  const results = []
  const walk = (dir) => {
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
        continue
      }
      if (entry.isFile() && entry.name === "SKILL.md") {
        results.push(fullPath)
      }
    }
  }

  walk(rootDir)
  return results
}

function addSkillFromMdFile(skillsMap, skillMdPath, scope, source) {
  let parsed
  try {
    parsed = parseMdFile(skillMdPath)
  } catch {
    return
  }

  const name = typeof parsed.frontmatter?.name === "string" ? parsed.frontmatter.name.trim() : ""
  const description = typeof parsed.frontmatter?.description === "string" ? parsed.frontmatter.description : ""

  if (!name) {
    return
  }

  skillsMap.set(name, {
    name,
    path: skillMdPath,
    scope,
    source,
    description,
  })
}

function resolveSkillSearchDirectories(workingDirectory) {
  const directories = []
  const pushDir = (dir) => {
    if (!dir) return
    const resolved = path.resolve(dir)
    if (!directories.includes(resolved)) {
      directories.push(resolved)
    }
  }

  pushDir(AX_CODE_CONFIG_DIR)

  if (workingDirectory) {
    const worktreeRoot = findWorktreeRoot(workingDirectory) || path.resolve(workingDirectory)
    const projectDirs = getAncestors(workingDirectory, worktreeRoot).map((dir) => path.join(dir, ".ax-code"))
    projectDirs.forEach(pushDir)
  }

  pushDir(path.join(os.homedir(), ".ax-code"))

  const customConfigDir = process.env.AX_CODE_CONFIG_DIR ? path.resolve(process.env.AX_CODE_CONFIG_DIR) : null
  pushDir(customConfigDir)

  return directories
}

function listSkillSupportingFiles(skillDir) {
  if (!fs.existsSync(skillDir)) {
    return []
  }

  const files = []

  function walkDir(dir, relativePath = "") {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name

      if (entry.isDirectory()) {
        walkDir(fullPath, relPath)
      } else if (entry.name !== "SKILL.md") {
        files.push({
          name: entry.name,
          path: relPath,
          fullPath: fullPath,
        })
      }
    }
  }

  walkDir(skillDir)
  return files
}

function assertPathWithinSkillDir(skillDir, relativePath) {
  const root = fs.realpathSync(skillDir)
  const target = path.resolve(root, relativePath)
  const relative = path.relative(root, target)
  const isWithin = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))

  if (!isWithin) {
    const error = new Error("Access to file denied")
    error.code = "EACCES"
    throw error
  }

  return target
}

function readSkillSupportingFile(skillDir, relativePath) {
  const fullPath = assertPathWithinSkillDir(skillDir, relativePath)
  if (!fs.existsSync(fullPath)) {
    return null
  }
  return fs.readFileSync(fullPath, "utf8")
}

function writeSkillSupportingFile(skillDir, relativePath, content) {
  const fullPath = assertPathWithinSkillDir(skillDir, relativePath)
  const dir = path.dirname(fullPath)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(fullPath, content, "utf8")
}

function deleteSkillSupportingFile(skillDir, relativePath) {
  const root = fs.realpathSync(skillDir)
  const fullPath = assertPathWithinSkillDir(skillDir, relativePath)
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath)
    let parentDir = path.dirname(fullPath)
    while (parentDir !== root) {
      try {
        const entries = fs.readdirSync(parentDir)
        if (entries.length === 0) {
          fs.rmdirSync(parentDir)
          parentDir = path.dirname(parentDir)
        } else {
          break
        }
      } catch {
        break
      }
    }
  }
}

export {
  AX_CODE_CONFIG_DIR,
  AGENT_DIR,
  COMMAND_DIR,
  SKILL_DIR,
  CONFIG_FILE,
  CUSTOM_CONFIG_FILE,
  PROMPT_FILE_PATTERN,
  AGENT_SCOPE,
  COMMAND_SCOPE,
  SKILL_SCOPE,
  ensureDirs,
  ensureProjectAxCodeResourceDirs,
  resolveProjectAxCodeResourcePath,
  resolveUserAxCodeResourcePath,
  parseMdFile,
  writeMdFile,
  getProjectConfigCandidates,
  getProjectConfigPath,
  ensureProjectConfigPath,
  resolveAxCodeConfigDir,
  getUserConfigPaths,
  getConfigPaths,
  getPrimaryUserConfigPath,
  readConfigFile,
  isPlainObject,
  mergeConfigs,
  readConfigLayers,
  readConfig,
  getConfigForPath,
  writeConfig,
  getJsonEntrySource,
  getJsonWriteTarget,
  getConfigEntitySources,
  getAncestors,
  findWorktreeRoot,
  isPromptFileReference,
  resolvePromptFilePath,
  writePromptFile,
  walkSkillMdFiles,
  addSkillFromMdFile,
  resolveSkillSearchDirectories,
  listSkillSupportingFiles,
  readSkillSupportingFile,
  writeSkillSupportingFile,
  deleteSkillSupportingFile,
}
