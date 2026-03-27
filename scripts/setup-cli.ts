/**
 * Sets up the `ax-code` command globally so it can be run from anywhere.
 *
 * Usage: bun run setup:cli
 *
 * Creates a shell script/batch file in Bun's global bin directory
 * that forwards all arguments to the ax-code CLI via bun.
 */

import fs from "fs"
import path from "path"
import os from "os"

const ROOT = path.resolve(import.meta.dir, "..")
const ENTRY = path.join(ROOT, "packages", "ax-code", "src", "index.ts")
const isWindows = os.platform() === "win32"

// Find the directory where bun is installed (already in PATH)
function getBunBinDir(): string {
  const bunExe = Bun.which("bun")
  if (bunExe) return path.dirname(bunExe)
  // Fallback to .bun/bin
  const bunPath = process.env.BUN_INSTALL || path.join(os.homedir(), ".bun")
  return path.join(bunPath, "bin")
}

const binDir = getBunBinDir()

if (!fs.existsSync(binDir)) {
  fs.mkdirSync(binDir, { recursive: true })
}

const cwdPath = path.join(ROOT, "packages", "ax-code")
const shContent = `#!/bin/sh\nexec bun run --cwd "${cwdPath.replace(/\\/g, "/")}" --conditions=browser "${ENTRY.replace(/\\/g, "/")}" "$@"\n`

if (isWindows) {
  // Create .cmd file for Windows (PowerShell/cmd.exe)
  const cmdPath = path.join(binDir, "ax-code.cmd")
  const cmdContent = `@echo off\nbun run --cwd "${cwdPath}" --conditions=browser "${ENTRY}" %*\n`
  fs.writeFileSync(cmdPath, cmdContent)
  console.log(`Created: ${cmdPath}`)

  // Create bash-compatible script (Git Bash/WSL)
  const bashPath = path.join(binDir, "ax-code")
  fs.writeFileSync(bashPath, shContent, { mode: 0o755 })
  console.log(`Created: ${bashPath}`)
} else {
  // Create shell script for Unix/macOS
  const shPath = path.join(binDir, "ax-code")
  fs.writeFileSync(shPath, shContent, { mode: 0o755 })
  console.log(`Created: ${shPath}`)
}

console.log(`\nax-code CLI installed globally!`)
console.log(`\nTry it:`)
console.log(`  ax-code --help`)
console.log(`  ax-code providers list`)
console.log(`  ax-code mcp add`)
console.log(`\nIf "ax-code" is not found, ensure ${binDir} is in your PATH.`)
