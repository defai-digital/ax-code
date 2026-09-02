"use strict"

const fs = require("node:fs")
const path = require("node:path")
const { verifyRuntimeManifest } = require("../../../../script/runtime-manifest.cjs")

const EMBEDDED_MANIFEST_NAME = "ax-code-runtime-manifest.json"
const PLACEHOLDER_SCHEMA = "ax-code.runtime-manifest.placeholder.v1"

function verifyBundledAxCodeIntegrity({
  platform = process.platform,
  isPackaged,
  appPath,
  resourcesPath,
  exists = fs.existsSync,
  readFile = fs.readFileSync,
} = {}) {
  if (!isPackaged) return { status: "skipped", reason: "unpackaged" }
  if (!appPath || !resourcesPath) throw new Error("Packaged application and resources paths are required")

  const runtimeRoot = path.join(resourcesPath, "ax-code")
  const launcher = path.join(runtimeRoot, "bin", platform === "win32" ? "ax-code.cmd" : "ax-code")
  const runtimePackage = path.join(runtimeRoot, "package.json")
  const trustedManifestPath = path.join(appPath, "dist", EMBEDDED_MANIFEST_NAME)
  if (!exists(trustedManifestPath)) {
    throw new Error(`Packaged ax-code runtime has no trusted ASAR manifest: ${trustedManifestPath}`)
  }

  let trustedManifest
  try {
    trustedManifest = JSON.parse(readFile(trustedManifestPath, "utf8"))
  } catch (error) {
    throw new Error(
      `Packaged ax-code runtime has an invalid trusted ASAR manifest: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  if (trustedManifest?.schema === PLACEHOLDER_SCHEMA) {
    if (exists(launcher) || exists(runtimePackage)) {
      throw new Error("Packaged ax-code runtime is present but the trusted ASAR manifest authorizes only a placeholder")
    }
    return { status: "skipped", reason: "runtime-not-staged", runtimeRoot }
  }

  if (!exists(launcher) || !exists(runtimePackage)) {
    throw new Error(`Packaged ax-code runtime required by the trusted ASAR manifest is incomplete: ${runtimeRoot}`)
  }

  const manifest = verifyRuntimeManifest(runtimeRoot, { manifest: trustedManifest })
  return { status: "verified", runtimeRoot, entries: manifest.files.length }
}

module.exports = { EMBEDDED_MANIFEST_NAME, PLACEHOLDER_SCHEMA, verifyBundledAxCodeIntegrity }
