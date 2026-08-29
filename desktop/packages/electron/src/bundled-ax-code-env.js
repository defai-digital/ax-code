"use strict"

const fs = require("fs")
const path = require("path")

// ── Bundled ax-code runtime env ─────────────────────────────────────────────
// Packaged builds ship the pinned ax-code CLI runtime as an extraResource
// (see electron-builder.yml / scripts/stage-ax-code.sh). Pointing
// AX_CODE_DESKTOP_BUNDLED_AX_CODE_BINARY at the launcher lets the web server
// prefer the bundled runtime over a PATH lookup (resolution order:
// settings.axCodeBinary > explicit env vars > bundled > PATH).
// Dev and placeholder-staged builds have no staged launcher → no override,
// and the runtime falls back to its existing PATH/fallback resolution.

// Windows has no exec bits — existence of the .cmd launcher is enough there.
// On unix the launcher must actually be executable, otherwise a broken staged
// tree would silently mask the PATH fallback.
const defaultIsExecutable = (candidate) => {
  try {
    fs.accessSync(candidate, fs.constants.X_OK)
    return fs.statSync(candidate).isFile()
  } catch {
    return false
  }
}

function buildBundledAxCodeEnv({
  platform,
  isPackaged,
  resourcesPath,
  exists = fs.existsSync,
  isExecutable = defaultIsExecutable,
}) {
  if (!isPackaged) return {}
  const launcher = path.join(resourcesPath, "ax-code", "bin", platform === "win32" ? "ax-code.cmd" : "ax-code")
  const usable = platform === "win32" ? exists(launcher) : isExecutable(launcher)
  if (!usable) return {}
  return {
    AX_CODE_DESKTOP_BUNDLED_AX_CODE_BINARY: launcher,
  }
}

// Merges the bundled-runtime env into a fork/spawn env object: sets the
// variable when this build has a staged launcher, otherwise strips any
// inherited value so a user-exported AX_CODE_DESKTOP_BUNDLED_AX_CODE_BINARY
// cannot leak through `...process.env` and make a dev/OSS build report the
// runtime source as "bundled".
function applyBundledAxCodeEnv(env, bundled) {
  const result = { ...env }
  if (bundled.AX_CODE_DESKTOP_BUNDLED_AX_CODE_BINARY) {
    result.AX_CODE_DESKTOP_BUNDLED_AX_CODE_BINARY = bundled.AX_CODE_DESKTOP_BUNDLED_AX_CODE_BINARY
  } else {
    delete result.AX_CODE_DESKTOP_BUNDLED_AX_CODE_BINARY
  }
  return result
}

module.exports = { applyBundledAxCodeEnv, buildBundledAxCodeEnv }
