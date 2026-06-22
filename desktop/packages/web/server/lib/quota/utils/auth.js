import fs from "fs"
import path from "path"
import os from "os"

const AX_CODE_CONFIG_DIR = process.env.AX_CODE_CONFIG_DIR || path.join(os.homedir(), ".config", "ax-code")
const AX_CODE_DATA_DIR = process.env.AX_CODE_DATA_DIR || path.join(os.homedir(), ".local", "share", "ax-code")

export const ANTIGRAVITY_ACCOUNTS_PATHS = [
  path.join(AX_CODE_CONFIG_DIR, "antigravity-accounts.json"),
  path.join(AX_CODE_DATA_DIR, "antigravity-accounts.json"),
]

export const readJsonFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return null
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8")
    const trimmed = raw.trim()
    if (!trimmed) return null
    return JSON.parse(trimmed)
  } catch (error) {
    console.warn(`Failed to read JSON file: ${filePath}`, error)
    return null
  }
}

export const getAuthEntry = (auth, aliases) => {
  for (const alias of aliases) {
    if (auth[alias]) {
      return auth[alias]
    }
  }
  return null
}

export const normalizeAuthEntry = (entry) => {
  if (!entry) return null
  if (typeof entry === "string") {
    return { token: entry }
  }
  if (typeof entry === "object") {
    return entry
  }
  return null
}
