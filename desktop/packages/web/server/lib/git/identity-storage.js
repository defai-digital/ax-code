import fs from "fs"
import path from "path"
import os from "os"
import crypto from "crypto"

const STORAGE_DIR = path.join(os.homedir(), ".config", "openchamber")
const STORAGE_FILE = path.join(STORAGE_DIR, "git-identities.json")

function ensureStorageDir() {
  fs.mkdirSync(STORAGE_DIR, { recursive: true, mode: 0o700 })
  try {
    fs.chmodSync(STORAGE_DIR, 0o700)
  } catch {}
}

function writeProfilesFile(data) {
  const tmpFile = path.join(
    STORAGE_DIR,
    `.git-identities.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString("hex")}.tmp`,
  )

  try {
    fs.writeFileSync(tmpFile, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
    try {
      fs.chmodSync(tmpFile, 0o600)
    } catch {}
    fs.renameSync(tmpFile, STORAGE_FILE)
    try {
      fs.chmodSync(STORAGE_FILE, 0o600)
    } catch {}
  } catch (error) {
    try {
      fs.rmSync(tmpFile, { force: true })
    } catch {}
    throw error
  }
}

export function loadProfiles() {
  ensureStorageDir()

  try {
    const content = fs.readFileSync(STORAGE_FILE, "utf8")
    const data = JSON.parse(content)
    return data
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { profiles: [] }
    }
    console.error("Failed to load git identity profiles:", error)
    return { profiles: [] }
  }
}

export function saveProfiles(data) {
  ensureStorageDir()

  try {
    writeProfilesFile(data)
    return true
  } catch (error) {
    console.error("Failed to save git identity profiles:", error)
    throw error
  }
}

export function getProfiles() {
  const data = loadProfiles()
  return data.profiles || []
}

export function getProfile(id) {
  const profiles = getProfiles()
  return profiles.find((p) => p.id === id) || null
}

export function createProfile(profileData) {
  const profiles = getProfiles()

  if (profiles.some((p) => p.id === profileData.id)) {
    throw new Error(`Profile with ID "${profileData.id}" already exists`)
  }

  if (!profileData.id || !profileData.userName || !profileData.userEmail) {
    throw new Error("Profile must have id, userName, and userEmail")
  }

  const newProfile = {
    id: profileData.id,
    name: profileData.name || profileData.userName,
    userName: profileData.userName,
    userEmail: profileData.userEmail,
    authType: profileData.authType || "ssh",
    sshKey: profileData.sshKey || null,
    host: profileData.host || null,
    color: profileData.color || "keyword",
    icon: profileData.icon || "branch",
  }

  profiles.push(newProfile)
  saveProfiles({ profiles })

  return newProfile
}

export function updateProfile(id, updates) {
  const profiles = getProfiles()
  const index = profiles.findIndex((p) => p.id === id)

  if (index === -1) {
    throw new Error(`Profile with ID "${id}" not found`)
  }

  profiles[index] = {
    ...profiles[index],
    ...updates,
    id: profiles[index].id,
  }

  saveProfiles({ profiles })
  return profiles[index]
}

export function deleteProfile(id) {
  const profiles = getProfiles()
  const filteredProfiles = profiles.filter((p) => p.id !== id)

  if (filteredProfiles.length === profiles.length) {
    throw new Error(`Profile with ID "${id}" not found`)
  }

  saveProfiles({ profiles: filteredProfiles })
  return true
}
