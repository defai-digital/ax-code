import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const asTrimmedString = (value) => (typeof value === "string" ? value.trim() : "")

const readOwnPackageJsonField = (field) => {
  // Running from source this module lives at server/lib/, so the manifest is
  // two levels up. The Electron build inlines the server into a single
  // dist/server.js, collapsing __dirname to the bundle dir — there it is one
  // level up. Probe both layouts.
  const candidatePaths = [
    path.resolve(__dirname, "..", "..", "package.json"),
    path.resolve(__dirname, "..", "package.json"),
  ]
  for (const pkgPath of candidatePaths) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"))
      const value = asTrimmedString(pkg?.[field])
      if (value.length > 0) return value
    } catch {}
  }
  return ""
}

// Remote update checks are hard-disabled: this module must never contact
// registry.npmjs.org or any external update API. Desktop builds update through
// their native updater, not this server-side package manager helper. The
// AX_CODE_UPDATE_* / AX_CODE_DESKTOP_UPDATE_* env vars are intentionally ignored.

/**
 * Get current installed version from package.json
 */
export function getCurrentVersion() {
  return readOwnPackageJsonField("version") || "unknown"
}

export async function checkForUpdates(options = {}) {
  const currentVersion = options.currentVersion || getCurrentVersion()

  // Remote update checks are intentionally disabled for this server-side helper.
  // Return only the fields still consumed by clients while guaranteeing no network I/O.
  return {
    available: false,
    currentVersion,
  }
}
