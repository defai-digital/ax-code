"use strict"

const path = require("path")
const os = require("os")

const DENIED_SEGMENTS = [
  ".ssh",
  ".aws",
  ".gnupg",
  ".gpg",
  ".docker",
  ".kube",
  ".azure",
  ".config/gh",
  ".config/gcloud",
  ".config/google-chrome",
  ".config/chromium",
  ".config/openchamber/credentials",
  "library/application support/google/chrome",
  "library/application support/chromium",
  "library/application support/microsoft edge",
  "appdata/local/google/chrome",
  "appdata/local/microsoft/edge",
]
const DENIED_BASENAMES = new Set([".env", ".netrc", ".npmrc", ".pypirc"])

const isInsideOrSameDirectory = (rootPath, targetPath, pathTools = path) => {
  if (!rootPath || !targetPath) return false
  const relative = pathTools.relative(rootPath, targetPath)
  return relative === "" || (!relative.startsWith("..") && !pathTools.isAbsolute(relative))
}

const toPosixRelativePath = (relativePath, pathTools = path) =>
  relativePath.split(pathTools.sep).filter(Boolean).join("/")

const assertDesktopReadFileAllowed = (realPath, options = {}) => {
  const pathTools = options.pathTools || path
  const home = typeof options.home === "string" ? options.home : os.homedir() || ""
  const tmp = typeof options.tmp === "string" ? options.tmp : os.tmpdir() || ""

  const underHome = isInsideOrSameDirectory(home, realPath, pathTools)
  const underTmp = isInsideOrSameDirectory(tmp, realPath, pathTools)
  if (!underHome && !underTmp) throw new Error("File is outside the allowed workspace")

  const relFromHome = underHome ? toPosixRelativePath(pathTools.relative(home, realPath), pathTools).toLowerCase() : ""
  if (DENIED_SEGMENTS.some((segment) => relFromHome === segment || relFromHome.startsWith(`${segment}/`))) {
    throw new Error("Access to this path is not allowed")
  }

  const basename = pathTools.basename(realPath).toLowerCase()
  if (
    DENIED_BASENAMES.has(basename) ||
    basename.startsWith(".env.") ||
    basename.endsWith(".pem") ||
    basename.endsWith(".key")
  ) {
    throw new Error("Access to this path is not allowed")
  }
}

module.exports = {
  assertDesktopReadFileAllowed,
  isInsideOrSameDirectory,
}
