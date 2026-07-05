import fs from "fs"
import path from "path"
import os from "os"

const GIT_CREDENTIALS_PATH = path.join(os.homedir(), ".git-credentials")

function readGitCredentialsFile(context) {
  try {
    return fs.readFileSync(GIT_CREDENTIALS_PATH, "utf8")
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null
    }
    const suffix = context ? ` ${context}` : ""
    console.error(`Failed to read .git-credentials${suffix}:`, error)
    return null
  }
}

export function discoverGitCredentials() {
  const credentials = []
  const content = readGitCredentialsFile("")
  if (content == null) {
    return credentials
  }

  const lines = content.split("\n").filter((line) => line.trim())

  for (const line of lines) {
    try {
      const url = new URL(line.trim())
      const hostname = url.hostname
      const pathname = url.pathname && url.pathname !== "/" ? url.pathname : ""
      const host = hostname + pathname
      const username = url.username || ""

      if (host && username) {
        const exists = credentials.some((c) => c.host === host && c.username === username)
        if (!exists) {
          credentials.push({ host, username })
        }
      }
    } catch {
      continue
    }
  }

  return credentials
}

export function getCredentialForHost(host) {
  const content = readGitCredentialsFile("for host lookup")
  if (content == null) {
    return null
  }

  const lines = content.split("\n").filter((line) => line.trim())

  for (const line of lines) {
    try {
      const url = new URL(line.trim())
      const hostname = url.hostname
      const pathname = url.pathname && url.pathname !== "/" ? url.pathname : ""
      const credHost = hostname + pathname

      if (credHost === host) {
        return {
          username: url.username || "",
          token: url.password || "",
        }
      }
    } catch {
      continue
    }
  }

  return null
}
