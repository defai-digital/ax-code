import { realpathSync, statSync } from "fs"
import type { Context } from "hono"
import os from "os"
import path from "path"
import { Filesystem } from "@/util/filesystem"
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
  const raw =
    c.req.query("directory") ||
    c.req.header("x-ax-code-directory") ||
    c.req.header("x-opencode-directory") ||
    process.cwd()
  const decoded = (() => {
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  })()
  if (decoded === process.cwd()) return Filesystem.resolve(decoded)
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
  return directory
}
