import fs from "fs"
import path from "path"
import os from "os"

// Respect XDG_DATA_HOME (used by ax-code via xdg-basedir) so the desktop
// reads/writes the same auth.json even when the user has customised XDG paths.
const XDG_DATA_HOME = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share")
const AX_CODE_DATA_DIR = path.join(XDG_DATA_HOME, "ax-code")
const AUTH_FILE = path.join(AX_CODE_DATA_DIR, "auth.json")

// Mirror ax-code's normalizeProviderID so lookups match entries stored
// by the server (trailing slashes stripped, non-safe chars removed).
function normalizeProviderID(providerID) {
  return providerID.replace(/[^\w\-.:/]/g, "").replace(/\/+$/, "")
}

function readAuthFile() {
  if (!fs.existsSync(AUTH_FILE)) {
    return {}
  }
  try {
    const content = fs.readFileSync(AUTH_FILE, "utf8")
    const trimmed = content.trim()
    if (!trimmed) {
      return {}
    }
    return JSON.parse(trimmed)
  } catch (error) {
    console.error("Failed to read auth file:", error)
    throw new Error("Failed to read ax-code auth configuration")
  }
}

function writeAuthFile(auth) {
  try {
    if (!fs.existsSync(AX_CODE_DATA_DIR)) {
      fs.mkdirSync(AX_CODE_DATA_DIR, { recursive: true })
    }

    if (fs.existsSync(AUTH_FILE)) {
      const backupFile = `${AUTH_FILE}.openchamber.backup`
      fs.copyFileSync(AUTH_FILE, backupFile)
      console.log(`Created auth backup: ${backupFile}`)
    }

    // Match ax-code's 0o600 permission — auth.json contains encrypted secrets.
    fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { encoding: "utf8", mode: 0o600 })
    console.log("Successfully wrote auth file")
  } catch (error) {
    console.error("Failed to write auth file:", error)
    throw new Error("Failed to write ax-code auth configuration")
  }
}

function removeProviderAuth(providerId) {
  if (!providerId || typeof providerId !== "string") {
    throw new Error("Provider ID is required")
  }

  const auth = readAuthFile()
  const normalized = normalizeProviderID(providerId)

  // Try raw key, normalized key, and normalized key with trailing slash —
  // matching ax-code's Auth.set/Auth.remove key variants.
  const hadRaw = Object.prototype.hasOwnProperty.call(auth, providerId)
  const hadNorm = Object.prototype.hasOwnProperty.call(auth, normalized)
  const hadSlash = Object.prototype.hasOwnProperty.call(auth, normalized + "/")

  if (!hadRaw && !hadNorm && !hadSlash) {
    console.log(`Provider ${providerId} not found in auth file, nothing to remove`)
    return false
  }

  if (hadRaw) delete auth[providerId]
  if (hadNorm && normalized !== providerId) delete auth[normalized]
  if (hadSlash) delete auth[normalized + "/"]

  writeAuthFile(auth)
  console.log(`Removed provider auth: ${providerId}`)
  return true
}

function getProviderAuth(providerId) {
  const auth = readAuthFile()
  if (auth[providerId]) return auth[providerId]
  const normalized = normalizeProviderID(providerId)
  if (normalized !== providerId && auth[normalized]) return auth[normalized]
  return null
}

function listProviderAuths() {
  const auth = readAuthFile()
  // Filter out internal fields like __canary that ax-code uses for crypto verification.
  return Object.keys(auth).filter((key) => !key.startsWith("__"))
}

export {
  readAuthFile,
  writeAuthFile,
  removeProviderAuth,
  getProviderAuth,
  listProviderAuths,
  normalizeProviderID,
  AUTH_FILE,
  AX_CODE_DATA_DIR,
}
