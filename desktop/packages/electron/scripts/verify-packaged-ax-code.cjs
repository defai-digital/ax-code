"use strict"

const fs = require("node:fs")
const path = require("node:path")
const { findUnsafeRuntimeSymlinks } = require("./runtime-symlinks.cjs")

const isStageRequired = (env = process.env) => {
  const value = typeof env.AX_CODE_STAGE_REQUIRED === "string" ? env.AX_CODE_STAGE_REQUIRED.trim().toLowerCase() : ""
  return value === "true" || value === "1" || value === "yes"
}

const resolvePackagedAxCodeRoot = ({ appOutDir, electronPlatformName, packager }) => {
  if (!appOutDir) throw new Error("electron-builder did not provide appOutDir")
  if (electronPlatformName === "darwin") {
    const productFilename = packager?.appInfo?.productFilename || "AX Code"
    return path.join(appOutDir, `${productFilename}.app`, "Contents", "Resources", "ax-code")
  }
  return path.join(appOutDir, "resources", "ax-code")
}

const dependencyManifestPath = (runtimeRoot, dependency) =>
  path.join(runtimeRoot, "node_modules", ...dependency.split("/"), "package.json")

const verifyPackagedAxCode = (
  context,
  { env = process.env, exists = fs.existsSync, readFile = fs.readFileSync } = {},
) => {
  const runtimeRoot = resolvePackagedAxCodeRoot(context)
  const platform = context.electronPlatformName
  const launcher = path.join(runtimeRoot, "bin", platform === "win32" ? "ax-code.cmd" : "ax-code")
  const manifestPath = path.join(runtimeRoot, "package.json")

  if (!exists(launcher) || !exists(manifestPath)) {
    if (isStageRequired(env)) {
      throw new Error(`Packaged app is missing the required ax-code runtime at ${runtimeRoot}`)
    }
    console.log("[verify-packaged-ax-code] bundled runtime placeholder detected; skipping dependency verification")
    return { status: "skipped", runtimeRoot }
  }

  const manifest = JSON.parse(readFile(manifestPath, "utf8"))
  const dependencies = Object.keys(manifest.dependencies || {})
  if (dependencies.length === 0) {
    throw new Error(`Packaged ax-code runtime manifest has no dependencies: ${manifestPath}`)
  }

  const unsafeSymlinks = findUnsafeRuntimeSymlinks(runtimeRoot)
  if (unsafeSymlinks.length > 0) {
    throw new Error(
      `Packaged ax-code runtime contains ${unsafeSymlinks.length} unsafe symlinks: ${unsafeSymlinks.join(", ")}`,
    )
  }

  const missing = dependencies.filter((dependency) => !exists(dependencyManifestPath(runtimeRoot, dependency)))
  if (missing.length > 0) {
    throw new Error(
      `Packaged ax-code runtime is missing ${missing.length} direct dependencies: ${missing.sort().join(", ")}`,
    )
  }

  console.log(`[verify-packaged-ax-code] verified ${dependencies.length} direct runtime dependencies`)
  return { status: "verified", runtimeRoot, dependencies }
}

const afterPack = async (context) => {
  verifyPackagedAxCode(context)
}

module.exports = afterPack
module.exports.__test = {
  dependencyManifestPath,
  isStageRequired,
  resolvePackagedAxCodeRoot,
  verifyPackagedAxCode,
}
