"use strict"

const fs = require("fs")
const path = require("path")

// ── Computer-use server env ─────────────────────────────────────────────────
// Packaged macOS builds ship the closed-source ax-computer MCP server as an
// extraResource (see electron-builder.yml / scripts/stage-ax-computer.sh).
// End-user machines have no system node, so the server runs under Electron
// itself (ELECTRON_RUN_AS_NODE) via bin/ax-computer-electron. Pointing
// AX_COMPUTER_COMMAND at that shim makes the AX Code runtime spawn the
// bundled server as a child of the app, so macOS TCC prompts (screen
// recording, automation) are attributed to AX Code Desktop.
// Dev and OSS builds have no staged artifact → no overrides, and the runtime
// falls back to its own AX_COMPUTER_COMMAND/PATH resolution.
function buildComputerUseServerEnv({ platform, isPackaged, resourcesPath, execPath, exists = fs.existsSync }) {
  if (platform !== "darwin" || !isPackaged) return {}
  const shim = path.join(resourcesPath, "ax-computer", "bin", "ax-computer-electron")
  if (!exists(shim)) return {}
  return {
    AX_COMPUTER_COMMAND: shim,
    AX_COMPUTER_ELECTRON_BINARY: execPath,
  }
}

module.exports = { buildComputerUseServerEnv }
