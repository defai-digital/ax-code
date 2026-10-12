import { statSync } from "fs"
import type { Context } from "hono"
import os from "os"
import path from "path"
import { Filesystem } from "@/util/filesystem"
import { AX_CODE_DIRECTORY_HEADER, LEGACY_OPENCODE_DIRECTORY_HEADER } from "@/util/directory-headers"
import { invalidRequest } from "./error"

const DANGEROUS_ROOTS = new Set([
  "/",
  "/etc",
  "/proc",
  "/sys",
  "/dev",
  "/boot",
  "/root",
  "/private/etc",
  "/private/var",
  "/private/tmp",
  "/tmp",
  "/Library",
  "/Users/Shared",
])

const WINDOWS_DANGEROUS_ROOTS = ["C:/", "C:/Windows", "C:/Program Files", "C:/Program Files (x86)"]

// Windows paths reach `realDirectory` with either separator and arbitrary
// drive-letter casing (`C:\Windows` vs `c:\windows`), so compare the
// Windows roots case-insensitively on forward-slash form.
function normalizeWindowsPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
}

const WINDOWS_DANGEROUS_ROOTS_NORMALIZED = new Set(WINDOWS_DANGEROUS_ROOTS.map(normalizeWindowsPath))

export function isDangerousRoot(directory: string): boolean {
  if (DANGEROUS_ROOTS.has(directory)) return true
  return WINDOWS_DANGEROUS_ROOTS_NORMALIZED.has(normalizeWindowsPath(directory))
}

const SENSITIVE_HOME_DIRECTORIES = [".ssh", ".gnupg", ".aws", ".azure", ".config/gcloud", ".docker", ".kube", ".npm"]

// Resolving home (a realpath syscall) and rebuilding the sensitive-entry list
// ran on every request, though both are constant for a given homedir. Memoize
// on the raw homedir string so a process whose HOME changes still gets a fresh
// list.
let cachedHome: string | undefined
let cachedSensitiveHomeDirectories: string[] = []
function sensitiveHomeDirectories(): string[] {
  const home = os.homedir()
  if (home !== cachedHome) {
    // Build the list BEFORE recording the key: a resolve that throws
    // (EACCES/EIO/ELOOP — Filesystem.resolve only falls back on ENOENT) must
    // not leave the new homedir memoized against the previous home's list,
    // which would fail the denylist open for every later request.
    const resolved = Filesystem.resolve(home)
    cachedSensitiveHomeDirectories = SENSITIVE_HOME_DIRECTORIES.map((entry) => path.join(resolved, entry))
    cachedHome = home
  }
  return cachedSensitiveHomeDirectories
}

export function requestDirectory(c: Context): string | Response {
  const queryDirectory = c.req.query("directory")
  const headerDirectory = c.req.header(AX_CODE_DIRECTORY_HEADER) || c.req.header(LEGACY_OPENCODE_DIRECTORY_HEADER)
  const decoded = (() => {
    if (queryDirectory) return queryDirectory
    const raw = headerDirectory || process.cwd()
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  })()
  if (decoded === process.cwd()) return Filesystem.resolve(decoded)
  if (decoded.includes("\0")) {
    return invalidRequest(c, { message: "Directory contains null byte", details: { resource: "directory" } })
  }
  if (!path.isAbsolute(decoded)) return invalidRequest(c, { message: "Directory must be absolute" })
  // Filesystem.resolve already realpaths (falling back to the unresolved path
  // on ENOENT), so a second realpathSync here would only re-do that work on
  // every request.
  const directory = Filesystem.resolve(decoded)
  const stat = (() => {
    try {
      return statSync(directory)
    } catch {
      return undefined
    }
  })()
  if (!stat?.isDirectory()) return invalidRequest(c, { message: "Directory does not exist or is not a directory" })

  const isSensitiveHomeDirectory = sensitiveHomeDirectories().some(
    (blocked) => directory === blocked || Filesystem.contains(blocked, directory),
  )
  if (isDangerousRoot(directory) || isSensitiveHomeDirectory) {
    return invalidRequest(c, { message: "Directory is not allowed", details: { resource: "directory" } })
  }
  return directory
}
