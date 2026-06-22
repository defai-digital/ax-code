import fs from "fs"
import os from "os"
import path from "path"

const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/

export function validateSkillName(skillName) {
  if (typeof skillName !== "string") return false
  if (skillName.length < 1 || skillName.length > 64) return false
  return SKILL_NAME_PATTERN.test(skillName)
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
  const parts = String(repoRelPosixPath || "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
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
