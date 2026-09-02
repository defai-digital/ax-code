"use strict"

const fs = require("node:fs")
const path = require("node:path")
const {
  MANIFEST_NAME,
  verifyRuntimeManifest,
  writeRuntimeManifest,
} = require("../../../../script/runtime-manifest.cjs")

const EMBEDDED_MANIFEST_NAME = "ax-code-runtime-manifest.json"
const PLACEHOLDER_SCHEMA = "ax-code.runtime-manifest.placeholder.v1"

function isStageRequired(env = process.env) {
  const value = typeof env.AX_CODE_STAGE_REQUIRED === "string" ? env.AX_CODE_STAGE_REQUIRED.trim().toLowerCase() : ""
  return value === "true" || value === "1" || value === "yes"
}

function hasRuntime(runtimeRoot, fileSystem = fs) {
  return (
    fileSystem.existsSync(path.join(runtimeRoot, "package.json")) &&
    (fileSystem.existsSync(path.join(runtimeRoot, "bin", "ax-code")) ||
      fileSystem.existsSync(path.join(runtimeRoot, "bin", "ax-code.cmd")))
  )
}

function prepareRuntimeIntegrityBinding({ runtimeRoot, outputPath, env = process.env, fileSystem = fs } = {}) {
  if (!runtimeRoot || !outputPath) throw new Error("Runtime root and embedded manifest output path are required")
  fileSystem.mkdirSync(path.dirname(outputPath), { recursive: true })

  if (!hasRuntime(runtimeRoot, fileSystem)) {
    fileSystem.writeFileSync(
      outputPath,
      `${JSON.stringify({ schema: PLACEHOLDER_SCHEMA, reason: "runtime-not-staged" }, null, 2)}\n`,
    )
    return { status: "placeholder", outputPath }
  }

  const manifestPath = path.join(runtimeRoot, MANIFEST_NAME)
  if (!fileSystem.existsSync(manifestPath)) {
    if (isStageRequired(env)) {
      throw new Error(`Staged ax-code runtime is missing ${MANIFEST_NAME}: ${runtimeRoot}`)
    }
    writeRuntimeManifest(runtimeRoot)
  }
  const manifest = verifyRuntimeManifest(runtimeRoot)
  fileSystem.copyFileSync(manifestPath, outputPath)
  return { status: "bound", outputPath, entries: manifest.files.length }
}

module.exports = {
  EMBEDDED_MANIFEST_NAME,
  PLACEHOLDER_SCHEMA,
  hasRuntime,
  isStageRequired,
  prepareRuntimeIntegrityBinding,
}
