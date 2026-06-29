import fs from "fs"
import os from "os"
import path from "path"
import yaml from "yaml"

const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/
const NON_ENGLISH_TEXT_PATTERN = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u

export function validateSkillName(skillName) {
  if (typeof skillName !== "string") return false
  if (skillName.length < 1 || skillName.length > 64) return false
  return SKILL_NAME_PATTERN.test(skillName)
}

export function normalizeRepoRelativePath(repoRelPosixPath) {
  const raw = String(repoRelPosixPath || "").trim()
  if (!raw) return null
  if (raw.includes("\\")) return null
  const parts = raw
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
    return null
  }
  return parts.join("/")
}

export function isRepoPathInside(candidatePath, parentPath) {
  const candidate = normalizeRepoRelativePath(candidatePath)
  if (!candidate) return false
  const parent = normalizeRepoRelativePath(parentPath)
  if (!parent) return true
  return candidate === parent || candidate.startsWith(`${parent}/`)
}

export function hasNonEnglishText(value) {
  if (typeof value !== "string") return false
  return NON_ENGLISH_TEXT_PATTERN.test(value)
}

export function isEnglishOnlyCatalogItem(item) {
  if (!item || typeof item !== "object") return false
  const visibleTextFields = [
    item.skillName,
    item.frontmatterName,
    item.description,
    item.clawdhub?.displayName,
    item.clawdhub?.owner,
  ]
  return visibleTextFields.every((field) => !hasNonEnglishText(field))
}

export function parseSkillMd(content) {
  const text = typeof content === "string" ? content : ""
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) {
    return {
      ok: true,
      frontmatter: {},
      warnings: ["Invalid SKILL.md: missing YAML frontmatter delimiter"],
    }
  }

  try {
    const frontmatter = yaml.parse(match[1]) || {}
    return { ok: true, frontmatter, warnings: [] }
  } catch {
    return {
      ok: true,
      frontmatter: {},
      warnings: ["Invalid SKILL.md: failed to parse YAML frontmatter"],
    }
  }
}

export function getCatalogItemFromSkillDocument({ source, effectiveSubpath, skillDir, skillMdContent }) {
  const skillName = path.posix.basename(skillDir)
  const parsedMd = parseSkillMd(skillMdContent)
  const warnings = [...(parsedMd.warnings || [])]
  const description = typeof parsedMd.frontmatter?.description === "string" ? parsedMd.frontmatter.description : undefined
  const frontmatterName = typeof parsedMd.frontmatter?.name === "string" ? parsedMd.frontmatter.name : undefined

  const installable = validateSkillName(skillName)
  if (!installable) {
    warnings.push("Skill directory name is not a valid AX Code skill name")
  }

  const item = {
    repoSource: source,
    repoSubpath: effectiveSubpath || undefined,
    skillDir,
    skillName,
    frontmatterName,
    description,
    installable,
    warnings: warnings.length ? warnings : undefined,
  }

  if (!isEnglishOnlyCatalogItem(item)) {
    return {
      ...item,
      installable: false,
      warnings: [...warnings, "Skill catalog metadata must be English-only"],
    }
  }

  return item
}

export async function safeRm(dir) {
  try {
    await fs.promises.rm(dir, { recursive: true, force: true })
  } catch {
    // ignore cleanup failures
  }
}

export async function ensureDir(dirPath) {
  await fs.promises.mkdir(dirPath, { recursive: true })
}

export function toRepoFsPath(repoDir, repoRelPosixPath) {
  const normalized = normalizeRepoRelativePath(repoRelPosixPath)
  if (!normalized) {
    throw new Error("Invalid repository path")
  }
  const parts = normalized.split("/")
  return path.join(repoDir, ...parts)
}

export function normalizeUserSkillDir(userSkillDir) {
  if (!userSkillDir) return null
  const legacySkillDir = path.join(os.homedir(), ".config", "ax-code", "skill")
  const pluralSkillDir = path.join(os.homedir(), ".config", "ax-code", "skills")
  if (userSkillDir === legacySkillDir) {
    if (fs.existsSync(legacySkillDir) && !fs.existsSync(pluralSkillDir)) return legacySkillDir
    return pluralSkillDir
  }
  return userSkillDir
}

export function getTargetSkillDir({ scope, targetSource, workingDirectory, userSkillDir, skillName }) {
  const source = targetSource === "agents" ? "agents" : "ax-code"

  if (scope === "user") {
    if (source === "agents") {
      return path.join(os.homedir(), ".agents", "skills", skillName)
    }
    return path.join(userSkillDir, skillName)
  }

  if (!workingDirectory) {
    throw new Error("workingDirectory is required for project installs")
  }

  if (source === "agents") {
    return path.join(workingDirectory, ".agents", "skills", skillName)
  }

  return path.join(workingDirectory, ".ax-code", "skills", skillName)
}
