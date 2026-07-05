import { realpathSync, statSync } from "fs"
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

const SENSITIVE_HOME_DIRECTORIES = [".ssh", ".gnupg", ".aws", ".azure", ".config/gcloud", ".docker", ".kube", ".npm"]

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
  const directory = Filesystem.resolve(decoded)
  const realDirectory = (() => {
    try {
      return realpathSync(directory)
    } catch {
      return directory
    }
  })()
  const stat = (() => {
    try {
      return statSync(realDirectory)
    } catch {
      return undefined
    }
  })()
  if (!stat?.isDirectory()) return invalidRequest(c, { message: "Directory does not exist or is not a directory" })

  const home = Filesystem.resolve(os.homedir())
  const sensitiveHomeDirectories = SENSITIVE_HOME_DIRECTORIES.map((entry) => path.join(home, entry))
  const isSensitiveHomeDirectory = sensitiveHomeDirectories.some(
    (blocked) => realDirectory === blocked || Filesystem.contains(blocked, realDirectory),
  )
  if (DANGEROUS_ROOTS.has(realDirectory) || isSensitiveHomeDirectory) {
    return invalidRequest(c, { message: "Directory is not allowed", details: { resource: "directory" } })
  }
  return realDirectory
}
